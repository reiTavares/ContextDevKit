#!/usr/bin/env node
/**
 * agent-registry — unified agent index: roster + squad + routing model/tier +
 * quality signals (CDK-081, PKG-08, umbrella ADR-0072).
 *
 * Advisory, fail-open, read-only tool. Composes committed exports from:
 *   - agent-tuning.mjs  → quality signals (hasBriefing, mentions) + roster
 *   - model-policy.mjs  → routing model/tier per agent
 *   - squad-meta.mjs    → squad detection (via agent-tuning, used transitively)
 *   - templates/claude/agents/*.md → fallback roster when tuning returns empty
 *
 * §8 honesty invariant: costUsd is ALWAYS null. The usage-event schema has no
 * agentName field (only agentScope + attributionSkill), so per-agent cost is
 * UNATTRIBUTABLE. Never fabricate a 0 or guess.
 *
 * CLI:
 *   agent-registry.mjs           # digest table
 *   agent-registry.mjs --json    # full JSON output
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assembleRegistry, COST_NOTE } from './agent-registry-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Schema version stamp for consumers to detect breaking changes. */
const SCHEMA_VERSION = 'cdk-agent-registry/1';

// The agents template dir is resolved from this file's location (rule 4 —
// no 'contextkit/' literal inside resolve/join).
const AGENTS_TEMPLATE_DIR = resolve(HERE, '..', '..', '..', '..', 'claude', 'agents');

// ---------------------------------------------------------------- helpers

/**
 * Reads a UTF-8 file, stripping a leading BOM (rule 4). Returns '' on error.
 * @param {string} filePath
 * @returns {string}
 */
function readSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  } catch {
    return '';
  }
}

/**
 * Lists .md files in a directory. Returns [] when the directory is absent or
 * unreadable — never throws (rule 2, fail-open).
 * @param {string} dirPath
 * @returns {string[]}
 */
