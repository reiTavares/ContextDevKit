/** Boundary validation for the canonical ContextDevKit 4 task store. */
import {
  TASK_EVENT_TYPE,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASKS_SCHEMA_VERSION,
  isLegalTaskTransition,
} from './tasks-schema.mjs';

const TASK_ARRAY_FIELDS = Object.freeze([
  'dependsOn',
  'acceptance',
  'touchHints',
  'evidenceRefs',
  'reportRefs',
]);
const TASK_FIELDS = new Set([
  'id', 'batchId', 'title', 'status', 'priority', ...TASK_ARRAY_FIELDS,
  'createdAt', 'updatedAt',
]);
const EVENT_FIELDS = new Set([
  'id', 'type', 'taskId', 'from', 'to', 'actor', 'at', 'revision',
  'evidenceRefs', 'reportRefs', 'note',
]);
const DOCUMENT_FIELDS = new Set(['schemaVersion', 'scopeRef', 'revision', 'tasks', 'events']);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isIsoTimestamp = (value) => isNonEmptyString(value) && !Number.isNaN(Date.parse(value));

/**
 * Validates a unique string array without mutating it.
 *
 * @param {unknown} fieldValue
 * @param {string} fieldLabel
 * @returns {string[]}
 */
function validateStringArray(fieldValue, fieldLabel) {
  if (!Array.isArray(fieldValue)) return [`${fieldLabel} must be an array`];
  const errors = [];
  const seenValues = new Set();
  for (const entry of fieldValue) {
    if (!isNonEmptyString(entry)) {
      errors.push(`${fieldLabel} must contain only non-empty strings`);
      continue;
    }
    if (seenValues.has(entry)) errors.push(`${fieldLabel} contains duplicate "${entry}"`);
    seenValues.add(entry);
  }
  return errors;
}

/**
 * Validates one complete task record.
 *
 * @param {unknown} candidate
 * @returns {{ok:boolean,errors:string[]}}
 */
