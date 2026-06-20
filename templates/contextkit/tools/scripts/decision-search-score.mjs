/**
 * decision-search-score.mjs — B2-T2: pure scoring primitives for ADR candidate
 * matching (BIZ-0001 / WF-0037, Wave B2).
 *
 * Owns: eligibility gate (§4.1), per-candidate score arithmetic (§4.2), and the
 * tie-break comparator (§4.3). All functions are pure — no I/O, no state, no
 * Math.random. Imported by `decision-search-match.mjs` (the public entry point).
 *
 * The MATCH_POLICY constant block is the SINGLE source of truth for every weight
 * and threshold in B2-T2. Any change to a number requires a new ADR (design §8 /
 * constitution §9). Source of values: B2-design-decision-table.md §4.2/§4.3/§9 OQ-6.
 *
 * Zero runtime dependencies. Reuses A2 `tokenize` for Jaccard — no second tokenizer.
 */

import { tokenize } from '../../runtime/execution/work-classify-signals.mjs';

// ---------------------------------------------------------------------------
// Named policy block (ADR-gated). Values from design doc §4.2/§4.3.
// ---------------------------------------------------------------------------
export const MATCH_POLICY = Object.freeze({
  // Component weights (§4.2)
  tripleExact: 50,
  triplePartial: 25,
  kindOnly: 10,
  governsOverlap: 20,
  valueIntentPrimary: 8,
  valueIntentSecondary: 4,
  tagOverlapPerTag: 4,
  tagOverlapMax: 8,
  titleTokenJaccardMax: 6,
  legacyPenalty: -4,
  // Band thresholds (§4.3)
  strongThreshold: 55,
  possibleThreshold: 40,
  // Output cap (§8)
  candidateCap: 3,
});

// ---------------------------------------------------------------------------
// §4.1 Eligibility gate (HR-2/HR-3 encoded here)
// ---------------------------------------------------------------------------

/**
 * Returns true when a registry row is eligible as a link target.
 * Excludes: proposed, rejected, superseded, supersededBy != null.
 *
 * @param {object} row - a decision registry row.
 * @returns {boolean}
 */
export function isEligible(row) {
  if (!row) return false;
  if (row.status === 'proposed' || row.status === 'rejected') return false;
  if (row.status === 'superseded') return false;
  if (row.supersededBy != null) return false;
  return row.status === 'accepted' || row.status === 'legacy';
}

// ---------------------------------------------------------------------------
// Context comparison helpers
// ---------------------------------------------------------------------------

/**
 * Tests whether two primaryContext objects are EXACT equal (same type AND id).
 * null id on either side → NOT equal (provisional cannot exact-match).
 *
 * @param {object|null} a
 * @param {object|null} b
 * @returns {boolean}
 */
export function primaryContextEqual(a, b) {
  if (!a || !b) return false;
  return a.type === b.type && a.id != null && b.id != null && a.id === b.id;
}

/**
 * Tests whether two primaryContext objects share the same TYPE only (partial).
 *
 * @param {object|null} a
 * @param {object|null} b
 * @returns {boolean}
 */
export function primaryContextTypeEqual(a, b) {
  if (!a || !b) return false;
  return a.type === b.type;
}

// ---------------------------------------------------------------------------
// §4.2 Work-tag derivation
// ---------------------------------------------------------------------------

/**
 * Derives work-side tags for tagOverlap per design §4.2:
 * `{ work.kind, work.growthLever, work.valueIntents.primary, decisionKind, decisionScope }`.
 *
 * @param {object} work - the work signals object.
 * @param {object} need - the B2-T1 need object `{ triple, ... }`.
 * @returns {Set<string>} lowercased, nulls dropped.
 */
export function deriveWorkTags(work, need) {
  const raw = [
    work && work.kind,
    work && work.growthLever,
    work && work.valueIntents && work.valueIntents.primary,
    need && need.triple && need.triple.decisionKind,
    need && need.triple && need.triple.decisionScope,
  ];
  return new Set(raw.filter(Boolean).map((v) => String(v).toLowerCase()));
}

// ---------------------------------------------------------------------------
// §4.2 Per-candidate score arithmetic
// ---------------------------------------------------------------------------

/**
 * Computes the match score for one eligible candidate against the work need.
 * Returns `{ score: number, breakdown: object }`.
 *
 * All arithmetic is integer/Math.floor; clamped to [0, 100]. Deterministic.
 *
 * @param {object} work - signals.work `{ kind, growthLever, valueIntents, ... }`.
 * @param {string} objective - raw NL objective text.
 * @param {object} candidate - a registry row.
 * @param {object} need - the B2-T1 need object `{ triple, ... }`.
 * @returns {{ score: number, breakdown: object }}
 */
