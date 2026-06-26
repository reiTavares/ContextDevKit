/**
 * Architecture-debt gate — the DebtPolicyEngine (WF-0057 W3, ADR-0122). Turns a
 * set of per-analyzer `Finding[]` into the single whole-gate `GateOutcome`
 * (§23) plus the bucketed blocking/review/advisory lists and machine-stable
 * reasons. This is the SOLE place per-finding verdicts aggregate into one gate
 * verdict; CI consumes only `outcome` (W0-contracts.md §7, fork #1).
 *
 * Binding rules it enforces (decisions.md / W0-contracts.md):
 *   - Per-rule authority (§12): an optional `ruleModes` map promotes/demotes/
 *     DISABLEs a rule's enforcement; a detector never picks its own gate weight.
 *   - Lexicographic floors (§20.3): ANY BLOCKING+VIOLATION floor breach ⇒ BLOCKED
 *     IMMEDIATELY, before any bucketing or scoring. No average washes it away.
 *   - Authority (§16): a SEMANTIC/HEURISTIC finding may RAISE concern (→
 *     REVIEW_REQUIRED) but may NEVER clear a deterministic VIOLATION (`mayOverride`)
 *     nor manufacture a PASS. UNKNOWN/SKIPPED are never approval.
 *   - Outcome mapping (§23) lives in the sibling `policy-outcomes.mjs`.
 *
 * Pure + deterministic: same findings + ruleModes ⇒ same result, no IO/clock.
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 *
 * @typedef {import('./finding.mjs')} FindingModule
 */

import {
  Enforcement, FindingStatus, EvidenceClass, DETERMINISTIC_TIER, GateOutcome,
  RecommendedAction,
} from './finding-enums.mjs';
import { isFloorBreach } from './finding.mjs';
import { mapOutcome, isMaterialUnknown } from './policy-outcomes.mjs';

const ENFORCEMENT_VALUES = new Set(Object.values(Enforcement));

/**
 * Resolve a finding's effective enforcement against the per-rule override map
 * (§12). The config is the authority: a rule can be promoted, demoted, or
 * DISABLED. An unknown/invalid override is ignored (fail-safe to the finding's
 * own mode) — config never silently corrupts the gate.
 *
 * @param {Object} finding   a validated Finding.
 * @param {Object<string,string>} ruleModes  ruleId → Enforcement override.
 * @returns {string} the effective Enforcement value for this finding.
 */
function effectiveEnforcement(finding, ruleModes) {
  const override = ruleModes[finding.ruleId];
  if (typeof override === 'string' && ENFORCEMENT_VALUES.has(override)) return override;
  return finding.enforcement;
}

/**
 * Is this a hard blocking VIOLATION? Only a BLOCKING-mode, VIOLATION-status,
 * deterministic-tier finding qualifies — a model opinion can never reach the
 * blocking path (§16, fork #2). The invariant is already enforced at construction
 * (makeFinding throws on BLOCKING+non-deterministic), re-checked here defensively.
 *
 * @param {Object} finding  a finding with its effective enforcement attached.
 * @returns {boolean} true iff this finding alone forces a block.
 */
function isBlockingViolation(finding) {
  return finding.mode === Enforcement.BLOCKING
    && finding.status === FindingStatus.VIOLATION
    && DETERMINISTIC_TIER.has(finding.evidence.class);
}

/**
 * Build the empty result envelope. Reasons accumulate machine-stable codes the
 * report renders and the registry indexes — never prose-only.
 * @returns {{outcome:string, blocking:Object[], review:Object[], advisory:Object[], reasons:string[]}}
 */
const emptyResult = () => ({
  outcome: GateOutcome.PASS, blocking: [], review: [], advisory: [], reasons: [],
});

/**
 * Evaluate a set of findings into the single whole-gate verdict (§23). Pure.
 *
 * Algorithm (order is the contract — lexicographic, non-passing wins):
 *   1. Resolve per-rule enforcement (§12); drop DISABLED findings entirely.
 *   2. Lexicographic floor short-circuit (§20.3): any blocking floor VIOLATION ⇒
 *      BLOCKED immediately, before any bucketing.
 *   3. Any other blocking deterministic VIOLATION ⇒ BLOCKED (§23). A lower-tier
 *      finding can never clear it (`mayOverride` semantics hold by construction).
 *   4. Bucket the rest (review / remediation / advisory / unknown / accepted) and
 *      map to the outcome (§23) via `policy-outcomes.mjs`.
 *
 * @param {Object[]} findings   the gate's `Finding[]` (any analyzer, any dimension).
 * @param {Object<string,string>} [ruleModes]  optional ruleId → Enforcement overrides (§12).
 * @returns {{outcome:string, blocking:Object[], review:Object[], advisory:Object[], reasons:string[]}}
 * @throws {TypeError} when `findings` is not an array.
 */
