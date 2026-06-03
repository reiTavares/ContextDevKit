/**
 * DevPipeline metadata v2 validators (ticket 040, ADR-0022 follow-through).
 *
 * Two concerns kept together because they share a single mental model — the
 * `dependencies: []` DAG over ticket ids:
 *
 *   1. `detectCycles(tasks)` — DFS-based cycle detector. Returns the offending
 *      cycle (array of ids in order) or `null`. Pure; no I/O.
 *   2. `blockedBy(task, tasks)` — counts how many of `task.dependencies` are
 *      *still open* (stage ≠ conclusion). Used by the board renderer to show
 *      the "↘ blocked by N" hint.
 *
 * Also exports the valid enums (`VALID_TYPES`, `VALID_COMPLEXITY`) so the CLI
 * + selfcheck + render layer single-source them.
 *
 * Pure ESM, zero-dep. See [ADR-0022](../../memory/decisions/0022-run-dispatcher-task-dependencies.md)
 * for the DAG semantics this ships even though no dispatcher reads it yet.
 */

export const VALID_TYPES = new Set(['bug', 'chore', 'feature', 'increment', 'spike', 'docs', 'task']);
export const VALID_COMPLEXITY = new Set(['S', 'M', 'L', 'XL']);

/**
 * Parses a YAML inline array — `[040, 041, 042]` — into a string array.
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
 * Validates a single ticket's metadata v2 fields. Returns `{ ok, errors }`.
 * Permissive: missing fields are accepted (backward-compat with v1 tickets).
 *
 * @param {object} task — shape from `listTasks()` (id, type, complexity, dependencies)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTaskV2(task) {
  const errors = [];
  if (task.type && !VALID_TYPES.has(task.type)) errors.push(`${task.id}: unknown type "${task.type}"`);
  if (task.complexity && !VALID_COMPLEXITY.has(task.complexity)) errors.push(`${task.id}: complexity must be S | M | L | XL (got "${task.complexity}")`);
  if (Array.isArray(task.dependencies)) {
    for (const dep of task.dependencies) if (dep === task.id) errors.push(`${task.id}: self-dependency`);
  }
  return { ok: errors.length === 0, errors };
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
 * @param {Array<{ id: string, dependencies?: string[] }>} tasks
 * @returns {string[] | null}
 */
export function detectCycles(tasks) {
  const graph = new Map();
  for (const t of tasks) graph.set(String(t.id), (t.dependencies || []).map(String));
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
 * Lints every task's type / complexity / dependencies and refuses on cycles.
 * Returns the list of error strings (empty when clean). Pure; the CLI prints +
 * exits. Lives here (not in pipeline.mjs) so pipeline.mjs stays under budget.
 *
 * @param {Array<{ id: string, type?: string, complexity?: string, dependencies?: string[] }>} tasks
 * @returns {string[]}
 */
export function runValidate(tasks) {
  const errors = tasks.flatMap((t) => validateTaskV2(t).errors);
  const cycle = detectCycles(tasks);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' → ')}`);
  return errors;
}

/**
 * Counts how many of `task.dependencies` are still open — stage is `backlog`,
 * `working`, or `testing`. Used by the board renderer to show "↘ blocked by N".
 * Dangling references (deps that don't exist in the task set) are silently
 * ignored.
 *
 * @param {{ dependencies?: string[] }} task
 * @param {Array<{ id: string, stage: string }>} allTasks
 * @returns {number}
 */
export function blockedBy(task, allTasks) {
  if (!Array.isArray(task.dependencies) || task.dependencies.length === 0) return 0;
  const byId = new Map(allTasks.map((t) => [String(t.id), t.stage]));
  let blocked = 0;
  for (const dep of task.dependencies) {
    const stage = byId.get(String(dep));
    if (stage && stage !== 'conclusion') blocked += 1;
  }
  return blocked;
}
