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
  {
    id: 'a3-bdm',
    file: 'tools/integration-test-a3-bdm.mjs',
    tier: 'integration:enforcement',
    touches: [
      'templates/contextkit/tools/scripts/business-growth-validator.mjs',
      'templates/contextkit/tools/scripts/business-render.mjs',
      'templates/contextkit/tools/scripts/business-templates.mjs',
      'templates/contextkit/tools/scripts/business-template-strings.mjs',
      'templates/contextkit/tools/scripts/work-business-lifecycle.mjs',
      'templates/contextkit/tools/scripts/work-business-gate.mjs',
      'templates/contextkit/tools/scripts/work-business-dispatch.mjs',
      'templates/contextkit/tools/scripts/work-decision-hash.mjs',
    ],
  },
  {
    id: 'b2-bdm',
    file: 'tools/integration-test-b2-bdm.mjs',
    tier: 'integration:enforcement',
    touches: [
      `${EXEC}/decision-need-classifier.mjs`, `${EXEC}/materiality-score.mjs`,
      `${EXEC}/decision-triple.mjs`, `${EXEC}/task-intake.mjs`,
      'templates/contextkit/policy/decision-intelligence.json',
      'templates/contextkit/tools/scripts/decision-search-match.mjs',
      'templates/contextkit/tools/scripts/decision-search-score.mjs',
      'templates/contextkit/tools/scripts/registry/decision.mjs',
    ],
  },
  {
    id: 'a4-bdm',
    file: 'tools/integration-test-a4-bdm.mjs',
    tier: 'integration:workflow',
    touches: [
      'templates/contextkit/tools/scripts/registry/workflow.mjs',
      'templates/contextkit/tools/scripts/registry/ids.mjs',
      'templates/contextkit/tools/scripts/migration-plan.mjs',
    ],
  },
  {
    id: 'b3-bdm',
    file: 'tools/integration-test-b3-bdm.mjs',
    tier: 'integration:enforcement',
    touches: [
      'templates/contextkit/tools/scripts/work-decision-mirror.mjs',
      'templates/contextkit/tools/scripts/work-decision-supersede.mjs',
      'templates/contextkit/tools/scripts/work-decision-ownership.mjs',
      'templates/contextkit/tools/scripts/decision-coverage.mjs',
      'templates/contextkit/runtime/hooks/execution-contract-hook.mjs',
      'templates/contextkit/runtime/hooks/execution-contract-advisory.mjs',
    ],
  },
  {
    id: 'a5-bdm',
    file: 'tools/integration-test-a5-bdm.mjs',
    tier: 'integration:enforcement',
    touches: [
      'templates/contextkit/tools/scripts/economics/investment-forecast.mjs',
      'templates/contextkit/tools/scripts/economics/investment-forecast-core.mjs',
      'templates/contextkit/tools/scripts/operation-recurrence.mjs',
      'templates/contextkit/tools/scripts/operation-recurrence-core.mjs',
    ],
  },
  {
    id: 'b4-adr-tooling',
    file: 'templates/contextkit/tools/scripts/adr-index.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/tools/scripts/adr-index.mjs',
      'templates/contextkit/tools/scripts/adr-migrate.mjs',
      'templates/contextkit/tools/scripts/adr-migrate-core.mjs',
      'templates/contextkit/tools/scripts/adr-redundancy.mjs',
      'templates/contextkit/tools/scripts/adr-redundancy-core.mjs',
      'templates/contextkit/tools/scripts/registry/decision.mjs',
    ],
  },
  {
    id: 'b4-legacy-coexistence',
    file: 'templates/contextkit/tools/scripts/b4-legacy-coexistence.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/tools/scripts/adr-index.mjs',
      'templates/contextkit/tools/scripts/registry/decision.mjs',
    ],
  },
  {
    id: 'b4-bdm',
    file: 'tools/integration-test-b4-bdm.mjs',
    tier: 'integration:installer',
    touches: [
      'install.mjs', 'tools/install/engine.mjs',
      'templates/contextkit/memory/decisions/business/',
      'templates/contextkit/memory/decisions/operations/',
      'templates/contextkit/memory/decisions/legacy/',
      'templates/contextkit/memory/decisions/_templates/',
      'templates/contextkit/tools/scripts/registry/decision.mjs',
    ],
  },
  {
    id: 'b5-governance',
    file: 'templates/contextkit/tools/scripts/program-governance.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/tools/scripts/program-governance.mjs',
      'templates/contextkit/tools/scripts/decision-coverage.mjs',
      'templates/contextkit/runtime/work/schema-decision.mjs',
    ],
  },
  {
    id: 'session4-regression',
    file: 'templates/contextkit/tools/scripts/economics/session4-bugfix-regression.selftest.mjs',
    tier: 'selfcheck',
    touches: [
      'templates/contextkit/tools/scripts/economics/investment-forecast-core.mjs',
      'templates/contextkit/tools/scripts/operation-recurrence-core.mjs',
      'templates/contextkit/tools/scripts/adr-migrate-core.mjs',
      'templates/contextkit/tools/scripts/adr-redundancy-core.mjs',
    ],
  },
]);
