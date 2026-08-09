/**
 * Global v4 ID allocation across every canonical methodology root.
 * Legacy names and `done/` placement are migration input only and never enter
 * normal runtime allocation.
 *
 * Defensive: a missing root contributes 0; allocators never throw on absent dirs.
 * Pure `node:*`, zero runtime dependencies.
 */
import { existsSync, readdirSync } from 'node:fs';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { fleetMemoryRoots } from './fleet.mjs';

/** Normalise a path to forward slashes (Windows/git spellings, fs-safe). */
const norm = (value) => String(value).replace(/\\/g, '/');

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
 * Highest prefixed number for a memory subdir (e.g. "business") across a set of
 * memory roots. The fleet-aware allocators pass every worktree's memory root so
 * the result is the global max — never a per-worktree local max (ADR-0119).
 *
 * @param {string[]} memoryRoots - absolute `memory/` directories.
 * @param {string} subdir - child of each memory root (e.g. "business").
 * @param {string} prefix - id prefix without the dash (e.g. "BIZ").
 * @returns {number} the global max, or 0.
 */
function maxPrefixedOver(memoryRoots, subdir, prefix) {
  let max = 0;
  for (const memory of memoryRoots) {
    max = Math.max(max, maxPrefixedNumber(`${memory}/${subdir}`, prefix));
  }
  return max;
}

/**
 * Next free Business id, reconciled across the whole worktree fleet so two
 * parallel sessions never allocate the same `BIZ-####` (empty fleet → `BIZ-0001`).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next `BIZ-####` id.
 */
export function nextBusinessId(root = process.cwd()) {
  return formatId('BIZ', maxPrefixedOver(fleetMemoryRoots(root), 'business', 'BIZ') + 1);
}

/**
 * Next free Operation id, reconciled across the whole worktree fleet
 * (empty fleet → `OP-0001`).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next `OP-####` id.
 */
export function nextOperationId(root = process.cwd()) {
  return formatId('OP', maxPrefixedOver(fleetMemoryRoots(root), 'operations', 'OP') + 1);
}

/**
 * Every canonical directory that may hold a `WF-####` workflow under one memory
 * root. Workflow status never changes these paths.
 *
 * @param {string} memory - an absolute `memory/` directory.
 * @returns {string[]} absolute paths of every workflow-holding directory.
 */
function workflowDirsUnder(memory) {
  const dirs = [`${memory}/workflows`];
  for (const contextsRoot of [`${memory}/business`, `${memory}/operations`]) {
    for (const name of childDirs(contextsRoot)) {
      dirs.push(`${contextsRoot}/${name}/workflows`);
    }
  }
  return dirs;
}

/**
 * Every canonical workflow-holding directory under the local project root.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string[]} absolute paths of every workflow-holding directory.
 */
export function workflowRoots(root = process.cwd()) {
  return workflowDirsUnder(pathsFor(root).memory);
}

/**
 * Highest workflow number behind `WF-` in one canonical directory, or 0.
 */
function maxWorkflowInDir(dir) {
  return maxPrefixedNumber(dir, 'WF');
}

/** Highest workflow number across a set of canonical memory roots. */
function maxWorkflowOver(memoryRoots) {
  let max = 0;
  for (const memory of memoryRoots) {
    for (const dir of workflowDirsUnder(memory)) {
      max = Math.max(max, maxWorkflowInDir(dir));
    }
  }
  return max;
}

/**
 * Next free workflow number, reconciled across the whole worktree fleet so a new
 * id never collides with a parallel session's canonical package. Returned value
 * is the bare 4-digit string (e.g. "0038"); WF callers prefix with `WF-`.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next free 4-digit workflow number, zero-padded.
 */
export function nextWorkflowNumber(root = process.cwd()) {
  return String(maxWorkflowOver(fleetMemoryRoots(root)) + 1).padStart(4, '0');
}

/**
 * Highest ADR number among `ADR-NNNN-*.md` (canonical), `NNNN-*.md` / `NNNN.md`
 * (legacy) files in one decisions dir, or 0. ADRs are files (not dirs), and may
 * live under `decisions/` or its `business/`, `operations/`, `legacy/` subtrees.
 */
function maxAdrInDir(dir) {
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(?:ADR-)?(\d{4})[-.]/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max;
}

/** Highest ADR number across a set of memory roots (decisions + subtrees). */
function maxAdrOver(memoryRoots) {
  let max = 0;
  for (const memory of memoryRoots) {
    for (const sub of ['decisions', 'decisions/business', 'decisions/operations', 'decisions/legacy']) {
      max = Math.max(max, maxAdrInDir(`${memory}/${sub}`));
    }
  }
  return max;
}

/**
 * Next free ADR number, reconciled across the whole worktree fleet so two parallel
 * sessions never allocate the same `NNNN` (the exact failure ADR-0118 records for
 * 0116/0117). Returned bare 4-digit string; callers prefix with `ADR-`.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next free 4-digit ADR number, zero-padded.
 */
export function nextAdrNumber(root = process.cwd()) {
  return String(maxAdrOver(fleetMemoryRoots(root)) + 1).padStart(4, '0');
}

/**
 * Diffs the LOCAL-only next id against the FLEET-reconciled next id for every kind
 * (BIZ / OP / WF / ADR). The advisory collision gate (`intake-collision-gate.mjs`)
 * renders this: when `diverges` is true, a parallel worktree already holds a higher
 * number and a local-only allocation would collide on merge.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {{kind:string, local:string, fleet:string, diverges:boolean}[]}
 */
export function localVsFleet(root = process.cwd()) {
  const localRoots = [norm(pathsFor(root).memory)];
  const fleetRoots = fleetMemoryRoots(root);
  const pad = (number) => String(number).padStart(4, '0');
  const row = (kind, localMax, fleetMax, format) => ({
    kind,
    local: format(localMax + 1),
    fleet: format(fleetMax + 1),
    diverges: fleetMax > localMax,
  });
  return [
    row('BIZ', maxPrefixedOver(localRoots, 'business', 'BIZ'), maxPrefixedOver(fleetRoots, 'business', 'BIZ'), (n) => formatId('BIZ', n)),
    row('OP', maxPrefixedOver(localRoots, 'operations', 'OP'), maxPrefixedOver(fleetRoots, 'operations', 'OP'), (n) => formatId('OP', n)),
    row('WF', maxWorkflowOver(localRoots), maxWorkflowOver(fleetRoots), (n) => `WF-${pad(n)}`),
    row('ADR', maxAdrOver(localRoots), maxAdrOver(fleetRoots), (n) => `ADR-${pad(n)}`),
  ];
}

/**
 * Allocates the next free workflow id as a formatted `WF-####` string by scanning
 * every canonical workflow root in the worktree fleet.
 *
 * This is the public allocator that callers (CLI, orchestrator) should use for new
 * workflow creation; it wraps `nextWorkflowNumber` to always return the complete
 * prefixed form. The seam contract is frozen by the A4-T1 interface specification
 * (BIZ-0001 / WF-0036 spec §A4).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the next free `WF-####` id, e.g. `"WF-0038"`.
 */
export function allocateWorkflowId(root = process.cwd()) {
  return `WF-${nextWorkflowNumber(root)}`;
}
