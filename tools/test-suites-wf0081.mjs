/**
 * WF-0081 (BIZ-0006, ADR-0148 §1) test suite — classifier integrity &
 * investigation exemption. The co-located selftest lives beside its engine module
 * under `templates/` (like the WF-0059 tasks-* selftests) and is spread into
 * `test-suites.mjs` via `...WF0081_SUITES` so the main registry stays under the
 * 308-line RED ceiling.
 *
 *   - wf0081-no-code-prior : the pre-write intent-aware downgrade + the completion-gate
 *                            SOURCE-only no-code revoke (the F1-F5 fixtures, incl. the
 *                            reproduced meta-bug: a memory-only investigation session
 *                            stays exempt; a real source write revokes the prior).
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module test-suites-wf0081
 */

/**
 * WF-0081 suites, declared with the other selfcheck floors.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0081_SUITES = Object.freeze([
  {
    id: 'wf0081-no-code-prior',
    file: 'templates/contextkit/runtime/execution/no-code-prior.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/runtime/execution/no-code-prior.mjs',
      'templates/contextkit/runtime/hooks/execution-gate.mjs',
      'templates/contextkit/runtime/hooks/completion-gate.mjs',
      'templates/contextkit/runtime/execution/execution-contract.mjs',
    ],
  },
]);
