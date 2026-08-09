/** Pure lifecycle mutations for the canonical v4 task document. */
import {
  TASK_EVENT_TYPE,
  TASK_STATUSES,
  isLegalTaskTransition,
} from './tasks-schema.mjs';
import { assertTasksDocument } from './tasks-validate.mjs';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Returns a stable union of existing and appended references.
 *
 * @param {string[]} currentRefs
 * @param {string[]|undefined} appendedRefs
 * @returns {string[]}
 */
function mergeReferences(currentRefs, appendedRefs) {
  return [...new Set([...(currentRefs ?? []), ...(appendedRefs ?? [])])];
}

/**
 * Finds an already committed transition request for retry idempotence.
 *
 * @param {object} document
 * @param {string|undefined} eventId
 * @returns {object|null}
 */
export function findTaskEvent(document, eventId) {
  if (!isNonEmptyString(eventId) || !Array.isArray(document?.events)) return null;
  return document.events.find((event) => event.id === eventId) ?? null;
}

/**
 * Plans one atomic status/event mutation entirely in memory.
 *
 * The returned document contains both the authoritative status and its optional
 * audit event at the same next revision. Callers must commit the whole document
 * with CAS; writing either part separately is unsupported.
 *
 * @param {object} document validated canonical tasks document
 * @param {string} taskId
 * @param {{to:string,actor:string,note?:string,evidenceRefs?:string[],reportRefs?:string[],at?:string,eventId?:string}} transition
 * @returns {{document:object,task:object,event:object,idempotent:boolean}}
 * @throws {Error} on unknown task, illegal edge, malformed actor, or missing done evidence
 */
export function planTaskTransition(document, taskId, transition) {
  assertTasksDocument(document);
  if (!isNonEmptyString(taskId)) throw new TypeError('transitionTask: taskId must be a non-empty string');
  if (!transition || typeof transition !== 'object') {
    throw new TypeError('transitionTask: transition must be an object');
  }
  const priorEvent = findTaskEvent(document, transition.eventId);
  if (priorEvent) {
    if (priorEvent.taskId !== taskId || priorEvent.to !== transition.to) {
      throw new Error(`transitionTask: eventId "${transition.eventId}" already belongs to another transition`);
    }
    const priorTask = document.tasks.find((task) => task.id === taskId);
    return { document, task: priorTask, event: priorEvent, idempotent: true };
  }

  const taskIndex = document.tasks.findIndex((task) => task.id === taskId);
  if (taskIndex < 0) throw new Error(`transitionTask: unknown task "${taskId}"`);
  const currentTask = document.tasks[taskIndex];
  if (!TASK_STATUSES.includes(transition.to)) {
    throw new Error(`transitionTask: target status must be one of ${TASK_STATUSES.join(', ')}`);
  }
  if (!isLegalTaskTransition(currentTask.status, transition.to)) {
    throw new Error(`transitionTask: illegal transition ${currentTask.status} -> ${transition.to}`);
  }
  if (!isNonEmptyString(transition.actor)) {
    throw new TypeError('transitionTask: actor must be a non-empty string');
  }
  if (transition.note !== undefined && !isNonEmptyString(transition.note)) {
    throw new TypeError('transitionTask: note must be a non-empty string when present');
  }
  if (transition.evidenceRefs !== undefined && !Array.isArray(transition.evidenceRefs)) {
    throw new TypeError('transitionTask: evidenceRefs must be an array');
  }
  if (transition.reportRefs !== undefined && !Array.isArray(transition.reportRefs)) {
    throw new TypeError('transitionTask: reportRefs must be an array');
  }

  const timestamp = transition.at ?? new Date().toISOString();
  const nextRevision = document.revision + 1;
  const restartsQaCycle = transition.to === 'backlog'
    && ['testing', 'done'].includes(currentTask.status);
  const evidenceRefs = restartsQaCycle
    ? mergeReferences([], transition.evidenceRefs)
    : mergeReferences(currentTask.evidenceRefs, transition.evidenceRefs);
  const reportRefs = mergeReferences(currentTask.reportRefs, transition.reportRefs);
  if (transition.to === 'done' && evidenceRefs.length === 0) {
    throw new Error('transitionTask: status done requires at least one evidence reference');
  }
  const nextTask = {
    ...currentTask,
    status: transition.to,
    evidenceRefs,
    reportRefs,
    updatedAt: timestamp,
  };
  const event = {
    id: transition.eventId ?? `${document.scopeRef}:${taskId}:r${nextRevision}`,
    type: TASK_EVENT_TYPE,
    taskId,
    from: currentTask.status,
    to: transition.to,
    actor: transition.actor.trim(),
    at: timestamp,
    revision: nextRevision,
    evidenceRefs: [...(transition.evidenceRefs ?? [])],
    reportRefs: [...(transition.reportRefs ?? [])],
  };
  if (transition.note !== undefined) event.note = transition.note.trim();

  const nextTasks = document.tasks.map((task, index) => (index === taskIndex ? nextTask : task));
  const nextDocument = {
    ...document,
    revision: nextRevision,
    tasks: nextTasks,
    events: [...document.events, event],
  };
  assertTasksDocument(nextDocument);
  return { document: nextDocument, task: nextTask, event, idempotent: false };
}

/**
 * Compatibility alias for callers that use a pure document transition name.
 *
 * @param {object} document
 * @param {string} taskId
 * @param {object} transition
 * @returns {object}
 */
export function transitionTaskDocument(document, taskId, transition) {
  return planTaskTransition(document, taskId, transition);
}
