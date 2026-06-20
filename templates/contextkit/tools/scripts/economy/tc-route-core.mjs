/**
 * Task-Compiler: execution-router core logic (WF0022 / ADR-0088).
 *
 * Cohesion note: this module exists ONLY because the combined public surface
 * (tc-route.mjs) would exceed the 308-line budget. All decision logic, signal
 * evaluation, and floor-clamping live here; tc-route.mjs re-exports the public
 * contract and owns the model-policy seam.
 *
 * consumes: model-policy
 * [task-compiler] [token-economy] [WF0022]
 */

// ---------------------------------------------------------------------------
// Route ladder
// ---------------------------------------------------------------------------

/**
 * Ordered execution tiers — cheapest to most expensive.
 * SCRIPT_ONLY: no model spawned. HAIKU/SONNET/OPUS: model tiers.
 * @type {Readonly<string[]>}
 */
export const ROUTE_LADDER = Object.freeze(['SCRIPT_ONLY', 'HAIKU', 'SONNET', 'OPUS']);

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Ambiguity score above which missingContext is flagged. */
export const AMBIGUITY_MISSING_THRESHOLD = 0.7;

/** Closure score below which missingContext is flagged. */
export const CLOSURE_LOW_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Decision builder
// ---------------------------------------------------------------------------

/**
 * Builds a frozen route-decision object matching the ADR-0088 §11.8 contract.
 *
 * @param {{
 *   route: string,
 *   confidence: number,
 *   signals: string[],
 *   reasons: string[],
 *   requiredCapabilities?: string[],
 *   missingContext?: string[],
 *   escalationTriggers?: string[],
 *   estimatedPacketSize?: number|null,
 *   escalation: { afterSameFailure: number, nextTier: string|null, humanAtRisk: boolean }
 * }} fields
 * @returns {Readonly<object>}
 */
