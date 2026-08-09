/** Semantic transition aliases over the canonical ContextDevKit 4 task store. */
import { listTasks, readTasksDocument, transitionTask } from './tasks-store.mjs';

const STATUS_ALIASES = Object.freeze({ conclusion: 'done' });
const AUTOMATIC_EDGES = Object.freeze({ backlog: ['working'], working: ['testing'] });

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

/** `pipeline qa-reject <id> <feedback>`: testing to working with feedback. */
export function qaReject({ target, argv }) {
  const [taskId, feedback] = argv;
  if (!taskId || !feedback) {
    throw new Error('Usage: pipeline.mjs qa-reject <id> "feedback" --tasks <scope>');
  }
  const document = readTasksDocument(target);
  const task = findTask(document, taskId);
  if (task.status !== 'testing') {
    throw new Error(`qa-reject: task ${taskId} is in "${task.status}", not "testing"`);
  }
  return transitionTask(target, taskId, {
    to: 'working',
    actor: 'qa',
    note: feedback,
    eventId: getArgument(argv, 'event-id'),
  }, document.revision);
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

/** Automatic alias limited to deterministic forward edges; no autonomy gate. */
export function autoTransition({ target, argv }) {
  const [taskId, requestedStatus] = argv;
  if (!taskId || !requestedStatus) {
    throw new Error('Usage: pipeline.mjs auto-transition <id> <working|testing> --tasks <scope>');
  }
  const document = readTasksDocument(target);
  const task = findTask(document, taskId);
  const targetStatus = canonicalStatus(requestedStatus);
  if (!(AUTOMATIC_EDGES[task.status] ?? []).includes(targetStatus)) {
    throw new Error(`auto-transition: ${task.status} -> ${targetStatus} is not a permitted automatic edge`);
  }
  return transitionTask(target, taskId, {
    to: targetStatus,
    actor: 'auto',
    eventId: getArgument(argv, 'event-id'),
  }, document.revision);
}
