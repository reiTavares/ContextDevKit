import { performance } from 'node:perf_hooks';
import { createSessionCircuitBreaker } from './circuit-breaker.mjs';
import { createGovernanceSessionStateStore } from './session-state-store.mjs';
import {
  createDedupCache,
  createGateDedupKey,
  createVisibleProblemKey,
} from './dedup-cache.mjs';

export const GOVERNANCE_EVENT_SCHEMA = 'governance-event/1';
export const GOVERNANCE_MOMENTS = Object.freeze([
  'prompt-preflight',
  'write-preflight',
  'postflight',
  'completion',
]);
export const DEFAULT_EVENT_BUDGET_MS = 500;
export const MAX_EVENT_BUDGET_MS = 500;
export const DEFAULT_GATE_TIMEOUT_MS = 100;
export const MAX_GATE_TIMEOUT_MS = 250;

let policyRuntimePromise;

/**
 * Loads the one canonical policy runtime lazily. The lazy boundary lets the
 * anti-loop runtime be tested independently while W01 owns gate policy.
 * A load failure is reported by the caller under the canonical continue policy;
 * no alternate registry or legacy resolver is consulted.
 *
 * @returns {Promise<object>}
 */
function loadPolicyRuntime() {
  policyRuntimePromise ??= import('./gate-mode.mjs');
  return policyRuntimePromise;
}

/** @param {object} input @returns {Promise<object>} */
async function resolveCanonicalGatePlan(input) {
  const policyRuntime = await loadPolicyRuntime();
  return policyRuntime.resolveGatePlan(input);
}

/** @param {object} input @returns {Promise<object>} */
async function evaluateCanonicalObservation(input) {
  const policyRuntime = await loadPolicyRuntime();
  return policyRuntime.evaluateGateObservation(input);
}

/** @param {unknown} requested @param {number} fallback @param {number} maximum @returns {number} */
function boundedMilliseconds(requested, fallback, maximum) {
  const numeric = Number(requested);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, maximum);
}

/**
 * Runs one operation under a cooperative AbortSignal and a hard wall-clock
 * timeout. Late promises are observed and ignored, preventing unhandled
 * rejections after the dispatcher has already continued.
 *
 * @param {(signal:AbortSignal)=>unknown|Promise<unknown>} operation
 * @param {number} timeoutMs
 * @param {object} timers
 * @returns {Promise<{status:'completed', value:unknown}|{status:'failed', error:unknown}|{status:'timed-out'}>}
 */
async function runWithTimeout(operation, timeoutMs, timers) {
  const controller = new AbortController();
  let timerHandle;
  const operationPromise = Promise.resolve()
    .then(() => operation(controller.signal))
    .then((value) => ({ status: 'completed', value }), (error) => ({ status: 'failed', error }));
  const timeoutPromise = new Promise((resolveTimeout) => {
    timerHandle = timers.setTimer(() => {
      controller.abort();
      resolveTimeout({ status: 'timed-out' });
    }, timeoutMs);
  });
  const outcome = await Promise.race([operationPromise, timeoutPromise]);
  timers.clearTimer(timerHandle);
  return outcome;
}

/** @param {unknown} error @returns {string} */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Returns a compact, stable problem identity. Gate evaluators may provide an
 * explicit key; otherwise a reason code is preferred over renderer text.
 *
 * @param {object} gate
 * @param {object} verdict
 * @returns {string}
 */
function equivalentProblemKey(gate, verdict) {
  return String(
    verdict.problemKey
      ?? verdict.reasonCode
      ?? verdict.code
      ?? `${gate.id}:${verdict.message ?? verdict.visibleMessage ?? verdict.decision ?? 'governance-problem'}`,
  );
}

