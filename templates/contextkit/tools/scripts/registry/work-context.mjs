/**
 * Work Context Registry generator (BIZ-0001 / WF-0036, A1-T3).
 *
 * Scans the canonical Business and Operation roots and emits a generated,
 * rebuildable, sorted index of every `BIZ-####` ∪ `OP-####` work context:
 * `{ id, path, type, status, title }`. It is an INDEX, never primary state
 * (source-of-truth-policy §"Indexes"); never hand-edited. Rebuild from disk is
 * byte-idempotent via `serialize.mjs`.
 *
 * Defensive: a missing root yields an empty section (never throws); an unreadable
 * or invalid context json is indexed with null status/title rather than dropped,
 * so the registry still reflects the folder's existence.
 *
 * Pure `node:*` + the shared work validators; zero runtime dependencies.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { stripBom } from '../../../runtime/work/enums.mjs';
import { BUSINESS_ID_PATTERN } from '../../../runtime/work/schema-business.mjs';
import { OPERATION_ID_PATTERN } from '../../../runtime/work/schema-operation.mjs';
import { serializeRegistry } from './serialize.mjs';
import { writeFileAtomicSync } from '../../../runtime/hooks/safe-io.mjs';

/** Schema version of the emitted work-context-registry.json. */
export const WORK_CONTEXT_REGISTRY_VERSION = 1;

/** Leading `BIZ-####` / `OP-####` of a context folder name, or null. */
function folderId(name) {
  const match = name.match(/^((?:BIZ|OP)-\d{4})-/);
  return match ? match[1] : null;
}

/** Child dir names under `dir`, excluding templates; [] when `dir` is absent. */
function contextFolders(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_TEMPLATE')
    .map((entry) => entry.name);
}

/** Reads `{ status, title }` from a context json, or nulls when unreadable. */
function readContextMeta(jsonPath) {
  if (!existsSync(jsonPath)) return { status: null, title: null };
  try {
    const parsed = JSON.parse(stripBom(readFileSync(jsonPath, 'utf-8')));
    return { status: parsed.status ?? null, title: parsed.title ?? null };
  } catch {
    return { status: null, title: null };
  }
}

/**
 * Indexes one context root into sorted `{ id, path, type, status, title }` rows.
 *
 * @param {string} rootDir - absolute path of the business/ or operations/ root.
 * @param {string} memoryDir - absolute memory root (to make paths relative).
 * @param {RegExp} idPattern - the id validity pattern for this type.
 * @param {"business"|"operation"} type - the work-context type tag.
 * @param {string} jsonName - the canonical json file name in each folder.
 * @returns {Array<object>} index rows for this root, sorted by id.
 */
function indexRoot(rootDir, memoryDir, idPattern, type, jsonName) {
  const rows = [];
  for (const folder of contextFolders(rootDir)) {
    const id = folderId(folder);
    if (!id || !idPattern.test(id)) continue;
    const relPath = resolve(rootDir, folder).slice(memoryDir.length + 1).split('\\').join('/');
    const meta = readContextMeta(resolve(rootDir, folder, jsonName));
    rows.push({ id, path: relPath, type, status: meta.status, title: meta.title });
  }
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Builds the work-context registry payload (Business ∪ Operation), sorted by id.
 * Pure: scans disk, returns the object, writes nothing.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {object} the registry payload `{ schemaVersion, generator, contexts }`.
 */
export function buildWorkContextRegistry(root = process.cwd()) {
  const paths = pathsFor(root);
  const contexts = [
    ...indexRoot(paths.business, paths.memory, BUSINESS_ID_PATTERN, 'business', 'business.json'),
    ...indexRoot(paths.operations, paths.memory, OPERATION_ID_PATTERN, 'operation', 'operation.json'),
  ].sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: WORK_CONTEXT_REGISTRY_VERSION,
    generator: 'registry/work-context.mjs',
    contexts,
  };
}

/**
 * Generates the registry and atomically writes it to `pathsFor().workContextRegistry`.
 * Returns the canonical bytes written (for idempotency assertions).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the canonical JSON text written.
 */
export function writeWorkContextRegistry(root = process.cwd()) {
  const text = serializeRegistry(buildWorkContextRegistry(root));
  writeFileAtomicSync(pathsFor(root).workContextRegistry, text);
  return text;
}
