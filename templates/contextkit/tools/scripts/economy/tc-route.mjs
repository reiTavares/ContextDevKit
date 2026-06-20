/**
 * Task-Compiler: execution router — public surface (WF0022 / ADR-0088).
 *
 * Single responsibility: expose `resolveExecution` + `presentRoute`, wiring
 * the pure signal evaluation (tc-route-core.mjs) to model-policy so floors and
 * host-awareness remain single-sourced. The router adds the SCRIPT_ONLY tier
 * and the explainable signal/reason layer on top of model-policy.resolveModel.
 *
 * Design invariants:
 *   - PURE: resolveExecution has zero side-effects. No Date.now, Math.random,
 *     network I/O, or file I/O inside. The runner injects all signals.
 *   - FLOORS WIN: model-policy floor beats budget de-escalation (ADR-0052 §5).
 *   - ADVISORY ALWAYS TRUE: output is advisory; callers decide whether to act.
 *   - SPLIT-FIRST: "task is large" alone never justifies OPUS. ADR-0088 §11.8
 *     demands architecture/security/contract/irreversible signals.
 *
 * consumes: model-policy
 * [task-compiler] [token-economy] [WF0022]
 */
import { resolveModel }                from '../model-policy.mjs';
import {
  ROUTE_LADDER,
  buildDecision,
  evaluateOpusSignals,
  evaluateScriptOnlyEligibility,
  applyFloorClamp,
  collectSignals,
  isHaikuEligible,
} from './tc-route-core.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for route decisions produced by this module. */
export const TC_ROUTE_SCHEMA_VERSION = 'cdk-tc-route/1';

// Re-export for downstream consumers that only import tc-route.mjs.
export { ROUTE_LADDER };

// ---------------------------------------------------------------------------
// model-policy seam (injectable for deterministic tests)
// ---------------------------------------------------------------------------

/**
 * Seam: override to inject a fake resolveModel without real file I/O.
 * @private
 */
let _policyOverride = null;

/** @private */
function _resolveModel(agent, opts) {
  return (_policyOverride ?? { resolveModel }).resolveModel(agent, opts);
}

/**
 * Injects a fake model-policy resolver for tests (pass null to reset).
 * @param {{ resolveModel: Function }|null} override
 */
export function _injectModelPolicyForTest(override) {
  _policyOverride = override;
}

// ---------------------------------------------------------------------------
// Agent archetypes used when funnelling through model-policy
// ---------------------------------------------------------------------------

/** resolveModel archetype for OPUS decisions (architecture/security tier). */
const AGENT_OPUS   = 'architect';
/** resolveModel archetype for HAIKU decisions (cheap execution tier). */
const AGENT_HAIKU  = 'qa-unit';
/** resolveModel archetype for SONNET decisions (balanced implementation tier). */
const AGENT_SONNET = 'test-engineer';

// ---------------------------------------------------------------------------
// Main pure resolver
// ---------------------------------------------------------------------------

/**
 * Resolves an execution route for a work-packet given runtime signals.
 *
 * PURE function: same inputs → same output, zero side-effects.
 * Route ladder: SCRIPT_ONLY → HAIKU → SONNET → OPUS
 *
 * Decision priority:
 *   1. OPUS  — any architecture/security/contract/irreversible signal.
 *   2. SCRIPT_ONLY — all mechanical/low-risk gates pass.
 *   3. HAIKU — low-complexity, bounded scope, no missing context.
 *   4. SONNET — default implementation (catch-all).
 *   5. Floor clamp — model-policy floor overrides if set higher.
 *
 * @param {Readonly<object>} packet  - work-packet produced by tc-packet.mjs
 * @param {{
 *   complexityTier?:              'mechanical'|'moderate'|'high',
 *   risk?:                        'low'|'medium'|'high'|'critical',
 *   reversibility?:               'reversible'|'irreversible',
 *   blastRadius?:                 'local'|'moderate'|'wide',
 *   affectedFileCount?:           number,
 *   changedPublicContracts?:      boolean,
 *   ambiguityScore?:              number,
 *   closureScore?:                number,
 *   missingContextScore?:         number,
 *   estimatedPacketSize?:         number|null,
 *   testAvailability?:            boolean,
 *   retryCount?:                  number,
 *   qaFailures?:                  number,
 *   budgetExhausted?:             boolean,
 *   requiresSecurity?:            boolean,
 *   requiresArchitectureDecision?: boolean,
 *   host?:                        string,
 *   policy?:                      object,
 * }} [signals={}]
 * @returns {Readonly<object>} ADR-0088 §11.8 route-decision contract
 * @throws {TypeError} on null/non-object packet or signals
 */
