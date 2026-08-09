/**
 * The single transactional writer for canonical ContextDevKit 4 task state.
 *
 * Every mutation is serialized by a sibling lock, guarded by revision CAS,
 * validated before I/O, and committed through same-volume temp plus rename.
 * Markdown is regenerated only after the JSON commit; projection failure is
 * reported and repairable without rolling back or rewriting the authority.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  TasksCasConflictError,
  assertExpectedRevision,
  replaceFileAtomic,
  withTasksFileLock,
} from './tasks-cas.mjs';
import { createTaskRecord } from './tasks-schema.mjs';
import { listTasks as listDerivedTasks } from './tasks-derive.mjs';
import { planTaskTransition } from './tasks-transition.mjs';
import { assertTasksDocument } from './tasks-validate.mjs';
import { renderTasksMarkdown } from './tasks-render.mjs';

export class TasksStoreNotFoundError extends Error {
  /** @param {string} filePath */
  constructor(filePath) {
    super(`canonical task store not found: ${filePath}`);
    this.name = 'TasksStoreNotFoundError';
    this.filePath = filePath;
  }
}

export class TasksStoreCorruptError extends Error {
  /** @param {string} filePath @param {unknown} cause */
  constructor(filePath, cause) {
    super(`canonical task store is corrupt: ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'TasksStoreCorruptError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

/**
 * Resolves a workflow root or an explicit `tasks.json` path without lane reads.
 * Batch callers whose tasks file is at the batch root pass the explicit path.
 *
 * @param {string} scopeRootOrTasksPath
 * @returns {string}
 */
export function resolveTasksDocumentPath(scopeRootOrTasksPath) {
  if (typeof scopeRootOrTasksPath !== 'string' || scopeRootOrTasksPath.trim() === '') {
    throw new TypeError('task store path must be a non-empty string');
  }
  const absoluteInput = resolve(scopeRootOrTasksPath);
  if (basename(absoluteInput).toLowerCase() === 'tasks.json') return absoluteInput;
  return resolve(absoluteInput, 'pipeline', 'tasks.json');
}

/**
 * Ensures a derived path remains inside its canonical parent.
 *
 * @param {string} parentPath
 * @param {string} childPath
 * @returns {string}
 */
function assertContainedPath(parentPath, childPath) {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) return resolve(childPath);
  throw new Error(`derived task path escapes its canonical parent: ${childPath}`);
}

/**
 * Parses and validates a canonical task document. Missing and corrupt stores are
 * deliberately distinct; neither silently becomes an empty board.
 *
 * @param {string} scopeRootOrTasksPath
 * @returns {object}
 * @throws {TasksStoreNotFoundError|TasksStoreCorruptError}
 */
export function readTasksDocument(scopeRootOrTasksPath) {
  const tasksPath = resolveTasksDocumentPath(scopeRootOrTasksPath);
  if (!existsSync(tasksPath)) throw new TasksStoreNotFoundError(tasksPath);
  try {
    const document = JSON.parse(readFileSync(tasksPath, 'utf8').replace(/^\uFEFF/, ''));
    return assertTasksDocument(document);
  } catch (error) {
    if (error instanceof TasksStoreNotFoundError) throw error;
    throw new TasksStoreCorruptError(tasksPath, error);
  }
}

/**
 * Non-throwing read surface for dashboards and statuslines.
 *
 * @param {string} scopeRootOrTasksPath
 * @returns {{ok:true,document:object,path:string}|{ok:false,error:Error,path:string}}
 */
export function tryReadTasksDocument(scopeRootOrTasksPath) {
  let tasksPath = String(scopeRootOrTasksPath ?? '');
  try {
    tasksPath = resolveTasksDocumentPath(scopeRootOrTasksPath);
    return { ok: true, document: readTasksDocument(tasksPath), path: tasksPath };
  } catch (error) {
    return { ok: false, error, path: tasksPath };
  }
}

/** @param {object} document @returns {string} */
function serializeTasksDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Low-level validated atomic commit for creation, migration, and prepared CAS
 * mutations. Existing stores always require `expectedRevision` and a +1 revision.
 *
 * @param {string} scopeRootOrTasksPath
 * @param {object} document
 * @param {{expectedRevision?:number,beforeRename?:(tempPath:string,targetPath:string)=>void}} [options]
 * @returns {{document:object,path:string,revision:number}}
 */
export function writeTasksDocumentAtomic(scopeRootOrTasksPath, document, options = {}) {
  const tasksPath = resolveTasksDocumentPath(scopeRootOrTasksPath);
  assertTasksDocument(document);
  return withTasksFileLock(tasksPath, () => {
    const storedRevision = existsSync(tasksPath) ? readTasksDocument(tasksPath).revision : null;
    if (storedRevision === null) {
      if (options.expectedRevision !== undefined) {
        throw new TasksCasConflictError(options.expectedRevision, -1);
      }
      if (document.revision !== 0) {
        throw new Error('new tasks.json must start at revision 0');
      }
    } else {
      if (options.expectedRevision === undefined) {
        throw new TypeError('expectedRevision is required when replacing an existing tasks.json');
      }
      assertExpectedRevision(storedRevision, options.expectedRevision);
      if (document.revision !== storedRevision + 1) {
        throw new Error(`next tasks.json revision must be ${storedRevision + 1}`);
      }
    }
    replaceFileAtomic(tasksPath, serializeTasksDocument(document), { beforeRename: options.beforeRename });
    return { document, path: tasksPath, revision: document.revision };
  });
}

/**
 * Writes or repairs `tasks.md` from JSON without mutating JSON in return.
 *
 * @param {string} scopeRootOrTasksPath
 * @param {{beforeRename?:(tempPath:string,targetPath:string)=>void}} [options]
 * @returns {{path:string,revision:number,status:'written'}}
 */
export function repairTasksProjection(scopeRootOrTasksPath, options = {}) {
  const tasksPath = resolveTasksDocumentPath(scopeRootOrTasksPath);
  return withTasksFileLock(tasksPath, () => {
    const document = readTasksDocument(tasksPath);
    const projectionPath = assertContainedPath(dirname(tasksPath), resolve(dirname(tasksPath), 'tasks.md'));
    replaceFileAtomic(projectionPath, renderTasksMarkdown(document), { beforeRename: options.beforeRename });
    return { path: projectionPath, revision: document.revision, status: 'written' };
  });
}

/**
 * Regenerates the projection after a canonical commit and reports failure
 * honestly while preserving the successful JSON mutation.
 *
 * @param {string} tasksPath
 * @param {object} document
 * @param {{projectionWriter?:(path:string,markdown:string)=>void}} [options]
 * @returns {{status:'written'|'failed',path:string,error?:Error}}
 */
function projectCommittedDocument(tasksPath, document, options = {}) {
  const projectionPath = assertContainedPath(dirname(tasksPath), resolve(dirname(tasksPath), 'tasks.md'));
  try {
    const markdown = renderTasksMarkdown(document);
    if (options.projectionWriter) options.projectionWriter(projectionPath, markdown);
    else replaceFileAtomic(projectionPath, markdown);
    return { status: 'written', path: projectionPath };
  } catch (error) {
    return { status: 'failed', path: projectionPath, error };
  }
}

/**
 * Runs one read-plan-CAS-write transaction under the unique writer lock.
 *
 * @param {string} tasksPath
 * @param {number} expectedRevision
 * @param {(document:object)=>{document:object,[key:string]:unknown}} planner
 * @param {{beforeCanonicalRename?:(tempPath:string,targetPath:string)=>void}} [options]
 * @returns {object}
 */
function transactTasksDocument(tasksPath, expectedRevision, planner, options = {}) {
  return withTasksFileLock(tasksPath, () => {
    const currentDocument = readTasksDocument(tasksPath);
    assertExpectedRevision(currentDocument.revision, expectedRevision);
    const plannedMutation = planner(currentDocument);
    if (plannedMutation.document === currentDocument) {
      const projection = projectCommittedDocument(tasksPath, currentDocument, options);
      return { ...plannedMutation, projection };
    }
    if (plannedMutation.document.revision !== currentDocument.revision + 1) {
      throw new Error('task mutation must advance revision exactly once');
    }
    assertTasksDocument(plannedMutation.document);
    replaceFileAtomic(tasksPath, serializeTasksDocument(plannedMutation.document), {
      beforeRename: options.beforeCanonicalRename,
    });
    const projection = projectCommittedDocument(tasksPath, plannedMutation.document, options);
    return { ...plannedMutation, projection };
  });
}

/**
 * Adds one complete task through the canonical CAS writer.
 *
 * @param {string} scopeRootOrTasksPath
 * @param {object} taskInput
 * @param {number} expectedRevision
 * @param {{now?:string,beforeCanonicalRename?:Function,projectionWriter?:Function}} [options]
 * @returns {object}
 */
export function addTask(scopeRootOrTasksPath, taskInput, expectedRevision, options = {}) {
  const tasksPath = resolveTasksDocumentPath(scopeRootOrTasksPath);
  const committedMutation = transactTasksDocument(tasksPath, expectedRevision, (currentDocument) => {
    const task = createTaskRecord(taskInput, { now: options.now });
    if (currentDocument.tasks.some((existingTask) => existingTask.id === task.id)) {
      throw new Error(`addTask: duplicate task id "${task.id}"`);
    }
    const nextDocument = {
      ...currentDocument,
      revision: currentDocument.revision + 1,
      tasks: [...currentDocument.tasks, task],
    };
    return { document: nextDocument, task, event: null, idempotent: false };
  }, options);
  return { ...committedMutation, revision: committedMutation.document.revision, path: tasksPath };
}

/**
 * Transitions task status with status/event pairing in one atomic JSON commit.
 * A previously committed `eventId` returns idempotently even when the caller's
 * expected revision is stale.
 *
 * @param {string} scopeRootOrTasksPath
 * @param {string} taskId
 * @param {object} transition
 * @param {number} expectedRevision
 * @param {{beforeCanonicalRename?:Function,projectionWriter?:Function}} [options]
 * @returns {object}
 */
export function transitionTask(scopeRootOrTasksPath, taskId, transition, expectedRevision, options = {}) {
  const tasksPath = resolveTasksDocumentPath(scopeRootOrTasksPath);
  let committedMutation;
  try {
    committedMutation = transactTasksDocument(
      tasksPath,
      expectedRevision,
      (currentDocument) => planTaskTransition(currentDocument, taskId, transition),
      options,
    );
  } catch (error) {
    if (!(error instanceof TasksCasConflictError) || typeof transition?.eventId !== 'string') throw error;
    committedMutation = withTasksFileLock(tasksPath, () => {
      const currentDocument = readTasksDocument(tasksPath);
      const idempotentMutation = planTaskTransition(currentDocument, taskId, transition);
      if (!idempotentMutation.idempotent) throw error;
      const projection = projectCommittedDocument(tasksPath, currentDocument, options);
      return { ...idempotentMutation, projection };
    });
  }
  return { ...committedMutation, revision: committedMutation.document.revision, path: tasksPath };
}

/** Pure list/filter convenience for CLI and read-only consumers. */
export const listTasks = listDerivedTasks;
