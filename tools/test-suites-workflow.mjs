/**
 * WF0035 universal wave workflow engine suite registrations (ADR-0101), split
 * out of `test-suites.mjs` so the engine's growing suite list has its own home
 * and the central registry stays within the line budget. Spread into `SUITES`
 * via `...WORKFLOW_ENGINE_SUITES`. Additive; legacy workflow CLI unchanged.
 *
 * The twelve engine-module suites are generated from their module names (each
 * `tools/integration-test-workflow-<name>.mjs` exercises
 * `templates/contextkit/tools/scripts/workflow/<name>.mjs`). The two cross-cutting
 * suites (origem-fixture, packaging) carry explicit touches because they exercise
 * several modules / the installer rather than one same-named module.
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
const WORKFLOW_DIR = 'templates/contextkit/tools/scripts/workflow';
const itFile = (name) => `tools/integration-test-workflow-${name}.mjs`;

const MODULE_SUITES = [
  'registries', 'plan', 'state', 'create', 'render', 'dag',
  'ownership', 'gates', 'scheduler', 'continuation', 'audit', 'migrate',
].map((name) => ({
  id: `workflow-${name}`,
  file: itFile(name),
  tier: 'integration:workflow',
  touches: [`${WORKFLOW_DIR}/${name}`, `${WORKFLOW_DIR}/io`],
}));

export const WORKFLOW_ENGINE_SUITES = Object.freeze([
  ...MODULE_SUITES,
  {
    id: 'workflow-origem-fixture',
    file: itFile('origem-fixture'),
    tier: 'integration:workflow',
    touches: [`${WORKFLOW_DIR}/audit`, `${WORKFLOW_DIR}/migrate`, 'tools/fixtures/wf0016/'],
  },
  {
    id: 'workflow-packaging',
    file: itFile('packaging'),
    tier: 'integration:installer',
    touches: ['install.mjs', 'tools/install/engine.mjs', `${WORKFLOW_DIR}/`],
  },
  {
    // WF-0057 (BIZ-0001 ownership rule 3) — owned-workflow placement gate. A
    // sibling selfcheck (dispatched directly, allowlisted in selfcheck-suites.mjs):
    // asserts no owner-bound workflow sits in the central legacy root.
    id: 'workflow-ownership-placement',
    file: 'tools/selfcheck-workflow-ownership.mjs',
    tier: 'selfcheck',
    touches: [
      `${WORKFLOW_DIR}/create`,
      'templates/contextkit/tools/scripts/workflow.mjs',
      'templates/contextkit/tools/scripts/registry/workflow.mjs',
    ],
  },
]);