export function scoreMatch(work, objective, candidate, need) {
  const triple = (need && need.triple) || {};
  const workCtx = triple.primaryContext || null;
  const workKind = triple.decisionKind || null;
  const workScope = triple.decisionScope || null;
  const candidateCtx = candidate.primaryContext || null;
  const breakdown = {};

  // Triple band (mutually exclusive — highest applicable fires first).
  const kindMatch = workKind != null && candidate.decisionKind === workKind;
  const scopeMatch = workScope != null && candidate.decisionScope === workScope;
  const ctxExact = primaryContextEqual(workCtx, candidateCtx);
  const ctxTypeMatch = primaryContextTypeEqual(workCtx, candidateCtx);

  let triplePoints = 0;
  if (kindMatch && scopeMatch && ctxExact) {
    triplePoints = MATCH_POLICY.tripleExact;
    breakdown.tripleExact = triplePoints;
  } else if (kindMatch && ctxTypeMatch) {
    triplePoints = MATCH_POLICY.triplePartial;
    breakdown.triplePartial = triplePoints;
  } else if (kindMatch) {
    triplePoints = MATCH_POLICY.kindOnly;
    breakdown.kindOnly = triplePoints;
  }

  // governsOverlap (§4.2): work's target entity id ∈ candidate governs.*.
  let governsPoints = 0;
  const gov = candidate.governs;
  const targetId = workCtx && workCtx.id;
  if (gov && targetId) {
    const allGoverned = [
      ...(Array.isArray(gov.workflows) ? gov.workflows : []),
      ...(Array.isArray(gov.operations) ? gov.operations : []),
      ...(Array.isArray(gov.business) ? gov.business : []),
    ];
    if (allGoverned.includes(targetId)) {
      governsPoints = MATCH_POLICY.governsOverlap;
      breakdown.governsOverlap = governsPoints;
    }
  }

  // valueIntentOverlap (§4.2): primary match → 8, secondary → 4.
  let intentPoints = 0;
  const workPrimary = work && work.valueIntents && work.valueIntents.primary;
  const workSecondary = work && work.valueIntents && Array.isArray(work.valueIntents.secondary)
    ? work.valueIntents.secondary : [];
  const candIntents = Array.isArray(candidate.valueIntents) ? candidate.valueIntents : [];
  if (workPrimary && candIntents.includes(workPrimary)) {
    intentPoints = MATCH_POLICY.valueIntentPrimary;
    breakdown.valueIntentPrimary = intentPoints;
  } else if (workSecondary.some((si) => candIntents.includes(si))) {
    intentPoints = MATCH_POLICY.valueIntentSecondary;
    breakdown.valueIntentSecondary = intentPoints;
  }

  // tagOverlap (§4.2): min(8, 4 × |sharedTags|).
  const workTags = deriveWorkTags(work, need);
  const candTags = new Set((Array.isArray(candidate.tags) ? candidate.tags : []).map((t) => String(t).toLowerCase()));
  const sharedCount = [...workTags].filter((t) => candTags.has(t)).length;
  const tagPoints = Math.min(MATCH_POLICY.tagOverlapMax, MATCH_POLICY.tagOverlapPerTag * sharedCount);
  if (tagPoints > 0) breakdown.tagOverlap = tagPoints;

  // titleTokenJaccard (§4.2): floor(6 × Jaccard) via A2 tokenize.
  const objTokens = tokenize(objective);
  const titleTokens = tokenize(candidate.title || candidate.id || '');
  const union = new Set([...objTokens, ...titleTokens]);
  const intersect = [...objTokens].filter((t) => titleTokens.has(t)).length;
  const jaccard = union.size > 0 ? intersect / union.size : 0;
  const titlePoints = Math.floor(MATCH_POLICY.titleTokenJaccardMax * jaccard);
  if (titlePoints > 0) breakdown.titleTokenJaccard = titlePoints;

  // legacyPenalty (§4.2): −4 when format === 'legacy'.
  const legacyPenalty = candidate.format === 'legacy' ? MATCH_POLICY.legacyPenalty : 0;
  if (legacyPenalty !== 0) breakdown.legacyPenalty = legacyPenalty;

  const rawScore = triplePoints + governsPoints + intentPoints + tagPoints + titlePoints + legacyPenalty;
  return { score: Math.max(0, Math.min(100, rawScore)), breakdown };
}

// ---------------------------------------------------------------------------
// §4.3 Tie-break comparator
// ---------------------------------------------------------------------------

/**
 * Stable comparator for scored candidate objects.
 * Priority: higher score → new format before legacy → accepted before legacy → id asc.
 *
 * @param {{ score: number, row: object }} a
 * @param {{ score: number, row: object }} b
 * @returns {number}
 */
export function candidateComparator(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const fmtA = a.row.format === 'new' ? 0 : 1;
  const fmtB = b.row.format === 'new' ? 0 : 1;
  if (fmtA !== fmtB) return fmtA - fmtB;
  const stA = a.row.status === 'accepted' ? 0 : 1;
  const stB = b.row.status === 'accepted' ? 0 : 1;
  if (stA !== stB) return stA - stB;
  return String(a.row.id).localeCompare(String(b.row.id));
}

// ---------------------------------------------------------------------------
// §4.5 Coverage mode from winning candidate
// ---------------------------------------------------------------------------

/**
 * Returns the appropriate DECISION_COVERAGE_MODES value for a LINK winner.
 *
 * @param {{ row: object }|null} candidate - a scored candidate (must be eligible).
 * @returns {string} 'COVERED_BY_ACCEPTED' | 'LEGACY_GRANDFATHERED' | 'NEEDS_DECISION'.
 */
export function coverageModeFromCandidate(candidate) {
  if (!candidate) return 'NEEDS_DECISION';
  if (candidate.row.format === 'legacy' || candidate.row.status === 'legacy') {
    return 'LEGACY_GRANDFATHERED';
  }
  return 'COVERED_BY_ACCEPTED';
}