/** @param {object} gate @param {object} verdict @returns {object|null} */
function visibleMessageFor(gate, verdict) {
  if (verdict.decision !== 'warn' && verdict.decision !== 'deny') return null;
  const message = verdict.visibleMessage ?? verdict.message;
  if (typeof message !== 'string' || message.trim() === '') return null;
  return {
    gateId: gate.id,
    problemKey: equivalentProblemKey(gate, verdict),
    level: verdict.decision === 'deny' ? 'error' : 'warning',
    text: message.trim(),
  };
}

/** @param {unknown} candidate @returns {object} */
function normalizeVerdict(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { decision: 'silent', reasonCode: 'INVALID_GATE_VERDICT' };
  }
  const decision = ['allow', 'silent', 'warn', 'deny'].includes(candidate.decision)
    ? candidate.decision
    : 'silent';
  return {
    decision,
    ...(candidate.reasonCode !== undefined ? { reasonCode: String(candidate.reasonCode) } : {}),
    ...(candidate.code !== undefined ? { code: String(candidate.code) } : {}),
    ...(candidate.problemKey !== undefined ? { problemKey: String(candidate.problemKey) } : {}),
    ...(candidate.visibleMessage !== undefined ? { visibleMessage: String(candidate.visibleMessage) } : {}),
    ...(candidate.message !== undefined ? { message: String(candidate.message) } : {}),
  };
}

/** @param {object} payload @returns {boolean} */
function hasTestGateInjection(payload) {
  return Array.isArray(payload.gates) && payload.gates.length > 0
    && payload.gates.every((gate) => gate && typeof gate.id === 'string' && typeof gate.evaluate === 'function');
}

/**
 * Creates an isolated event runtime. Production uses the singleton export below;
 * tests and benchmarks inject policy functions without inventing another runtime
 * authority.
 *
 * @param {object} [options]
 * @param {(input:object)=>object|Promise<object>} [options.resolveGatePlan]
 * @param {(input:object)=>object|Promise<object>} [options.evaluateGateObservation]
 * @param {()=>number} [options.now]
 * @param {(callback:Function,delay:number)=>unknown} [options.setTimer]
 * @param {(handle:unknown)=>void} [options.clearTimer]
 * @param {number} [options.failureThreshold]
 * @param {object|null} [options.stateStore] cross-process mutation-session state
 * @returns {{dispatch:(input:object)=>Promise<object>, clearSession:(sessionId:string)=>void, clear:()=>void}}
 */
