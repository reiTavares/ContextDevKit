/**
 * BIZ-0001 / WF-0036 + WF-0037 (Business-driven methodology) suite registrations,
 * split out of `test-suites.mjs` so the central registry stays within the line
 * budget (immutable rule 1, ≤308 lines). Spread into `SUITES` via `...BDM_SUITES`.
 * Additive; the legacy tier/workflow flows are unaffected.
 *
 *  - `bdm-static`   — static wiring for the A1 domain layer + A2 classifier modules
 *                     (paths roots, schemas/validators, work CLI, registries, classifier).
 *  - `workflow-bdm` — end-to-end A1: Operation create/render + registry rebuild + ID alloc.
 *  - `classify-bdm` — A2 classifier fixtures + Business matcher + fail-open intake hook.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
const EXEC = 'templates/contextkit/runtime/execution';

export const BDM_SUITES = Object.freeze([
  {
    id: 'bdm-static',
    file: 'tools/selfcheck-bdm.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/runtime/work/', 'templates/contextkit/tools/scripts/work',
      'templates/contextkit/tools/scripts/registry/', 'templates/contextkit/runtime/config/paths.mjs',
      `${EXEC}/work-classifier.mjs`, 'templates/contextkit/policy/work-classification.json',
    ],
  },
  {
    id: 'workflow-bdm',
    file: 'tools/integration-test-workflow-bdm.mjs',
    tier: 'integration:workflow',
    touches: [
      'templates/contextkit/tools/scripts/work', 'templates/contextkit/tools/scripts/registry/',
      'templates/contextkit/runtime/work/',
    ],
  },
  {
    id: 'classify-bdm',
    file: 'tools/integration-test-classify-bdm.mjs',
    tier: 'integration:enforcement',
    touches: [
      `${EXEC}/work-classifier.mjs`, `${EXEC}/work-classify-signals.mjs`,
      `${EXEC}/business-matcher.mjs`, `${EXEC}/intake-proposal-store.mjs`,
      `${EXEC}/intake-methodology.mjs`, 'templates/contextkit/policy/work-classification.json',
    ],
  },
  {
    id: 'decision-bdm',
    file: 'tools/integration-test-decision-bdm.mjs',
    tier: 'integration:workflow',
    touches: [
      'templates/contextkit/runtime/work/decision-enums.mjs',
      'templates/contextkit/runtime/work/schema-decision.mjs',
      'templates/contextkit/runtime/work/front-matter.mjs',
      'templates/contextkit/tools/scripts/registry/decision.mjs',
      'templates/contextkit/tools/scripts/decision-template.mjs',
      'templates/contextkit/memory/decisions/_templates/',
    ],
  },
]);
