/**
 * Test-infrastructure self-test suites (WF0025 / ADR-0113).
 *
 * Cohesion note: these three suites guard the test machinery itself (the suite
 * list, the impact selector, and the request-orchestration shard). They live in
 * their own module — spread into `test-suites.mjs` via `...INFRA_SUITES` — so the
 * main registry stays under the 308-line RED ceiling (same pattern as
 * `BDM_SUITES` / `WORKFLOW_ENGINE_SUITES`). All are fast `smoke` suites.
 *
 * Zero runtime dependencies — node:* only (no imports needed).
 *
 * @module test-suites-infra
 */

/**
 * Infra self-test suites, declared last in execution order.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const INFRA_SUITES = Object.freeze([
  // Request-orchestration shard (WF0025) — runs the W1–W7 block standalone so a
  // `runtime/execution/*` edit selects it (seconds) instead of the selfcheck
  // monolith. The monolith STILL runs the same block inline (full floor).
  { id: 'selfcheck-request', file: 'tools/selfcheck-request.mjs', tier: 'smoke',
    touches: ['tools/selfcheck-request', 'templates/contextkit/runtime/execution/'] },

  // Infra self-test (TEA-002) — guards the list itself; also a fast smoke suite.
  { id: 'selfcheck-suites', file: 'tools/selfcheck-suites.mjs', tier: 'smoke',
    touches: ['tools/test-suites.mjs', 'tools/run-suites.mjs', 'tools/selfcheck-suites.mjs'] },

  // Infra self-test (TEA-004) — guards the impact selector; also a fast smoke suite.
  { id: 'selfcheck-impact', file: 'tools/selfcheck-impact.mjs', tier: 'smoke',
    touches: ['tools/test-impact.mjs', 'tools/test-suites.mjs', 'tools/selfcheck-impact.mjs'] },

  // Infra self-test (TEA-006 / task 301) — guards the telemetry summary +
  // selection metric round-trip; also a fast smoke suite.
  { id: 'selfcheck-telemetry', file: 'tools/selfcheck-telemetry.mjs', tier: 'smoke',
    touches: ['tools/selfcheck-telemetry.mjs', 'tools/test-telemetry.mjs', 'tools/test-telemetry-stats.mjs', 'tools/run-suites.mjs'] },
]);
