/**
 * WF-0094 (BIZ-0006, ADR-0152) test suite — reference-intent resolution &
 * existing-context continuation gate. The co-located selftest lives beside its
 * engine module under `templates/` (like the WF-0081 / WF-0059 selftests) and is
 * spread into `test-suites.mjs` via `...WF0094_SUITES` so the main registry stays
 * under the 308-line RED ceiling.
 *
 *   - wf0094-reference-intent : the citation scan (explicit id + fuzzy title/slug,
 *                               refuse-to-null, fail-open) + the four-intent
 *                               resolver (new-context / work-within /
 *                               new-child-in-context / new-workflow-in-owner) + ask,
 *                               incl. the reproduced meta-bug (a continuation prompt
 *                               citing an existing WF/BIZ resolves to work-within /
 *                               new-workflow-in-owner, never a silent new operation).
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module test-suites-wf0094
 */

/**
 * WF-0094 suites, declared with the other selfcheck floors.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
export const WF0094_SUITES = Object.freeze([
  {
    id: 'wf0094-reference-intent',
    file: 'templates/contextkit/runtime/execution/reference-intent.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/runtime/execution/reference-intent.mjs',
      'templates/contextkit/runtime/execution/intake-methodology.mjs',
    ],
  },
]);