export function evaluatePolicy(findings, ruleModes = {}) {
  if (!Array.isArray(findings)) {
    throw new TypeError('evaluatePolicy: findings must be an array');
  }
  const modes = ruleModes && typeof ruleModes === 'object' ? ruleModes : {};
  const result = emptyResult();

  // 1. Resolve enforcement, drop DISABLED (§12 — config can suppress a rule).
  const active = [];
  for (const finding of findings) {
    if (!finding || typeof finding !== 'object') continue;
    const mode = effectiveEnforcement(finding, modes);
    if (mode === Enforcement.DISABLED) {
      result.reasons.push(`RULE_DISABLED:${finding.ruleId}`);
      continue;
    }
    active.push({ ...finding, mode });
  }

  // 2. Lexicographic floor short-circuit (§20.3) — precedes ALL aggregation.
  const floorBreach = active.find(
    (f) => isBlockingViolation(f) && isFloorBreach(f),
  );
  if (floorBreach) {
    result.outcome = GateOutcome.BLOCKED;
    result.blocking.push(floorBreach);
    result.reasons.push(`FLOOR_BREACH:${floorBreach.ruleId}`, 'LEXICOGRAPHIC_BLOCK');
    // Still surface the other blockers so the report is complete.
    for (const f of active) {
      if (f !== floorBreach && isBlockingViolation(f)) result.blocking.push(f);
    }
    return result;
  }

  // 3. Any blocking deterministic VIOLATION ⇒ BLOCKED (§23). No lower-tier
  //    finding can clear it — authority is enforced at construction (§16).
  const blockers = active.filter(isBlockingViolation);
  if (blockers.length > 0) {
    result.outcome = GateOutcome.BLOCKED;
    result.blocking.push(...blockers);
    result.reasons.push(...blockers.map((f) => `BLOCKING_VIOLATION:${f.ruleId}`));
    return result;
  }

  // 4. Bucket the remainder and map to the §23 outcome ladder.
  return classifyAndMap(active, result);
}

/**
 * Bucket the non-blocking findings and resolve the outcome (§23). A
 * REVIEW_REQUIRED-mode VIOLATION is confirmed remediable debt (REMEDIATION);
 * a material REVIEW_REQUIRED concern (incl. raised semantic/heuristic) demands
 * review; ADVISORY/OBSERVE_ONLY are observation only; UNKNOWN never passes (§16).
 *
 * @param {Object[]} active   findings with `.mode` resolved, no hard blockers left.
 * @param {Object} result     the envelope to fill (blocking/review/advisory/reasons).
 * @returns {Object} the completed result with `outcome` set.
 */
function classifyAndMap(active, result) {
  const review = [];
  const remediation = [];
  const advisory = [];
  const unknown = [];
  const accepted = [];

  for (const f of active) {
    if (isMaterialUnknown(f)) {
      unknown.push(f);
      result.reasons.push(`MISSING_EVIDENCE:${f.ruleId}`);
      continue;
    }
    if (f.recommendedAction === RecommendedAction.ACCEPT_TEMPORARILY) {
      accepted.push(f);
      continue;
    }
    if (f.mode === Enforcement.REVIEW_REQUIRED) {
      if (f.status === FindingStatus.VIOLATION) remediation.push(f);
      else review.push(f);
      continue;
    }
    // A satisfied/inapplicable finding is positive/neutral evidence, NOT an
    // observation — it must not downgrade a clean PASS to PASS_WITH_OBSERVATION.
    if (f.status === FindingStatus.PASS || f.status === FindingStatus.SKIPPED) continue;
    // ADVISORY / OBSERVE_ONLY material signal: observation only, never blocks (§12.3/§12.4).
    advisory.push(f);
  }

  result.review = review.concat(remediation);
  result.advisory = advisory;
  result.outcome = mapOutcome({ review, remediation, advisory, unknown, accepted }, active);
  if (result.outcome === GateOutcome.PASS_WITH_OBSERVATION) {
    result.reasons.push('OBSERVATION_ONLY');
  }
  return result;
}

export { effectiveEnforcement, isBlockingViolation };
