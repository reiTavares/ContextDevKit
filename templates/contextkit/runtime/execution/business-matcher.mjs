/**
 * business-matcher.mjs — deterministic Business matcher for a classified
 * Operation (BIZ-0001 / WF-0036 Wave A2, ADR-0102; design §8).
 *
 * Given a classified Operation (`signals.work`) and a project root, it scores
 * every Business in the A1 work-context registry and returns the linkage shape
 * the schema-plan defines: `{ suggested, confirmed, score, status, candidates }`
 * plus a flat `reasons[]` and a structured `evidence` mirror (design §5).
 *
 * Deterministic + explainable, NO embeddings: score is a weighted blend of
 *   value-intent match · operation→business kind affinity · token Jaccard,
 * normalized to 0..1, with a stable `id.localeCompare` tie-break. Same input →
 * same output, always — no `Math.random`, no time, no LLM.
 *
 * Refuse-low / provenance-null (constitution §8): the matcher only ever sets
 * `suggested`; `confirmed` starts null and is stamped ONLY by the human approval
 * ceremony in A3, never here. Zero matches / below threshold → `unlinked`, never
 * a guessed parent.
 *
 * Reuse, never re-scan: it consumes `buildWorkContextRegistry` (A1) and the
 * `businessMatch` policy from `loadWorkPolicy` (A2-T1) — no forked tables, no
 * independent disk walk. Fail-open: any read failure degrades to "no candidate"
 * rather than throwing (immutable rule 2).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';
import { buildWorkContextRegistry } from '../../tools/scripts/registry/work-context.mjs';
import { loadWorkPolicy } from './work-classifier.mjs';
import { tokenize } from './work-classify-signals.mjs';

/** Embedded fallback for the matcher policy (mirrors design §8.2; rule 2). */
const DEFAULT_MATCH = Object.freeze({
  weights: { valueIntent: 3, kind: 2, token: 1 },
  thresholds: { suggested: 0.45, confirmed: 0.75 },
  winnerMargin: 0.1,
  kindAffinity: {
    fix: ['capability', 'product'], change: ['capability', 'product'],
    maintenance: ['capability'], investigation: ['capability', 'compliance'],
    operationalresponse: ['capability', 'product'],
  },
});

/** Resolves the `businessMatch` policy section with a defensive fallback. */
function matchPolicy(policy) {
  const section = policy && typeof policy.businessMatch === 'object' ? policy.businessMatch : null;
  return section && section.weights && section.thresholds ? section : DEFAULT_MATCH;
}

/**
 * Reads one Business's `business.json` from a registry row, returning the fields
 * the matcher scores against. Defensive: an unreadable/invalid file yields a row
 * with empty intents/kind rather than throwing (rule 2), so the candidate is
 * scored as a no-affinity, no-intent match instead of being dropped.
 *
 * @param {string} memoryDir - absolute memory root.
 * @param {object} row - a registry row `{ id, path, title }`.
 * @returns {{ id, title, slug, kind, primary, secondary: string[] }}
 */
function readBusiness(memoryDir, row) {
  const base = { id: row.id, title: row.title || '', slug: '', kind: '', primary: null, secondary: [] };
  const jsonPath = join(memoryDir, String(row.path || ''), 'business.json');
  if (!existsSync(jsonPath)) return base;
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8').replace(/^﻿/, ''));
    const intents = parsed.valueIntents || {};
    return {
      id: row.id,
      title: typeof parsed.title === 'string' ? parsed.title : (row.title || ''),
      slug: typeof parsed.slug === 'string' ? parsed.slug : '',
      kind: typeof parsed.kind === 'string' ? parsed.kind.toLowerCase() : '',
      primary: typeof intents.primary === 'string' ? intents.primary : null,
      secondary: Array.isArray(intents.secondary) ? intents.secondary : [],
    };
  } catch {
    return base;
  }
}

/**
 * Deterministic value-intent component (design §8.2): 1 when the Operation's
 * primary intent is in the Business intent set (primary ∪ secondary), else 0.5
 * when any Operation secondary overlaps, else 0.
 */
function intentMatch(work, business) {
  const intents = new Set([business.primary, ...business.secondary].filter(Boolean));
  const primary = work?.valueIntents?.primary;
  if (primary && intents.has(primary)) return 1;
  const secondaries = Array.isArray(work?.valueIntents?.secondary) ? work.valueIntents.secondary : [];
  return secondaries.some((intent) => intents.has(intent)) ? 0.5 : 0;
}

