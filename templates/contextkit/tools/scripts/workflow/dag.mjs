/**
 * Pure DAG (directed acyclic graph) calculations over a normalized plan.
 *
 * Cohesion note: this module is a single cohesive graph-algebra unit. Cycle
 * detection, topological ordering, readiness, blocking reasons, dependency
 * validation and critical-path share one adjacency representation; splitting
 * them would force the shared graph types across a module seam for no real
 * second consumer. Kept together intentionally (constitution §1 tolerance).
 *
 * The functions operate on GENERIC nodes shaped `{ id, dependsOn[] }`, so the
 * same engine serves BOTH wave-level graphs (waves linked by `dependsOn`) and
 * task-level graphs (tasks linked by `dependsOn`). No I/O, no imports beyond
 * none — fully pure and deterministic (no Date.now / Math.random).
 *
 * @module workflow/dag
 */

/** Error thrown when a topological order is requested on a cyclic graph. */
export class CycleError extends Error {
  /**
   * @param {string[]} cycle the node ids forming the detected cycle
   */
  constructor(cycle) {
    super(`workflow dag: cycle detected (${cycle.join(' -> ')})`);
    this.name = 'CycleError';
    /** @type {string[]} */
    this.cycle = cycle;
  }
}

/**
 * Sort a copy of ids ascending for stable, deterministic output.
 * @param {string[]} ids node ids
 * @returns {string[]} a new sorted array
 */
function sortedIds(ids) {
  return [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Build an adjacency structure from generic nodes. Dangling dependency ids
 * (references to nodes not present) are tolerated here and surfaced by
 * `validateDependencies`; graph traversals ignore them.
 *
 * @param {{ id: string, dependsOn?: string[] }[]} nodes the normalized nodes
 * @returns {{ ids: string[], deps: Map<string,string[]>, has: (id: string) => boolean }}
 *   `ids` (sorted), `deps` (id -> its existing dependency ids), `has` membership
 * @throws {TypeError} when `nodes` is not an array or a node lacks a string id
 */
export function buildGraph(nodes) {
  if (!Array.isArray(nodes)) {
    throw new TypeError('workflow dag: buildGraph expects an array of nodes');
  }
  const present = new Set();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string') {
      throw new TypeError('workflow dag: every node must have a string id');
    }
    present.add(node.id);
  }
  /** @type {Map<string,string[]>} */
  const deps = new Map();
  for (const node of nodes) {
    const declared = Array.isArray(node.dependsOn) ? node.dependsOn : [];
    deps.set(node.id, sortedIds(declared.filter((dep) => present.has(dep))));
  }
  return {
    ids: sortedIds([...present]),
    deps,
    has: (id) => present.has(id),
  };
}

/**
 * Detect a dependency cycle via depth-first search over a stable node order.
 *
 * @param {{ id: string, dependsOn?: string[] }[]} nodes the normalized nodes
 * @returns {{ hasCycle: boolean, cycle: string[] }} `cycle` is the path of ids
 *   (first repeated id closing the loop) when found, otherwise empty
 */