export function buildDecision(fields) {
  return Object.freeze({
    schemaVersion:        fields.schemaVersion,
    route:                fields.route,
    confidence:           fields.confidence,
    signals:              Object.freeze(fields.signals.slice()),
    reasons:              Object.freeze(fields.reasons.slice()),
    requiredCapabilities: Object.freeze((fields.requiredCapabilities ?? []).slice()),
    missingContext:       Object.freeze((fields.missingContext ?? []).slice()),
    escalationTriggers:   Object.freeze((fields.escalationTriggers ?? []).slice()),
    estimatedPacketSize:  fields.estimatedPacketSize ?? null,
    advisory:             true,
    escalation:           Object.freeze({
      afterSameFailure: fields.escalation?.afterSameFailure ?? 2,
      nextTier:         fields.escalation?.nextTier ?? null,
      humanAtRisk:      fields.escalation?.humanAtRisk ?? false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Signal evaluators
// ---------------------------------------------------------------------------

/**
 * Returns true when any signal demands OPUS-level semantic reasoning.
 * ADR-0088: architecture/security/contract/irreversible/benchmark-validity —
 * NOT task size alone.
 *
 * @param {object} signals
 * @returns {{ needs: boolean, reasons: string[], capabilities: string[] }}
 */
export function evaluateOpusSignals(signals) {
  const reasons = [];
  const capabilities = [];

  if (signals.changedPublicContracts) {
    reasons.push('public-contract-change');
    capabilities.push('contract-review');
  }
  if (signals.risk === 'high' || signals.risk === 'critical') {
    reasons.push(`risk(${signals.risk})`);
    capabilities.push('risk-assessment');
  }
  if (signals.reversibility === 'irreversible') {
    reasons.push('irreversible-change');
    capabilities.push('impact-analysis');
  }
  if (signals.blastRadius === 'wide') {
    reasons.push('wide-blast-radius');
    capabilities.push('cross-module-analysis');
  }
  if (signals.requiresSecurity) {
    reasons.push('security-review-required');
    capabilities.push('security-analysis');
  }
  if (signals.requiresArchitectureDecision) {
    reasons.push('architecture-decision-required');
    capabilities.push('architecture-review');
  }

  return { needs: reasons.length > 0, reasons, capabilities };
}

/**
 * Returns true when all signals pass the SCRIPT_ONLY bar — no semantic
 * reasoning needed (mechanical, low-risk, local, unambiguous).
 *
 * @param {object} signals
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function evaluateScriptOnlyEligibility(signals) {
  if (signals.complexityTier !== 'mechanical')   return { eligible: false, reasons: [] };
  if (signals.risk && signals.risk !== 'low')     return { eligible: false, reasons: [] };
  if (signals.reversibility && signals.reversibility !== 'reversible') return { eligible: false, reasons: [] };
  if (signals.blastRadius && signals.blastRadius !== 'local')          return { eligible: false, reasons: [] };
  if (signals.ambiguityScore != null && signals.ambiguityScore > AMBIGUITY_MISSING_THRESHOLD) {
    return { eligible: false, reasons: [] };
  }
  if (signals.changedPublicContracts) return { eligible: false, reasons: [] };
  if (signals.requiresSecurity)       return { eligible: false, reasons: [] };

  return { eligible: true, reasons: ['mechanical-complexity', 'low-risk-local'] };
}

// ---------------------------------------------------------------------------
// Floor clamping
// ---------------------------------------------------------------------------

/** Maps model-policy tier names to route-ladder entries. */
const POLICY_TIER_TO_ROUTE = Object.freeze({
  fast:      'HAIKU',
  powerful:  'SONNET',
  reasoning: 'OPUS',
});

/**
 * Clamps a route tier upward when model-policy applied a floor.
 * Floors win (ADR-0052 §5): never route a floor agent below its floor.
 *
 * @param {string}   targetRoute  - desired route from ROUTE_LADDER
 * @param {object}   policyResult - result of resolveModel(agent, opts)
 * @param {string[]} reasons      - mutated in-place: floor reason appended if clamped
 * @returns {string}              - effective route (may equal targetRoute)
 */
export function applyFloorClamp(targetRoute, policyResult, reasons) {
  const policyRoute = POLICY_TIER_TO_ROUTE[policyResult.tier] ?? null;
  if (!policyRoute) return targetRoute;

  const targetIdx = ROUTE_LADDER.indexOf(targetRoute);
  const floorIdx  = ROUTE_LADDER.indexOf(policyRoute);
  const floorReasonTag = (policyResult.reasons ?? []).find((r) => r.startsWith('floor('));

  if (floorReasonTag && targetIdx < floorIdx) {
    reasons.push(`floor-clamp: ${targetRoute}->${policyRoute} (${floorReasonTag})`);
    return policyRoute;
  }
  return targetRoute;
}

// ---------------------------------------------------------------------------
// Signal collector
// ---------------------------------------------------------------------------

/**
 * Collects structured signals from the signals bag into a string array and
 * detects missing-context conditions.
 *
 * @param {object} signals
 * @returns {{ collectedSignals: string[], missingContext: string[] }}
 */
export function collectSignals(signals) {
  const collectedSignals = [];
  const missingContext   = [];

  if (signals.complexityTier)               collectedSignals.push(`complexity:${signals.complexityTier}`);
  if (signals.risk)                         collectedSignals.push(`risk:${signals.risk}`);
  if (signals.reversibility)                collectedSignals.push(`reversibility:${signals.reversibility}`);
  if (signals.blastRadius)                  collectedSignals.push(`blastRadius:${signals.blastRadius}`);
  if (signals.changedPublicContracts)       collectedSignals.push('changedPublicContracts');
  if (signals.requiresSecurity)             collectedSignals.push('requiresSecurity');
  if (signals.requiresArchitectureDecision) collectedSignals.push('requiresArchitectureDecision');
  if (signals.affectedFileCount != null)    collectedSignals.push(`affectedFiles:${signals.affectedFileCount}`);
  if (signals.retryCount != null)           collectedSignals.push(`retryCount:${signals.retryCount}`);
  if (signals.qaFailures != null)           collectedSignals.push(`qaFailures:${signals.qaFailures}`);
  if (signals.budgetExhausted)              collectedSignals.push('budgetExhausted');
  if (signals.closureScore != null)         collectedSignals.push(`closureScore:${signals.closureScore}`);
  if (signals.ambiguityScore != null)       collectedSignals.push(`ambiguityScore:${signals.ambiguityScore}`);

  if (signals.ambiguityScore != null && signals.ambiguityScore > AMBIGUITY_MISSING_THRESHOLD) {
    missingContext.push(`ambiguityScore(${signals.ambiguityScore}) exceeds threshold(${AMBIGUITY_MISSING_THRESHOLD})`);
  }
  if (signals.closureScore != null && signals.closureScore < CLOSURE_LOW_THRESHOLD) {
    missingContext.push(`closureScore(${signals.closureScore}) below threshold(${CLOSURE_LOW_THRESHOLD})`);
  }

  return { collectedSignals, missingContext };
}

// ---------------------------------------------------------------------------
// HAIKU eligibility (low-complexity, bounded, but not purely mechanical)
// ---------------------------------------------------------------------------

/**
 * Returns true when signals qualify for HAIKU (bounded low-risk, moderate
 * complexity, no missing context).
 *
 * @param {object} signals
 * @param {string[]} missingContext
 * @returns {boolean}
 */
export function isHaikuEligible(signals, missingContext) {
  if (missingContext.length > 0) return false;
  const isLowComplexity = signals.complexityTier === 'mechanical'
    || (signals.complexityTier === 'moderate'
        && signals.affectedFileCount != null
        && signals.affectedFileCount <= 2);
  const isLowRisk = !signals.risk || signals.risk === 'low';
  const isBounded = !signals.blastRadius || signals.blastRadius === 'local';
  return isLowComplexity && isLowRisk && isBounded;
}
