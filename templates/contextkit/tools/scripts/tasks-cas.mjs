/** Cross-process CAS and same-volume atomic replacement for `tasks.json`. */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export class TasksCasConflictError extends Error {
  /** @param {number} expectedRevision @param {number} actualRevision */
  constructor(expectedRevision, actualRevision) {
    super(`tasks CAS conflict: expected revision ${expectedRevision}, found ${actualRevision}`);
    this.name = 'TasksCasConflictError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class TasksStoreLockedError extends Error {
  /** @param {string} lockPath */
  constructor(lockPath) {
    super(`tasks store is locked by another writer: ${lockPath}`);
    this.name = 'TasksStoreLockedError';
    this.lockPath = lockPath;
  }
}

export const CasConflict = TasksCasConflictError;

/**
 * Refuses a stale caller before any mutation is written.
 *
 * @param {number} actualRevision
 * @param {number} expectedRevision
 * @returns {void}
 * @throws {TasksCasConflictError}
 */
export function assertExpectedRevision(actualRevision, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError('expectedRevision must be a non-negative integer');
  }
  if (actualRevision !== expectedRevision) {
    throw new TasksCasConflictError(expectedRevision, actualRevision);
  }
}

export const casGuard = assertExpectedRevision;

/**
 * Serializes all cooperating writers with an atomic sibling lock directory.
 * A process crash leaves an explicit lock for doctor/recovery instead of
 * silently permitting a possible split-brain writer.
 *
 * @template T
 * @param {string} filePath
 * @param {(lockPath:string)=>T} operation
 * @returns {T}
 * @throws {TasksStoreLockedError} when another writer owns the lock
 */
export function withTasksFileLock(filePath, operation) {
  const absolutePath = resolve(filePath);
  const lockPath = `${absolutePath}.lock`;
  mkdirSync(dirname(absolutePath), { recursive: true });
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new TasksStoreLockedError(lockPath);
    throw error;
  }
  try {
    writeFileSync(`${lockPath}/owner.json`, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, 'utf8');
    return operation(lockPath);
  } finally {
    try { unlinkSync(`${lockPath}/owner.json`); } catch { /* lock owner marker may be absent */ }
    rmdirSync(lockPath);
  }
}

/**
 * Atomically replaces a file through a flushed temp sibling and rename.
 *
 * @param {string} filePath
 * @param {string} contents
 * @param {{beforeRename?: (tempPath:string,targetPath:string)=>void}} [options]
 * @returns {void}
 */
export function replaceFileAtomic(filePath, contents, options = {}) {
  const absolutePath = resolve(filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let fileDescriptor = null;
  try {
    fileDescriptor = openSync(tempPath, 'wx');
    writeFileSync(fileDescriptor, contents, 'utf8');
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = null;
    options.beforeRename?.(tempPath, absolutePath);
    renameSync(tempPath, absolutePath);
  } catch (error) {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    try { unlinkSync(tempPath); } catch { /* temp may already be renamed */ }
    throw error;
  }
}

/**
 * Reads only the revision for an already locked CAS commit.
 *
 * @param {string} filePath
 * @returns {number|null} null when the file does not exist
 * @throws {SyntaxError} when JSON is corrupt
 */
export function readStoredRevision(filePath) {
  if (!existsSync(filePath)) return null;
  const parsedDocument = JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  if (!Number.isInteger(parsedDocument?.revision) || parsedDocument.revision < 0) {
    throw new SyntaxError('tasks.json revision is missing or invalid');
  }
  return parsedDocument.revision;
}