export function createGovernanceEventRuntime({
  resolveGatePlan = resolveCanonicalGatePlan,
  evaluateGateObservation = evaluateCanonicalObservation,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  failureThreshold = 3,
  stateStore = null,
} = {}) {
  const evaluationCache = createDedupCache();
  const visibleProblemCache = createDedupCache();
  const circuitBreaker = createSessionCircuitBreaker({ failureThreshold });
  const timers = { setTimer, clearTimer };

  /**
   * Dispatches one normalized host event through the canonical gate plan.
   * Governance infrastructure errors, timeouts, exhausted budgets, duplicates,
   * and open circuits all release the underlying operation.
   *
   * @param {object} input
   * @param {string} input.moment
   * @param {object} input.payload
   * @param {string} input.root
   * @param {object} input.env
   * @returns {Promise<object>}
   */
  async function dispatch({ moment, payload = {}, root, env = process.env } = {}) {
    payload = payload && typeof payload === 'object' ? payload : {};
    env = env && typeof env === 'object' ? env : {};
    const startedAt = now();
    const eventBudgetMs = boundedMilliseconds(payload.budgetMs, DEFAULT_EVENT_BUDGET_MS, MAX_EVENT_BUDGET_MS);
    const gateTimeoutMs = boundedMilliseconds(payload.timeoutMs, DEFAULT_GATE_TIMEOUT_MS, MAX_GATE_TIMEOUT_MS);
    const baseResponse = {
      schemaVersion: GOVERNANCE_EVENT_SCHEMA,
      moment: typeof moment === 'string' ? moment : null,
      allowed: true,
      evaluations: [],
      messages: [],
      diagnostics: [],
    };
    const finish = (status, additions = {}) => {
      const elapsedMs = Math.max(0, now() - startedAt);
      return {
        ...baseResponse,
        ...additions,
        status,
        budget: {
          limitMs: eventBudgetMs,
          elapsedMs,
          remainingMs: Math.max(0, eventBudgetMs - elapsedMs),
          exhausted: elapsedMs >= eventBudgetMs,
        },
      };
    };

    if (env?.CONTEXTKIT_INTERNAL === '1') {
      return finish('internal', {
        diagnostics: [{ code: 'INTERNAL_REENTRY_SKIPPED', message: 'Internal governance execution cannot enqueue governance again.' }],
      });
    }

    const sessionId = payload.sessionId;
    const workItemId = payload.workItemId;
    const revision = payload.revision;
    if (!GOVERNANCE_MOMENTS.includes(moment) || typeof root !== 'string' || root.trim() === '' || !sessionId || !workItemId
      || revision === null || revision === undefined || String(revision).trim() === '') {
      return finish('invalid-context', {
        diagnostics: [{
          code: 'INVALID_EVENT_CONTEXT',
          message: 'Governance event requires a canonical moment, root, sessionId, workItemId, and revision.',
        }],
      });
    }

    const mutationStateEnabled = Boolean(stateStore) && (
      (['write-preflight', 'postflight'].includes(moment) && payload.mutationAttempt === true)
      || (moment === 'completion' && (payload.mutationAttempt === true || stateStore.hasSession(sessionId)))
    );
    if (moment === 'completion' && stateStore && !mutationStateEnabled) {
      return finish('not-applicable', {
        diagnostics: [],
      });
    }

    const persistentDiagnostics = [];
    const recordFailure = () => {
      circuitBreaker.recordFailure(sessionId);
      if (!mutationStateEnabled) return;
      const recorded = stateStore.recordCircuitFailure(sessionId, failureThreshold);
      if (recorded.status !== 'ok') {
        persistentDiagnostics.push({ code: 'SESSION_STATE_UNAVAILABLE', message: recorded.reason ?? recorded.status });
      }
    };
    const recordSuccess = () => {
      circuitBreaker.recordSuccess(sessionId);
      if (!mutationStateEnabled) return;
      const recorded = stateStore.recordCircuitSuccess(sessionId);
      if (recorded.status !== 'ok') {
        persistentDiagnostics.push({ code: 'SESSION_STATE_UNAVAILABLE', message: recorded.reason ?? recorded.status });
      }
    };

    if (mutationStateEnabled) {
      const persistentCircuit = stateStore.circuitSnapshot(sessionId);
      if (persistentCircuit.status !== 'ok') {
        return finish('state-unavailable', {
          diagnostics: [{ code: 'SESSION_STATE_UNAVAILABLE', message: persistentCircuit.reason ?? persistentCircuit.status }],
        });
      }
      if (persistentCircuit.open) {
        return finish('circuit-open', {
          diagnostics: [{ code: 'SESSION_CIRCUIT_OPEN', message: 'Governance evaluation bypassed after repeated cross-process session failures.' }],
        });
      }
    }

    if (!circuitBreaker.canEvaluate(sessionId)) {
      return finish('circuit-open', {
        diagnostics: [{ code: 'SESSION_CIRCUIT_OPEN', message: 'Governance evaluation bypassed after repeated session failures.' }],
      });
    }

    const remainingBeforePlan = Math.max(0, eventBudgetMs - (now() - startedAt));
    if (remainingBeforePlan === 0) return finish('budget-exhausted');

    let gatePlan;
    const testInjection = hasTestGateInjection(payload);
    if (testInjection) {
      gatePlan = { gates: payload.gates, failurePolicy: 'continue', warnings: [] };
    } else {
      const planOutcome = await runWithTimeout(
        (signal) => resolveGatePlan({ moment, payload, root, env, signal }),
        Math.min(gateTimeoutMs, remainingBeforePlan),
        timers,
      );
      if (planOutcome.status !== 'completed') {
        recordFailure();
        const code = planOutcome.status === 'timed-out' ? 'GATE_PLAN_TIMEOUT' : 'GATE_PLAN_FAILURE';
        return finish('completed', {
          diagnostics: [
            ...persistentDiagnostics,
            { code, message: planOutcome.status === 'failed' ? errorMessage(planOutcome.error) : 'Canonical gate plan timed out.' },
          ],
        });
      }
      gatePlan = planOutcome.value;
    }

    const gates = Array.isArray(gatePlan?.gates) ? gatePlan.gates : [];
    const evaluations = [];
    const messages = [];
    const diagnostics = [
      ...persistentDiagnostics,
      ...(Array.isArray(gatePlan?.warnings)
        ? gatePlan.warnings.map((warning) => ({ code: 'GATE_PLAN_WARNING', message: String(warning) }))
        : []),
    ];
    let allowed = true;
    let stoppedStatus = null;

    for (const gate of gates) {
      if (!gate || typeof gate.id !== 'string' || gate.id.trim() === '') {
        diagnostics.push({ code: 'INVALID_GATE', message: 'Gate plan contained an entry without an id.' });
        continue;
      }
      if (!circuitBreaker.canEvaluate(sessionId)) {
        stoppedStatus = 'circuit-open';
        diagnostics.push({ code: 'SESSION_CIRCUIT_OPEN', gateId: gate.id, message: 'Remaining gates bypassed after repeated session failures.' });
        break;
      }

      const dedupKey = createGateDedupKey({ sessionId, workItemId, revision, gateId: gate.id, moment });
      let evaluationClaimed;
      if (mutationStateEnabled) {
        const persistentClaim = stateStore.claimEvaluation(sessionId, dedupKey);
        if (persistentClaim.status !== 'ok') {
          stoppedStatus = 'state-unavailable';
          evaluations.push({ gateId: gate.id, status: 'state-unavailable', durationMs: 0 });
          diagnostics.push({ code: 'SESSION_STATE_UNAVAILABLE', gateId: gate.id, message: persistentClaim.reason ?? persistentClaim.status });
          break;
        }
        evaluationClaimed = persistentClaim.claimed;
        if (evaluationClaimed) evaluationCache.claim(dedupKey);
      } else {
        evaluationClaimed = evaluationCache.claim(dedupKey);
      }
      if (!evaluationClaimed) {
        evaluations.push({ gateId: gate.id, status: 'deduplicated', durationMs: 0 });
        continue;
      }

      const remainingBudgetMs = Math.max(0, eventBudgetMs - (now() - startedAt));
      if (remainingBudgetMs === 0) {
        stoppedStatus = 'budget-exhausted';
        evaluations.push({ gateId: gate.id, status: 'budget-exhausted', durationMs: 0 });
        break;
      }

      const gateStartedAt = now();
      const observation = payload.observations?.[gate.evaluatorId ?? gate.id]
        ?? { status: 'unknown', deterministic: false, applicable: false, evidenced: false };
      const contextualObservation = {
        ...observation,
        currentRevision: observation.currentRevision ?? revision,
        currentScope: observation.currentScope ?? { workItemId },
      };
      const internalEnv = { ...env, CONTEXTKIT_INTERNAL: '1' };
      const evaluationOutcome = await runWithTimeout(
        (signal) => testInjection
          ? gate.evaluate({ moment, root, payload, env: internalEnv }, { signal })
          : evaluateGateObservation({ gate, moment, observation: contextualObservation, signal }),
        Math.min(gateTimeoutMs, remainingBudgetMs),
        timers,
      );
      const durationMs = Math.max(0, now() - gateStartedAt);

      if (evaluationOutcome.status === 'timed-out') {
        recordFailure();
        evaluations.push({ gateId: gate.id, status: 'timed-out', durationMs });
        diagnostics.push({ code: 'GATE_TIMEOUT', gateId: gate.id, message: `Gate exceeded its ${Math.min(gateTimeoutMs, remainingBudgetMs)} ms timeout.` });
        continue;
      }
      if (evaluationOutcome.status === 'failed') {
        recordFailure();
        evaluations.push({ gateId: gate.id, status: 'failed', durationMs });
        diagnostics.push({ code: 'GATE_FAILURE', gateId: gate.id, message: errorMessage(evaluationOutcome.error) });
        continue;
      }

      let verdict;
      try {
        verdict = normalizeVerdict(evaluationOutcome.value);
      } catch (error) {
        recordFailure();
        evaluations.push({ gateId: gate.id, status: 'failed', durationMs });
        diagnostics.push({ code: 'MESSAGE_RENDER_FAILURE', gateId: gate.id, message: errorMessage(error) });
        continue;
      }
      if (observation.status === 'error') recordFailure();
      else recordSuccess();
      if (verdict.decision === 'deny') allowed = false;
      evaluations.push({ gateId: gate.id, status: 'evaluated', durationMs, verdict });

      const visibleMessage = visibleMessageFor(gate, verdict);
      if (visibleMessage) {
        const problemDedupKey = createVisibleProblemKey({ sessionId, problemKey: visibleMessage.problemKey });
        let visibleProblemClaimed;
        if (mutationStateEnabled) {
          const persistentClaim = stateStore.claimVisibleProblem(sessionId, problemDedupKey);
          visibleProblemClaimed = persistentClaim.status === 'ok' && persistentClaim.claimed;
          if (persistentClaim.status !== 'ok') {
            diagnostics.push({ code: 'SESSION_STATE_UNAVAILABLE', gateId: gate.id, message: persistentClaim.reason ?? persistentClaim.status });
          }
          if (visibleProblemClaimed) visibleProblemCache.claim(problemDedupKey);
        } else {
          visibleProblemClaimed = visibleProblemCache.claim(problemDedupKey);
        }
        if (visibleProblemClaimed) messages.push(visibleMessage);
      }
    }

    const allDeduplicated = evaluations.length > 0
      && evaluations.every((evaluation) => evaluation.status === 'deduplicated');
    if (!stoppedStatus && now() - startedAt >= eventBudgetMs) {
      stoppedStatus = 'budget-exhausted';
      diagnostics.push({ code: 'EVENT_BUDGET_EXHAUSTED', message: `Governance exceeded its ${eventBudgetMs} ms aggregate budget.` });
    }
    return finish(stoppedStatus ?? (allDeduplicated ? 'deduplicated' : 'completed'), {
      allowed,
      evaluations,
      messages,
      diagnostics,
      policy: {
        version: gatePlan?.policyVersion ?? null,
        hash: gatePlan?.policyHash ?? null,
        failurePolicy: gatePlan?.failurePolicy ?? 'continue',
      },
    });
  }

  return Object.freeze({
    dispatch,
    clearSession(sessionId) {
      const belongsToSession = (key) => {
        try { return JSON.parse(key)[0] === String(sessionId); } catch { return false; }
      };
      evaluationCache.deleteWhere(belongsToSession);
      visibleProblemCache.deleteWhere(belongsToSession);
      circuitBreaker.clearSession(sessionId);
      stateStore?.clearSession?.(sessionId);
    },
    clear() {
      evaluationCache.clear();
      visibleProblemCache.clear();
      circuitBreaker.clear();
    },
  });
}

const defaultRuntime = createGovernanceEventRuntime({
  stateStore: createGovernanceSessionStateStore(),
});

/**
 * Canonical W03/W04 seam: one call per host event, one structured verdict.
 *
 * @param {{moment:string,payload:object,root:string,env:object}} input
 * @returns {Promise<object>}
 */
export function dispatchGovernanceEvent(input) {
  return defaultRuntime.dispatch(input);
}
