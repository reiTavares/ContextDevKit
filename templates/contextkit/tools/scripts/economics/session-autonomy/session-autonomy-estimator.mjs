/**
 * session-autonomy-estimator.mjs — Session Autonomy Receipt: the estimator.
 *
 * The honest core of the receipt. It is an ASSEMBLER over the existing
 * `economics/` layer (spec preamble) — it introduces NO new ledger. Given a
 * session's signals it resolves a claim type, derives ONLY the numbers the
 * evidence actually supports, and returns the §9 result object (frozen).
 *
 * Cardinal honesty invariants (enforced here, never relaxed):
 *  - claimType ∈ {measured, estimated, insufficient-evidence}; an `estimated`
 *    path is NEVER relabeled `measured` (#1) — only a valid direct A/B arm mints
 *    `measured`.
 *  - A multiplier is NEVER shown without a matched calibration baseline OR a
 *    direct A/B (#24). No match + no direct baseline ⇒ insufficient-evidence with
 *    a machine-readable reason and ALL numbers null — never a fabricated figure.
 *  - The 1.3983× pilot is NOT a global constant: it lives only in the scoped
 *    calibration profile (calibration-profiles.json) and is applied only when the
 *    session's task profile matches it.
 *  - autonomy gain ≠ token reduction — separate metrics (#4). Unknowns are null,
 *    never 0 (#19).
 *
 * Deterministic (no Date.now()/Math.random()/new Date()); zero deps (node:* /
 * relative imports only); defensive — never crashes the caller.
 */

import {
  tokenEfficiencyMultiplier, tokenSavingsPercent, savedTokens, autonomyGainPercent,
} from './receipt-metrics.mjs';
import {
  CLAIM_TYPES, ESTIMATOR_NAME, REASON_CODES, emptyUsageBlock, emptyAutonomyBlock,
} from './receipt-schema.mjs';
import { matchProfile } from '../calibration/calibration-profiles.mjs';
import { autonomyMultiplier } from '../autonomy-multiplier.mjs';
import { resolveClaimType, resolveConfidence } from './estimator-confidence.mjs';

/** Estimator version — recorded on every receipt (spec §11). */
export const SESSION_AUTONOMY_ESTIMATOR_VERSION = '1.0.0';

/** Reads the observed effective token count from the usage telemetry, or null. */
function readObservedTokens(observedUsage) {
  if (!observedUsage || typeof observedUsage !== 'object') return null;
  const candidate = observedUsage.observedTokens ?? observedUsage.effectiveTokens
    ?? observedUsage.totalTokens;
  return (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0)
    ? candidate : null;
}

/** Reads the count of accepted/QA-green units from acceptance/outcome signals. */
function readAccepted(acceptance, sessionOutcome) {
  const fromAcceptance = acceptance && typeof acceptance === 'object'
    ? (acceptance.accepted ?? acceptance.qaGreen ?? acceptance.acceptedUnits) : null;
  const fromOutcome = sessionOutcome && typeof sessionOutcome === 'object'
    ? (sessionOutcome.accepted ?? sessionOutcome.qaGreen) : null;
  const value = fromAcceptance ?? fromOutcome;
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : null;
}

/** Builds the frozen consumption block from mode/provider signals (spec §4). */
function buildConsumption(consumptionMode, providerUsage) {
  const provider = providerUsage && typeof providerUsage === 'object' ? providerUsage : {};
  return {
    mode: typeof consumptionMode === 'string' ? consumptionMode : 'unknown',
    provider: typeof provider.provider === 'string' ? provider.provider : null,
    model: typeof provider.model === 'string' ? provider.model : null,
    usageSource: typeof provider.usageSource === 'string' ? provider.usageSource : null,
  };
}

/** Assembles the frozen §9 result object. All blocks frozen; unknowns null. */
function buildResult({ claimType, consumption, usage, autonomy, confidence, calibrationId }) {
  return Object.freeze({
    claimType,
    consumption: Object.freeze(consumption),
    usage: Object.freeze(usage),
    autonomy: Object.freeze(autonomy),
    confidence,
    estimator: Object.freeze({
      name: ESTIMATOR_NAME,
      version: SESSION_AUTONOMY_ESTIMATOR_VERSION,
      calibrationId: calibrationId ?? null,
    }),
  });
}

/** Returns true for a valid direct A/B baseline (same task/acceptance/isolation). */
function isValidDirectBaseline(directBaseline) {
  if (!directBaseline || typeof directBaseline !== 'object') return false;
  const tokens = directBaseline.baselineTokens;
  const valid = typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0;
  return valid && directBaseline.sameTask === true
    && directBaseline.sameAcceptance === true && directBaseline.isolated === true;
}

