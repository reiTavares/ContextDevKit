/**
 * receipt-build.mjs — Session Autonomy Receipt: canonical assembler.
 *
 * Composes the five workstream modules (estimator, usage, financial, integrity,
 * render upstream) into ONE canonical `cdk-autonomy-receipt/1` payload (spec §21).
 * This is the ASSEMBLER — it owns NO economics math of its own; it only wires the
 * already-validated pieces and attaches integrity LAST (the signature is never
 * part of the hashed payload). Pure + deterministic: `generatedAt` is injected by
 * the caller (no Date.now() here). Zero deps.
 */

import {
  RECEIPT_SCHEMA_VERSION, RECEIPT_STATUSES, emptyUsageBlock, emptyFinancialBlock,
  isBasisValue,
} from './receipt-schema.mjs';
import { estimateSessionAutonomy } from './session-autonomy-estimator.mjs';
import { buildUsageBlock, reconcileUsage, buildExecutorBreakdown } from './receipt-usage.mjs';
import { buildFinancialBlock } from './receipt-financial.mjs';
import { signReceipt } from './receipt-integrity.mjs';

/** Reads the accepted-task count from outcome/acceptance signals (null-safe). */
function acceptedCount(sessionOutcome, acceptance) {
  const out = (sessionOutcome && typeof sessionOutcome === 'object') ? sessionOutcome : {};
  const acc = (acceptance && typeof acceptance === 'object') ? acceptance : {};
  const candidate = acc.accepted ?? acc.qaGreen ?? acc.acceptedUnits ?? out.accepted ?? out.qaGreen;
  return (typeof candidate === 'number' && Number.isFinite(candidate)) ? candidate : null;
}

/**
 * Builds the canonical outcome block (spec §20). Failed/incomplete work is kept
 * (#8); unknown counts are null, not zero (#19), except where a true 0 is known.
 * @returns {object}
 */
function buildOutcome(sessionOutcome, acceptance) {
  const out = (sessionOutcome && typeof sessionOutcome === 'object') ? sessionOutcome : {};
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    tasksAttempted: num(out.tasksAttempted),
    tasksCompleted: num(out.tasksCompleted),
    tasksAccepted: acceptedCount(sessionOutcome, acceptance),
    tasksRejected: num(out.tasksRejected),
    tasksIncomplete: num(out.tasksIncomplete),
    qaStatus: typeof out.qaStatus === 'string' ? out.qaStatus : null,
    humanInterventions: num(out.humanInterventions),
    retries: num(out.retries),
    escalations: num(out.escalations),
    fallbacks: num(out.fallbacks),
    loopBreakerActivations: num(out.loopBreakerActivations),
  };
}

/**
 * Keeps only telemetry-confirmed basis values (#23): a feature appears ONLY when
 * the caller passed it AND it is a recognised basis token.
 * @param {string[]} basis
 * @returns {string[]}
 */
function sanitizeBasis(basis) {
  if (!Array.isArray(basis)) return [];
  const seen = new Set();
  const result = [];
  for (const value of basis) {
    if (isBasisValue(value) && !seen.has(value)) { seen.add(value); result.push(value); }
  }
  return result;
}

/** Merges the estimator's autonomy-usage fields over the token-category block. */
function mergeUsage(categoryBlock, estimatorUsage) {
  const merged = { ...emptyUsageBlock(), ...categoryBlock };
  for (const key of [
    'observedTokens', 'estimatedBaselineTokens', 'estimatedSavedTokens',
    'tokenSavingsPercent', 'tokenEfficiencyMultiplier',
  ]) {
    if (estimatorUsage && estimatorUsage[key] != null) merged[key] = estimatorUsage[key];
  }
  return merged;
}

/**
 * Assembles a canonical, frozen Session Autonomy Receipt.
 *
 * @param {object} input — the collected session signals plus `generatedAt`
 *   (ISO string, injected), `signingKey` (from resolveSigningKey), `config`.
 * @returns {Readonly<object>} the canonical receipt (spec §21) with integrity attached.
 */
export function buildReceipt(input = {}) {
  const {
    sessionId = null, projectId = null, generatedAt = null,
    observedUsage = {}, taskCompilerTelemetry = null, economyRuntime = null,
    sessionOutcome = null, acceptance = null, consumptionMode = 'unknown',
    providerUsage = null, financialUsage = null, sessionProfile = null,
    directBaseline = null, executors = [], basis = [],
    baselineCost = null, pricingRegistry = null, actualProviderCost = null,
    userSuppliedCost = null, snapshotCost = null, pricingSnapshotId = null,
    signingKey = { available: false },
  } = input;

  const estimate = estimateSessionAutonomy({
    session: input.session ?? null, observedUsage, taskCompilerTelemetry, economyRuntime,
    sessionOutcome, acceptance, benchmarkCalibration: input.benchmarkCalibration ?? null,
    consumptionMode, providerUsage, financialUsage, sessionProfile, directBaseline,
  });

  const usage = mergeUsage(buildUsageBlock(observedUsage, {}), estimate.usage);
  const usageAccounting = reconcileUsage({
    providerReportedTotal: observedUsage.providerReportedTotal ?? null,
    normalizedCalculatedTotal: observedUsage.total ?? usage.observedTokens ?? null,
    adapter: observedUsage.adapter ?? null,
    adapterVersion: observedUsage.adapterVersion ?? null,
  });
  const executorBreakdown = buildExecutorBreakdown(executors);
  const financial = buildFinancialBlock({
    mode: consumptionMode, executors, acceptedTasks: acceptedCount(sessionOutcome, acceptance),
    baselineCost, pricingRegistry, actualProviderCost, userSuppliedCost, snapshotCost, pricingSnapshotId,
  });

  const payload = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptType: 'session-autonomy',
    reportId: sessionId ? `economy-session-${sessionId}` : null,
    sessionId,
    projectId,
    generatedAt,
    claimType: estimate.claimType,
    status: RECEIPT_STATUSES[0], // 'generated'
    consumption: estimate.consumption,
    usage,
    usageAccounting,
    autonomy: estimate.autonomy,
    financial: financial ?? emptyFinancialBlock(),
    outcome: buildOutcome(sessionOutcome, acceptance),
    executors: executorBreakdown,
    basis: sanitizeBasis(basis),
    confidence: estimate.confidence,
    estimator: estimate.estimator,
  };

  const integrity = signReceipt(payload, signingKey);
  return Object.freeze({ ...payload, integrity });
}
