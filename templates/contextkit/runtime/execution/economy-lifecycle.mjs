/**
 * Stable economy lever lifecycle + execution acknowledgement (AEP W2 / #348).
 *
 * Recommendation is policy evidence; application is execution evidence. This
 * pure module is the seam between both. Without a valid correlated acknowledgement
 * it always reports `applied:false`.
 *
 * Deterministic, zero-dependency and fail-open for hook hot paths.
 */

export const ECONOMY_EVENT_SCHEMA = 'cdk-economy-event/1';
export const ECONOMY_ACK_SCHEMA = 'cdk-economy-ack/1';

export const ECONOMY_LIFECYCLE_STAGES = Object.freeze([
  'evaluated', 'eligible', 'recommended', 'directed',
  'attempted', 'applied', 'skipped', 'failed',
]);

export const ECONOMY_REASON_CODES = Object.freeze({
  SHADOW_MODE: 'shadow_mode',
  POLICY_NOT_SELECTED: 'policy_not_selected',
  HOST_UNSUPPORTED: 'host_does_not_support_in_session_model_switch',
  EXECUTION_ACK_MISSING: 'execution_ack_missing',
  EXECUTION_ACK_INVALID: 'execution_ack_invalid',
  EXECUTION_NOT_ATTEMPTED: 'execution_not_attempted',
  EXECUTION_ATTEMPTED: 'execution_attempted',
  EXECUTION_APPLIED: 'execution_applied',
  EXECUTION_FAILED: 'execution_failed',
  EXECUTOR_MISMATCH: 'executor_mismatch',
  FABLE_AUTO_BLOCKED: 'fable_auto_blocked',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const uniqueStrings = (values) => Object.freeze([
  ...new Set((Array.isArray(values) ? values : []).filter(nonEmpty).map((value) => value.trim())),
]);

function policyWouldApply(decision) {
  if (typeof decision?.policyWouldApply === 'boolean') return decision.policyWouldApply;
  // routing-decision/1 used `applied` for policy intent. It remains readable as
  // intent, but is never accepted as observed application without an ack.
  return decision?.applied === true;
}

function expectedExecutor(decision) {
  return decision?.selectedTier ?? decision?.recommendedTier ?? decision?.executor ?? null;
}

function lifecycleStatus(state) {
  if (state.failed) return 'failed';
  if (state.applied) return 'applied';
  if (state.attempted) return 'attempted';
  if (state.skipped) return 'skipped';
  if (state.directed) return 'directed';
  if (state.recommended) return 'recommended';
  if (state.eligible) return 'eligible';
  return 'evaluated';
}

/**
 * Create a normalized acknowledgement. Time, ids and evidence are caller-supplied.
 *
 * @param {object} input
 * @returns {Readonly<object>} `cdk-economy-ack/1`
 */
export function createExecutionAck(input = {}) {
  const value = isObject(input) ? input : {};
  const applied = value.applied === true;
  const attempted = value.attempted === true || applied;
  const exitCode = Number.isInteger(value.exitCode) ? value.exitCode : null;
  const failed = value.failed === true || (attempted && exitCode !== null && exitCode !== 0);
  const ack = {
    schemaVersion: ECONOMY_ACK_SCHEMA,
    ackId: nonEmpty(value.ackId) ? value.ackId.trim() : null,
    at: nonEmpty(value.at) ? value.at.trim() : null,
    requestId: nonEmpty(value.requestId) ? value.requestId.trim() : null,
    sessionId: nonEmpty(value.sessionId) ? value.sessionId.trim() : null,
    taskId: nonEmpty(value.taskId) ? value.taskId.trim() : null,
    decisionId: nonEmpty(value.decisionId) ? value.decisionId.trim() : null,
    attempted,
    applied,
    failed,
    executor: nonEmpty(value.executor) ? value.executor.trim() : null,
    exitCode,
    qualityEquivalent: typeof value.qualityEquivalent === 'boolean' ? value.qualityEquivalent : null,
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    reasonCodes: uniqueStrings(value.reasonCodes),
  };
  return Object.freeze({ ...ack, status: lifecycleStatus({ ...ack, skipped: !attempted }) });
}

/**
 * Validate an acknowledgement alone or against its routing decision.
 *
 * @param {object} ack
 * @param {object|null} [decision]
 * @returns {Readonly<{valid:boolean,errors:Readonly<string[]>}>}
 */
export function validateExecutionAck(ack, decision = null) {
  const errors = [];
  if (!isObject(ack)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['ack_not_object']) });
  }
  if (ack.schemaVersion !== ECONOMY_ACK_SCHEMA) errors.push('ack_schema_invalid');
  if (!nonEmpty(ack.decisionId)) errors.push('decision_id_missing');
  if (typeof ack.attempted !== 'boolean') errors.push('attempted_not_boolean');
  if (typeof ack.applied !== 'boolean') errors.push('applied_not_boolean');
  if (typeof ack.failed !== 'boolean') errors.push('failed_not_boolean');
  if (ack.applied === true && ack.attempted !== true) errors.push('applied_without_attempt');
  if (ack.attempted === true && !nonEmpty(ack.executor)) errors.push('executor_missing');
  if (ack.attempted === true && !Number.isInteger(ack.exitCode)) errors.push('exit_code_missing');
  if (ack.attempted === true && (!Array.isArray(ack.evidenceRefs) || ack.evidenceRefs.length === 0)) {
    errors.push('evidence_refs_missing');
  }
  if (ack.qualityEquivalent !== null && typeof ack.qualityEquivalent !== 'boolean') {
    errors.push('quality_equivalent_invalid');
  }

  if (isObject(decision)) {
    if (nonEmpty(decision.decisionId) && ack.decisionId !== decision.decisionId) {
      errors.push('decision_id_mismatch');
    }
    if (nonEmpty(decision.requestId) && nonEmpty(ack.requestId) && ack.requestId !== decision.requestId) {
      errors.push('request_id_mismatch');
    }
    if (nonEmpty(decision.sessionId) && nonEmpty(ack.sessionId) && ack.sessionId !== decision.sessionId) {
      errors.push('session_id_mismatch');
    }
    if (nonEmpty(decision.taskId) && nonEmpty(ack.taskId) && ack.taskId !== decision.taskId) {
      errors.push('task_id_mismatch');
    }
    const mode = decision.mode ?? 'shadow';
    const expected = expectedExecutor(decision);
    if (ack.applied === true && mode === 'shadow') errors.push('shadow_cannot_apply');
    if (ack.applied === true && !policyWouldApply(decision)) errors.push('policy_did_not_select');
    if (ack.applied === true && nonEmpty(expected) && ack.executor !== expected) {
      errors.push(ECONOMY_REASON_CODES.EXECUTOR_MISMATCH);
    }
    if (ack.applied === true && /fable/i.test(String(ack.executor)) && mode !== 'manual') {
      errors.push(ECONOMY_REASON_CODES.FABLE_AUTO_BLOCKED);
    }
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Reconcile policy with execution truth. This is the only function that may
 * produce `applied:true`, after validating a correlated acknowledgement.
 *
 * @param {object} decision
 * @param {object|null} ack
 * @returns {Readonly<object>}
 */
export function reconcileDecisionExecution(decision = {}, ack = null) {
  const value = isObject(decision) ? decision : {};
  const mode = value.mode ?? 'shadow';
  const wouldApply = policyWouldApply(value);
  const evaluated = value.evaluated !== false;
  const eligible = value.eligible === true;
  const recommended = value.recommended !== false && nonEmpty(expectedExecutor(value));
  const baseReasons = [
    ...(Array.isArray(value.reasonCodes) ? value.reasonCodes : []),
    ...(nonEmpty(value.reason) ? [value.reason] : []),
  ];

  if (!isObject(ack)) {
    const reason = mode === 'shadow'
      ? ECONOMY_REASON_CODES.SHADOW_MODE
      : wouldApply
        ? ECONOMY_REASON_CODES.EXECUTION_ACK_MISSING
        : ECONOMY_REASON_CODES.POLICY_NOT_SELECTED;
    const state = {
      evaluated, eligible, recommended,
      directed: value.directed === true,
      attempted: false, applied: false, skipped: true, failed: false,
    };
    return Object.freeze({
      ...value,
      ...state,
      status: lifecycleStatus(state),
      policyWouldApply: wouldApply,
      reasonCodes: uniqueStrings([...baseReasons, reason]),
      executionAck: null,
      ackValid: false,
    });
  }

  const validation = validateExecutionAck(ack, { ...value, policyWouldApply: wouldApply });
  if (!validation.valid) {
    const state = {
      evaluated, eligible, recommended,
      directed: value.directed === true,
      attempted: false, applied: false, skipped: true, failed: true,
    };
    return Object.freeze({
      ...value,
      ...state,
      status: lifecycleStatus(state),
      policyWouldApply: wouldApply,
      reasonCodes: uniqueStrings([
        ...baseReasons, ECONOMY_REASON_CODES.EXECUTION_ACK_INVALID, ...validation.errors,
      ]),
      executionAck: ack,
      ackValid: false,
    });
  }

  const attempted = ack.attempted === true;
  const applied = ack.applied === true;
  const failed = ack.failed === true || (attempted && ack.exitCode !== 0);
  const skipped = !attempted;
  const state = {
    evaluated, eligible, recommended,
    directed: value.directed === true || attempted,
    attempted, applied, skipped, failed,
  };
  const terminalReason = failed
    ? ECONOMY_REASON_CODES.EXECUTION_FAILED
    : applied
      ? ECONOMY_REASON_CODES.EXECUTION_APPLIED
      : attempted
        ? ECONOMY_REASON_CODES.EXECUTION_ATTEMPTED
        : ECONOMY_REASON_CODES.EXECUTION_NOT_ATTEMPTED;
  return Object.freeze({
    ...value,
    ...state,
    status: lifecycleStatus(state),
    policyWouldApply: wouldApply,
    reasonCodes: uniqueStrings([...baseReasons, ...ack.reasonCodes, terminalReason]),
    executionAck: ack,
    ackValid: true,
  });
}

/**
 * Build the stable cross-lever lifecycle event consumed by economy telemetry.
 *
 * @param {object} input decision fields + correlation + optional executionAck
 * @returns {Readonly<object>} `cdk-economy-event/1`
 */
export function createEconomyEvent(input = {}) {
  const value = isObject(input) ? input : {};
  const reconciled = reconcileDecisionExecution(value, value.executionAck ?? null);
  return Object.freeze({
    schemaVersion: ECONOMY_EVENT_SCHEMA,
    eventId: nonEmpty(value.eventId) ? value.eventId.trim() : null,
    at: nonEmpty(value.at) ? value.at.trim() : null,
    capturedAt: nonEmpty(value.at) ? value.at.trim() : null,
    lever: nonEmpty(value.lever) ? value.lever.trim() : 'unknown',
    mode: value.mode ?? 'shadow',
    requestId: nonEmpty(value.requestId) ? value.requestId.trim() : null,
    sessionId: nonEmpty(value.sessionId) ? value.sessionId.trim() : null,
    taskId: nonEmpty(value.taskId) ? value.taskId.trim() : null,
    decisionId: nonEmpty(value.decisionId) ? value.decisionId.trim() : null,
    lifecycle: reconciled.status,
    status: reconciled.status,
    evaluated: reconciled.evaluated,
    eligible: reconciled.eligible,
    recommended: reconciled.recommended,
    directed: reconciled.directed,
    attempted: reconciled.attempted,
    applied: reconciled.applied,
    skipped: reconciled.skipped,
    failed: reconciled.failed,
    policyWouldApply: reconciled.policyWouldApply,
    reason: reconciled.reasonCodes[0] ?? null,
    reasons: reconciled.reasonCodes,
    reasonCodes: reconciled.reasonCodes,
    executor: expectedExecutor(value),
    estimated: isObject(value.estimate) ? Object.freeze({ ...value.estimate }) : null,
    observed: isObject(value.observed) ? Object.freeze({ ...value.observed }) : null,
    executionAck: reconciled.executionAck,
  });
}