/**
 * Kind-affinity component (design §8.2): 1 when the Business kind is in the
 * Operation-kind's affinity list, else 0. The classifier emits camelCase
 * Operation kinds; affinity keys are lowercase, so the lookup lowercases first.
 */
function kindAffinity(work, business, affinity) {
  const opKind = String(work?.kind || '').toLowerCase();
  const preferred = Array.isArray(affinity?.[opKind]) ? affinity[opKind] : [];
  return business.kind && preferred.includes(business.kind) ? 1 : 0;
}

/** Token-overlap component (design §8.2): Jaccard of objective vs title+slug. */
function tokenOverlap(objective, business) {
  const left = tokenize(objective);
  const right = tokenize(`${business.title} ${business.slug}`);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Scores one Business candidate into a normalized 0..1 score with its components.
 *
 * @param {object} work - the classified Operation.
 * @param {string} objective - the Operation's free-text objective (for tokens).
 * @param {object} business - a `readBusiness` row.
 * @param {object} cfg - the resolved `businessMatch` policy.
 * @returns {{ id, score, parts: {intent, kind, token} }}
 */
function scoreCandidate(work, objective, business, cfg) {
  const weights = cfg.weights;
  const parts = {
    intent: intentMatch(work, business),
    kind: kindAffinity(work, business, cfg.kindAffinity),
    token: tokenOverlap(objective, business),
  };
  const max = weights.valueIntent + weights.kind + weights.token;
  const raw = weights.valueIntent * parts.intent + weights.kind * parts.kind + weights.token * parts.token;
  const score = max > 0 ? Math.round((raw / max) * 1000) / 1000 : 0;
  return { id: business.id, title: business.title, score, parts };
}

/** Builds the "no candidate" verdict shared by the empty-registry and below-threshold paths. */
function unlinked(reason, candidates = []) {
  return {
    suggested: null,
    confirmed: null,
    score: candidates[0]?.score ?? 0,
    status: 'unlinked',
    candidates,
    reasons: [reason],
    evidence: { candidates, winner: null, thresholds: null },
  };
}

/**
 * Matches a classified Operation to the most likely parent Business.
 *
 * @param {object} work - the Operation's `signals.work` classification (§5).
 * @param {{ root?: string, objective?: string, policy?: object, registry?: object }} [options]
 *   `objective` supplies the token-overlap text (falls back to the work reasons);
 *   `registry`/`policy` allow hermetic injection for tests.
 * @returns {object} the §8.3 verdict `{ suggested, confirmed, score, status, candidates, reasons, evidence }`.
 */
export function matchBusiness(work, options = {}) {
  const root = options.root || process.cwd();
  try {
    if (!work || work.nature !== 'operation') return unlinked('matcher skipped — not an operation');
    const policy = options.policy || loadWorkPolicy(root);
    const cfg = matchPolicy(policy);
    const registry = options.registry || buildWorkContextRegistry(root);
    const memoryDir = pathsFor(root).memory;
    const objective = typeof options.objective === 'string' ? options.objective : '';

    const businesses = (registry?.contexts || []).filter((row) => row && row.type === 'business');
    if (businesses.length === 0) return unlinked('no Business candidates in the work-context registry');

    const candidates = businesses
      .map((row) => scoreCandidate(work, objective, readBusiness(memoryDir, row), cfg))
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

    const top = candidates[0];
    const runnerUp = candidates[1];
    const { suggested: suggestedT, confirmed: confirmedT } = cfg.thresholds;
    const clearWinner = !runnerUp || top.score - runnerUp.score >= (cfg.winnerMargin ?? 0.1);

    if (top.score < suggestedT) {
      return unlinked(`below suggested threshold (${top.score} < ${suggestedT}) — refuse-to-null`, candidates);
    }

    const tier = top.score >= confirmedT ? 'high-confidence' : 'low-confidence';
    const marginNote = clearWinner ? 'clear winner' : `near-tie with ${runnerUp.id} (margin < ${cfg.winnerMargin})`;
    const reasons = [
      `suggested=${top.id} (score ${top.score}; intent ${top.parts.intent}, kind ${top.parts.kind}, token ${top.parts.token}; ${tier}; ${marginNote})`,
      'confirmed=null (provenance default — human approval ceremony in A3 stamps it, never the matcher)',
    ];
    return {
      suggested: top.id,
      confirmed: null,
      score: top.score,
      status: 'suggested',
      candidates,
      reasons,
      evidence: { candidates, winner: top.id, thresholds: cfg.thresholds, clearWinner },
    };
  } catch {
    return unlinked('matcher error — fail-open to unlinked (rule 2)');
  }
}
