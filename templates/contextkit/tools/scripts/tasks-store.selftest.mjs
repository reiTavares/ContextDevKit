/** Focused acceptance tests for the ContextDevKit 4 canonical task store. */
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TasksCasConflictError, TasksStoreLockedError, withTasksFileLock } from './tasks-cas.mjs';
import { deriveTaskBoard } from './tasks-derive.mjs';
import {
  TASK_STATUSES,
  TASKS_SCHEMA_VERSION,
  createTaskRecord,
  createTasksDocument,
} from './tasks-schema.mjs';
import {
  TasksStoreCorruptError,
  addTask,
  readTasksDocument,
  repairTasksProjection,
  resolveTasksDocumentPath,
  transitionTask,
  writeTasksDocumentAtomic,
} from './tasks-store.mjs';
import { validateTasksDocument } from './tasks-validate.mjs';

const failures = [];

/** @param {string} label @param {boolean} condition @param {string} [detail] */
function check(label, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === '' ? '' : ` - ${detail}`}\n`);
  if (!condition) failures.push(label);
}

/** @param {Function} operation @param {Function} ErrorType @returns {boolean} */
function throwsType(operation, ErrorType) {
  try {
    operation();
    return false;
  } catch (error) {
    return error instanceof ErrorType;
  }
}

const fixedTime = '2026-08-08T12:00:00.000Z';
const laterTime = '2026-08-08T12:01:00.000Z';
const finalTime = '2026-08-08T12:02:00.000Z';
const testRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-v4-tasks-'));
const workflowRoot = join(testRoot, 'WF-0111-governance-first');
const tasksPath = resolveTasksDocumentPath(workflowRoot);

try {
  process.stdout.write('\n[schema and authority]\n');
  check('schema version is exactly v2', TASKS_SCHEMA_VERSION === 2);
  check('six canonical statuses are closed', TASK_STATUSES.join('|') === 'backlog|working|blocked|testing|done|cancelled');
  const emptyDocument = createTasksDocument('WF-0111');
  check('empty workflow store has the complete envelope',
    validateTasksDocument(emptyDocument).ok
    && emptyDocument.revision === 0
    && Array.isArray(emptyDocument.events));

  const firstTask = createTaskRecord({
    id: 'T-001',
    title: 'Canonical task store',
    acceptance: ['CAS is enforced'],
    touchHints: ['templates/contextkit/tools/scripts/tasks-store.mjs'],
  }, { now: fixedTime });
  const initialDocument = createTasksDocument('WF-0111', { tasks: [firstTask] });
  check('complete task record validates', validateTasksDocument(initialDocument).ok);
  check('unsupported legacy metadata is refused', !validateTasksDocument({
    ...initialDocument,
    tasks: [{ ...firstTask, workflow: 'legacy-slug' }],
  }).ok);
  check('duplicate task IDs are refused', !validateTasksDocument({
    ...initialDocument,
    tasks: [firstTask, structuredClone(firstTask)],
  }).ok);
  check('status remains authority without event folding', validateTasksDocument({
    ...initialDocument,
    tasks: [{ ...firstTask, status: 'working' }],
    events: [],
  }).ok);
  check('duplicate scope authorities are refused by global derivation', throwsType(
    () => deriveTaskBoard([initialDocument, structuredClone(initialDocument)]),
    Error,
  ));
  check('workflow root resolves only pipeline/tasks.json', tasksPath === resolve(workflowRoot, 'pipeline', 'tasks.json'));

  process.stdout.write('\n[atomic creation and mutation]\n');
  const creationReceipt = writeTasksDocumentAtomic(tasksPath, initialDocument);
  check('creation writes revision zero', creationReceipt.revision === 0 && existsSync(tasksPath));
  check('overwriting without CAS is refused', throwsType(
    () => writeTasksDocumentAtomic(tasksPath, initialDocument),
    TypeError,
  ));

  const startReceipt = transitionTask(tasksPath, 'T-001', {
    to: 'working', actor: 'implementation-engineer', at: laterTime, eventId: 'evt-start',
    reportRefs: ['reports/implementation.md'],
  }, 0);
  const startedDocument = readTasksDocument(tasksPath);
  check('status and event commit in one revision',
    startReceipt.revision === 1
    && startedDocument.tasks[0].status === 'working'
    && startedDocument.events.length === 1
    && startedDocument.events[0].revision === 1);
  check('report refs are paired with transition', startedDocument.tasks[0].reportRefs[0] === 'reports/implementation.md');

  const bytesBeforeInjectedFailure = readFileSync(tasksPath, 'utf8');
  check('injected pre-rename failure surfaces', throwsType(() => transitionTask(tasksPath, 'T-001', {
    to: 'testing', actor: 'implementation-engineer', at: finalTime, eventId: 'evt-testing-failed',
  }, 1, { beforeCanonicalRename: () => { throw new Error('injected write failure'); } }), Error));
  check('failed commit leaves status and event bytes untouched', readFileSync(tasksPath, 'utf8') === bytesBeforeInjectedFailure);
  check('failed commit cleans temporary siblings',
    readdirSync(join(workflowRoot, 'pipeline')).every((entry) => !entry.includes('.tmp-')));

  process.stdout.write('\n[CAS, concurrency, and idempotence]\n');
  check('stale concurrent writer loses by CAS', throwsType(() => transitionTask(tasksPath, 'T-001', {
    to: 'testing', actor: 'implementation-engineer', at: finalTime, eventId: 'evt-stale',
  }, 0), TasksCasConflictError));
  check('CAS loser cannot mutate authority', readFileSync(tasksPath, 'utf8') === bytesBeforeInjectedFailure);
  check('exclusive lock refuses a concurrent writer', withTasksFileLock(tasksPath, () => throwsType(
    () => transitionTask(tasksPath, 'T-001', {
      to: 'testing', actor: 'implementation-engineer', at: finalTime, eventId: 'evt-locked',
    }, 1),
    TasksStoreLockedError,
  )));
  const tasksStoreModuleUrl = new URL('./tasks-store.mjs', import.meta.url).href;
  const crossProcessLockCheck = withTasksFileLock(tasksPath, () => spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { addTask } from ${JSON.stringify(tasksStoreModuleUrl)};
     try {
       addTask(process.env.CONTEXTDEVKIT_TASKS_PATH, { id: 'T-RACER', title: 'Concurrent racer' }, 1, { now: ${JSON.stringify(finalTime)} });
       process.exit(2);
     } catch (error) {
       process.exit(error?.name === 'TasksStoreLockedError' ? 0 : 3);
     }`,
  ], {
    env: { ...process.env, CONTEXTDEVKIT_TASKS_PATH: tasksPath },
    encoding: 'utf8',
  }));
  check('cross-process writer observes the same exclusive lock',
    crossProcessLockCheck.status === 0,
    crossProcessLockCheck.stderr);
  const retryReceipt = transitionTask(tasksPath, 'T-001', {
    to: 'working', actor: 'implementation-engineer', at: laterTime, eventId: 'evt-start',
  }, 0);
  check('same eventId retry is idempotent after stale revision',
    retryReceipt.idempotent && retryReceipt.revision === 1 && retryReceipt.document.events.length === 1);

  process.stdout.write('\n[projection failure and deterministic repair]\n');
  const testingReceipt = transitionTask(tasksPath, 'T-001', {
    to: 'testing', actor: 'implementation-engineer', at: finalTime, eventId: 'evt-testing',
  }, 1, { projectionWriter: () => { throw new Error('injected projection failure'); } });
  check('projection failure is reported without losing canonical JSON',
    testingReceipt.projection.status === 'failed'
    && readTasksDocument(tasksPath).tasks[0].status === 'testing'
    && readTasksDocument(tasksPath).revision === 2);
  const canonicalBytesBeforeRepair = readFileSync(tasksPath, 'utf8');
  const firstRepair = repairTasksProjection(tasksPath);
  const projectionBytes = readFileSync(firstRepair.path, 'utf8');
  const secondRepair = repairTasksProjection(tasksPath);
  check('projection repair is byte-idempotent', readFileSync(secondRepair.path, 'utf8') === projectionBytes);
  check('projection never writes back to JSON authority', readFileSync(tasksPath, 'utf8') === canonicalBytesBeforeRepair);
  check('projection labels itself generated', projectionBytes.includes('Generated projection'));

  process.stdout.write('\n[evidence, additions, and corruption]\n');
  const doneReceipt = transitionTask(tasksPath, 'T-001', {
    to: 'done', actor: 'qa', at: finalTime, eventId: 'evt-done',
    evidenceRefs: ['reports/tests.json'], reportRefs: ['reports/final.md'],
  }, 2);
  check('done transition carries evidence and report refs',
    doneReceipt.task.evidenceRefs.includes('reports/tests.json')
    && doneReceipt.task.reportRefs.includes('reports/final.md'));
  const reopenedReceipt = transitionTask(tasksPath, 'T-001', {
    to: 'backlog', actor: 'qa', at: finalTime, eventId: 'evt-human-feedback',
    note: 'Human requested an adjustment.',
  }, 3);
  check('human feedback reopens done at backlog and clears stale current evidence',
    reopenedReceipt.task.status === 'backlog'
    && reopenedReceipt.task.evidenceRefs.length === 0
    && reopenedReceipt.document.events.find((event) => event.id === 'evt-done')?.evidenceRefs.includes('reports/tests.json'));
  transitionTask(tasksPath, 'T-001', {
    to: 'working', actor: 'implementation-engineer', at: finalTime, eventId: 'evt-rework',
  }, 4);
  transitionTask(tasksPath, 'T-001', {
    to: 'testing', actor: 'implementation-engineer', at: finalTime, eventId: 'evt-retest',
  }, 5);
  const redoneReceipt = transitionTask(tasksPath, 'T-001', {
    to: 'done', actor: 'automated-test', at: finalTime, eventId: 'evt-redone',
    evidenceRefs: ['reports/retest.json'],
  }, 6);
  check('reopened task requires and retains fresh evidence on its next done cycle',
    redoneReceipt.task.status === 'done'
    && redoneReceipt.task.evidenceRefs.join(',') === 'reports/retest.json');
  const secondTaskReceipt = addTask(tasksPath, { id: 'T-002', title: 'Projection repair' }, 7, { now: finalTime });
  check('addTask creates the complete default shape through CAS',
    secondTaskReceipt.revision === 8
    && secondTaskReceipt.task.status === 'backlog'
    && secondTaskReceipt.task.priority === 'P2'
    && secondTaskReceipt.task.batchId === null);

  const corruptRoot = join(testRoot, 'corrupt-workflow');
  const corruptPath = resolveTasksDocumentPath(corruptRoot);
  mkdirSync(join(corruptRoot, 'pipeline'), { recursive: true });
  writeFileSync(corruptPath, '{broken json', 'utf8');
  const corruptBytes = readFileSync(corruptPath, 'utf8');
  check('corrupt JSON fails honestly', throwsType(() => readTasksDocument(corruptPath), TasksStoreCorruptError));
  check('mutation refuses corrupt authority without repair guess', throwsType(
    () => addTask(corruptPath, { id: 'T-003', title: 'Must not write' }, 0, { now: finalTime }),
    TasksStoreCorruptError,
  ));
  check('corrupt authority remains byte-identical after refusal', readFileSync(corruptPath, 'utf8') === corruptBytes);
} finally {
  const resolvedTestRoot = resolve(testRoot);
  if (resolvedTestRoot.startsWith(resolve(tmpdir())) && basenameSafe(resolvedTestRoot).startsWith('contextdevkit-v4-tasks-')) {
    rmSync(resolvedTestRoot, { recursive: true, force: true });
  }
}

/** @param {string} filePath @returns {string} */
function basenameSafe(filePath) {
  return filePath.replace(/\\/g, '/').split('/').at(-1) ?? '';
}

process.stdout.write(`\nContextDevKit 4 canonical task store selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exitCode = failures.length === 0 ? 0 : 1;
