/**
 * receipt-schema.mjs — Session Autonomy Receipt: canonical schema constants.
 *
 * The single source of truth for the receipt's versioned shape, the closed enums
 * every layer validates against, and the machine-readable reason codes (spec §7,
 * §21). Pure data + tiny pure validators; zero deps, deterministic.
 *
 * Naming follows the repo's economy convention (`cdk-*` schema strings, frozen
 * objects). The receipt is an ASSEMBLER over existing economics modules — it does
 * NOT introduce a parallel ledger (spec preamble), so most numeric fields are
 * produced elsewhere and only NAMED + ENUMERATED here.
 */

/** Canonical schema id for a Session Autonomy Receipt payload. */
export const RECEIPT_SCHEMA_VERSION = 'cdk-autonomy-receipt/1';

/** Estimator identity — recorded on every receipt (invariant #11). */
export const ESTIMATOR_NAME = 'session-autonomy-estimator';
export const ESTIMATOR_VERSION = '1.0.0';

/** Consumption modes (spec §4). `unknown` is the safe default. */
export const CONSUMPTION_MODES = Object.freeze(['subscription', 'api', 'hybrid', 'unknown']);

/** Claim types (spec §6). Estimated is never relabeled as measured (#1). */
export const CLAIM_TYPES = Object.freeze(['measured', 'estimated', 'insufficient-evidence']);

/** Confidence levels (spec §10). Receipt-level abstraction, distinct from the
 *  economics-layer evidence confidence (`direct`/`inferred`/`unknown`). */
export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low', 'insufficient']);

/** Integrity states (spec §22). */
export const INTEGRITY_STATES = Object.freeze(['signed', 'hash-only', 'unsigned', 'invalid']);

/** Token reconciliation states (spec §5). */
export const RECONCILIATION_STATES = Object.freeze([
  'matched', 'provider-total-only', 'calculated-total-only', 'mismatch', 'partial', 'unavailable',
]);

/** Cost-source status (spec §16). Actual takes precedence over estimated (#22). */
export const COST_STATUSES = Object.freeze(['actual', 'estimated', 'user-supplied', 'unavailable']);

/** Estimation modes (spec §29). Public default is `conservative`. */
export const ESTIMATION_MODES = Object.freeze(['conservative', 'balanced', 'experimental']);

/** Receipt lifecycle status. */
export const RECEIPT_STATUSES = Object.freeze(['generated', 'failed']);

/**
 * Evidence-basis vocabulary (spec §14). A feature appears in a receipt's `basis`
 * ONLY when telemetry confirms it was used (#23) — this list is the closed set
 * of allowed values, not an assertion that any were used.
 */
export const BASIS_VALUES = Object.freeze([
  'project-map', 'project-map-find', 'graphify', 'related-files', 'symbol-context',
  'closure-guard', 'code-guidance', 'compiled-work-packet', 'run-compact',
  'deterministic-execution', 'economic-model-routing', 'strong-model-escalation',
  'qa-green', 'external-acceptance', 'loop-breaker', 'task-compiler-routing',
  'graphify-related-files',
]);

/**
 * Machine-readable reason codes for non-generated / degraded receipts (spec §7).
 * Emitted alongside human-readable text — never a silent failure.
 */
export const REASON_CODES = Object.freeze({
  ESTIMATOR_INPUT_INCOMPLETE: 'estimator-input-incomplete',
  INSUFFICIENT_CALIBRATED_EVIDENCE: 'insufficient-calibrated-evidence',
  NO_USAGE_TELEMETRY: 'no-usage-telemetry',
  NO_OUTCOME_EVIDENCE: 'no-outcome-evidence',
  ESTIMATOR_THREW: 'estimator-threw',
  SIGNATURE_FAILED: 'signature-failed',
  STORAGE_FAILED: 'storage-failed',
  FEATURE_DISABLED: 'feature-disabled',
});

const FROZEN_SETS = {
  mode: new Set(CONSUMPTION_MODES),
  claim: new Set(CLAIM_TYPES),
  confidence: new Set(CONFIDENCE_LEVELS),
  integrity: new Set(INTEGRITY_STATES),
  reconciliation: new Set(RECONCILIATION_STATES),
  cost: new Set(COST_STATUSES),
  estimation: new Set(ESTIMATION_MODES),
  basis: new Set(BASIS_VALUES),
};

export const isConsumptionMode = (value) => FROZEN_SETS.mode.has(value);
export const isClaimType = (value) => FROZEN_SETS.claim.has(value);
export const isConfidenceLevel = (value) => FROZEN_SETS.confidence.has(value);
export const isIntegrityState = (value) => FROZEN_SETS.integrity.has(value);
export const isReconciliationState = (value) => FROZEN_SETS.reconciliation.has(value);
export const isCostStatus = (value) => FROZEN_SETS.cost.has(value);
export const isEstimationMode = (value) => FROZEN_SETS.estimation.has(value);
export const isBasisValue = (value) => FROZEN_SETS.basis.has(value);

/**
 * Canonical all-null usage block (spec §21). Unknown categories are null, not
 * zero (#19). Callers overwrite only what telemetry actually provides.
 * @returns {object} a fresh (non-frozen) block so the assembler can populate it.
 */
export function emptyUsageBlock() {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    toolTokens: null,
    observedTokens: null,
    estimatedBaselineTokens: null,
    estimatedSavedTokens: null,
    tokenSavingsPercent: null,
    tokenEfficiencyMultiplier: null,
  };
}

/**
 * Canonical all-null financial block (spec §21). Subscription mode keeps these
 * null + costStatus 'unavailable' — financial savings are NEVER invented (#14).
 * @returns {object}
 */
export function emptyFinancialBlock() {
  return {
    currency: null,
    actualCost: null,
    estimatedCost: null,
    observedCost: null,
    estimatedBaselineCost: null,
    estimatedSavings: null,
    estimatedSavingsPercent: null,
    costEfficiencyMultiplier: null,
    costPerAcceptedTask: null,
    costStatus: 'unavailable',
    costSource: null,
    pricingSnapshotId: null,
  };
}

/**
 * Canonical autonomy block (spec §21) — all null until the estimator fills it.
 * @returns {object}
 */
export function emptyAutonomyBlock() {
  return { multiplier: null, gainPercent: null, lowerBound: null, upperBound: null };
}
