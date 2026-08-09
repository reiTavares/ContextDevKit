/**
 * decision-search-score.mjs — B2-T2: pure scoring primitives for ADR candidate
 * matching (BIZ-0001 / WF-0037, Wave B2 / §29 TABLE 5).
 *
 * Owns: eligibility gate (§4.1), per-candidate score arithmetic (§29), and the
 * tie-break comparator (§4.3). All functions are pure — no I/O, no state, no
 * Math.random. Imported by `decision-search-match.mjs` (the public entry point).
 *
 * The MATCH_POLICY constant block is the SINGLE source of truth for every weight
 * and threshold in B2-T2. Any change to a number requires a new ADR (design §8 /
 * constitution §9). Source of values: §29 TABLE 5 (ADR-0125).
 *
 * Zero runtime dependencies. Reuses A2 `tokenize` for Jaccard — no second tokenizer.
 */

import { tokenize } from '../../runtime/execution/work-classify-signals.mjs';

// ---------------------------------------------------------------------------
// Named policy block (ADR-gated). Values from design doc §29 TABLE 5.
// ---------------------------------------------------------------------------
export const MATCH_POLICY = Object.freeze({
  // Component weights (§29 TABLE 5)
  explicitAdr:            100, // +100 explicit ADR ref (handled in HR-1 upstream)
  samePrimaryContext:      35, // +35 same primary context (exact type AND id)
  sameProduct:             20, // +20 same product (same business context)
  sameAreaCapability:      20, // +20 same area/capability (same context type, not exact)
  sameDecisionKind:        15, // +15 same decision kind
  sameContractInvariant:   20, // +20 same contract/invariant (kind + scope aligned)
  sameComponent:           10, // +10 same component (governs overlap for workflow/op ctx)
  acceptedAndCurrent:       5, // +5 accepted & current (no supersededBy)
  termOverlap:             10, // +10 relevant term overlap (Jaccard-weighted, max 10)
  incompatibleScope:      -25, // −25 incompatible scope (scope AND kind differ)
  incompatibleContext:    -20, // −20 incompatible context (different context type)
  supersededPenalty:     -100, // −100 superseded/rejected/deprecated (safety net)
  // Band thresholds (§29)
  governingThreshold:      80, // score >= 80 → 'governing' → LINK
  confirmThreshold:        60, // 60..79 → 'confirm' (candidates surfaced, no auto-link)
  // Backward-compat aliases (selftests use these names)
  strongThreshold:         80, // alias for governingThreshold
  possibleThreshold:       60, // alias for confirmThreshold
  // Output cap
  candidateCap:             3,
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
// §29 Per-candidate score arithmetic (TABLE 5)
// ---------------------------------------------------------------------------

/**
 * Computes the §29 TABLE 5 match score for one eligible candidate.
 * Returns `{ score: number, breakdown: object }`.
 *
 * Dimensions fire independently (not mutually exclusive); score is the sum of
 * all that fire, clamped to [0, 100]. Superseded rows incur a −100 penalty as a
 * safety net (they should never reach here after isEligible, but belt-and-braces).
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

  const kindMatch = workKind != null && candidate.decisionKind === workKind;
  const scopeMatch = workScope != null && candidate.decisionScope === workScope;
  const ctxExact = primaryContextEqual(workCtx, candidateCtx);
  const ctxTypeMatch = primaryContextTypeEqual(workCtx, candidateCtx);

  // −100 safety-net: superseded/rejected/deprecated should never win.
  if (
    candidate.status === 'superseded' || candidate.supersededBy != null
    || candidate.status === 'rejected' || candidate.status === 'deprecated'
  ) {
    breakdown.supersededPenalty = MATCH_POLICY.supersededPenalty;
    return { score: 0, breakdown };
  }

  // +35 samePrimaryContext: exact type AND id.
  if (ctxExact) {
    breakdown.samePrimaryContext = MATCH_POLICY.samePrimaryContext;
  }

  // +20 sameProduct: same business context (type=business, same id or governs.business contains it).
  const gov = candidate.governs;
  const targetId = workCtx && workCtx.id;
  if (
    workCtx && workCtx.type === 'business'
    && candidateCtx && candidateCtx.type === 'business'
    && !ctxExact
    && targetId
    && Array.isArray(gov && gov.business)
    && gov.business.includes(targetId)
  ) {
    breakdown.sameProduct = MATCH_POLICY.sameProduct;
  }

  // +20 sameAreaCapability: same context type but NOT exact (partial, different id).
  if (ctxTypeMatch && !ctxExact) {
    breakdown.sameAreaCapability = MATCH_POLICY.sameAreaCapability;
  }

  // +15 sameDecisionKind: matching decision kind.
  if (kindMatch) {
    breakdown.sameDecisionKind = MATCH_POLICY.sameDecisionKind;
  }

  // +20 sameContractInvariant: same scope AND same kind (exact kind+scope alignment).
  if (kindMatch && scopeMatch) {
    breakdown.sameContractInvariant = MATCH_POLICY.sameContractInvariant;
  }

  // +10 sameComponent: work context is workflow/operation and candidate governs it.
  if (
    workCtx && (workCtx.type === 'workflow' || workCtx.type === 'operation')
    && targetId && gov
  ) {
    const governed = [
      ...(Array.isArray(gov.workflows)   ? gov.workflows   : []),
      ...(Array.isArray(gov.operations)  ? gov.operations  : []),
    ];
    if (governed.includes(targetId)) {
      breakdown.sameComponent = MATCH_POLICY.sameComponent;
    }
  }

  // +5 acceptedAndCurrent: accepted status with no supersededBy.
  if (candidate.status === 'accepted' && candidate.supersededBy == null) {
    breakdown.acceptedAndCurrent = MATCH_POLICY.acceptedAndCurrent;
  }

  // +10 (max) termOverlap: Jaccard on title vs objective tokens.
  const objTokens  = tokenize(objective);
  const titleTokens = tokenize(candidate.title || candidate.id || '');
  const union     = new Set([...objTokens, ...titleTokens]);
  const intersect  = [...objTokens].filter((t) => titleTokens.has(t)).length;
  const jaccard    = union.size > 0 ? intersect / union.size : 0;
  const termPoints = Math.min(MATCH_POLICY.termOverlap, Math.floor(MATCH_POLICY.termOverlap * jaccard));
  if (termPoints > 0) breakdown.termOverlap = termPoints;

  // −25 incompatibleScope: scope AND kind both differ (genuinely incompatible).
  if (workScope != null && !scopeMatch && !kindMatch) {
    breakdown.incompatibleScope = MATCH_POLICY.incompatibleScope;
  }

  // −20 incompatibleContext: different context type.
  if (workCtx && candidateCtx && workCtx.type !== candidateCtx.type) {
    breakdown.incompatibleContext = MATCH_POLICY.incompatibleContext;
  }

  const rawScore = Object.values(breakdown).reduce((s, v) => s + v, 0);
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
