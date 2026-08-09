/**
 * estimator-confidence.mjs — Session Autonomy Receipt: claim + confidence policy.
 *
 * The honesty kernel for the estimator (spec §6, §10). Two pure resolvers, no
 * I/O, zero deps, deterministic (no Date.now()/Math.random()/new Date()):
 *
 *  - `resolveClaimType` decides measured / estimated / insufficient-evidence and
 *    enforces the cardinal invariant (#1): an `estimated` path is NEVER relabeled
 *    `measured`. Only a real, valid direct A/B baseline mints `measured`.
 *  - `resolveConfidence` maps evidence quality onto the receipt-level confidence
 *    abstraction {high, medium, low, insufficient} (spec §10) — which is DISTINCT
 *    from the economics-layer evidence confidence (derived/inferred/unknown).
 *
 * Reasons are machine-readable strings (a closed vocabulary) so a consumer can
 * render or branch without parsing prose (constitution §4, fail-loud-not-silent).
 */

import { CLAIM_TYPES, CONFIDENCE_LEVELS, REASON_CODES } from './receipt-schema.mjs';

/** Closed vocabulary of machine-readable confidence reasons (spec §10). */
export const CONFIDENCE_REASONS = Object.freeze({
  DIRECT_AB_BASELINE: 'direct-ab-baseline',
  CALIBRATED_TASK_PROFILE: 'calibrated-task-profile',
  QA_GREEN_CONFIRMED: 'qa-green-confirmed',
  COMPLETE_SESSION_TELEMETRY: 'complete-session-telemetry',
  NO_DIRECT_BASELINE: 'no-direct-baseline',
  PARTIAL_TELEMETRY: 'partial-telemetry',
  WEAK_PROFILE_MATCH: 'weak-profile-match',
  NO_USABLE_EVIDENCE: 'no-usable-evidence',
  QUALITY_NON_INFERIORITY: 'quality-non-inferiority',
});

/**
 * Resolves the receipt claim type from the evidence available (spec §6, #1).
 *
 * Precedence is strict and one-directional: a valid direct A/B arm is the ONLY
 * thing that yields `measured`. A matched calibration profile yields `estimated`
 * — it can never be promoted. Anything else is `insufficient-evidence`, carrying
 * a machine-readable reason so the caller emits NO fabricated number.
 *
 * @param {{ hasUsage: boolean, hasDirectBaseline: boolean,
 *   calibrationMatched: boolean }} signals
 * @returns {{ claimType: string, reason: string|null }} reason is null on a
 *   positive claim; a REASON_CODES value when claimType is insufficient-evidence.
 */
export function resolveClaimType(signals) {
  const sig = (signals && typeof signals === 'object') ? signals : {};
  if (sig.hasUsage !== true) {
    return { claimType: CLAIM_TYPES[2], reason: REASON_CODES.NO_USAGE_TELEMETRY };
  }
  if (sig.hasDirectBaseline === true) {
    return { claimType: CLAIM_TYPES[0], reason: null }; // 'measured'
  }
  if (sig.calibrationMatched === true) {
    return { claimType: CLAIM_TYPES[1], reason: null }; // 'estimated'
  }
  return { claimType: CLAIM_TYPES[2], reason: REASON_CODES.INSUFFICIENT_CALIBRATED_EVIDENCE };
}

/** Clamps a score into [0,1]; non-finite → 0 (conservative, never inflate). */
function clamp01(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Resolves receipt-level confidence {high, medium, low, insufficient} (spec §10).
 *
 * Policy:
 *  - high   = direct A/B baseline + complete usage telemetry + quality
 *             non-inferiority (qaGreen, no interventions).
 *  - medium = matched calibrated profile + complete telemetry + QA-green +
 *             NO direct baseline.
 *  - low    = partial telemetry OR a weak profile match (any usable-but-thin
 *             evidence that still carried a number).
 *  - insufficient = no usable evidence.
 *
 * The score is a coarse, deterministic 0..1 surrogate (not a probability): it
 * ranks the four tiers so a consumer can sort/threshold without re-deriving.
 *
 * @param {{ hasDirectBaseline?: boolean, calibrationMatch?: boolean,
 *   telemetryCompleteness?: number, qaGreen?: boolean,
 *   interventions?: number, weakMatch?: boolean }} params
 * @returns {{ level: string, score: number, reasons: string[] }}
 */
export function resolveConfidence(params) {
  const input = (params && typeof params === 'object') ? params : {};
  const completeness = clamp01(input.telemetryCompleteness);
  const completeTelemetry = completeness >= 1;
  const qaGreen = input.qaGreen === true;
  const interventions = Number.isFinite(input.interventions) ? input.interventions : null;
  const qualityNonInferior = qaGreen && (interventions === null || interventions <= 0);
  const reasons = [];

  // high: direct A/B + complete usage + quality non-inferiority.
  if (input.hasDirectBaseline === true && completeTelemetry && qualityNonInferior) {
    reasons.push(CONFIDENCE_REASONS.DIRECT_AB_BASELINE);
    reasons.push(CONFIDENCE_REASONS.COMPLETE_SESSION_TELEMETRY);
    reasons.push(CONFIDENCE_REASONS.QUALITY_NON_INFERIORITY);
    return frozenConfidence(CONFIDENCE_LEVELS[0], 0.95, reasons);
  }

  // medium: matched calibrated profile + complete telemetry + QA-green + no A/B.
  if (input.calibrationMatch === true && completeTelemetry && qaGreen
    && input.hasDirectBaseline !== true && input.weakMatch !== true) {
    reasons.push(CONFIDENCE_REASONS.CALIBRATED_TASK_PROFILE);
    reasons.push(CONFIDENCE_REASONS.COMPLETE_SESSION_TELEMETRY);
    reasons.push(CONFIDENCE_REASONS.QA_GREEN_CONFIRMED);
    reasons.push(CONFIDENCE_REASONS.NO_DIRECT_BASELINE);
    return frozenConfidence(CONFIDENCE_LEVELS[1], 0.7, reasons);
  }

  // low: there is SOME usable evidence (a match or partial telemetry) but it is
  // thin — a weak match or incomplete usage. Still carries a number.
  if (input.calibrationMatch === true || (completeness > 0 && completeness < 1)) {
    if (!completeTelemetry) reasons.push(CONFIDENCE_REASONS.PARTIAL_TELEMETRY);
    if (input.weakMatch === true) reasons.push(CONFIDENCE_REASONS.WEAK_PROFILE_MATCH);
    if (reasons.length === 0) reasons.push(CONFIDENCE_REASONS.PARTIAL_TELEMETRY);
    return frozenConfidence(CONFIDENCE_LEVELS[2], 0.4, reasons);
  }

  // insufficient: nothing usable.
  reasons.push(CONFIDENCE_REASONS.NO_USABLE_EVIDENCE);
  return frozenConfidence(CONFIDENCE_LEVELS[3], 0, reasons);
}

/** Builds the frozen confidence record (reasons array frozen too). */
function frozenConfidence(level, score, reasons) {
  return Object.freeze({ level, score, reasons: Object.freeze(reasons.slice()) });
}