export function validateTaskRecord(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, errors: ['task must be an object'] };
  }
  const task = candidate;
  const taskLabel = isNonEmptyString(task.id) ? task.id : '(missing id)';
  const errors = [];
  for (const fieldName of Object.keys(task)) {
    if (!TASK_FIELDS.has(fieldName)) errors.push(`${taskLabel} contains unsupported field "${fieldName}"`);
  }
  if (!isNonEmptyString(task.id)) errors.push('task.id must be a non-empty string');
  if (!(task.batchId === null || isNonEmptyString(task.batchId))) {
    errors.push(`${taskLabel}.batchId must be null or a non-empty string`);
  }
  if (!isNonEmptyString(task.title)) errors.push(`${taskLabel}.title must be a non-empty string`);
  if (!TASK_STATUSES.includes(task.status)) {
    errors.push(`${taskLabel}.status must be one of ${TASK_STATUSES.join(', ')}`);
  }
  if (!TASK_PRIORITIES.includes(task.priority)) {
    errors.push(`${taskLabel}.priority must be one of ${TASK_PRIORITIES.join(', ')}`);
  }
  for (const fieldName of TASK_ARRAY_FIELDS) {
    errors.push(...validateStringArray(task[fieldName], `${taskLabel}.${fieldName}`));
  }
  if (!isIsoTimestamp(task.createdAt)) errors.push(`${taskLabel}.createdAt must be an ISO-8601 timestamp`);
  if (!isIsoTimestamp(task.updatedAt)) errors.push(`${taskLabel}.updatedAt must be an ISO-8601 timestamp`);
  if (isIsoTimestamp(task.createdAt) && isIsoTimestamp(task.updatedAt)
      && Date.parse(task.updatedAt) < Date.parse(task.createdAt)) {
    errors.push(`${taskLabel}.updatedAt cannot precede createdAt`);
  }
  if (task.status === 'done' && Array.isArray(task.evidenceRefs) && task.evidenceRefs.length === 0) {
    errors.push(`${taskLabel}.status done requires at least one evidenceRefs entry`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validates one secondary audit event. It verifies the pair but never folds the
 * event log back into task status.
 *
 * @param {unknown} candidate
 * @returns {{ok:boolean,errors:string[]}}
 */
export function validateTaskEvent(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, errors: ['event must be an object'] };
  }
  const event = candidate;
  const eventLabel = isNonEmptyString(event.id) ? event.id : '(missing event id)';
  const errors = [];
  for (const fieldName of Object.keys(event)) {
    if (!EVENT_FIELDS.has(fieldName)) errors.push(`${eventLabel} contains unsupported field "${fieldName}"`);
  }
  if (!isNonEmptyString(event.id)) errors.push('event.id must be a non-empty string');
  if (event.type !== TASK_EVENT_TYPE) errors.push(`${eventLabel}.type must be ${TASK_EVENT_TYPE}`);
  if (!isNonEmptyString(event.taskId)) errors.push(`${eventLabel}.taskId must be a non-empty string`);
  if (!TASK_STATUSES.includes(event.from)) errors.push(`${eventLabel}.from is invalid`);
  if (!TASK_STATUSES.includes(event.to)) errors.push(`${eventLabel}.to is invalid`);
  if (TASK_STATUSES.includes(event.from) && TASK_STATUSES.includes(event.to)
      && !isLegalTaskTransition(event.from, event.to)) {
    errors.push(`${eventLabel} records an illegal transition ${event.from} -> ${event.to}`);
  }
  if (!isNonEmptyString(event.actor)) errors.push(`${eventLabel}.actor must be a non-empty string`);
  if (!isIsoTimestamp(event.at)) errors.push(`${eventLabel}.at must be an ISO-8601 timestamp`);
  if (!Number.isInteger(event.revision) || event.revision < 1) {
    errors.push(`${eventLabel}.revision must be a positive integer`);
  }
  errors.push(...validateStringArray(event.evidenceRefs, `${eventLabel}.evidenceRefs`));
  errors.push(...validateStringArray(event.reportRefs, `${eventLabel}.reportRefs`));
  if (event.note !== undefined && !isNonEmptyString(event.note)) {
    errors.push(`${eventLabel}.note must be a non-empty string when present`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validates the complete `pipeline/tasks.json` authority document.
 *
 * @param {unknown} candidate
 * @returns {{ok:boolean,errors:string[]}}
 */
export function validateTasksDocument(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, errors: ['tasks.json must be an object'] };
  }
  const document = candidate;
  const errors = [];
  for (const fieldName of Object.keys(document)) {
    if (!DOCUMENT_FIELDS.has(fieldName)) errors.push(`tasks.json contains unsupported field "${fieldName}"`);
  }
  if (document.schemaVersion !== TASKS_SCHEMA_VERSION) {
    errors.push(`tasks.json.schemaVersion must be ${TASKS_SCHEMA_VERSION}`);
  }
  if (!isNonEmptyString(document.scopeRef)) errors.push('tasks.json.scopeRef must be a non-empty string');
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    errors.push('tasks.json.revision must be a non-negative integer');
  }
  if (!Array.isArray(document.tasks)) {
    errors.push('tasks.json.tasks must be an array');
  }
  if (!Array.isArray(document.events)) {
    errors.push('tasks.json.events must be an array');
  }

  const taskIds = new Set();
  if (Array.isArray(document.tasks)) {
    for (const task of document.tasks) {
      const taskValidation = validateTaskRecord(task);
      errors.push(...taskValidation.errors);
      if (isNonEmptyString(task?.id)) {
        if (taskIds.has(task.id)) errors.push(`duplicate task id "${task.id}"`);
        taskIds.add(task.id);
      }
    }
    for (const task of document.tasks) {
      if (!Array.isArray(task?.dependsOn)) continue;
      for (const dependencyId of task.dependsOn) {
        if (dependencyId === task.id) errors.push(`${task.id}.dependsOn cannot reference itself`);
        else if (!taskIds.has(dependencyId)) errors.push(`${task.id}.dependsOn references unknown task "${dependencyId}"`);
      }
    }
  }

  const eventIds = new Set();
  if (Array.isArray(document.events)) {
    for (const event of document.events) {
      const eventValidation = validateTaskEvent(event);
      errors.push(...eventValidation.errors);
      if (isNonEmptyString(event?.id)) {
        if (eventIds.has(event.id)) errors.push(`duplicate event id "${event.id}"`);
        eventIds.add(event.id);
      }
      if (isNonEmptyString(event?.taskId) && !taskIds.has(event.taskId)) {
        errors.push(`${event.id ?? '(missing event id)'}.taskId references unknown task "${event.taskId}"`);
      }
      if (Number.isInteger(event?.revision) && Number.isInteger(document.revision)
          && event.revision > document.revision) {
        errors.push(`${event.id ?? '(missing event id)'}.revision exceeds document revision`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Refuses an invalid task authority at every I/O boundary.
 *
 * @param {unknown} document
 * @returns {object}
 * @throws {TypeError} when any schema invariant fails
 */
export function assertTasksDocument(document) {
  const validation = validateTasksDocument(document);
  if (!validation.ok) {
    throw new TypeError(`tasks.json is invalid:\n- ${validation.errors.join('\n- ')}`);
  }
  return document;
}

export const validateTask = validateTaskRecord;
export const validateTasksDoc = validateTasksDocument;
export const assertTasksDoc = assertTasksDocument;
