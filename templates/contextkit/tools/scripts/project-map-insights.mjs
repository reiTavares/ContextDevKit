/**
 * Project-map INSIGHTS — deterministic graph analysis over the module model.
 *
 * Pure functions (model in, data out): no I/O, no clock. Sibling of
 * `project-map-deps.mjs` (edges) and `-symbols.mjs` — keeps the scanner under its
 * line budget while turning the dependency graph into actionable signals the boot
 * surfaces and `--check` diffs. Everything is sorted/normalized so the committed
 * `manifest.json` stays churn-free (ADR-0039/0046). [project-map]
 */

import { structuralSignals } from './project-map-signals.mjs';

/** Build `path → [dep paths]` from the model (only edges to mapped modules). */
function adjacency(modules) {
  const known = new Set(modules.map((m) => m.path));
  const out = new Map();
  for (const m of modules) out.set(m.path, (m.deps || []).filter((d) => known.has(d)));
  return out;
}

/** Elementary dependency cycles (DFS back-edges), deduped + normalized for stability. */
function findCycles(adj) {
  const cycles = [];
  const seen = new Set();
  const stack = [];
  const onStack = new Set();
  const color = new Map(); // undefined=white, 1=gray, 2=black

  const visit = (node) => {
    color.set(node, 1);
    stack.push(node);
    onStack.add(node);
    for (const next of adj.get(node) || []) {
      if (onStack.has(next)) {
        const cycle = stack.slice(stack.indexOf(next));
        // Normalize (rotate to the lexicographically-smallest start) so a→b→a and b→a→b dedupe.
        const min = cycle.indexOf([...cycle].sort()[0]);
        const norm = [...cycle.slice(min), ...cycle.slice(0, min)];
        const key = norm.join('>');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(norm);
        }
      } else if (color.get(next) !== 2) {
        visit(next);
      }
    }
    stack.pop();
    onStack.delete(node);
    color.set(node, 2);
  };

  for (const node of [...adj.keys()].sort()) if (!color.has(node)) visit(node);
  return cycles.sort((a, b) => a.join('>').localeCompare(b.join('>')));
}

/**
 * Structural insights: dependency cycles, orphan modules (no in/out edges), and
 * oversized modules (hit the file cap → split candidates). Deterministic.
 *
 * Also attaches the W1.1 per-module GRAPH_DERIVED structural signals
 * (fanIn/fanOut/instability/blastRadius) under `structural` so the arch/debt gate
 * reads them from the public contract — a strict superset, existing keys unchanged.
 *
 * @param {Array<{path:string, deps?:string[], capped?:boolean}>} modules
 * @returns {{cycles:string[][], orphans:string[], oversized:string[], structural:ReturnType<typeof structuralSignals>}}
 */
export function computeInsights(modules) {
  const adj = adjacency(modules);
  const inbound = new Set();
  for (const deps of adj.values()) for (const d of deps) inbound.add(d);
  const orphans = modules
    .filter((m) => (adj.get(m.path) || []).length === 0 && !inbound.has(m.path))
    .map((m) => m.path)
    .sort();
  const oversized = modules.filter((m) => m.capped).map((m) => m.path).sort();
  return { cycles: findCycles(adj), orphans, oversized, structural: structuralSignals(modules) };
}

/** Flatten a manifest/model module list into a `path → Set(deps)` map. */
function depMap(modules) {
  const map = new Map();
  for (const m of modules || []) map.set(m.path, new Set(m.deps || []));
  return map;
}

/**
 * Structural delta between the saved manifest and a fresh model — added/removed
 * modules and dependency edges. Lets `--check` print a token-cheap "what changed"
 * instead of the whole map. [ADR-0046]
 */
export function manifestDelta(saved, model) {
  const before = depMap(saved?.modules);
  const after = depMap(model.modules);
  const addedModules = [...after.keys()].filter((p) => !before.has(p)).sort();
  const removedModules = [...before.keys()].filter((p) => !after.has(p)).sort();
  const addedEdges = [];
  const removedEdges = [];
  for (const [path, deps] of after) {
    const prev = before.get(path) || new Set();
    for (const d of deps) if (!prev.has(d)) addedEdges.push(`${path} → ${d}`);
  }
  for (const [path, deps] of before) {
    const now = after.get(path) || new Set();
    for (const d of deps) if (!now.has(d)) removedEdges.push(`${path} → ${d}`);
  }
  return {
    addedModules,
    removedModules,
    addedEdges: addedEdges.sort(),
    removedEdges: removedEdges.sort(),
  };
}

/**
 * Focused subgraph for a path — the module owning `targetPath`, its dependencies,
 * and its importers (reverse deps). Bounded + deterministic so the ADR-0044
 * memory retriever can consume it instead of the whole index. [ADR-0046]
 *
 * @returns {{module:string, deps:string[], importers:string[]}|null}
 */
export function subgraphFor(modules, targetPath) {
  const norm = String(targetPath || '').replaceAll('\\', '/').replace(/\/+$/, '');
  if (!norm) return null;
  // Most specific module whose path prefixes the target.
  const owner = modules
    .filter((m) => norm === m.path || norm.startsWith(m.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!owner) return null;
  const importers = modules
    .filter((m) => (m.deps || []).includes(owner.path))
    .map((m) => m.path)
    .sort();
  return { module: owner.path, deps: [...(owner.deps || [])].sort(), importers };
}
