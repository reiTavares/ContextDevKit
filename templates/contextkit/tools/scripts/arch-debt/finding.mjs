/**
 * Architecture-debt gate — the SINGLE SOURCE of the finding contract (WF-0057,
 * ADR-0122). Every analyzer/dimension/fitness-function in the gate imports
 * `makeFinding` / `liftLegacyFinding` from here and emits the one `Finding`
 * shape; the policy engine imports `mayOverride` / `isFloorBreach` /
 * `resolveMissingEvidence` / `ciShouldBlock` from here. There is NO second
 * definition of the shape anywhere (W0-contracts.md §37, fork #1).
 *
 * The `Finding` typedef + enum semantics live in W0-contracts.md §1; the closed
 * value sets live in the sibling `finding-enums.mjs` (cohesive split, §1
 * constitution). This module is the LOGIC: validate, lift, compare, resolve.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 * Fail-fast: `makeFinding` THROWS on an invalid finding rather than warning
 * (constitution §8 — validators throw, never silently downgrade).
 *
 * @typedef {import('./finding-enums.mjs')} Enums
 */

import {
  Enforcement, FindingStatus, RecommendedAction, EvidenceClass, EVIDENCE_RANK,
  DETERMINISTIC_TIER, GateOutcome, PASSING_OUTCOMES, BaselineClass, Principal,
  Interest, DEFAULT_RISK, Dimension, DebtClass, LEGACY_DIMENSION, LEGACY_DEBTCLASS,
} from './finding-enums.mjs';

export {
  Enforcement, FindingStatus, RecommendedAction, EvidenceClass, EVIDENCE_RANK,
  DETERMINISTIC_TIER, GateOutcome, PASSING_OUTCOMES, BaselineClass, Principal,
  Interest, DEFAULT_RISK, Dimension, DebtClass,
};

/** Throw a descriptive, typed error when a value is outside a closed enum. */
const assertIn = (label, value, allowed) => {
  if (!allowed.includes(value)) {
    throw new TypeError(`Finding.${label}: "${value}" is not one of [${allowed.join(', ')}]`);
  }
};

/**
 * Validate + default-fill a partial finding into a complete `Finding` (§1).
 * Fail-fast: throws a `TypeError` on any contract violation (constitution §8) —
 * a malformed finding must never silently flow into the gate.
 *
 * @param {Object} partial  caller-supplied finding fields (id/ruleId/path required).
 * @returns {Object} a complete, validated Finding.
 * @throws {TypeError} when a required field is missing or an enum value is invalid.
 */
