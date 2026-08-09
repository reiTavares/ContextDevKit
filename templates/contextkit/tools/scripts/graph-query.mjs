#!/usr/bin/env node
/**
 * Graph query core (IF1, WF-0072/BIZ-0004).
 *
 * The single read surface over the committed graph projection WF-0071 writes
 * (`<projectMap>/graph/graph.json`). Every consumer in this workflow
 * (simulate-impact, task-compiler, contract-check, the MCP server) reads THROUGH
 * these functions so the degrade-to-UNKNOWN contract lives in exactly one place:
 * absent/unparsable projection -> `{ available:false, reason }`, never a
 * fabricated caller/consumer/path (constitution section 8; ADR-0136 invariant).
 *
 * Pure + deterministic (neighbors sorted, no clock, no Math.random). Reads
 * PRE-COMPUTED JSON only — never parses source, never pulls a dependency, so a
 * hot-path consumer can call it (immutable rule 1). Zero non-`node:` imports
 * beyond the sibling paths helper.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const GRAPH_EVIDENCE = 'GRAPH_DERIVED';

/**
 * Loads the committed graph projection, degrading defensively. Never throws.
 * @param {string} root project root
 * @returns {{available:true, nodes:object[], edges:object[], signature:string}
 *   | {available:false, reason:string, evidenceClass:string}}
 */
export function loadProjection(root) {
  const path = join(pathsFor(root).projectMap, 'graph', 'graph.json');
  if (!existsSync(path)) return { available: false, reason: 'no committed graph projection', evidenceClass: GRAPH_EVIDENCE };
  try {
    const raw = readFileSync(path, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return { available: false, reason: 'projection missing nodes/edges arrays', evidenceClass: GRAPH_EVIDENCE };
    }
    return { available: true, nodes: parsed.nodes, edges: parsed.edges, layers: Array.isArray(parsed.layers) ? parsed.layers : [], signature: parsed.graphSignature || '' };
  } catch (err) {
    return { available: false, reason: `projection unparsable: ${err?.message ?? err}`, evidenceClass: GRAPH_EVIDENCE };
  }
}

/** Builds forward + reverse adjacency (by relation) from an edge list. Sorted, deterministic. */
function adjacency(edges) {
  const forward = new Map();
  const reverse = new Map();
  for (const e of edges) {
    if (!forward.has(e.source)) forward.set(e.source, []);
    forward.get(e.source).push(e);
    if (!reverse.has(e.target)) reverse.set(e.target, []);
    reverse.get(e.target).push(e);
  }
  return { forward, reverse };
}

/**
 * Reverse callers of a symbol: every node whose `calls` edge targets `symbolId`.
 * @param {object} projection loadProjection() result
 * @param {string} symbolId e.g. `sym:pkg/x.js#foo`
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, callers:string[], evidenceClass:string}}
 */
export function reverseCallers(projection, symbolId) {
  if (!projection.available) return projection;
  // RO4 review fix: an extract-only projection has no `calls` layer; returning []
  // would be a false negative ('nobody calls X') dressed as an answer. Degrade to
  // UNKNOWN instead (constitution section 8: skipped != a fabricated pass).
  if (Array.isArray(projection.layers) && projection.layers.length > 0 && !projection.layers.includes('calls')) {
    return { available: false, reason: 'calls layer not built in this projection', evidenceClass: GRAPH_EVIDENCE };
  }
  const callers = projection.edges
    .filter((e) => e.relation === 'calls' && e.target === symbolId)
    .map((e) => e.source);
  return { available: true, callers: [...new Set(callers)].sort(), evidenceClass: GRAPH_EVIDENCE };
}

/**
 * Reverse consumers of a file/symbol: every distinct source with an inbound
 * `calls`/`imports`/`references` edge to `targetId` (who breaks if it changes).
 * @param {object} projection loadProjection() result
 * @param {string} targetId
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, consumers:string[], evidenceClass:string}}
 */
export function reverseConsumers(projection, targetId) {
  if (!projection.available) return projection;
  const wanted = new Set(['calls', 'imports', 'references']);
  const consumers = projection.edges
    .filter((e) => wanted.has(e.relation) && e.target === targetId)
    .map((e) => e.source);
  return { available: true, consumers: [...new Set(consumers)].sort(), evidenceClass: GRAPH_EVIDENCE };
}

