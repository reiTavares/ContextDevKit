/** Session-aware aliases over canonical task transitions. */
import { attachTask, detachTask } from './claim.mjs';
import { listTasks, readTasksDocument, transitionTask } from './tasks-store.mjs';

/**
 * Resolves a task from the canonical authority.
 *
 * @param {object} document
 * @param {string} taskId
 * @returns {object}
 * @throws {Error} when the task is absent
 */
function requireTask(document, taskId) {
  const task = listTasks(document).find((candidate) => candidate.id === String(taskId));
  if (!task) throw new Error(`No task with id ${taskId}.`);
  return task;
}

/**
 * Starts one backlog task and then associates it with the active host session.
 * The task transition is authoritative; a workspace-association failure is
 * returned as an honest warning and never rolls the JSON state backward.
 *
 * @param {string} tasksTarget workflow/batch directory or tasks.json path
 * @param {string} taskId
 * @param {{attach?:Function,at?:string,eventId?:string}} [options]
 * @returns {Promise<object>}
 */
export async function startTask(tasksTarget, taskId, options = {}) {
  const document = readTasksDocument(tasksTarget);
  const task = requireTask(document, taskId);
  if (task.status !== 'backlog') {
    throw new Error(`Task ${taskId} is in "${task.status}", not "backlog".`);
  }
  const transitionReceipt = transitionTask(tasksTarget, task.id, {
    to: 'working',
    actor: 'human',
    at: options.at,
    eventId: options.eventId,
  }, document.revision);
  let workspaceWarning = null;
  try {
    await (options.attach ?? attachTask)(task.id);
  } catch (error) {
    workspaceWarning = `task transitioned, but workspace association failed: ${error?.message ?? error}`;
  }
  return { ...transitionReceipt, workspaceWarning };
}

/**
 * Stops one working task by returning its canonical status to backlog.
 *
 * @param {string} tasksTarget workflow/batch directory or tasks.json path
 * @param {string} taskId
 * @param {{detach?:Function,at?:string,eventId?:string}} [options]
 * @returns {Promise<object>}
 */
export async function stopTask(tasksTarget, taskId, options = {}) {
  const document = readTasksDocument(tasksTarget);
  const task = requireTask(document, taskId);
  if (task.status !== 'working') {
    throw new Error(`Task ${taskId} is in "${task.status}", not "working".`);
  }
  const transitionReceipt = transitionTask(tasksTarget, task.id, {
    to: 'backlog',
    actor: 'human',
    at: options.at,
    eventId: options.eventId,
  }, document.revision);
  let workspaceWarning = null;
  try {
    await (options.detach ?? detachTask)(task.id);
  } catch (error) {
    workspaceWarning = `task transitioned, but workspace release failed: ${error?.message ?? error}`;
  }
  return { ...transitionReceipt, workspaceWarning };
}
