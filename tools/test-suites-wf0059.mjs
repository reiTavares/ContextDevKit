/**
 * ContextDevKit 4 canonical task authority and explicit v3 migration suites.
 * Retired WF-0059 lane/journal/compatibility contracts are intentionally absent.
 */
const SCRIPTS = 'templates/contextkit/tools/scripts';

export const WF0059_SUITES = Object.freeze([
  {
    id: 'wf0111-v4-task-store',
    file: `${SCRIPTS}/tasks-store.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/tasks-schema.mjs`, `${SCRIPTS}/tasks-validate.mjs`,
      `${SCRIPTS}/tasks-transition.mjs`, `${SCRIPTS}/tasks-derive.mjs`,
      `${SCRIPTS}/tasks-cas.mjs`, `${SCRIPTS}/tasks-store.mjs`,
      `${SCRIPTS}/tasks-render.mjs`,
    ],
  },
  {
    id: 'wf0111-v3-to-v4-migration',
    file: 'tools/migrations/v3-to-v4/v3-to-v4.selftest.mjs',
    tier: 'integration:workflow',
    touches: [
      'templates/contextkit/tools/migrations/v3-to-v4/',
      'tools/migrations/v3-to-v4/',
      `${SCRIPTS}/tasks-store.mjs`,
    ],
  },
  {
    id: 'wf0111-v4-pipeline-cli-cutover',
    file: `${SCRIPTS}/pipeline-cutover.selftest.mjs`,
    tier: 'selfcheck',
    touches: [
      `${SCRIPTS}/pipeline.mjs`, `${SCRIPTS}/pipeline-add.mjs`,
      `${SCRIPTS}/pipeline-board.mjs`, `${SCRIPTS}/pipeline-session.mjs`,
      `${SCRIPTS}/pipeline-transitions.mjs`, `${SCRIPTS}/work.mjs`,
      `${SCRIPTS}/work-operation.mjs`, `${SCRIPTS}/tasks-store.mjs`,
      `${SCRIPTS}/tasks-render.mjs`, `${SCRIPTS}/workspace-sync.mjs`,
      `${SCRIPTS}/claim.mjs`,
    ],
  },
]);