/** Total degree (in + out) per node id. */
function degrees(edges) {
  const deg = new Map();
  const bump = (id) => deg.set(id, (deg.get(id) || 0) + 1);
  for (const e of edges) { bump(e.source); bump(e.target); }
  return deg;
}

/**
 * The p99 degree threshold — nodes at/above it are "hubs" and are not expanded
 * through during bounded traversal (keeps a neighborhood relevant on a huge
 * graph; mirrors Graphify's hub-avoiding BFS). Floored at 50 like Graphify.
 */
function hubThreshold(deg) {
  const sorted = [...deg.values()].sort((a, b) => a - b);
  if (sorted.length === 0) return Infinity;
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  return Math.max(50, p99);
}

/**
 * Bounded, hub-avoiding neighborhood of a seed node under a node budget
 * (approximates a token budget). BFS over forward+reverse edges; refuses to
 * expand THROUGH a hub (degree >= p99), and stops at `budget` nodes.
 * Deterministic: neighbors visited in sorted id order.
 * @param {object} projection loadProjection() result
 * @param {string} seedId
 * @param {number} [budget=40] max nodes in the neighborhood
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, nodes:string[], excludedHubs:string[], evidenceClass:string}}
 */
export function boundedReachability(projection, seedId, budget = 40) {
  if (!projection.available) return projection;
  const { forward, reverse } = adjacency(projection.edges);
  const deg = degrees(projection.edges);
  const hub = hubThreshold(deg);
  const neighborsOf = (id) => {
    const out = [];
    for (const e of forward.get(id) || []) out.push(e.target);
    for (const e of reverse.get(id) || []) out.push(e.source);
    return [...new Set(out)].sort();
  };
  const visited = new Set([seedId]);
  const excludedHubs = new Set();
  const queue = [seedId];
  while (queue.length && visited.size < budget) {
    const current = queue.shift();
    // Do not expand THROUGH a hub (but the hub itself, reached as a neighbor, is kept).
    if (current !== seedId && (deg.get(current) || 0) >= hub) { excludedHubs.add(current); continue; }
    for (const next of neighborsOf(current)) {
      if (visited.has(next)) continue;
      if (visited.size >= budget) break;
      visited.add(next);
      queue.push(next);
    }
  }
  return { available: true, nodes: [...visited].sort(), excludedHubs: [...excludedHubs].sort(), evidenceClass: GRAPH_EVIDENCE };
}

/**
 * Highest-degree "god nodes" (most-connected real abstractions). Deterministic:
 * ties broken by id. Excludes synthetic `unresolved:` targets.
 * @param {object} projection loadProjection() result
 * @param {number} [topN=10]
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, godNodes:Array<{id:string, degree:number}>, evidenceClass:string}}
 */
export function godNodes(projection, topN = 10) {
  if (!projection.available) return projection;
  const deg = degrees(projection.edges);
  const ranked = [...deg.entries()]
    .filter(([id]) => !id.startsWith('unresolved:'))
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, topN)
    .map(([id, degree]) => ({ id, degree }));
  return { available: true, godNodes: ranked, evidenceClass: GRAPH_EVIDENCE };
}

/**
 * Shortest path between two node ids over the undirected edge view. BFS,
 * deterministic (neighbors sorted). Returns an empty path when unreachable.
 * @param {object} projection loadProjection() result
 * @param {string} fromId
 * @param {string} toId
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, path:string[], evidenceClass:string}}
 */
export function shortestPath(projection, fromId, toId) {
  if (!projection.available) return projection;
  const { forward, reverse } = adjacency(projection.edges);
  const neighborsOf = (id) => {
    const out = [];
    for (const e of forward.get(id) || []) out.push(e.target);
    for (const e of reverse.get(id) || []) out.push(e.source);
    return [...new Set(out)].sort();
  };
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const current = queue.shift();
    if (current === toId) {
      const path = [];
      for (let at = toId; at !== null; at = prev.get(at)) path.unshift(at);
      return { available: true, path, evidenceClass: GRAPH_EVIDENCE };
    }
    for (const next of neighborsOf(current)) {
      if (prev.has(next)) continue;
      prev.set(next, current);
      queue.push(next);
    }
  }
  return { available: true, path: [], evidenceClass: GRAPH_EVIDENCE };
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-query.mjs') {
  const root = process.cwd();
  const projection = loadProjection(root);
  process.stdout.write(JSON.stringify(godNodes(projection, 10), null, 2) + '\n');
}
