/** Canonical task creation for the `pipeline add` semantic alias. */
import { addTask, listTasks, readTasksDocument } from './tasks-store.mjs';

/** @param {string[]} argv @param {string} name @returns {string|undefined} */
function getArgument(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * Parses a comma-separated or bracketed list without introducing YAML parsing.
 *
 * @param {string|undefined} value
 * @returns {string[]}
 */
function parseList(value) {
  if (!value) return [];
  const normalized = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Allocates the next owner-local canonical task id.
 *
 * @param {object[]} tasks
 * @returns {string}
 */
export function nextTaskId(tasks) {
  const highest = tasks.reduce((currentHighest, task) => {
    const match = String(task.id).match(/^(?:T-)?(\d+)$/i);
    return match ? Math.max(currentHighest, Number(match[1])) : currentHighest;
  }, 0);
  return `T-${String(highest + 1).padStart(3, '0')}`;
}

/**
 * Adds one task through the canonical CAS writer.
 *
 * @param {object} context
 * @param {string} context.target workflow/batch directory or tasks.json path
 * @param {string[]} context.argv command arguments after `add`
 * @param {string} [context.now] injected ISO timestamp
 * @returns {object} canonical store receipt
 * @throws {Error} when title/priority is invalid or the CAS write fails
 */
export function add({ target, argv, now }) {
  const title = getArgument(argv, 'title');
  if (!title) throw new Error('Usage: pipeline.mjs add --tasks <scope> --title "..." [--priority P0-P4]');
  const priority = getArgument(argv, 'priority') ?? 'P2';
  if (!/^P[0-4]$/.test(priority)) throw new Error(`pipeline add: invalid priority "${priority}"`);

  const document = readTasksDocument(target);
  const taskInput = {
    id: getArgument(argv, 'id') ?? nextTaskId(listTasks(document)),
    title,
    batchId: getArgument(argv, 'batch-id') ?? null,
    priority,
    dependsOn: parseList(getArgument(argv, 'depends-on')),
    acceptance: parseList(getArgument(argv, 'acceptance')),
    touchHints: parseList(getArgument(argv, 'touch-hints')),
  };
  return addTask(target, taskInput, document.revision, { now });
}
