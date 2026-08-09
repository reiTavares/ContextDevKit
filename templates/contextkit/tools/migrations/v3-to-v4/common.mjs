import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';

export class MigrationRefusedError extends Error {
  /** @param {string} message @param {string} [code] */
  constructor(message, code = 'MIGRATION_REFUSED') {
    super(message);
    this.name = 'MigrationRefusedError';
    this.code = code;
  }
}

/** @param {unknown} value @returns {string} */
export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** @param {string|Buffer} value @returns {string} */
export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** @param {string} filePath @returns {unknown} */
export function readJson(filePath) {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

/** @param {string} value @returns {string} */
export function toPortablePath(value) {
  return value.split(sep).join('/');
}

/**
 * Resolve a path below a trusted root without allowing absolute paths, traversal,
 * or an existing symbolic-link/junction hop.
 *
 * @param {string} trustedRoot
 * @param {string} relativePath
 * @param {{ allowMissingLeaf?: boolean }} [options]
 * @returns {string}
 * @throws {MigrationRefusedError}
 */
export function resolveContainedPath(trustedRoot, relativePath, options = {}) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '' || isAbsolute(relativePath)) {
    throw new MigrationRefusedError('path must be a non-empty relative path', 'PATH_NOT_RELATIVE');
  }
  const resolvedRoot = resolve(trustedRoot);
  const candidate = resolve(resolvedRoot, relativePath);
  const traversal = relative(resolvedRoot, candidate);
  if (traversal === '..' || traversal.startsWith(`..${sep}`) || isAbsolute(traversal)) {
    throw new MigrationRefusedError(`path escapes migration root: ${relativePath}`, 'PATH_ESCAPE');
  }
  assertNoReparseHop(resolvedRoot, candidate, options.allowMissingLeaf !== false);
  return candidate;
}

/**
 * Reject symbolic links and Windows junctions in every existing path component.
 * `lstat().isSymbolicLink()` reports junctions as symbolic links in Node.
 *
 * @param {string} trustedRoot
 * @param {string} candidate
 * @param {boolean} allowMissingLeaf
 * @returns {void}
 * @throws {MigrationRefusedError}
 */
export function assertNoReparseHop(trustedRoot, candidate, allowMissingLeaf = true) {
  const resolvedRoot = resolve(trustedRoot);
  const resolvedCandidate = resolve(candidate);
  const traversal = relative(resolvedRoot, resolvedCandidate);
  if (traversal === '..' || traversal.startsWith(`..${sep}`) || isAbsolute(traversal)) {
    throw new MigrationRefusedError(`path escapes trusted root: ${resolvedCandidate}`, 'PATH_ESCAPE');
  }

  const rootStat = lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink()) {
    throw new MigrationRefusedError(`trusted root is a reparse link: ${resolvedRoot}`, 'REPARSE_POINT');
  }
  const components = traversal === '' ? [] : traversal.split(sep);
  let cursor = resolvedRoot;
  for (let index = 0; index < components.length; index += 1) {
    cursor = resolve(cursor, components[index]);
    if (!existsSync(cursor)) {
      if (allowMissingLeaf) return;
      throw new MigrationRefusedError(`required path does not exist: ${cursor}`, 'PATH_MISSING');
    }
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new MigrationRefusedError(`reparse path is not allowed: ${cursor}`, 'REPARSE_POINT');
    }
  }

  const canonicalRoot = realpathSync.native(resolvedRoot);
  const canonicalCandidate = existsSync(resolvedCandidate)
    ? realpathSync.native(resolvedCandidate)
    : realpathSync.native(dirname(resolvedCandidate));
  const canonicalTraversal = relative(canonicalRoot, canonicalCandidate);
  if (canonicalTraversal === '..' || canonicalTraversal.startsWith(`..${sep}`) || isAbsolute(canonicalTraversal)) {
    throw new MigrationRefusedError(`real path escapes trusted root: ${resolvedCandidate}`, 'REALPATH_ESCAPE');
  }
}

/** @param {string} leftPath @param {string} rightPath @returns {void} */
export function assertSameVolume(leftPath, rightPath) {
  const leftRoot = parse(resolve(leftPath)).root.toLowerCase();
  const rightRoot = parse(resolve(rightPath)).root.toLowerCase();
  if (leftRoot !== rightRoot) {
    throw new MigrationRefusedError(
      `atomic rename requires one volume (${leftRoot} != ${rightRoot})`,
      'CROSS_VOLUME_WRITE',
    );
  }
}

/**
 * Write one file with an exclusive sibling temp and rename. The optional hook is
 * used only by failure-injection tests.
 *
 * @param {string} filePath
 * @param {string|Buffer} contents
 * @param {{ beforeRename?: (tempPath: string, filePath: string) => void }} [hooks]
 * @returns {void}
 */
export function atomicWriteFile(filePath, contents, hooks = {}) {
  const parent = dirname(filePath);
  mkdirSync(parent, { recursive: true });
  assertNoReparseHop(parent, parent, false);
  const nonce = `${process.pid}-${createHash('sha256').update(`${filePath}:${String(contents).length}`).digest('hex').slice(0, 12)}`;
  const temporaryPath = resolve(parent, `.${parse(filePath).base}.${nonce}.tmp`);
  assertSameVolume(temporaryPath, filePath);
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, contents);
    closeSync(descriptor);
    descriptor = undefined;
    hooks.beforeRename?.(temporaryPath, filePath);
    renameSync(temporaryPath, filePath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

/** @param {Record<string, string>} files @returns {string} */
export function digestFiles(files) {
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  return sha256(entries.map(([path, contents]) => `${path}\u001f${sha256(contents)}`).join('\u001e'));
}
