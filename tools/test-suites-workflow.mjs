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

// WF-0089 SA4-T1 (BIZ-0006, ADR-0148 §9/§10) — `create` now also exercises the
// structural auto-fill engine's fail-open/shadow-stamp path (structure-only
// fallback proof), so its touches widen beyond the generic `[<name>, io]` pair.
const EXTRA_MODULE_TOUCHES = Object.freeze({
  create: [
    'templates/contextkit/tools/scripts/graph-query.mjs',
    'templates/contextkit/methodology/projections.mjs',
    'templates/contextkit/methodology/provenance.mjs',
  ],
});

const MODULE_SUITES = [
  'registries', 'plan', 'state', 'create', 'render', 'dag',
  'ownership', 'gates', 'scheduler', 'continuation', 'audit', 'migrate',
].map((name) => ({
  id: `workflow-${name}`,
  file: itFile(name),
  tier: 'integration:workflow',
  touches: [`${WORKFLOW_DIR}/${name}`, `${WORKFLOW_DIR}/io`, ...(EXTRA_MODULE_TOUCHES[name] ?? [])],
}));

export const WORKFLOW_ENGINE_SUITES = Object.freeze([
  {
    id: 'workflow-v2',
    file: 'tools/integration-test-workflow-v2.mjs',
    tier: 'integration:workflow',
    touches: [
      'templates/contextkit/tools/scripts/workflow-pack.mjs',
      'templates/contextkit/tools/scripts/workflow.mjs',
      `${WORKFLOW_DIR}/catalog`,
      `${WORKFLOW_DIR}/create`,
      `${WORKFLOW_DIR}/files`,
      `${WORKFLOW_DIR}/render`,
      `${WORKFLOW_DIR}/validate`,
      'templates/contextkit/tools/scripts/tasks-schema.mjs',
      'templates/contextkit/tools/scripts/tasks-store.mjs',
      'templates/contextkit/tools/scripts/tasks-validate.mjs',
    ],
  },
  ...MODULE_SUITES,
  {
    // WF-0084 finalization authority, lifecycle verbs, and I1-I10 adversarial fixtures.
    id: 'workflow-finalization',
    file: 'templates/contextkit/tools/scripts/workflow-finalization.selftest.mjs',
    tier: 'integration:workflow',
    touches: [
      `${WORKFLOW_DIR}/commands`,
      `${WORKFLOW_DIR}/state`,
      `${WORKFLOW_DIR}/finalization`,
      `${WORKFLOW_DIR}/invariants`,
      'templates/contextkit/runtime/git-hooks/workflow-invariant-hook.mjs',
      'templates/contextkit/runtime/git-hooks/pre-commit.mjs',
      'templates/contextkit/tools/scripts/workflow-done-sweep.mjs',
      'templates/contextkit/tools/scripts/work-lifecycle-cmd.mjs',
      'templates/contextkit/tools/scripts/work-business-lifecycle.mjs',
    ],
  },
  {
    id: 'workflow-close-wave',
    file: 'tools/integration-test-workflow-close-wave.mjs',
    tier: 'integration:workflow',
    touches: [`${WORKFLOW_DIR}/commands`, `${WORKFLOW_DIR}/state`, `${WORKFLOW_DIR}/scheduler`],
  },
  {
    id: 'methodology-shapes',
    file: 'tools/integration-test-methodology-shapes.mjs',
    tier: 'integration:workflow',
    touches: ['templates/contextkit/methodology/', 'templates/contextkit/runtime/execution/work-classifier.mjs'],
  },
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
