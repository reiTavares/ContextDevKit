/**
 * Ownership engine — pure path/lane validation for the wave-based workflow.
 *
 * A task declares ownership lanes (`allowedPaths`, `forbiddenPaths`,
 * `readOnlyPaths`, `sharedPaths`, `integrationOwner`). This module prevents
 * parallel agents from writing the same file and enforces that shared
 * orchestration files are touched by the orchestrator alone (ADR-0100 §8).
 *
 * Glob matching lives in `./glob.mjs` (the matched responsibility seam). This
 * module stays no-I/O, no-clock, deterministic, and default-refuse: an
 * ambiguous overlap is REPORTED (false-positive over silent collision).
 */
import { matchesGlob, normalize, globsCanOverlap } from './glob.mjs';

// Re-exported so consumers importing the matcher from the ownership surface
// (the integration test, callers) keep a stable public API.
export { matchesGlob };

/**
 * Profiles for which an `agent`-mode task MUST declare `allowedPaths`.
 * @type {ReadonlySet<string>}
 */
const OWNERSHIP_REQUIRED_PROFILES = new Set(['standard', 'advanced', 'program']);

/**
 * Default orchestrator-only shared files: the CLI entrypoint, central test
 * registration, and shared package surfaces (ADR-0100 §8). A documented default,
 * overridable via `orchestratorOwned`'s `sharedRegistry` argument.
 * @type {ReadonlyArray<string>}
 */
export const DEFAULT_ORCHESTRATOR_SHARED = Object.freeze([
  'templates/contextkit/tools/scripts/workflow.mjs',
  'tools/test-suites.mjs',
  'package.json',
  'package-lock.json',
]);

/**
 * Whether two ALLOWED-path glob SETS can match a common path. Conservative:
 * any pair across the two sets that {@link globsCanOverlap} ⇒ the sets overlap.
 * @param {string[]} globsA first allowed-path set
 * @param {string[]} globsB second allowed-path set
 * @returns {boolean} true when a write/write collision is possible
 */
export function pathsOverlap(globsA, globsB) {
  const setA = Array.isArray(globsA) ? globsA : [];
  const setB = Array.isArray(globsB) ? globsB : [];
  for (const left of setA) {
    for (const right of setB) {
      if (globsCanOverlap(left, right)) return true;
    }
  }
  return false;
}

/**
 * Read a task's ownership block defensively.
 * @param {object} task a `{ id, ownership, execution }` task
 * @returns {{allowedPaths:string[],forbiddenPaths:string[],readOnlyPaths:string[],sharedPaths:string[],integrationOwner:(string|null)}}
 */
function ownershipOf(task) {
  const own = (task && task.ownership) || {};
  return {
    allowedPaths: Array.isArray(own.allowedPaths) ? own.allowedPaths : [],
    forbiddenPaths: Array.isArray(own.forbiddenPaths) ? own.forbiddenPaths : [],
    readOnlyPaths: Array.isArray(own.readOnlyPaths) ? own.readOnlyPaths : [],
    sharedPaths: Array.isArray(own.sharedPaths) ? own.sharedPaths : [],
    integrationOwner: own.integrationOwner ?? null,
  };
}

/**
 * Whether a task runs in `agent` mode (the only mode that gets agent slots).
 * @param {object} task a workflow task
 * @returns {boolean}
 */
function isAgentTask(task) {
  return Boolean(task && task.execution && task.execution.mode === 'agent');
}

/**
 * Detect ownership collisions across a set of tasks. Reports:
 *  - two AGENT tasks whose `allowedPaths` overlap (write/write collision);
 *  - a `sharedPaths` entry on any task with no `integrationOwner`.
 *
 * Output is deterministic, sorted by `(taskA, taskB)` then `reason`.
 * @param {Array<{id:string, ownership?:object, execution?:object}>} tasks
 * @returns {Array<{taskA:string, taskB:string, reason:string}>} collisions
 */