function listMarkdown(dirPath) {
  try {
    return readdirSync(dirPath).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * Parses the `name` frontmatter field from a markdown file's YAML front matter.
 * Falls back to the bare filename stem when the field is absent.
 * @param {string} filePath
 * @param {string} stem bare filename without extension
 * @returns {string}
 */
function parseFrontmatterName(filePath, stem) {
  const raw = readSafe(filePath);
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return stem;
  const nameField = /^name:\s*(.+)$/m.exec(match[1]);
  return nameField ? nameField[1].trim() : stem;
}

/**
 * Scans the agents template directory for a fallback roster when agent-tuning
 * returns no agents. Each entry gets zeroed quality signals.
 * @returns {Array<{ name:string, squad:string, hasBriefing:boolean, mentions:number }>}
 */
function scanAgentsDir() {
  const files = listMarkdown(AGENTS_TEMPLATE_DIR).filter((f) => f !== '_TEMPLATE.md');
  return files.map((f) => {
    const stem = f.slice(0, -3);
    const name = parseFrontmatterName(resolve(AGENTS_TEMPLATE_DIR, f), stem);
    const squad = /^qa-/.test(name) ? 'qa-team' : 'devteam';
    return { name, squad, hasBriefing: false, mentions: 0 };
  });
}

// ---------------------------------------------------------------- loader

/**
 * Loads agent-tuning signals by spawning a child process. agent-tuning.mjs
 * calls main() unconditionally at module level (no isMain guard in that file),
 * so a direct dynamic import would print to stdout as a side effect. Running it
 * as a subprocess and capturing stdout is the only clean composition path.
 *
 * Fails open: returns an empty result on any error (rule 2, rule 8).
 *
 * @returns {{ agents: Array<{ name:string, squad:string, hasBriefing:boolean, mentions:number }>, sessionsAnalyzed:number, withoutBriefing:string[] }}
 */
function loadTuning() {
  const tuningScript = resolve(HERE, 'agent-tuning.mjs');
  try {
    const raw = execFileSync(process.execPath, [tuningScript, '--json'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    const parsed = JSON.parse(raw.replace(/^﻿/, ''));
    return parsed;
  } catch {
    return { agents: [], sessionsAnalyzed: 0, withoutBriefing: [] };
  }
}

/**
 * Loads the routing policy and returns a resolver function keyed by agent name.
 * Degrades to a null-returning resolver when the policy is absent or corrupt
 * (fail-open — advisory tool must never crash a session). The resolver first
 * tries the prebuilt roster index (O(1) lookup), then falls back to resolveModel
 * for agents not in the static roster.
 *
 * @returns {Promise<{ resolveFn:(name:string) => { model:string|null, tier:string|null }, sources:{ present:string[], skipped:string[] } }>}
 */
async function buildResolver() {
  const sources = { present: [], skipped: [] };
  const nullResolver = () => ({ model: null, tier: null });

  const policyPath = resolve(HERE, '..', '..', 'policy', 'routing-policy.json');
  if (!existsSync(policyPath)) {
    sources.skipped.push('routing-policy.json (not found)');
    return { resolveFn: nullResolver, sources };
  }
  let policy;
  try {
    policy = JSON.parse(readSafe(policyPath));
    sources.present.push('routing-policy.json');
  } catch {
    sources.skipped.push('routing-policy.json (parse error)');
    return { resolveFn: nullResolver, sources };
  }

  let resolveRoster;
  let resolveModel;
  try {
    ({ resolveRoster, resolveModel } = await import('./model-policy.mjs'));
  } catch {
    sources.skipped.push('model-policy.mjs (import failed)');
    return { resolveFn: nullResolver, sources };
  }

  let roster = [];
  try {
    roster = resolveRoster(policy);
  } catch {
    sources.skipped.push('resolveRoster (threw — degrading)');
  }

  // name→{model,tier} index from the static roster for O(1) lookup.
  /** @type {Map<string,{ model:string|null, tier:string|null }>} */
  const rosterIndex = new Map(
    roster.map((row) => [row.agent, { model: row.model ?? null, tier: row.tier ?? null }]),
  );
  sources.present.push(`routing-policy roster (${roster.length} agents)`);

  return {
    resolveFn: (agentName) => {
      if (rosterIndex.has(agentName)) return rosterIndex.get(agentName);
      try {
        const resolved = resolveModel(agentName, { policy });
        return { model: resolved.model ?? null, tier: resolved.tier ?? null };
      } catch {
        return { model: null, tier: null };
      }
    },
    sources,
  };
}

// ---------------------------------------------------------------- public API

/**
 * Builds and returns the unified agent registry. Advisory + fail-open — all
 * errors degrade gracefully; the function always resolves (never rejects).
 *
 * @param {{ _tuning?: object }} [opts] internal seam for unit tests
 * @returns {Promise<{
 *   schemaVersion: 'cdk-agent-registry/1',
 *   agents: Array<{ name:string, squad:string, model:string|null, tier:string|null, hasBriefing:boolean, mentions:number, costUsd:null, costConfidence:'unattributable' }>,
 *   totals: { agents:number, byTier:Record<string,number>, withoutBriefing:number },
 *   sources: { present:string[], skipped:string[] },
 *   costNote: string
 * }>}
 */
export async function buildAgentRegistry(opts = {}) {
  // 1. Collect quality signals (sync subprocess call).
  const tuningResult = opts._tuning ?? loadTuning();
  let tuningAgents = tuningResult.agents ?? [];

  // 2. Fall back to template dir scan when tuning returns nothing.
  const sources = { present: [], skipped: [] };
  if (tuningAgents.length === 0) {
    const fallback = scanAgentsDir();
    if (fallback.length > 0) {
      tuningAgents = fallback;
      sources.present.push('agents-template-dir (tuning empty — fallback scan)');
    } else {
      sources.skipped.push('agents-template-dir (empty or missing)');
    }
  } else {
    sources.present.push(`agent-tuning (${tuningAgents.length} agents, ${tuningResult.sessionsAnalyzed ?? 0} sessions)`);
  }

  // 3. Build resolver (async — imports model-policy + loads routing policy).
  const { resolveFn, sources: policySources } = await buildResolver();
  sources.present.push(...policySources.present);
  sources.skipped.push(...policySources.skipped);

  // 4. Assemble — pure join in the core module.
  const { agents, totals } = assembleRegistry(tuningAgents, resolveFn);

  return {
    schemaVersion: SCHEMA_VERSION,
    agents,
    totals,
    sources,
    costNote: COST_NOTE,
  };
}

// ---------------------------------------------------------------- CLI

function isMain() {
  if (!process.argv[1]) return false;
  const argv1 = process.argv[1].replace(/\\/g, '/');
  return argv1.endsWith('agent-registry.mjs');
}

/** Renders a human-readable digest table from a registry result. */
function renderTable(registry) {
  const { agents, totals, costNote } = registry;
  if (agents.length === 0) {
    console.log('agent-registry: no agents found.');
    return;
  }
  console.log(`agent-registry  schema=${registry.schemaVersion}`);
  console.log(`${agents.length} agents | ${totals.withoutBriefing} without briefing\n`);
  const header = 'NAME'.padEnd(28) + 'SQUAD'.padEnd(16) + 'TIER'.padEnd(12) + 'MODEL'.padEnd(10) + 'BRIEFING  MENTIONS';
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const a of agents) {
    const row = [
      a.name.padEnd(28),
      a.squad.padEnd(16),
      (a.tier ?? 'unresolved').padEnd(12),
      (a.model ?? 'n/a').padEnd(10),
      (a.hasBriefing ? 'yes' : 'no').padEnd(10),
      String(a.mentions),
    ].join('');
    console.log(row);
  }
  console.log('\nBy tier:', JSON.stringify(totals.byTier));
  console.log('\ncostNote:', costNote);
}

if (isMain()) {
  buildAgentRegistry()
    .then((registry) => {
      if (process.argv.includes('--json')) {
        process.stdout.write(JSON.stringify(registry, null, 2) + '\n');
      } else {
        renderTable(registry);
      }
    })
    .catch((err) => {
      // Exit 0 — advisory tool must never break a real session (rule 2).
      console.error('agent-registry: unexpected error:', err?.message ?? String(err));
    });
}
