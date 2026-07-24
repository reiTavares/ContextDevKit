/**
 * WF-0088 (BIZ-0006, ADR-0148 position 11) test suite — the governance-contract
 * envelope: schema + validator + emit hook, the stable BIZ-0002 seam. The
 * co-located selftest lives beside its schema module under `templates/` (like the
 * WF-0081 no-code-prior selftest) and is spread into `test-suites.mjs` via
 * `...WF0088_SUITES` so the main registry stays under the 308-line RED ceiling.
 *
 *   - wf0088-governance-contract : validator round-trip + malformed rejection
 *     (drift bugs + live-state leak), override co-occurrence invariant, uncovered
 *     governing decision, emit validate-before-write/diff-aware/self-heal/fail-open,
 *     refresh status-move, and the SCOPE GUARD (0 runtime/dispatcher/adapter code —
 *     the BIZ-0002 seam stays schema-only).
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module test-suites-wf0088
 */

/**
 * WF-0088 suites, declared with the other selfcheck floors.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0088_SUITES = Object.freeze([
  {
    id: 'wf0088-governance-contract',
    file: 'templates/contextkit/runtime/work/schema-governance-contract.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/runtime/work/schema-governance-contract.mjs',
      'templates/contextkit/tools/scripts/emit-governance-contract.mjs',
      'templates/contextkit/tools/scripts/emit-business-contract.mjs',
      'templates/contextkit/tools/scripts/read-governance-contract.mjs',
      'templates/contextkit/tools/scripts/backfill-governance-contracts.mjs',
      'templates/contextkit/runtime/hooks/execution-contract-advisory.mjs',
      'templates/contextkit/methodology/resolve-ceremony-shape.mjs',
    ],
  },
]);
