const DEFAULT_FAILURE_THRESHOLD = 3;

/**
 * Creates a fail-open session circuit breaker. Once a session reaches the
 * consecutive-failure threshold, governance evaluation is bypassed for that session so a broken
 * auxiliary gate cannot deny or recursively delay real work.
 *
 * @param {object} [options]
 * @param {number} [options.failureThreshold=3]
 * @returns {{canEvaluate:(sessionId:string)=>boolean, recordFailure:(sessionId:string)=>object, recordSuccess:(sessionId:string)=>object, snapshot:(sessionId:string)=>object, clearSession:(sessionId:string)=>void, clear:()=>void}}
 * @throws {RangeError} when failureThreshold is not a positive integer
 */
export function createSessionCircuitBreaker({ failureThreshold = DEFAULT_FAILURE_THRESHOLD } = {}) {
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new RangeError('failureThreshold must be a positive integer.');
  }

  const sessions = new Map();
  const stateFor = (sessionId) => sessions.get(String(sessionId)) ?? { failures: 0, open: false };

  return Object.freeze({
    canEvaluate(sessionId) {
      return !stateFor(sessionId).open;
    },
    recordFailure(sessionId) {
      const current = stateFor(sessionId);
      const failures = current.failures + 1;
      const next = Object.freeze({ failures, open: failures >= failureThreshold });
      sessions.set(String(sessionId), next);
      return next;
    },
    recordSuccess(sessionId) {
      const current = stateFor(sessionId);
      const next = Object.freeze({ failures: current.open ? current.failures : 0, open: current.open });
      sessions.set(String(sessionId), next);
      return next;
    },
    snapshot(sessionId) {
      const current = stateFor(sessionId);
      return Object.freeze({ failures: current.failures, open: current.open, failureThreshold });
    },
    clearSession(sessionId) {
      sessions.delete(String(sessionId));
    },
    clear() {
      sessions.clear();
    },
  });
}

export { DEFAULT_FAILURE_THRESHOLD };