/**
 * Builds an insufficient-evidence result with ALL numbers null (#19, #24).
 * The machine-readable REASON_CODES value is surfaced inside confidence.reasons
 * (the §9 object's only reason channel) so a consumer never has to parse prose
 * and no number is ever fabricated to fill a gap.
 */
function insufficient(consumption, reasonCode) {
  const confidence = resolveConfidence({ hasDirectBaseline: false, calibrationMatch: false });
  const reasons = Object.freeze([reasonCode, ...confidence.reasons]);
  return buildResult({
    claimType: CLAIM_TYPES[2],
    consumption,
    usage: emptyUsageBlock(),
    autonomy: emptyAutonomyBlock(),
    confidence: Object.freeze({ level: confidence.level, score: confidence.score, reasons }),
    calibrationId: null,
  });
}

/** measured path: a real direct A/B arm with equal accepted work (spec §6.1). */
function estimateFromDirectBaseline(ctx) {
  const { observedTokens, accepted, directBaseline, consumption } = ctx;
  const baselineTokens = directBaseline.baselineTokens;
  const acceptedUnits = (typeof accepted === 'number' && accepted > 0) ? accepted : 1;
  const ratio = autonomyMultiplier(
    { qaGreen: acceptedUnits, units: observedTokens },
    { qaGreen: acceptedUnits, units: baselineTokens },
    { unit: 'effective-mtok' },
  );
  const multiplier = (ratio && ratio.status !== 'skipped') ? ratio.multiplier : null;
  const usage = emptyUsageBlock();
  usage.observedTokens = observedTokens;
  usage.estimatedBaselineTokens = baselineTokens;
  usage.estimatedSavedTokens = savedTokens(observedTokens, baselineTokens);
  usage.tokenSavingsPercent = tokenSavingsPercent(observedTokens, baselineTokens);
  usage.tokenEfficiencyMultiplier = tokenEfficiencyMultiplier(observedTokens, baselineTokens);
  return buildResult({
    claimType: CLAIM_TYPES[0], // 'measured'
    consumption,
    usage,
    autonomy: {
      multiplier,
      gainPercent: autonomyGainPercent(multiplier),
      lowerBound: Number.isFinite(directBaseline.lowerBound) ? directBaseline.lowerBound : null,
      upperBound: Number.isFinite(directBaseline.upperBound) ? directBaseline.upperBound : null,
    },
    confidence: resolveConfidence({
      hasDirectBaseline: true, calibrationMatch: false, telemetryCompleteness: ctx.telemetryCompleteness ?? 1,
      qaGreen: acceptedUnits > 0, interventions: ctx.interventions,
    }),
    calibrationId: null,
  });
}

/** estimated path: a matched, scoped calibration profile (spec §6.2). */
function estimateFromCalibration(ctx) {
  const { observedTokens, match, accepted, consumption } = ctx;
  const profile = match.profile; // the matched calibration ENTRY (carries the scoped ratio)
  const scopedMultiplier = profile.tokenEfficiencyMultiplier;
  // Guard: a matched profile without a finite scoped ratio cannot estimate a
  // baseline — refuse rather than write NaN (#19). Falls through to insufficient.
  if (!Number.isFinite(scopedMultiplier) || scopedMultiplier <= 0) {
    return insufficient(consumption, REASON_CODES.INSUFFICIENT_CALIBRATED_EVIDENCE);
  }
  // Scoped ratio applied to THIS session's observed tokens — never a global const.
  const estimatedBaselineTokens = observedTokens * scopedMultiplier;
  const usage = emptyUsageBlock();
  usage.observedTokens = observedTokens;
  usage.estimatedBaselineTokens = estimatedBaselineTokens;
  usage.estimatedSavedTokens = savedTokens(observedTokens, estimatedBaselineTokens);
  usage.tokenSavingsPercent = tokenSavingsPercent(observedTokens, estimatedBaselineTokens);
  usage.tokenEfficiencyMultiplier = tokenEfficiencyMultiplier(observedTokens, estimatedBaselineTokens);
  // Autonomy multiplier equals the token ratio ONLY when accepted work is equal
  // on both arms — the calibration profile is defined at equal QA-green.
  const autonomyMult = usage.tokenEfficiencyMultiplier;
  // QA-green must come from THIS session's accepted work, never the profile —
  // else a no-telemetry session inherits the pilot's green (debate voice 1).
  const qaGreen = (typeof accepted === 'number' && accepted > 0);
  return buildResult({
    claimType: CLAIM_TYPES[1], // 'estimated' — NEVER promoted to measured (#1)
    consumption,
    usage,
    autonomy: {
      multiplier: autonomyMult,
      gainPercent: autonomyGainPercent(autonomyMult),
      lowerBound: Number.isFinite(profile.lowerBound) ? profile.lowerBound : null,
      upperBound: Number.isFinite(profile.upperBound) ? profile.upperBound : null,
    },
    confidence: resolveConfidence({
      hasDirectBaseline: false, calibrationMatch: true, telemetryCompleteness: ctx.telemetryCompleteness ?? 1,
      qaGreen: Boolean(qaGreen), interventions: ctx.interventions, weakMatch: ctx.weakMatch === true,
    }),
    calibrationId: match.calibrationId,
  });
}

