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
 *  - `wf0059-w3-transition` — W3 transition engine: legal table + actor rules +
 *    atomic status↔event pairing (journal-first) + crash-injection recovery.
 *  - `wf0059-w6-compat` — W6 compatibility adapters: old workflow:-string / old-id
 *    → owner FK; ambiguous (dup 001) refuses; deprecation notice.
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
  {
    id: 'wf0059-w3-transition',
    file: `${SCRIPTS}/tasks-transition.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-transition.mjs`,
      `${SCRIPTS}/tasks-schema.mjs`,
    ],
  },
  {
    id: 'wf0059-w4-derive',
    file: `${SCRIPTS}/tasks-derive.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-derive.mjs`,
      `${SCRIPTS}/tasks-schema.mjs`,
    ],
  },
  {
    id: 'wf0059-w5-cas',
    file: `${SCRIPTS}/tasks-cas.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-cas.mjs`,
      'templates/contextkit/runtime/hooks/safe-io.mjs',
    ],
  },
  {
    id: 'wf0059-w6-compat',
    file: `${SCRIPTS}/tasks-compat.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-compat.mjs`,
      `${SCRIPTS}/tasks-schema.mjs`,
    ],
  },
  {
    id: 'wf0059-w7-migrate',
    file: `${SCRIPTS}/tasks-migrate.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-migrate.mjs`,
      `${SCRIPTS}/pipeline-inventory.mjs`,
    ],
  },
  {
    id: 'wf0059-w8-cutover',
    file: `${SCRIPTS}/tasks-cutover.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-cutover.mjs`,
      `${SCRIPTS}/tasks-derive.mjs`,
      `${SCRIPTS}/pipeline-inventory.mjs`,
    ],
  },
  {
    id: 'wf0059-w9-e2e',
    file: 'tools/integration-test-wf0059-e2e.mjs',
    tier: 'integration:workflow',
    touches: [
      `${SCRIPTS}/pipeline-inventory.mjs`, `${SCRIPTS}/tasks-schema.mjs`,
      `${SCRIPTS}/tasks-validate.mjs`, `${SCRIPTS}/tasks-transition.mjs`,
      `${SCRIPTS}/tasks-derive.mjs`, `${SCRIPTS}/tasks-cas.mjs`,
      `${SCRIPTS}/tasks-compat.mjs`, `${SCRIPTS}/tasks-migrate.mjs`,
      `${SCRIPTS}/tasks-cutover.mjs`,
    ],
  },
]);
