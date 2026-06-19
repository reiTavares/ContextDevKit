/**
 * Global ID allocation across every methodology root (BIZ-0001 / WF-0036, A1-T3).
 *
 * Reuses the `workflow-number.mjs` allocator pattern (`nextNumber` over `NNNN-`
 * folders) rather than forking it: `nextWorkflowNumber` delegates to that module
 * for EACH workflow root and takes the global max, so a new WF id never collides
 * with a legacy `NNNN-slug` dir (compatibility-plan §"Dual resolution"). The
 * prefixed allocators (`BIZ-####`, `OP-####`) share one generic scanner here —
 * the legacy `NNNN` regex is owned by `workflow-number.mjs` and not duplicated.
 *
 * Defensive: a missing root contributes 0; allocators never throw on absent dirs.
 * Pure `node:*`, zero runtime dependencies.
 */
import { existsSync, readdirSync } from 'node:fs';
import { nextNumber } from '../workflow-number.mjs';
import { pathsFor } from '../../../runtime/config/paths.mjs';

/** Immediate child directory names of `dir`, or [] when `dir` is absent. */
function childDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_TEMPLATE')
    .map((entry) => entry.name);
}

/**
 * Highest 4-digit number found behind `prefix-` in the folder names under `dir`
 * (e.g. `BIZ-` over `BIZ-0001-foo` → 1). Absent dir or no match → 0.
 *
 * @param {string} dir - directory to scan.
 * @param {string} prefix - id prefix without the trailing dash (e.g. "BIZ").
 * @returns {number} the max number, or 0 when none.
 */
function maxPrefixedNumber(dir, prefix) {
  const pattern = new RegExp(`^${prefix}-(\\d{4})-`);
  let max = 0;
  for (const name of childDirs(dir)) {
    const match = name.match(pattern);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max;
}

/** Formats a prefixed id, e.g. (`BIZ`, 2) → "BIZ-0002". */
function formatId(prefix, number) {
  return `${prefix}-${String(number).padStart(4, '0')}`;
}

/**
 * Next free Business id scanning the business root (`BIZ-0001` → `BIZ-0002`;
 * empty root → `BIZ-0001`).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next `BIZ-####` id.
 */
export function nextBusinessId(root = process.cwd()) {
  return formatId('BIZ', maxPrefixedNumber(pathsFor(root).business, 'BIZ') + 1);
}

/**
 * Next free Operation id scanning the operations root (empty root → `OP-0001`).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next `OP-####` id.
 */
export function nextOperationId(root = process.cwd()) {
  return formatId('OP', maxPrefixedNumber(pathsFor(root).operations, 'OP') + 1);
}

/**
 * Every directory that may hold a `NNNN-slug` (legacy) or `WF-####` workflow:
 * the new top-level workflows root plus per-context `workflows/` subfolders under
 * business/ and operations/. A4 adds duplicate-path detection over this same set.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string[]} absolute paths of every workflow-holding directory.
 */
export function workflowRoots(root = process.cwd()) {
  const paths = pathsFor(root);
  const roots = [resolveWorkflowsTop(paths)];
  for (const contextsRoot of [paths.business, paths.operations]) {
    for (const name of childDirs(contextsRoot)) {
      roots.push(`${contextsRoot}/${name}/workflows`);
    }
  }
  return roots;
}

/** The new top-level `memory/workflows/` directory (also holds legacy dirs). */
function resolveWorkflowsTop(paths) {
  return `${paths.memory}/workflows`;
}

/**
 * Highest `WF-####` number among the folder names under `dir`, or 0. The legacy
 * `NNNN-` parsing stays owned by `workflow-number.mjs#nextNumber`; this only adds
 * the NEW-format prefix (`WF-`) that the legacy allocator does not recognise.
 */
function maxNewWorkflowNumber(dir) {
  return maxPrefixedNumber(dir, 'WF');
}

/**
 * Next free workflow number scanning EVERY workflow root (new + legacy) so a new
 * id never collides. For each root it takes the max of the legacy `NNNN-` count
 * (delegated to `workflow-number.mjs#nextNumber` — reuse, not fork) and the new
 * `WF-####` count, then the global max across roots. Returned value is the bare
 * 4-digit string (e.g. "0038"); WF callers prefix with `WF-`. Empty → "0001".
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next free 4-digit workflow number, zero-padded.
 */
export function nextWorkflowNumber(root = process.cwd()) {
  let globalMax = 0;
  for (const dir of workflowRoots(root)) {
    // nextNumber = legacy max+1; subtract 1 to recover the per-root legacy max.
    const legacyMax = parseInt(nextNumber(dir), 10) - 1;
    globalMax = Math.max(globalMax, legacyMax, maxNewWorkflowNumber(dir));
  }
  return String(globalMax + 1).padStart(4, '0');
}
