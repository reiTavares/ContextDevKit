/**
 * Canonical ContextDevKit 4 task document schema primitives.
 *
 * `pipeline/tasks.json` is the only authority for task definitions and status.
 * Audit events, when retained, live in the same atomically replaced document and
 * never participate in status derivation.
 */

export const TASKS_SCHEMA_VERSION = 2;

export const TASK_STATUSES = Object.freeze([
  'backlog',
  'working',
  'blocked',
  'testing',
  'done',
  'cancelled',
]);

export const TASK_PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4']);

export const TASK_TRANSITIONS = Object.freeze({
  backlog: Object.freeze(['working', 'cancelled']),
  working: Object.freeze(['backlog', 'blocked', 'testing', 'cancelled']),
  blocked: Object.freeze(['backlog', 'working', 'cancelled']),
  testing: Object.freeze(['working', 'blocked', 'done', 'cancelled']),
  done: Object.freeze([]),
  cancelled: Object.freeze([]),
});

export const TASK_EVENT_TYPE = 'task.transitioned';

/** Compatibility vocabulary used only by the explicit v3 migrator. */
export const OWNER_KINDS = Object.freeze(['WF', 'OP', 'BIZ']);
export const EXECUTION_MODES = Object.freeze(['workflow', 'direct', 'batch']);
export const INITIAL_STATE = 'backlog';
export const TASK_STATES = TASK_STATUSES;
export const LEGAL_TRANSITIONS = TASK_TRANSITIONS;

/**
 * Tests whether a lifecycle edge belongs to the closed v4 transition table.
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function isLegalTaskTransition(fromStatus, toStatus) {
  return Array.isArray(TASK_TRANSITIONS[fromStatus])
    && TASK_TRANSITIONS[fromStatus].includes(toStatus);
}

export const isLegalTransition = isLegalTaskTransition;

/**
 * Creates a complete v4 task record for CLI and workflow-pack callers.
 *
 * @param {{id:string,title:string,batchId?:string|null,status?:string,priority?:string,dependsOn?:string[],acceptance?:string[],touchHints?:string[],evidenceRefs?:string[],reportRefs?:string[],createdAt?:string,updatedAt?:string}} input
 * @param {{now?: string}} [options]
 * @returns {object}
 * @throws {TypeError} when required identity fields are absent
 */
export function createTaskRecord(input, options = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('createTaskRecord: input must be an object');
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new TypeError('createTaskRecord: id must be a non-empty string');
  }
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw new TypeError('createTaskRecord: title must be a non-empty string');
  }
  for (const fieldName of ['dependsOn', 'acceptance', 'touchHints', 'evidenceRefs', 'reportRefs']) {
    if (input[fieldName] !== undefined && !Array.isArray(input[fieldName])) {
      throw new TypeError(`createTaskRecord: ${fieldName} must be an array`);
    }
  }
  const timestamp = options.now ?? input.createdAt ?? new Date().toISOString();
  return {
    id: input.id.trim(),
    batchId: input.batchId ?? null,
    title: input.title.trim(),
    status: input.status ?? 'backlog',
    priority: input.priority ?? 'P2',
    dependsOn: [...(input.dependsOn ?? [])],
    acceptance: [...(input.acceptance ?? [])],
    touchHints: [...(input.touchHints ?? [])],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    reportRefs: [...(input.reportRefs ?? [])],
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

/**
 * Creates the canonical v4 task document without reading the clock or disk.
 * Callers must supply complete task records when `tasks` is non-empty.
 *
 * @param {string} scopeRef stable workflow or batch reference
 * @param {{tasks?: object[], revision?: number, events?: object[]}} [options]
 * @returns {{schemaVersion: 2, scopeRef: string, revision: number, tasks: object[], events: object[]}}
 * @throws {TypeError} when the constructor inputs are structurally invalid
 */
export function createTasksDocument(scopeRef, options = {}) {
  if (typeof scopeRef !== 'string' || scopeRef.trim() === '') {
    throw new TypeError('createTasksDocument: scopeRef must be a non-empty string');
  }
  const revision = options.revision ?? 0;
  if (!Number.isInteger(revision) || revision < 0) {
    throw new TypeError('createTasksDocument: revision must be a non-negative integer');
  }
  if (options.tasks !== undefined && !Array.isArray(options.tasks)) {
    throw new TypeError('createTasksDocument: tasks must be an array');
  }
  if (options.events !== undefined && !Array.isArray(options.events)) {
    throw new TypeError('createTasksDocument: events must be an array');
  }
  return {
    schemaVersion: TASKS_SCHEMA_VERSION,
    scopeRef: scopeRef.trim(),
    revision,
    tasks: (options.tasks ?? []).map((task) => structuredClone(task)),
    events: (options.events ?? []).map((event) => structuredClone(event)),
  };
}

/**
 * Folds audit events for explicit migration diagnostics only.
 * Runtime status authority remains `tasks[].status`.
 *
 * @param {Array<{to?: string}>} events
 * @param {string} [initialStatus]
 * @returns {string}
 */
export function foldStatus(events, initialStatus = INITIAL_STATE) {
  if (!Array.isArray(events) || events.length === 0) return initialStatus;
  const finalEvent = events[events.length - 1];
  return TASK_STATUSES.includes(finalEvent?.to) ? finalEvent.to : initialStatus;
}

/**
 * Checks a migration event chain without making it a runtime authority.
 *
 * @param {Array<{from?: string,to?: string}>} events
 * @param {string} [initialStatus]
 * @returns {boolean}
 */
export function eventsContiguous(events, initialStatus = INITIAL_STATE) {
  if (!Array.isArray(events)) return false;
  let currentStatus = initialStatus;
  for (const event of events) {
    if (event?.from !== currentStatus || !isLegalTaskTransition(event.from, event.to)) return false;
    currentStatus = event.to;
  }
  return true;
}
