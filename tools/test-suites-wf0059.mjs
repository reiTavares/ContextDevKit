/**
 * OP-0004 / WF-0059 (Task ownership & pipeline architecture reform) suite
 * registrations, split out of `test-suites.mjs` so the central registry stays
 * within the line budget (immutable rule 1). Spread into `SUITES` via
 * `...WF0059_SUITES`. Additive; the legacy tier/workflow flows are unaffected.
 *
 * Each wave's owned selftest lives beside its engine module under `templates/`
 * (constitution: every addition ships a test) and is dispatched directly as a
 * `selfcheck`-tier suite. The paths must also appear in `selfcheck-suites.mjs`'s
 * `infra` set (they are not `tools/` entrypoints discovered on disk).
 *
 *  - `wf0059-w1-inventory` — W1 Stage-0 inventory (parity oracle): determinism,
 *    per-card facts, anomaly enumeration, greenfield, byte-stability.
 *  - `wf0059-w2-tasks-schema` — W2 tasks.json schema + validators (the
 *    source-of-truth guardrail): 5-state table, O4/O2 ownership, single-journal
 *    fence, fold==status fence, done/blocked deterministic predicates.
 *
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
const SCRIPTS = 'templates/contextkit/tools/scripts';

export const WF0059_SUITES = Object.freeze([
  {
    id: 'wf0059-w1-inventory',
    file: `${SCRIPTS}/pipeline-inventory.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/pipeline-inventory.mjs`,
      `${SCRIPTS}/pipeline-tasks.mjs`,
      'templates/contextkit/runtime/state/state-io.mjs',
    ],
  },
  {
    id: 'wf0059-w2-tasks-schema',
    file: `${SCRIPTS}/tasks-validate.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-schema.mjs`,
      `${SCRIPTS}/tasks-validate.mjs`,
    ],
  },
]);