export function resolveExecution(packet, signals = {}) {
  if (!packet || typeof packet !== 'object') {
    throw new TypeError('resolveExecution: packet must be a non-null object');
  }
  if (!signals || typeof signals !== 'object') {
    throw new TypeError('resolveExecution: signals must be a non-null object');
  }

  const { collectedSignals, missingContext } = collectSignals(signals);
  const reasons = [];
  const requiredCapabilities = [];
  const policyOpts = {
    budgetExhausted: !!signals.budgetExhausted,
    qaFailures:      signals.qaFailures ?? 0,
    host:            signals.host ?? 'claude',
    policy:          signals.policy,
  };

  // ── Step 1: OPUS path ───────────────────────────────────────────────────
  const opusEval = evaluateOpusSignals(signals);
  if (opusEval.needs) {
    reasons.push(...opusEval.reasons);
    requiredCapabilities.push(...opusEval.capabilities);

    const policyResult = _resolveModel(AGENT_OPUS, { ...policyOpts, task: 'think' });
    const route        = applyFloorClamp('OPUS', policyResult, reasons);
    const nextIdx      = ROUTE_LADDER.indexOf(route) + 1;

    return buildDecision({
      schemaVersion: TC_ROUTE_SCHEMA_VERSION,
      route,
      confidence: 0.9,
      signals: collectedSignals,
      reasons,
      requiredCapabilities,
      missingContext,
      escalationTriggers: [],
      estimatedPacketSize: signals.estimatedPacketSize ?? null,
      escalation: {
        afterSameFailure: 2,
        nextTier:         nextIdx < ROUTE_LADDER.length ? ROUTE_LADDER[nextIdx] : null,
        humanAtRisk:      true,
      },
    });
  }

  // ── Step 2: SCRIPT_ONLY path ────────────────────────────────────────────
  const scriptEval = evaluateScriptOnlyEligibility(signals);
  if (scriptEval.eligible) {
    reasons.push(...scriptEval.reasons);
    return buildDecision({
      schemaVersion: TC_ROUTE_SCHEMA_VERSION,
      route: 'SCRIPT_ONLY',
      confidence: 0.95,
      signals: collectedSignals,
      reasons,
      requiredCapabilities,
      missingContext,
      escalationTriggers: ['semantic-reasoning-required', 'output-validation-fails'],
      estimatedPacketSize: signals.estimatedPacketSize ?? null,
      escalation: {
        afterSameFailure: 2,
        nextTier:         'HAIKU',
        humanAtRisk:      false,
      },
    });
  }

  // ── Step 3: HAIKU path ──────────────────────────────────────────────────
  if (isHaikuEligible(signals, missingContext)) {
    reasons.push('low-complexity-bounded-scope');
    const policyResult = _resolveModel(AGENT_HAIKU, { ...policyOpts, task: 'execute' });
    const route        = applyFloorClamp('HAIKU', policyResult, reasons);
    const nextIdx      = ROUTE_LADDER.indexOf(route) + 1;

    return buildDecision({
      schemaVersion: TC_ROUTE_SCHEMA_VERSION,
      route,
      confidence: 0.8,
      signals: collectedSignals,
      reasons,
      requiredCapabilities,
      missingContext,
      escalationTriggers: ['qa-failure', 'retry-exceeded'],
      estimatedPacketSize: signals.estimatedPacketSize ?? null,
      escalation: {
        afterSameFailure: 2,
        nextTier:         nextIdx < ROUTE_LADDER.length ? ROUTE_LADDER[nextIdx] : null,
        humanAtRisk:      false,
      },
    });
  }

  // ── Step 4: SONNET (default implementation) ─────────────────────────────
  reasons.push('default-implementation-tier');
  if (signals.complexityTier === 'high') reasons.push('complexity:high');
  if (missingContext.length > 0) reasons.push('missing-context-flagged');

  const escalationTriggers = [];
  const retryEscalation = (signals.retryCount ?? 0) >= 2 || (signals.qaFailures ?? 0) >= 2;
  if (retryEscalation) {
    escalationTriggers.push('retry-threshold-reached');
    reasons.push('retry-escalation-advisory');
  }

  const policyResult = _resolveModel(AGENT_SONNET, { ...policyOpts, task: 'execute' });
  const route        = applyFloorClamp('SONNET', policyResult, reasons);
  const nextIdx      = ROUTE_LADDER.indexOf(route) + 1;

  return buildDecision({
    schemaVersion: TC_ROUTE_SCHEMA_VERSION,
    route,
    confidence: 0.75,
    signals: collectedSignals,
    reasons,
    requiredCapabilities,
    missingContext,
    escalationTriggers,
    estimatedPacketSize: signals.estimatedPacketSize ?? null,
    escalation: {
      afterSameFailure: 2,
      nextTier:         nextIdx < ROUTE_LADDER.length ? ROUTE_LADDER[nextIdx] : null,
      humanAtRisk:      false,
    },
  });
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

/**
 * Renders a route decision as a terse, human-readable explanation.
 *
 * @param {Readonly<object>} decision - route decision from resolveExecution
 * @returns {string}
 */
export function presentRoute(decision) {
  if (!decision || typeof decision !== 'object') return 'route-decision: invalid';

  const lines = [
    `route-decision [${decision.schemaVersion}]`,
    `  route      : ${decision.route}`,
    `  confidence : ${decision.confidence}`,
    `  advisory   : ${decision.advisory}`,
    `  reasons    : ${(decision.reasons ?? []).join('; ')}`,
    `  signals    : ${(decision.signals ?? []).join(', ')}`,
  ];

  if (decision.requiredCapabilities?.length) {
    lines.push(`  capabilities: ${decision.requiredCapabilities.join(', ')}`);
  }
  if (decision.missingContext?.length) {
    lines.push(`  missing-ctx : ${decision.missingContext.join('; ')}`);
  }
  if (decision.escalationTriggers?.length) {
    lines.push(`  esc-triggers: ${decision.escalationTriggers.join(', ')}`);
  }
  if (decision.escalation) {
    const esc = decision.escalation;
    lines.push(`  escalation  : after ${esc.afterSameFailure} same-tier failures → ${esc.nextTier ?? 'none'} (humanAtRisk: ${esc.humanAtRisk})`);
  }
  if (decision.estimatedPacketSize != null) {
    lines.push(`  packet-size : ${decision.estimatedPacketSize}`);
  }
  return lines.join('\n');
}
