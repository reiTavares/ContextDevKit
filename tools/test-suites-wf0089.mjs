/**
 * WF-0089 (BIZ-0006, ADR-0148 §9/§10) test suite — structural auto-fill by
 * projection. The co-located selftests live beside their engine modules under
 * `templates/` (like the WF-0059 tasks-* selftests and WF-0081's
 * no-code-prior) and are spread into `test-suites.mjs` via `...WF0089_SUITES`
 * so the main registry stays under the 308-line RED ceiling.
 *
 *   - wf0089-projections : deriveScope/deriveRisk trace to real BIZ-0004 graph
 *                          queries (fwd-reach/rev-consumers) on a fixture;
 *                          deriveTasks/deriveClassification reuse BIZ-0003's
 *                          tasks-derive and work-classifier verbatim;
 *                          deriveKpiSkeleton ships baseline:null (constitution
 *                          §8); every export is idempotent and fail-open.
 *   - wf0089-provenance  : SA2 field-provenance sidecar + idempotent re-derive
 *                          engine — every filled field is tagged; unchanged
 *                          input is a no-op; an out-of-band edit promotes to
 *                          authored (one-way); the single-authority invariant
 *                          is validator-enforced; an unclaimed field defaults
 *                          to authored; a legitimate graph change re-derives
 *                          without a false promote.
 *   - wf0089-verify      : SA3-T1 verification — scope/risk asserted against
 *                          an INDEPENDENTLY recomputed graph traversal (proves
 *                          the value came FROM the graph query, not a
 *                          hand-picked expectation); an EXPLICITLY authored
 *                          field (not merely unclaimed) is preserved
 *                          byte-for-byte; and the honest zero-token-on-
 *                          structure receipt (static import-graph scan +
 *                          determinism proof, ledger read advisory-only).
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module test-suites-wf0089
 */

/**
 * WF-0089 suites, declared with the other selfcheck floors.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0089_SUITES = Object.freeze([
  {
    id: 'wf0089-projections',
    file: 'templates/contextkit/methodology/projections.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/methodology/projections.mjs',
      'templates/contextkit/tools/scripts/graph-query.mjs',
      'templates/contextkit/tools/scripts/tasks-derive.mjs',
      'templates/contextkit/runtime/execution/work-classifier.mjs',
    ],
  },
  {
    id: 'wf0089-provenance',
    file: 'templates/contextkit/methodology/provenance.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/methodology/provenance.mjs',
      'templates/contextkit/methodology/schema-provenance-sidecar.mjs',
      'templates/contextkit/methodology/projections.mjs',
      'templates/contextkit/tools/scripts/workflow/create.mjs',
    ],
  },
  {
    id: 'wf0089-verify',
    file: 'templates/contextkit/methodology/projections-verify.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/methodology/projections.mjs',
      'templates/contextkit/methodology/provenance.mjs',
      'templates/contextkit/tools/scripts/graph-query.mjs',
      'templates/contextkit/runtime/config/paths.mjs',
    ],
  },
]);