export function makeFinding(partial) {
  if (!partial || typeof partial !== 'object') {
    throw new TypeError('makeFinding: expected an object');
  }
  const { id, ruleId, path } = partial;
  for (const [k, v] of [['id', id], ['ruleId', ruleId], ['path', path]]) {
    if (typeof v !== 'string' || v.length === 0) {
      throw new TypeError(`makeFinding: "${k}" is required and must be a non-empty string`);
    }
  }
  const evidence = partial.evidence || { class: EvidenceClass.HEURISTIC, source: 'unknown', ref: ruleId };
  assertIn('evidence.class', evidence.class, Object.values(EvidenceClass));
  const finding = {
    id,
    ruleId,
    dimension: partial.dimension ?? Dimension.COGNITIVE_COHERENCE,
    debtClass: partial.debtClass ?? DebtClass.CODE,
    status: partial.status ?? FindingStatus.OBSERVATION,
    confidence: typeof partial.confidence === 'number' ? partial.confidence : 0.5,
    evidence: { class: evidence.class, source: evidence.source ?? 'unknown', ref: evidence.ref ?? ruleId },
    reasonCodes: Array.isArray(partial.reasonCodes) ? partial.reasonCodes : [],
    risk: partial.risk ?? DEFAULT_RISK,
    principal: partial.principal ?? Principal.UNKNOWN,
    interest: Array.isArray(partial.interest) ? partial.interest : [],
    deltaFromBaseline: partial.deltaFromBaseline ?? BaselineClass.UNKNOWN,
    recommendedAction: partial.recommendedAction ?? RecommendedAction.OBSERVE,
    enforcement: partial.enforcement ?? Enforcement.ADVISORY,
    message: typeof partial.message === 'string' ? partial.message : '',
    path,
    line: partial.line,
    snippet: partial.snippet,
  };
  assertIn('dimension', finding.dimension, Object.values(Dimension));
  assertIn('debtClass', finding.debtClass, Object.values(DebtClass));
  assertIn('status', finding.status, Object.values(FindingStatus));
  assertIn('principal', finding.principal, Object.values(Principal));
  assertIn('deltaFromBaseline', finding.deltaFromBaseline, Object.values(BaselineClass));
  assertIn('recommendedAction', finding.recommendedAction, Object.values(RecommendedAction));
  assertIn('enforcement', finding.enforcement, Object.values(Enforcement));
  if (finding.confidence < 0 || finding.confidence > 1) {
    throw new TypeError(`makeFinding: confidence ${finding.confidence} out of range 0..1`);
  }
  // Invariant (fork #2): BLOCKING is permitted only for the deterministic tier.
  if (finding.enforcement === Enforcement.BLOCKING && !DETERMINISTIC_TIER.has(finding.evidence.class)) {
    throw new TypeError(
      `makeFinding: BLOCKING enforcement requires a deterministic-tier evidence class, got "${finding.evidence.class}"`,
    );
  }
  return finding;
}

/**
 * Lift a legacy detector finding into the new `Finding` shape (§1.4). Pure,
 * total, lossless — every legacy field round-trips verbatim. Crucially the
 * `line-budget` kind maps to ADVISORY (never BLOCKING), so a long-but-cohesive
 * file can never reach the blocking path (test §34.25).
 *
 * @param {{kind:string,severity:number,path:string,line?:number,snippet?:string,message:string}} legacy
 * @returns {Object} the upgraded Finding (validated through makeFinding).
 * @throws {TypeError} when the legacy finding lacks `kind`/`path`.
 */
export function liftLegacyFinding(legacy) {
  if (!legacy || typeof legacy.kind !== 'string' || typeof legacy.path !== 'string') {
    throw new TypeError('liftLegacyFinding: legacy finding needs string kind + path');
  }
  return makeFinding({
    id: `${legacy.kind}:${legacy.path}:${legacy.line ?? 'file'}`,
    ruleId: legacy.kind,
    dimension: LEGACY_DIMENSION[legacy.kind] ?? Dimension.COGNITIVE_COHERENCE,
    debtClass: LEGACY_DEBTCLASS[legacy.kind] ?? DebtClass.CODE,
    status: FindingStatus.OBSERVATION,
    confidence: 0.5,
    evidence: { class: EvidenceClass.HEURISTIC, source: 'tech-debt-detectors', ref: legacy.kind },
    reasonCodes: [legacy.kind.toUpperCase().replaceAll('-', '_')],
    risk: DEFAULT_RISK,
    principal: Principal.UNKNOWN,
    interest: [],
    deltaFromBaseline: BaselineClass.UNKNOWN,
    recommendedAction: RecommendedAction.OBSERVE,
    // Legacy heuristics are advisory; line-budget is explicitly demoted (fork #2).
    enforcement: Enforcement.ADVISORY,
    message: legacy.message ?? '',
    path: legacy.path,
    line: legacy.line,
    snippet: legacy.snippet,
  });
}

/**
 * The hard authority rule (§3/§16, fork #3). A SEMANTIC/HEURISTIC finding may
 * RAISE concern but may NEVER override a deterministic-tier verdict nor
 * manufacture a PASS it did not earn.
 *
 * @param {Object} challenger  lower-authority finding trying to soften a verdict.
 * @param {Object} incumbent   the finding already carrying the verdict.
 * @returns {boolean} true iff the challenger is ALLOWED to override the incumbent.
 */
