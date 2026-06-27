/**
 * business-matcher.mjs — deterministic Business matcher for a classified
 * Operation (BIZ-0001 / WF-0036 Wave A2, ADR-0102; design §8). Updated by
 * OP-0005 / ADR-0125 to use additive integer scoring (TABLE 3).
 *
 * Given a classified Operation (`signals.work`) and a project root, it scores
 * every Business in the A1 work-context registry and returns the linkage shape
 * the schema-plan defines: `{ suggested, confirmed, score, status, candidates }`
 * plus a flat `reasons[]` and a structured `evidence` mirror (design §5).
 *
 * Deterministic + explainable, NO embeddings: additive integer score over
 *   explicit-id match · kind affinity · value-intent match · token overlap ·
 *   active-status bonus · incompatible/closed penalties.
 * Thresholds: >= 75 → suggested; 55–74 → confirm; <55 → unlinked.
 * Same input → same output, always — no `Math.random`, no time, no LLM.
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

/** Embedded fallback for the matcher policy (TABLE 3, OP-0005 / ADR-0125; rule 2). */
const DEFAULT_MATCH = Object.freeze({
  thresholds: { suggested: 75, confirm: 55 },
  nearTieMargin: 10,
  points: {
    explicitIdMatch: 100, sameProduct: 35, sameAreaCapability: 20,
    compatibleValueIntents: 15, sameRoadmapItem: 10, relatedOutcomeKpi: 10,
    tokenOverlap: 10, activeBusiness: 5, incompatibleProduct: -30, closedRejected: -100,
  },
  kindAffinity: {
    fix: ['capability', 'product'], change: ['capability', 'product'],
    maintenance: ['capability'], investigation: ['capability', 'compliance'],
    operationalresponse: ['capability', 'product'],
  },
});

/** Resolves the `businessMatch` policy section with a defensive fallback. */
function matchPolicy(policy) {
  const section = policy && typeof policy.businessMatch === 'object' ? policy.businessMatch : null;
  return section && section.thresholds && section.points ? section : DEFAULT_MATCH;
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
 * Deterministic value-intent component: 1 for primary match, 0.5 for secondary overlap.
 */
function intentMatch(work, business) {
  const intents = new Set([business.primary, ...business.secondary].filter(Boolean));
  const primary = work?.valueIntents?.primary;
  if (primary && intents.has(primary)) return 1;
  const secondaries = Array.isArray(work?.valueIntents?.secondary) ? work.valueIntents.secondary : [];
  return secondaries.some((intent) => intents.has(intent)) ? 0.5 : 0;
}

/**
 * Kind-affinity component: 1 when the Business kind is in the Operation-kind's affinity list.
 */
function kindAffinity(work, business, affinity) {
  const opKind = String(work?.kind || '').toLowerCase();
  const preferred = Array.isArray(affinity?.[opKind]) ? affinity[opKind] : [];
  return business.kind && preferred.includes(business.kind) ? 1 : 0;
}

/** Token-overlap component: Jaccard of objective vs title+slug. */
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
 * Scores one Business candidate using additive integer scoring (TABLE 3, OP-0005).
 *
 * @param {object} work - the classified Operation.
 * @param {string} objective - the Operation's free-text objective.
 * @param {object} business - a `readBusiness` row.
 * @param {object} cfg - the resolved `businessMatch` policy.
 * @param {object} registryRow - the registry row (for status).
 * @returns {{ id, title, score: number, parts: object }}
 */
function scoreCandidate(work, objective, business, cfg, registryRow) {
  const pts = cfg.points || DEFAULT_MATCH.points;
  let score = 0;
  const parts = {};

  // Explicit Business ID match in the objective text.
  if (objective.toLowerCase().includes(business.id.toLowerCase())) {
    score += pts.explicitIdMatch; parts.explicitIdMatch = pts.explicitIdMatch;
  }

  // Registry row status: active bonus or closed/rejected penalty.
  const rowStatus = String(registryRow?.status || '').toLowerCase();
  if (rowStatus === 'approved' || rowStatus === 'active') {
    score += pts.activeBusiness; parts.activeBusiness = pts.activeBusiness;
  } else if (rowStatus === 'rejected' || rowStatus === 'closed' || rowStatus === 'archived') {
    score += pts.closedRejected; parts.closedRejected = pts.closedRejected;
  }

  // Kind affinity: sameProduct vs sameAreaCapability.
  const opKind = String(work?.kind || '').toLowerCase();
  const affinity = cfg.kindAffinity || DEFAULT_MATCH.kindAffinity;
  const preferredKinds = Array.isArray(affinity?.[opKind]) ? affinity[opKind] : [];
  if (business.kind === 'product' && (opKind === 'change' || opKind === 'fix') && preferredKinds.includes('product')) {
    score += pts.sameProduct; parts.sameProduct = pts.sameProduct;
  } else if (business.kind && preferredKinds.includes(business.kind)) {
    score += pts.sameAreaCapability; parts.sameAreaCapability = pts.sameAreaCapability;
  } else if (business.kind === 'product' && (opKind === 'investigation' || opKind === 'compliance')) {
    score += pts.incompatibleProduct; parts.incompatibleProduct = pts.incompatibleProduct;
  }

  // Compatible value intents: full (primary match) or half (secondary overlap).
  const intentScore = intentMatch(work, business);
  if (intentScore > 0) {
    const intentPts = Math.round(intentScore * pts.compatibleValueIntents);
    score += intentPts; parts.compatibleValueIntents = intentPts;
  }

  // Token overlap: Jaccard >= 0.15 earns the tokenOverlap bonus.
  const jaccardScore = tokenOverlap(objective, business);
  if (jaccardScore >= 0.15) {
    score += pts.tokenOverlap; parts.tokenOverlap = pts.tokenOverlap;
  }

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
      .map((row) => scoreCandidate(work, objective, readBusiness(memoryDir, row), cfg, row))
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

    const top = candidates[0];
    const runnerUp = candidates[1];
    const { suggested: suggestedT } = cfg.thresholds;
    const nearTieMargin = cfg.nearTieMargin ?? 10;
    const clearWinner = !runnerUp || top.score - runnerUp.score >= nearTieMargin;

    if (top.score < suggestedT) {
      return unlinked(`below suggested threshold (${top.score} < ${suggestedT}) — refuse-to-null`, candidates);
    }

    const tier = top.score >= (cfg.thresholds.confirm ?? 55) ? 'high-confidence' : 'low-confidence';
    const marginNote = clearWinner ? 'clear winner' : `near-tie with ${runnerUp?.id} (margin < ${nearTieMargin})`;
    const reasons = [
      `suggested=${top.id} (score ${top.score}; ${tier}; ${marginNote})`,
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
