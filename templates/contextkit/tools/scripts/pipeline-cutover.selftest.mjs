#!/usr/bin/env node
/** Focused contract tests for the v4 pipeline/work CLI cutover. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBoard } from './pipeline-board.mjs';
import { dispatchPipelineCommand, parsePipelineInvocation } from './pipeline.mjs';
import { runOperationCreate } from './work-operation.mjs';
import { createTaskRecord, createTasksDocument, TASK_STATUSES } from './tasks-schema.mjs';
import { renderTasksMarkdown } from './tasks-render.mjs';
import {
  readTasksDocument,
  transitionTask,
} from './tasks-store.mjs';

let passed = 0;
let failed = 0;

/** @param {string} name @param {boolean} condition @param {string} [detail] */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } else {
    failed += 1;
    process.stderr.write(`FAIL ${name}${detail ? ` - ${detail}` : ''}\n`);
  }
}

/** @param {string[]} statusList @returns {object[]} */
function recordsForStatuses(statusList) {
  return statusList.map((status, index) => createTaskRecord({
    id: `S-${index + 1}`,
    title: `${status} task`,
    status,
    evidenceRefs: status === 'done' ? ['suite:green'] : [],
  }, { now: '2026-08-08T12:00:00.000Z' }));
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-pipeline-v4-'));
try {
  const scopeRoot = join(temporaryRoot, 'WF-9000-cli-cutover');
  const pipelineRoot = join(scopeRoot, 'pipeline');
  const tasksPath = join(pipelineRoot, 'tasks.json');
  mkdirSync(pipelineRoot, { recursive: true });
  const seedTasks = ['T-001', 'T-002', 'T-003'].map((id) => createTaskRecord({
    id,
    title: `Task ${id}`,
  }, { now: '2026-08-08T12:00:00.000Z' }));
  const seedDocument = createTasksDocument('WF-9000', { tasks: seedTasks });
  writeFileSync(tasksPath, `${JSON.stringify(seedDocument, null, 2)}\n`, 'utf8');
  writeFileSync(join(pipelineRoot, 'tasks.md'), renderTasksMarkdown(seedDocument), 'utf8');

  // A conflicting physical status directory is a trap: readers must ignore it.
  const retiredStatusDir = join(scopeRoot, 'backlog');
  mkdirSync(retiredStatusDir, { recursive: true });
  writeFileSync(join(retiredStatusDir, 'T-999-retired.md'), 'status: done\n', 'utf8');

  const output = [];
  const environment = {
    out: (line) => output.push(line),
    session: { attach: async () => {}, detach: async () => {} },
  };
  const invocation = (commandArgs) => parsePipelineInvocation([...commandArgs, '--tasks', scopeRoot], {});

  const initialList = await dispatchPipelineCommand(invocation(['list']), environment);
  check('list reads only canonical JSON', initialList.tasks.length === 3 && !initialList.tasks.some((task) => task.id === 'T-999'));

  await dispatchPipelineCommand(invocation(['start', 'T-001']), environment);
  await dispatchPipelineCommand(invocation(['move', 'T-001', 'testing']), environment);
  await dispatchPipelineCommand(invocation(['qa-approve', 'T-001', '--evidence', 'suite:green']), environment);
  let currentDocument = readTasksDocument(scopeRoot);
  check('start/move/qa aliases persist canonical transitions', currentDocument.tasks.find((task) => task.id === 'T-001')?.status === 'done');
  check('transition status and audit event share one revision', currentDocument.revision === 3 && currentDocument.events.length === 3);

  await dispatchPipelineCommand(invocation(['start', 'T-002']), environment);
  await dispatchPipelineCommand(invocation(['auto-transition', 'T-002', 'testing']), environment);
  let missingAutomatedEvidenceRefused = false;
  try {
    await dispatchPipelineCommand(invocation(['auto-transition', 'T-002', 'done']), environment);
  } catch (error) {
    missingAutomatedEvidenceRefused = /requires --evidence/.test(error.message);
  }
  check('automatic testing-to-done refuses without a bound test receipt', missingAutomatedEvidenceRefused);
  await dispatchPipelineCommand(invocation(['auto-transition', 'T-002', 'done', '--evidence', 'suite:auto-green']), environment);
  currentDocument = readTasksDocument(scopeRoot);
  check('green automated tests transition testing directly to done', currentDocument.tasks.find((task) => task.id === 'T-002')?.status === 'done');
  await dispatchPipelineCommand(invocation(['qa-reject', 'T-002', 'human requested adjustment']), environment);
  currentDocument = readTasksDocument(scopeRoot);
  const reopenedTask = currentDocument.tasks.find((task) => task.id === 'T-002');
  check('human feedback reopens a done task in backlog', reopenedTask?.status === 'backlog');
  check('human feedback clears stale current-cycle evidence', reopenedTask?.evidenceRefs.length === 0);
  await dispatchPipelineCommand(invocation(['start', 'T-002']), environment);
  await dispatchPipelineCommand(invocation(['auto-transition', 'T-002', 'testing']), environment);
  await dispatchPipelineCommand(invocation(['auto-transition', 'T-002', 'done', '--evidence', 'suite:retest-green']), environment);
  currentDocument = readTasksDocument(scopeRoot);
  const retestedTask = currentDocument.tasks.find((task) => task.id === 'T-002');
  check('reopened task completes a fresh backlog-to-testing-to-done cycle', retestedTask?.status === 'done' && retestedTask.evidenceRefs.join(',') === 'suite:retest-green');

  await dispatchPipelineCommand(invocation([
    'add', '--title', 'Canonical new task', '--priority', 'P1',
    '--evidence-refs', 'gh#42', '--report-refs', 'reports/triage.md',
  ]), environment);
  await dispatchPipelineCommand(invocation(['move', 'T-003', 'cancelled']), environment);
  currentDocument = readTasksDocument(scopeRoot);
  const newTask = currentDocument.tasks.find((task) => task.title === 'Canonical new task');
  check('add writes schema-v2 task through store API', newTask?.id === 'T-004' && newTask.status === 'backlog');
  check('add preserves canonical evidence/report references', newTask?.evidenceRefs.includes('gh#42') && newTask.reportRefs.includes('reports/triage.md'));
  check('cancelled is persisted as status, not placement', currentDocument.tasks.find((task) => task.id === 'T-003')?.status === 'cancelled');

  let staleCasRefused = false;
  try {
    transitionTask(scopeRoot, 'T-004', { to: 'working', actor: 'human' }, 0);
  } catch (error) {
    staleCasRefused = /CAS conflict/i.test(error?.message ?? '');
  }
  check('stale CAS refuses without mutation', staleCasRefused && readTasksDocument(scopeRoot).revision === currentDocument.revision);

  await dispatchPipelineCommand(invocation(['sync']), environment);
  const projectedDocument = readTasksDocument(scopeRoot);
  check('tasks.md is exact idempotent projection', readFileSync(join(pipelineRoot, 'tasks.md'), 'utf8') === renderTasksMarkdown(projectedDocument));
  const finalList = await dispatchPipelineCommand(invocation(['list']), environment);
  check('CLI state is byte-equivalent to canonical task records', JSON.stringify(finalList.tasks) === JSON.stringify(projectedDocument.tasks));

  const statusBoard = renderBoard(recordsForStatuses(TASK_STATUSES));
  check('board preserves all six canonical states', TASK_STATUSES.every((status) => statusBoard.includes(`${status} task`)));

  let missingScopeRefused = false;
  try {
    parsePipelineInvocation(['list'], {});
  } catch (error) {
    missingScopeRefused = /--tasks/.test(error?.message ?? '');
  }
  check('mutating authority is never inferred globally', missingScopeRefused);

  const projectRoot = join(temporaryRoot, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const directReceipt = runOperationCreate({
    positionals: ['Direct operation'],
    flags: { id: 'OP-9001', mode: 'direct' },
    apply: true,
    root: projectRoot,
    now: '2026-08-08',
  });
  check('direct operation creates no speculative task store', directReceipt.applied && directReceipt.detail.taskStore === null && !existsSync(join(directReceipt.detail.dir, 'batch')));

  const batchReceipt = runOperationCreate({
    positionals: ['Batch operation'],
    flags: { id: 'OP-9002', mode: 'batch' },
    apply: true,
    root: projectRoot,
    now: '2026-08-08',
  });
  const batchDocument = readTasksDocument(batchReceipt.detail.taskStore);
  check('batch operation seeds canonical task store', batchDocument.scopeRef === 'OP-9002' && batchDocument.revision === 0);
  check('batch operation creates reports and projection', existsSync(join(batchReceipt.detail.dir, 'batch', 'reports')) && existsSync(join(batchReceipt.detail.dir, 'batch', 'tasks.md')));

  const scriptsRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const ownedFiles = [
    'pipeline.mjs',
    'pipeline-add.mjs',
    'pipeline-board.mjs',
    'pipeline-session.mjs',
    'pipeline-transitions.mjs',
    'work.mjs',
    'work-operation.mjs',
    'work-business-dispatch.mjs',
  ];
  const ownedSource = ownedFiles.map((fileName) => readFileSync(join(scriptsRoot, fileName), 'utf8')).join('\n');
  check('CLI has no retired task reader import', !ownedSource.includes('pipeline-tasks'));
  check('CLI has no filesystem status move', !ownedSource.includes('renameSync'));
  check('CLI has no status-directory path access', !/["'`](?:backlog|working|testing|conclusion)[\\/]/.test(ownedSource));
  check('CLI imports canonical task store', ownedSource.includes("from './tasks-store.mjs'"));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`\nPipeline v4 cutover: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exitCode = 1;