export function mayOverride(challenger, incumbent) {
  if (DETERMINISTIC_TIER.has(incumbent.evidence.class)
      && !DETERMINISTIC_TIER.has(challenger.evidence.class)) {
    return false; // a model opinion never beats a deterministic verdict
  }
  return EVIDENCE_RANK[challenger.evidence.class] <= EVIDENCE_RANK[incumbent.evidence.class];
}

/**
 * Fail-closed resolution for absent/errored evidence (§3/§16). Returns SKIPPED
 * only when the rule itself was already SKIPPED; everything else collapses to
 * UNKNOWN. NEVER returns PASS — downstream both map a *material* rule to
 * REVIEW_REQUIRED (§23), never approval.
 *
 * @param {Object} finding  the finding whose evidence could not be produced.
 * @returns {string} a FindingStatus value (UNKNOWN or SKIPPED).
 */
export function resolveMissingEvidence(finding) {
  return finding && finding.status === FindingStatus.SKIPPED
    ? FindingStatus.SKIPPED
    : FindingStatus.UNKNOWN;
}

/**
 * Lexicographic floor check (§5.3). A tripped security/data-integrity/
 * operational floor forces BLOCKED regardless of any score — no average can
 * wash it away. Accepts a Finding (reads `.risk`) or a bare Risk object.
 *
 * @param {Object} findingOrRisk  a Finding or a Risk.
 * @returns {boolean} true iff a floor is breached.
 */
export function isFloorBreach(findingOrRisk) {
  const risk = findingOrRisk && findingOrRisk.risk ? findingOrRisk.risk : findingOrRisk;
  if (!risk) return false;
  return Boolean(risk.securityFloor || risk.dataIntegrityFloor || risk.operationalFloor);
}

/** True iff a GateOutcome is in the approval set (§6.1). UNKNOWN/SKIPPED → false. */
export const isApproval = (outcome) => PASSING_OUTCOMES.has(outcome);

/**
 * Default baseline disposition (§6.2). Maps the DELTA onto a report/block/etc
 * disposition; the finding's own acceptability (no floor breach + within policy)
 * is the second input. UNKNOWN delta never silently passes.
 *
 * @param {string} delta       a BaselineClass value.
 * @param {boolean} acceptable is the finding itself within policy?
 * @returns {'REPORT'|'BLOCK'|'REVIEW'|'POSITIVE'|'ANALYZE'}
 */
export function baselineDisposition(delta, acceptable) {
  if (delta === BaselineClass.REDUCED || delta === BaselineClass.PAID) return 'POSITIVE';
  if (delta === BaselineClass.TRANSFERRED) return 'ANALYZE';
  if (delta === BaselineClass.PRE_EXISTING || delta === BaselineClass.UNCHANGED) return 'REPORT';
  if (delta === BaselineClass.INTRODUCED) return acceptable ? 'REPORT' : 'BLOCK';
  if (delta === BaselineClass.WORSENED) return acceptable ? 'REPORT' : 'REVIEW';
  return 'REVIEW'; // UNKNOWN delta → never silently pass
}

/**
 * The ONE per-finding CI block predicate (§7) — replaces the legacy
 * `severity >= 5` test. A finding blocks CI iff its rule runs BLOCKING and it
 * is an actual VIOLATION. Severity is irrelevant here by design (fork #2).
 *
 * @param {Object[]} findings  the gate's findings (or a single finding).
 * @returns {boolean} true iff any finding forces a CI block.
 */
export function ciShouldBlock(findings) {
  const list = Array.isArray(findings) ? findings : [findings];
  return list.some((f) =>
    f && f.enforcement === Enforcement.BLOCKING && f.status === FindingStatus.VIOLATION);
}
