#!/usr/bin/env node
/**
 * `/complexity` — per-task complexity classifier (ADR-0030).
 *
 * Deterministic lookup over `contextkit/policy/complexity-rubric.json`: classifies
 * a task description into a CEREMONY TIER (trivial / feature / architectural) and
 * detects a REGULATED DOMAIN (lgpd / fintech / healthcare / …) that auto-routes to
 * the owning agents and forces the architectural tier. This is NOT LLM judgment —
 * it is a signal-table match, so `/dev-start`, `/pipeline` and `/ship` can right-size
 * the process the same way every time.
 *
 * Zero runtime deps (rule 1): JSON.parse + string matching only. Never throws —
 * a missing/malformed rubric falls back to the embedded DEFAULT_RUBRIC so the
 * classifier still works in a project that seeded nothing (mirrors load.mjs).
 *
 * Usage:
 *   node contextkit/tools/scripts/complexity-rubric.mjs classify "store user CPF + consent"
 *   node contextkit/tools/scripts/complexity-rubric.mjs classify "fix typo" --json
 *   node contextkit/tools/scripts/complexity-rubric.mjs show
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathsFor } from '../../runtime/config/paths.mjs';

/**
 * Embedded fallback — kept deliberately minimal (lgpd + general + the three
 * tiers). The shipped seed `policy/complexity-rubric.json` is the real rubric;
 * this only guarantees classification never crashes when the seed is absent.
 */
const DEFAULT_RUBRIC = Object.freeze({
  version: 1,
  tiers: {
    trivial: { signals: ['typo', 'rename', 'comment', 'bump version', 'lint', 'format'], ceremony: { adr: false, story: false, review: 'light' } },
    feature: { signals: ['add', 'feature', 'endpoint', 'component', 'screen', 'command'], ceremony: { adr: false, story: true, review: 'standard' } },
    architectural: { signals: ['migrate', 'new dependency', 'auth', 'schema', 'breaking', 'rewrite', 'encryption'], ceremony: { adr: true, story: true, review: 'deep' } },
  },
  defaultTier: 'feature',
  domains: {
    lgpd: { signals: ['cpf', 'dados pessoais', 'personal data', 'lgpd', 'consent', 'pii'], complexity: 'high', requiredAgents: ['privacy-lgpd', 'security'], requiredSections: ['data-inventory', 'legal-basis', 'retention', 'data-subject-rights'] },
    general: { signals: [], complexity: 'low', requiredAgents: [], requiredSections: [] },
  },
});

const COMPLEXITY_RANK = { low: 0, medium: 1, high: 2 };

/** Reads the rubric for `root`, falling back to DEFAULT_RUBRIC on any failure. Never throws. */
export function loadRubric(root = process.cwd()) {
  const path = pathsFor(root).complexityRubric;
  if (!existsSync(path)) return structuredClone(DEFAULT_RUBRIC);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));
    return parsed && parsed.tiers && parsed.domains ? parsed : structuredClone(DEFAULT_RUBRIC);
  } catch {
    return structuredClone(DEFAULT_RUBRIC);
  }
}