export function detectCollisions(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const collisions = [];

  for (let i = 0; i < list.length; i += 1) {
    const own = ownershipOf(list[i]);
    if (own.sharedPaths.length > 0 && !own.integrationOwner) {
      collisions.push({
        taskA: list[i].id,
        taskB: list[i].id,
        reason: `shared path declared without an integrationOwner: ${own.sharedPaths.join(', ')}`,
      });
    }
    for (let j = i + 1; j < list.length; j += 1) {
      if (!isAgentTask(list[i]) || !isAgentTask(list[j])) continue;
      const ownB = ownershipOf(list[j]);
      if (pathsOverlap(own.allowedPaths, ownB.allowedPaths)) {
        // Canonical pair order so the same collision records identically
        // regardless of the order tasks were supplied in.
        const [taskA, taskB] = [list[i].id, list[j].id].sort((a, b) => a.localeCompare(b));
        collisions.push({ taskA, taskB, reason: 'overlapping allowedPaths (write/write collision)' });
      }
    }
  }

  collisions.sort((a, b) =>
    a.taskA === b.taskA
      ? a.taskB === b.taskB
        ? a.reason.localeCompare(b.reason)
        : a.taskB.localeCompare(b.taskB)
      : a.taskA.localeCompare(b.taskA),
  );
  return collisions;
}

/**
 * Validate that an agent result only wrote paths it owns. Every created /
 * modified / deleted path must match an `allowedPaths` glob, must NOT match a
 * `forbiddenPaths` glob, and must NOT match a `readOnlyPaths` glob.
 *
 * @param {object} task the task whose ownership applies
 * @param {{filesCreated?:string[], filesModified?:string[], filesDeleted?:string[]}} result agent result
 * @returns {{valid:boolean, violations:Array<{path:string, rule:string}>}}
 */
export function validateResultPaths(task, result) {
  const own = ownershipOf(task);
  const written = [
    ...(Array.isArray(result?.filesCreated) ? result.filesCreated : []),
    ...(Array.isArray(result?.filesModified) ? result.filesModified : []),
    ...(Array.isArray(result?.filesDeleted) ? result.filesDeleted : []),
  ].map(normalize);

  const violations = [];
  for (const path of written) {
    if (own.forbiddenPaths.some((glob) => matchesGlob(path, glob))) {
      violations.push({ path, rule: 'forbiddenPath' });
      continue;
    }
    if (own.readOnlyPaths.some((glob) => matchesGlob(path, glob))) {
      violations.push({ path, rule: 'readOnlyPath' });
      continue;
    }
    if (!own.allowedPaths.some((glob) => matchesGlob(path, glob))) {
      violations.push({ path, rule: 'outsideAllowedPaths' });
    }
  }

  violations.sort((a, b) =>
    a.path === b.path ? a.rule.localeCompare(b.rule) : a.path.localeCompare(b.path),
  );
  return { valid: violations.length === 0, violations };
}

/**
 * Require ownership on an agent-mode task in an ownership-bearing profile.
 * Throws a descriptive, typed error when `allowedPaths` is empty — refusal is a
 * feature: an agent with no declared lane cannot be safely dispatched.
 *
 * @param {{id:string, execution?:object, ownership?:object}} task the task
 * @param {{profile:string}} options the active workflow profile
 * @throws {Error} when an agent task in standard/advanced/program lacks allowedPaths
 * @returns {true} when ownership is satisfied (or the task is exempt)
 */
export function requireOwnership(task, { profile } = {}) {
  if (!isAgentTask(task)) return true;
  if (!OWNERSHIP_REQUIRED_PROFILES.has(profile)) return true;
  const own = ownershipOf(task);
  if (own.allowedPaths.length === 0) {
    throw new Error(
      `Ownership required: agent task "${task?.id ?? '?'}" in profile "${profile}" declares no allowedPaths.`,
    );
  }
  return true;
}

/**
 * Flag which of the given paths belong to the orchestrator-only shared set —
 * the files no parallel agent may write (CLI entrypoint, test registration,
 * package/index surfaces). Accepts the shared list as a parameter.
 *
 * @param {string[]} paths candidate paths to inspect
 * @param {string[]} [sharedRegistry] orchestrator-owned globs (default constant)
 * @returns {string[]} normalized paths that are orchestrator-owned (sorted, unique)
 */
export function orchestratorOwned(paths, sharedRegistry = DEFAULT_ORCHESTRATOR_SHARED) {
  const candidates = Array.isArray(paths) ? paths : [];
  const registry = Array.isArray(sharedRegistry) ? sharedRegistry : DEFAULT_ORCHESTRATOR_SHARED;
  const flagged = new Set();
  for (const candidate of candidates) {
    const path = normalize(candidate);
    if (registry.some((glob) => matchesGlob(path, glob))) flagged.add(path);
  }
  return [...flagged].sort((a, b) => a.localeCompare(b));
}
