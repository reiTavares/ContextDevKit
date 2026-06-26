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

  // Infra self-test (TEA-008) — guards the shuffle + bounded-concurrency
  // pool (permutation, in-order results, concurrency cap, soft-cancel); fast smoke.
  { id: 'selfcheck-run-pool', file: 'tools/selfcheck-run-pool.mjs', tier: 'smoke',
    touches: ['tools/selfcheck-run-pool.mjs', 'tools/run-suites-pool.mjs', 'tools/run-suites.mjs'] },

  // DOC-007 / WF0016 — per-PR docs enforcement gate (ADR-0075).
  // Static wiring: lint + claims + idempotency + structural completeness.
  { id: 'selfcheck-docs', file: 'tools/selfcheck-docs.mjs', tier: 'selfcheck',
    touches: ['templates/contextkit/tools/scripts/docs-public-lint.mjs', 'templates/contextkit/tools/scripts/readme-claims.mjs', 'templates/contextkit/tools/scripts/docs-reindex.mjs', 'docs/'] },

  // DOC-007 / WF0016 — behavioral integration for the docs gate.
  // Fixture-driven: lint blocks/passes, claims fail/pass, reindex idempotency, validate-doc advisory.
  { id: 'integration-test-docs', file: 'tools/integration-test-docs.mjs', tier: 'integration:core',
    touches: ['templates/contextkit/tools/scripts/docs-public-lint.mjs', 'templates/contextkit/tools/scripts/readme-claims.mjs', 'templates/contextkit/tools/scripts/docs-reindex.mjs', 'docs/'] },

  // MCP-006 suites moved to test-suites-mcp.mjs (MCP_SUITES) after the WF0014
  // suite split; the monolithic selfcheck-mcp-006.mjs / integration-test-mcp-006.mjs
  // were divided into focused sub-suites registered there.
]);