export function detectCycle(nodes) {
  const graph = buildGraph(nodes);
  const VISITING = 1;
  const DONE = 2;
  /** @type {Map<string,number>} */
  const mark = new Map();
  /** @type {string[]} */
  const stack = [];

  /**
   * @param {string} id current node
   * @returns {string[]|null} the cycle path if one closes through `id`
   */
  const visit = (id) => {
    mark.set(id, VISITING);
    stack.push(id);
    for (const dep of graph.deps.get(id) ?? []) {
      const state = mark.get(dep);
      if (state === VISITING) {
        const start = stack.indexOf(dep);
        return [...stack.slice(start), dep];
      }
      if (state !== DONE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    mark.set(id, DONE);
    return null;
  };

  for (const id of graph.ids) {
    if (mark.get(id) === undefined) {
      const cycle = visit(id);
      if (cycle) return { hasCycle: true, cycle };
    }
  }
  return { hasCycle: false, cycle: [] };
}

/**
 * Produce a deterministic topological order. Ties (nodes whose dependencies are
 * all satisfied at the same step) are broken by id ascending (Kahn's algorithm
 * with a sorted ready frontier).
 *
 * @param {{ id: string, dependsOn?: string[] }[]} nodes the normalized nodes
 * @returns {string[]} ids in topological order (dependencies before dependents)
 * @throws {CycleError} when the graph contains a cycle
 */
export function topoOrder(nodes) {
  const graph = buildGraph(nodes);
  const cycleScan = detectCycle(nodes);
  if (cycleScan.hasCycle) {
    throw new CycleError(cycleScan.cycle);
  }
  /** @type {Map<string,number>} */
  const remaining = new Map();
  for (const id of graph.ids) {
    remaining.set(id, (graph.deps.get(id) ?? []).length);
  }
  /** @type {string[]} */
  const ordered = [];
  let frontier = graph.ids.filter((id) => remaining.get(id) === 0);
  while (frontier.length > 0) {
    const next = sortedIds(frontier);
    frontier = [];
    for (const id of next) {
      ordered.push(id);
      for (const other of graph.ids) {
        if ((graph.deps.get(other) ?? []).includes(id)) {
          const left = remaining.get(other) - 1;
          remaining.set(other, left);
          if (left === 0) frontier.push(other);
        }
      }
    }
  }
  return ordered;
}

/**
 * Ids whose every dependency is in `completedIds` and which are not themselves
 * completed. Useful for "what can run now".
 *
 * @param {{ id: string, dependsOn?: string[] }[]} nodes the normalized nodes
 * @param {Iterable<string>} [completedIds] ids already completed
 * @returns {string[]} ready node ids, ascending
 */
export function readyNodes(nodes, completedIds = []) {
  const graph = buildGraph(nodes);
  const done = new Set(completedIds);
  const ready = graph.ids.filter(
    (id) => !done.has(id) && (graph.deps.get(id) ?? []).every((dep) => done.has(dep)),
  );
  return sortedIds(ready);
}

/**
 * Nodes that are neither completed nor ready, with the specific unmet
 * dependency ids that block each one.
 *
 * @param {{ id: string, dependsOn?: string[] }[]} nodes the normalized nodes
 * @param {Iterable<string>} [completedIds] ids already completed
 * @returns {{ id: string, blockedBy: string[] }[]} blocked nodes, ascending
 */
export function blockedNodes(nodes, completedIds = []) {
  const graph = buildGraph(nodes);
  const done = new Set(completedIds);
  /** @type {{ id: string, blockedBy: string[] }[]} */
  const blocked = [];
  for (const id of graph.ids) {
    if (done.has(id)) continue;
    const unmet = (graph.deps.get(id) ?? []).filter((dep) => !done.has(dep));
    if (unmet.length > 0) {
      blocked.push({ id, blockedBy: sortedIds(unmet) });
    }
  }
  return blocked;
}

/**
 * Validate that dependencies are well-formed: every `dependsOn` references an
 * existing node id (no dangling) and no node depends on itself.
 *
 * @param {{ id: string, dependsOn?: string[] }[]} nodes the normalized nodes
 * @returns {{ valid: boolean, errors: string[] }} errors are ascending + stable
 */
export function validateDependencies(nodes) {
  const present = new Set();
  for (const node of nodes) {
    if (node && typeof node.id === 'string') present.add(node.id);
  }
  /** @type {string[]} */
  const errors = [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string') continue;
    const declared = Array.isArray(node.dependsOn) ? node.dependsOn : [];
    for (const dep of sortedIds(declared)) {
      if (dep === node.id) {
        errors.push(`${node.id}: self-dependency`);
      } else if (!present.has(dep)) {
        errors.push(`${node.id}: unknown dependency '${dep}'`);
      }
    }
  }
  return { valid: errors.length === 0, errors: sortedIds(errors) };
}

/**
 * Longest dependency chain through the graph. Metric: by default the chain with
 * the most nodes; when `weight(id)` is supplied, the chain of greatest summed
 * weight (a node-weighted longest path). Best-effort and deterministic — ties
 * are broken so that the lexicographically smallest chain wins.
 *
 * @param {{ id: string, dependsOn?: string[] }[]} nodes the normalized nodes
 * @param {{ weight?: (id: string) => number }} [options] optional node weighting
 * @returns {string[]} ids of the critical (longest) chain, dependency-first
 * @throws {CycleError} when the graph contains a cycle
 */
export function criticalPath(nodes, options = {}) {
  const graph = buildGraph(nodes);
  const order = topoOrder(nodes);
  const weightOf = typeof options.weight === 'function' ? options.weight : () => 1;
  /** @type {Map<string,{ cost: number, path: string[] }>} */
  const best = new Map();
  for (const id of order) {
    const own = weightOf(id);
    let chosen = { cost: own, path: [id] };
    for (const dep of graph.deps.get(id) ?? []) {
      const upstream = best.get(dep);
      if (!upstream) continue;
      const cost = upstream.cost + own;
      const path = [...upstream.path, id];
      if (cost > chosen.cost || (cost === chosen.cost && isSmallerChain(path, chosen.path))) {
        chosen = { cost, path };
      }
    }
    best.set(id, chosen);
  }
  /** @type {{ cost: number, path: string[] }} */
  let winner = { cost: -Infinity, path: [] };
  for (const id of order) {
    const candidate = best.get(id);
    if (candidate.cost > winner.cost || (candidate.cost === winner.cost && isSmallerChain(candidate.path, winner.path))) {
      winner = candidate;
    }
  }
  return winner.path;
}

/**
 * Lexicographic chain comparison for deterministic tie-breaking.
 * @param {string[]} left candidate chain
 * @param {string[]} right incumbent chain
 * @returns {boolean} true when `left` should win over `right`
 */
function isSmallerChain(left, right) {
  if (right.length === 0) return true;
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return left.length < right.length;
}
