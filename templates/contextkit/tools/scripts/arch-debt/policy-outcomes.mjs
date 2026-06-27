/**
 * Architecture-debt gate — outcome-mapping helper for the policy engine
 * (WF-0057 W3, ADR-0122). Pure classification of an already-bucketed finding
 * set into the single whole-gate `GateOutcome` (§23). Split from
 * `policy-engine.mjs` so the engine stays a thin orchestrator under the line
 * budget (constitution §1 cohesive seam): the engine owns floor short-circuit +
 * authority + bucketing; THIS module owns the §23 outcome table.
 *
 * The floor short-circuit (BLOCKED) is decided BEFORE this module runs — it is
 * never reachable here. Zero runtime deps, ESM, `node:`/relative imports only.
 *
 * @typedef {import('./finding.mjs')} FindingModule
 */

import { GateOutcome, FindingStatus, BaselineClass } from './finding-enums.mjs';

/** Baseline deltas that are positive repayment evidence (§6.2/§26). */
const REPAYMENT_DELTAS = new Set([BaselineClass.REDUCED, BaselineClass.PAID]);

/**
 * Does any finding in the set carry repayment evidence (§26)? Drives the
 * DEBT_REDUCED positive outcome when nothing else is material.
 *
 * @param {Object[]} findings  the full (enforcement-resolved) finding set.
 * @returns {boolean} true iff a finding shows reduced/paid baseline debt.
 */
function hasRepaymentEvidence(findings) {
  return findings.some((f) => REPAYMENT_DELTAS.has(f.deltaFromBaseline));
}

/**
 * Map the bucketed finding set onto the single whole-gate outcome (§23). The
 * BLOCKED case is handled by the engine's lexicographic floor short-circuit and
 * its blocking-violation check before this runs; here we resolve the remaining
 * ladder: REVIEW_REQUIRED → REMEDIATION_REQUIRED → UNKNOWN → positive outcomes.
 *
 * Ordering matters (lexicographic, non-passing wins): a material review need or
 * missing evidence outranks any positive observation — UNKNOWN never becomes a
 * PASS (§16/§23).
 *
 * @param {Object} buckets
 * @param {Object[]} buckets.review        findings demanding human/semantic review.
 * @param {Object[]} buckets.remediation   confirmed remediable debt (review-required violations).
 * @param {Object[]} buckets.advisory      advisory/observe-only signals only.
 * @param {Object[]} buckets.unknown       findings whose evidence was missing/errored.
 * @param {Object[]} buckets.accepted      governed intentional-debt acceptances (§21).
 * @param {Object[]} all                    the full finding set (for repayment/empty checks).
 * @returns {string} a GateOutcome value (never BLOCKED — that path precedes this).
 */
export function mapOutcome(buckets, all) {
  const { review, remediation, advisory, unknown, accepted } = buckets;
  // Non-passing ladder first — a material concern outranks any positive signal.
  if (review.length > 0) return GateOutcome.REVIEW_REQUIRED;
  if (remediation.length > 0) return GateOutcome.REMEDIATION_REQUIRED;
  // Missing evidence on a material rule is non-passing (§16) — never silent PASS.
  if (unknown.length > 0) return GateOutcome.UNKNOWN;
  // Positive outcomes (nothing material outstanding).
  if (hasRepaymentEvidence(all)) return GateOutcome.DEBT_REDUCED;
  if (accepted.length > 0) return GateOutcome.DEBT_ACCEPTED;
  if (advisory.length > 0) return GateOutcome.PASS_WITH_OBSERVATION;
  return GateOutcome.PASS;
}

/**
 * Is this finding a missing-evidence (UNKNOWN) signal that is MATERIAL — i.e.
 * could have carried a verdict? A SKIPPED finding on an inapplicable scope is
 * not material; an UNKNOWN on an evaluable rule is (§16, test §34.22).
 *
 * @param {Object} finding  an enforcement-resolved finding.
 * @returns {boolean} true iff the finding's missing evidence must not pass silently.
 */
export function isMaterialUnknown(finding) {
  return finding.status === FindingStatus.UNKNOWN;
}
