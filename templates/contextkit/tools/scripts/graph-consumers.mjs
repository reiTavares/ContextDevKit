#!/usr/bin/env node
/**
 * Graph consumer adapters (IF2, WF-0072/BIZ-0004).
 *
 * One function per governance consumer's question, each reading THROUGH
 * `graph-query.mjs` over the committed projection and degrading to
 * `{ available:false, reason }` when the graph is absent — never a fabricated
 * caller / consumer / packet / pass (ADR-0136 invariant). These are the thin,
 * additive entry points the existing consumers call; the consumers keep their
 * current module-level / prose behavior as the graph-absent fallback, so no
 * consumer's contract changes (spec section "Invariants").
 *
 * IF2 surfaces ONLY structural fields — node ids, paths, counts. No free text
 * from source enters a result, so the MCP/gate output is injection-safe by
 * construction here; the free-text sanitization pipeline lands with the
 * semantic layer (WF-0073, ADR-0138).
 *
 * Pure, deterministic, reads pre-computed JSON only (hot-path safe). Zero
 * non-`node:` imports beyond the sibling `graph-query.mjs`.
 */
import {
  loadProjection, reverseCallers, reverseConsumers, boundedReachability, godNodes, shortestPath,
} from './graph-query.mjs';

/**
 * `/simulate-impact` enrichment: the exact reverse callers AND transitive
 * reverse consumers of a changed symbol/file, plus a blast-radius count.
 * Degrades to UNKNOWN (the command falls back to its prose reasoning).
 *
 * @param {string} root project root
 * @param {string} targetId node id being changed (`sym:...` or `file:...`)
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, callers:string[], consumers:string[], blastRadius:number, evidenceClass:string}}
 */
export function impactReport(root, targetId) {
  const projection = loadProjection(root);
  if (!projection.available) return projection;
  // RO4 review fix: reverseCallers can degrade (calls layer not built) -> propagate
  // the UNKNOWN instead of crashing / fabricating an empty impact.
  const callersResult = reverseCallers(projection, targetId);
  if (!callersResult.available) return callersResult;
  const callers = callersResult.callers;
  const consumers = reverseConsumers(projection, targetId).consumers;
  const blast = new Set([...callers, ...consumers]);
  return { available: true, callers, consumers, blastRadius: blast.size, evidenceClass: 'GRAPH_DERIVED' };
}

/**
 * `/contract-check` enrichment: the real reverse-consumers of a removed/renamed
 * export — who breaks when it disappears (inbound calls/imports/references).
 * Degrades to UNKNOWN (contract-check keeps its export-surface diff).
 *
 * @param {string} root project root
 * @param {string} exportId node id of the removed export
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, consumers:string[], breaks:boolean, evidenceClass:string}}
 */
export function contractReverseConsumers(root, exportId) {
  const projection = loadProjection(root);
  if (!projection.available) return projection;
  const consumers = reverseConsumers(projection, exportId).consumers;
  return { available: true, consumers, breaks: consumers.length > 0, evidenceClass: 'GRAPH_DERIVED' };
}

/**
 * Task-compiler packet enrichment: the bounded, hub-avoiding neighborhood of a
 * seed symbol under a node budget (approximating a token budget). Degrades to
 * UNKNOWN (the compiler keeps its file-glob heuristic).
 *
 * @param {string} root project root
 * @param {string} seedId seed node id
 * @param {number} [budget=40]
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, nodes:string[], excludedHubs:string[], size:number, evidenceClass:string}}
 */
export function packetNeighborhood(root, seedId, budget = 40) {
  const projection = loadProjection(root);
  if (!projection.available) return projection;
  const r = boundedReachability(projection, seedId, budget);
  return { available: true, nodes: r.nodes, excludedHubs: r.excludedHubs, size: r.nodes.length, evidenceClass: 'GRAPH_DERIVED' };
}

/**
 * Read-only MCP tool dispatch. Maps a tool name + args to a structural result,
 * loading the projection once. Unknown tool or absent graph -> a degrade object
 * (never throws, never fabricates). Every returned field is structural (ids /
 * counts / paths) — injection-safe by construction for IF2.
 *
 * @param {string} root project root
 * @param {string} tool one of query_graph|get_node|get_neighbors|shortest_path|affected|god_nodes
 * @param {Record<string, unknown>} [args]
 * @returns {object} a structural result or `{available:false, reason}`
 */
export function mcpGraphTool(root, tool, args = {}) {
  const projection = loadProjection(root);
  if (!projection.available) return projection;
  const id = typeof args.id === 'string' ? args.id : '';
  switch (tool) {
    case 'god_nodes':
      return godNodes(projection, Number(args.topN) || 10);
    case 'affected':
      return reverseConsumers(projection, id);
    case 'get_neighbors':
      return boundedReachability(projection, id, Number(args.budget) || 40);
    case 'shortest_path':
      return shortestPath(projection, id, typeof args.to === 'string' ? args.to : '');
    case 'get_node': {
      const node = projection.nodes.find((n) => n.id === id) || null;
      return { available: true, node, evidenceClass: 'GRAPH_DERIVED' };
    }
    case 'query_graph': {
      // Structural substring match over node ids (no free-text query at IF2).
      const q = typeof args.q === 'string' ? args.q : '';
      const matches = projection.nodes.filter((n) => n.id.includes(q)).map((n) => n.id).sort().slice(0, 50);
      return { available: true, matches, evidenceClass: 'GRAPH_DERIVED' };
    }
    default:
      return { available: false, reason: `unknown graph tool "${tool}"`, evidenceClass: 'GRAPH_DERIVED' };
  }
}

/** The read-only MCP tool names IF2 exposes (registry-facing). */
export const MCP_GRAPH_TOOLS = Object.freeze([
  'query_graph', 'get_node', 'get_neighbors', 'shortest_path', 'affected', 'god_nodes',
]);

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-consumers.mjs') {
  const root = process.cwd();
  const target = process.argv.slice(2).find((a) => !a.startsWith('--')) || '';
  process.stdout.write(JSON.stringify(impactReport(root, target), null, 2) + '\n');
}