/** Escapes a string for a deterministic RegExp literal. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when one rubric signal matches the lowercased text. */
function signalMatches(text, signal) {
  const s = String(signal || '').toLowerCase().trim();
  if (!s) return false;
  if (/^[a-z0-9]+$/.test(s) && s.length <= 4) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(s)}([^a-z0-9]|$)`).test(text);
  }
  return text.includes(s);
}

/** True when any signal occurs in the lowercased text. */
function hasAny(text, signals) {
  return Array.isArray(signals) && signals.some((s) => signalMatches(text, s));
}

/**
 * Pure classifier. Tier precedence is architectural → feature → trivial → default
 * (higher ceremony wins on overlap — constitution §8, refuse-low by default). A
 * high-complexity domain match FORCES the architectural tier.
 *
 * @param {string} input task description
 * @param {object} [rubric] loaded rubric (defaults to the embedded fallback)
 * @returns {object} classification with tier, domain, requiredAgents, needsAdr…
 */
export function classify(input, rubric = DEFAULT_RUBRIC) {
  const text = String(input || '').toLowerCase();
  const tiers = rubric.tiers || {};

  let tier = rubric.defaultTier || 'feature';
  if (hasAny(text, tiers.architectural?.signals)) tier = 'architectural';
  else if (hasAny(text, tiers.feature?.signals)) tier = 'feature';
  else if (hasAny(text, tiers.trivial?.signals)) tier = 'trivial';

  // Domain detection — collect every regulated domain whose signals appear.
  const matched = [];
  for (const [name, def] of Object.entries(rubric.domains || {})) {
    if (name === 'general') continue;
    const hits = (def.signals || []).filter((s) => signalMatches(text, s));
    if (hits.length) matched.push({ name, hits: hits.length, def });
  }
  matched.sort((a, b) => b.hits - a.hits);

  const domain = matched[0]?.name || 'general';
  const complexity = matched.reduce(
    (acc, m) => (COMPLEXITY_RANK[m.def.complexity] > COMPLEXITY_RANK[acc] ? m.def.complexity : acc),
    matched.length ? 'low' : (rubric.domains?.general?.complexity || 'low'),
  );
  const requiredAgents = [...new Set(matched.flatMap((m) => m.def.requiredAgents || []))];
  const requiredSections = [...new Set(matched.flatMap((m) => m.def.requiredSections || []))];

  // A regulated (high-complexity) domain forces the architectural tier.
  const forcedByDomain = complexity === 'high' && tier !== 'architectural';
  if (forcedByDomain) tier = 'architectural';

  const ceremony = tiers[tier]?.ceremony || { adr: tier === 'architectural', story: tier !== 'trivial', review: 'standard' };
  const needsAdr = tier === 'architectural' || ceremony.adr === true;

  return {
    input: String(input || ''),
    tier,
    ceremony,
    domain,
    domains: matched.map((m) => m.name),
    complexity,
    requiredAgents,
    requiredSections,
    needsAdr,
    forcedByDomain,
  };
}

/**
 * Pipeline convenience (ADR-0032): classify a task title → the frontmatter
 * `complexity` value (the tier) + a one-line routing hint for the `add` output.
 * Lets `pipeline.mjs add` auto-classify deterministically instead of relying on
 * the AI to run the rubric. Never throws (delegates to the never-throw classify).
 *
 * @param {string} title task title
 * @param {string} [root] project root
 * @returns {{ complexity: string, route: string }}
 */
export function classifyTask(title, root = process.cwd()) {
  const r = classify(title, loadRubric(root));
  // Map the ceremony tier → the pipeline's t-shirt `complexity` field (S|M|L|XL,
  // ticket 040) so the schema stays valid; the TIER/ADR/agent signal rides the
  // returned object (the gate re-derives it; the `add` line surfaces it).
  const complexity = { trivial: 'S', feature: 'M', architectural: 'L' }[r.tier] || 'M';
  const adr = r.needsAdr ? ' · ⚠️ architectural → /new-adr first' : '';
  const agents = r.requiredAgents.length ? ` · route: ${r.requiredAgents.map((a) => `@${a}`).join(' ')}` : '';
  return { complexity, tier: r.tier, needsAdr: r.needsAdr, requiredAgents: r.requiredAgents, route: `${adr}${agents}` };
}

/** Human-readable report. */
function formatHuman(r) {
  const lines = [];
  lines.push(`🧭 Complexity classification`);
  lines.push('─'.repeat(56));
  lines.push(`  Task        : ${r.input || '(empty)'}`);
  lines.push(`  Tier        : ${r.tier}${r.forcedByDomain ? '  (forced by regulated domain)' : ''}`);
  lines.push(`  Ceremony    : ADR=${r.ceremony.adr ? 'yes' : 'no'} · story=${r.ceremony.story ? 'yes' : 'no'} · review=${r.ceremony.review}`);
  lines.push(`  Domain      : ${r.domain}${r.domains.length > 1 ? ` (+ ${r.domains.slice(1).join(', ')})` : ''} · complexity=${r.complexity}`);
  if (r.requiredAgents.length) lines.push(`  Auto-route  : ${r.requiredAgents.map((a) => `@${a}`).join(', ')}`);
  if (r.requiredSections.length) lines.push(`  Sections    : ${r.requiredSections.join(', ')}`);
  lines.push('');
  if (r.needsAdr) lines.push('  ⚠️  Run /new-adr BEFORE implementing (architectural tier).');
  if (r.requiredAgents.length) lines.push(`  ⚠️  Regulated domain — bring in ${r.requiredAgents.map((a) => `@${a}`).join(' + ')} for this work.`);
  if (!r.needsAdr && !r.requiredAgents.length) lines.push('  ✅ No special gate — proceed at the stated ceremony.');
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const cmd = argv[0] === 'classify' || argv[0] === 'show' ? argv[0] : 'classify';
  const rubric = loadRubric(process.cwd());

  if (cmd === 'show') {
    const summary = {
      version: rubric.version,
      tiers: Object.keys(rubric.tiers || {}),
      domains: Object.keys(rubric.domains || {}),
    };
    console.log(wantJson ? JSON.stringify(summary, null, 2) : `Tiers: ${summary.tiers.join(', ')}\nDomains: ${summary.domains.join(', ')}`);
    return;
  }

  const text = argv.filter((a) => a !== 'classify' && a !== '--json').join(' ').trim();
  if (!text) {
    console.error('Usage: complexity-rubric.mjs classify "<task description>" [--json]');
    process.exit(1);
  }
  const result = classify(text, rubric);
  console.log(wantJson ? JSON.stringify(result, null, 2) : formatHuman(result));
}

// Only run the CLI when invoked directly (not when imported by selfcheck/tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('complexity-rubric.mjs')) {
  main();
}
