/**
 * DevPipeline metadata v2 validators (ticket 040, ADR-0022 follow-through).
 *
 * Two concerns kept together because they share a single mental model — the
 * `dependsOn: []` DAG over canonical task ids:
 *
 *   1. `detectCycles(tasks)` — DFS-based cycle detector. Returns the offending
 *      cycle (array of ids in order) or `null`. Pure; no I/O.
 *   2. `blockedBy(task, tasks)` — counts how many of `task.dependsOn` are
 *      *still open* (status ≠ done/cancelled). Used by read-only planners to
 *      produce the "blocked by N" hint.
 *
 * Pure ESM, zero-dep. Canonical status and field validation remains in
 * `tasks-validate.mjs`; this module only holds shared dependency helpers.
 */

/**
 * Parses a compact CLI list — `[T-001, T-002]` — into a string array.
 * Trims, drops empty entries, returns `[]` for absent / empty / malformed.
 *
 * @param {string | undefined | null} raw
 * @returns {string[]}
 */
export function parseInlineArray(raw) {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '[]') return [];
  const stripped = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return stripped.split(',').map((s) => s.replace(/['"]/g, '').trim()).filter(Boolean);
}

/**
 * DFS cycle detector over the task graph.
 *
 * Returns the offending cycle as an ordered array of ids (`['040', '041', '040']`)
 * when one exists, or `null` when the graph is acyclic. An edge to an unknown
 * id (`042` depends on `999` which doesn't exist) is ignored — that's a
 * dangling reference, not a cycle. The validator should surface those
 * separately if/when it grows.
 *
 * @param {Array<{ id: string, dependsOn?: string[] }>} tasks
 * @returns {string[] | null}
 */
export function detectCycles(tasks) {
  const graph = new Map();
  for (const task of tasks) graph.set(String(task.id), (task.dependsOn || []).map(String));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const colour = new Map();
  for (const id of graph.keys()) colour.set(id, WHITE);
  const stack = [];

  function dfs(node) {
    colour.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (!graph.has(next)) continue; // dangling reference — not a cycle
      if (colour.get(next) === GRAY) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (colour.get(next) === WHITE) {
        const cycle = dfs(next);
        if (cycle) return cycle;
      }
    }
    colour.set(node, BLACK);
    stack.pop();
    return null;
  }

  for (const id of graph.keys()) {
    if (colour.get(id) !== WHITE) continue;
    const cycle = dfs(id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Counts how many of `task.dependsOn` are still open. `done` and `cancelled`
 * dependencies are terminal; every other canonical status remains blocking.
 * Dangling references (deps that don't exist in the task set) are silently
 * ignored.
 *
 * @param {{ dependsOn?: string[] }} task
 * @param {Array<{ id: string, status: string }>} allTasks
 * @returns {number}
 */
export function blockedBy(task, allTasks) {
  if (!Array.isArray(task.dependsOn) || task.dependsOn.length === 0) return 0;
  const statusById = new Map(allTasks.map((candidate) => [String(candidate.id), candidate.status]));
  let blocked = 0;
  for (const dependencyId of task.dependsOn) {
    const status = statusById.get(String(dependencyId));
    if (status && status !== 'done' && status !== 'cancelled') blocked += 1;
  }
  return blocked;
}
