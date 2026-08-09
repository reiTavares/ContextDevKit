/**
 * WF-0081 (BIZ-0006, ADR-0148 §1) test suite — classifier integrity &
 * investigation exemption. The co-located selftest lives beside its engine module
 * under `templates/` (like the WF-0059 tasks-* selftests) and is spread into
 * `test-suites.mjs` via `...WF0081_SUITES` so the main registry stays under the
 * 308-line RED ceiling.
 *
 *   - wf0081-no-code-prior : the compatibility no-code prior and authoritative
 *                            write-attempt promotion.
 *   - wf0111-interaction-classification : the 4.0 mutation-only fast path,
 *                            linkage consumption, owner nature, and execution shape.
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
  {
    id: 'wf0111-interaction-classification',
    file: 'templates/contextkit/runtime/execution/interaction-classify.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/runtime/execution/interaction-classify.mjs',
      'templates/contextkit/runtime/execution/intent-language.mjs',
      'templates/contextkit/runtime/execution/task-intake.mjs',
      'templates/contextkit/runtime/execution/request-classify.mjs',
      'templates/contextkit/runtime/execution/work-classify-nature.mjs',
      'templates/contextkit/runtime/execution/work-classifier.mjs',
      'templates/contextkit/runtime/execution/no-code-prior.mjs',
    ],
  },
]);