/**
 * Estimates per-session autonomy from the assembled session signals (spec §9).
 *
 * Resolution order: no usage → insufficient(NO_USAGE_TELEMETRY); valid direct
 * A/B → measured; matched calibration profile → estimated; otherwise →
 * insufficient(INSUFFICIENT_CALIBRATED_EVIDENCE). The estimator never throws on
 * shape mismatches — it returns a structured insufficient result; the finalizer
 * owns the try/catch for genuinely unexpected throws.
 *
 * @param {{ session?: object, observedUsage?: object,
 *   taskCompilerTelemetry?: object, economyRuntime?: object,
 *   sessionOutcome?: object, acceptance?: object, benchmarkCalibration?: object,
 *   consumptionMode?: string, providerUsage?: object, financialUsage?: object,
 *   sessionProfile?: object, directBaseline?: object }} inputs
 * @returns {Readonly<object>} the frozen §9 result object.
 */
export function estimateSessionAutonomy(inputs) {
  const input = (inputs && typeof inputs === 'object') ? inputs : {};
  const consumption = buildConsumption(input.consumptionMode, input.providerUsage);
  const observedTokens = readObservedTokens(input.observedUsage);
  const accepted = readAccepted(input.acceptance, input.sessionOutcome);
  const interventions = (input.sessionOutcome && Number.isFinite(input.sessionOutcome.interventions))
    ? input.sessionOutcome.interventions : null;

  const hasDirectBaseline = isValidDirectBaseline(input.directBaseline);
  const match = hasDirectBaseline ? { matched: false } : matchProfile(input.sessionProfile);
  // Confidence inputs derived from real signals (not asserted): a thin match
  // (similarity near the 0.6 threshold) drops to low; completeness reflects
  // whether an acceptance/outcome signal was actually observed.
  const similarity = (match && Number.isFinite(match.similarity)) ? match.similarity : 0;
  // A cross-taskType match applies a scoped ratio outside its dominant axis —
  // treat as weak (low confidence + range), never medium (debate 2026-06-20 voice 1).
  const sessionTaskType = input.sessionProfile && typeof input.sessionProfile.taskType === 'string'
    ? input.sessionProfile.taskType.toLowerCase() : null;
  const profileTaskType = match.profile && match.profile.profile && typeof match.profile.profile.taskType === 'string'
    ? match.profile.profile.taskType.toLowerCase() : null;
  const taskTypeMismatch = Boolean(sessionTaskType && profileTaskType && sessionTaskType !== profileTaskType);
  const weakMatch = match.matched === true && (similarity < 0.75 || taskTypeMismatch);
  // Completeness reflects REAL accepted work, not the profile (voice 1): accepted
  // must be a positive count, else telemetry is partial.
  const telemetryCompleteness = (typeof accepted === 'number' && accepted > 0) ? 1 : 0.6;
  const claim = resolveClaimType({
    hasUsage: observedTokens !== null,
    hasDirectBaseline,
    calibrationMatched: match.matched === true,
  });

  if (claim.claimType === CLAIM_TYPES[2]) {
    return insufficient(consumption, claim.reason ?? REASON_CODES.ESTIMATOR_INPUT_INCOMPLETE);
  }
  if (hasDirectBaseline) {
    return estimateFromDirectBaseline({
      observedTokens, accepted, directBaseline: input.directBaseline, consumption, interventions, telemetryCompleteness,
    });
  }
  return estimateFromCalibration({ observedTokens, match, accepted, consumption, interventions, telemetryCompleteness, weakMatch });
}
