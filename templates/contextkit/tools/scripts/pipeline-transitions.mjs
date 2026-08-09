/** Semantic transition aliases over the canonical ContextDevKit 4 task store. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  listTasks,
  readTasksDocument,
  resolveTasksDocumentPath,
  transitionTask,
} from './tasks-store.mjs';
import { loadWorkflowPack, reopenCompletedWorkflow } from './workflow-pack.mjs';

const STATUS_ALIASES = Object.freeze({ conclusion: 'done' });
const AUTOMATIC_EDGES = Object.freeze({
  backlog: ['working'],
  working: ['testing'],
  testing: ['done'],
});

/** @param {string[]} argv @param {string} name @returns {string|undefined} */
function getArgument(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** @param {string} requestedStatus @returns {string} */
export function canonicalStatus(requestedStatus) {
  return STATUS_ALIASES[requestedStatus] ?? requestedStatus;
}

/**
 * Resolves a task from the canonical document.
 *
 * @param {object} document
 * @param {string} taskId
 * @returns {object}
 * @throws {Error} when the task does not exist
 */
export function findTask(document, taskId) {
  const wanted = String(taskId);
  const task = listTasks(document).find((candidate) => candidate.id === wanted);
  if (!task) throw new Error(`No task with id ${taskId}.`);
  return task;
}

/**
 * Applies one CAS-guarded task transition.
 *
 * @param {object} context
 * @param {string} context.target
 * @param {string} context.taskId
 * @param {string} context.to
 * @param {string} context.actor
 * @param {string} [context.note]
 * @param {string[]} [context.evidenceRefs]
 * @param {string[]} [context.reportRefs]
 * @param {string} [context.eventId]
 * @param {string} [context.at]
 * @returns {object}
 */
export function applySemanticTransition(context) {
  const document = readTasksDocument(context.target);
  findTask(document, context.taskId);
  return transitionTask(
    context.target,
    context.taskId,
    {
      to: canonicalStatus(context.to),
      actor: context.actor,
      note: context.note,
      evidenceRefs: context.evidenceRefs,
      reportRefs: context.reportRefs,
      eventId: context.eventId,
      at: context.at,
    },
    document.revision,
  );
}

/** `pipeline move <id> <status>`: human alias over a legal canonical edge. */
export function move({ target, argv }) {
  const [taskId, requestedStatus] = argv;
  if (!taskId || !requestedStatus) {
    throw new Error('Usage: pipeline.mjs move <id> <backlog|working|blocked|testing|done|cancelled> --tasks <scope>');
  }
  return applySemanticTransition({
    target,
    taskId,
    to: requestedStatus,
    actor: getArgument(argv, 'actor') ?? 'human',
    note: getArgument(argv, 'note'),
    evidenceRefs: getArgument(argv, 'evidence') ? [getArgument(argv, 'evidence')] : undefined,
    reportRefs: getArgument(argv, 'report') ? [getArgument(argv, 'report')] : undefined,
    eventId: getArgument(argv, 'event-id'),
  });
}

/** Return the workflow package that owns a task scope, when one exists. */
function workflowDirectoryForTaskScope(target) {
  const tasksPath = resolveTasksDocumentPath(target);
  const workflowDirectory = dirname(dirname(tasksPath));
  return existsSync(join(workflowDirectory, 'workflow.json'))
    && existsSync(join(workflowDirectory, 'workflow-state.json'))
    ? workflowDirectory
    : null;
}

/** `pipeline qa-reject <id> <feedback>`: testing/done to a fresh backlog cycle. */
export function qaReject({ target, argv, root = process.cwd() }) {
  const [taskId, feedback] = argv;
  if (!taskId || !feedback) {
    throw new Error('Usage: pipeline.mjs qa-reject <id> "feedback" --tasks <scope>');
  }
  const document = readTasksDocument(target);
  const task = findTask(document, taskId);
  if (!['testing', 'done'].includes(task.status)) {
    throw new Error(`qa-reject: task ${taskId} is in "${task.status}", not "testing" or "done"`);
  }
  let transitionTarget = target;
  const workflowDirectory = workflowDirectoryForTaskScope(target);
  if (workflowDirectory) {
    const workflow = loadWorkflowPack(root, workflowDirectory);
    if (workflow.state.status === 'done') {
      transitionTarget = reopenCompletedWorkflow(root, workflowDirectory, {
        expectedRevision: workflow.state.revision,
      }).dir;
    }
  }
  const currentDocument = readTasksDocument(transitionTarget);
  findTask(currentDocument, taskId);
  return transitionTask(transitionTarget, taskId, {
    to: 'backlog',
    actor: getArgument(argv, 'actor') ?? 'qa',
    note: feedback,
    eventId: getArgument(argv, 'event-id'),
  }, currentDocument.revision);
}

/** `pipeline qa-approve <id>`: testing to done with required evidence. */
export function qaApprove({ target, argv }) {
  const [taskId] = argv;
  const evidence = getArgument(argv, 'evidence');
  if (!taskId || !evidence) {
    throw new Error('Usage: pipeline.mjs qa-approve <id> --evidence "reference" --tasks <scope>');
  }
  const document = readTasksDocument(target);
  const task = findTask(document, taskId);
  if (task.status !== 'testing') {
    throw new Error(`qa-approve: task ${taskId} is in "${task.status}", not "testing"`);
  }
  return transitionTask(target, taskId, {
    to: 'done',
    actor: 'qa',
    evidenceRefs: [evidence],
    eventId: getArgument(argv, 'event-id'),
  }, document.revision);
}

/** Automatic alias limited to deterministic forward edges and evidence-bound QA. */
export function autoTransition({ target, argv }) {
  const [taskId, requestedStatus] = argv;
  if (!taskId || !requestedStatus) {
    throw new Error('Usage: pipeline.mjs auto-transition <id> <working|testing|done> --tasks <scope> [--evidence <test-receipt>]');
  }
  const document = readTasksDocument(target);
  const task = findTask(document, taskId);
  const targetStatus = canonicalStatus(requestedStatus);
  if (!(AUTOMATIC_EDGES[task.status] ?? []).includes(targetStatus)) {
    throw new Error(`auto-transition: ${task.status} -> ${targetStatus} is not a permitted automatic edge`);
  }
  const evidence = getArgument(argv, 'evidence');
  if (targetStatus === 'done' && !evidence) {
    throw new Error('auto-transition: testing -> done requires --evidence <successful automated-test receipt>');
  }
  return transitionTask(target, taskId, {
    to: targetStatus,
    actor: targetStatus === 'done' ? 'automated-test' : 'auto',
    note: getArgument(argv, 'note'),
    evidenceRefs: evidence ? [evidence] : undefined,
    eventId: getArgument(argv, 'event-id'),
  }, document.revision);
}
