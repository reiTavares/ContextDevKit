#!/usr/bin/env node
/**
 * Committed graph projection - writer + signature + composition + incremental merge
 * (GC1-T2 writer/signature, GC3-T1 merge; WF-0071/BIZ-0004; RO4-review composition).
 *
 * Sorts the extracted node/edge set into the deterministic shape the store
 * contract (gc0-report.md section 3) requires, computes the churn-stable
 * `graphSignature`, stamps the `layers` actually present, and (only with
 * `--apply`) atomically writes `<projectMap>/graph/graph.json`. Dry-run by
 * default (constitution section 8).
 *
 * `buildFullProjection` is the COMPOSITION ROOT (RO4 architect review): it
 * composes the resolver output (structural + imports + resolved `calls`) with
 * the deterministic rationale layer (`adr:` nodes + `cites` edges) so the
 * committed artifact is COMPLETE. Before this, `--apply` wrote extract-only
 * output, so `reverseCallers` returned `[]` (a false negative dressed as an
 * answer). The `layers` stamp lets a consumer degrade to UNKNOWN when a layer
 * was not built, instead of fabricating an empty result.
 *
 * `mergeProjection` is the incremental-merge core: re-extracting a subset of
 * changed source files REPLACES exactly those files' contribution and prunes a
 * deleted file's contribution, while a shrink guard refuses to silently drop a
 * node owned by an UNCHANGED source (Graphify's never-shrink safety, ported).
 *
 * No clock in the body: the only randomness source is the seeded `mulberry32`.
 * Zero non-`node:` imports beyond the sibling scripts (constitution rule 1).
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { extractSymbols } from './graph-extract.mjs';
import { resolveGraph } from './project-map-resolve.mjs';
import { buildRationaleLayer } from './rationale-nodes.mjs';

/**
 * Deterministic seeded PRNG (mulberry32) - floats in `[0, 1)`. Defined for the
 * seeded-determinism contract (GC0 section 3); no `Math.random()` anywhere.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sort key for an edge tuple (source, target, relation). */
function edgeSortKey(edge) {
  return `${edge.source} ${edge.target} ${edge.relation}`;
}

/**
 * The repo-relative file that "owns" a node/edge endpoint id, or null for a
 * module-level (`mod:`) or synthetic (`unresolved:`) id. Used by the
 * incremental merge to attribute nodes/edges to a source file.
 * @param {string} id
 * @returns {string|null}
 */
function ownerFileOf(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('file:')) return id.slice(5);
  if (id.startsWith('sym:')) return id.slice(4).split('#')[0];
  return null;
}

/**
 * Derives the deterministic, sorted `layers` list from the relations present in
 * the edge set - an honest manifest of what the projection actually contains, so
 * a consumer can degrade to UNKNOWN (never fabricate) when a layer is missing.
 * @param {Array<{relation:string}>} edges
 * @returns {string[]}
 */
function layersOf(edges) {
  const relations = new Set(edges.map((e) => e.relation));
  const layers = [];
  if (relations.has('contains') || relations.has('imports')) layers.push('structural');
  if (relations.has('calls')) layers.push('calls');
  if (relations.has('inherits') || relations.has('implements') || relations.has('extends')) layers.push('inheritance');
  if (relations.has('cites')) layers.push('rationale');
  return layers.sort();
}

/**
 * Content-addressed signature of the graph SHAPE - sorted node ids + sorted
 * edge tuples - sliced to 12 hex. EXCLUDES `sourceLocation`/`confidenceScore`
 * and `layers` (GC0 section 3): a line move or confidence tweak must not churn
 * the shape.
 * @param {Array<{id:string}>} nodes
 * @param {Array<{source:string, target:string, relation:string}>} edges
 * @returns {string} 12-hex signature
 */
export function graphSignature(nodes, edges) {
  const nodeIds = [...nodes.map((node) => node.id)].sort();
  const edgeTuples = [...edges.map(edgeSortKey)].sort();
  const hash = createHash('sha256');
  hash.update(nodeIds.join(' '));
  hash.update('|');
  hash.update(edgeTuples.join(' '));
  return hash.digest('hex').slice(0, 12);
}

/**
 * COMPOSITION ROOT (RO4 architect review). Composes the full committed graph:
 * the resolver output (structural `contains`/`imports` + resolved `calls`, from
 * `project-map-resolve.resolveGraph`) merged with the deterministic rationale
 * layer (`adr:` nodes + `cites` edges, from `rationale-nodes.buildRationaleLayer`).
 * Deduped by node id and edge tuple; the resolver wins a node-id tie. Returns an
 * unsorted `{nodes, edges, layers}` (feed it to `writeCommittedProjection`).
 *
 * This is what `--apply` must write - an extract-only projection is incomplete
 * and makes `reverseCallers` return a false-negative `[]`.
 *
 * @param {string} root project root
 * @returns {{nodes:Array<object>, edges:Array<object>, layers:string[]}}
 */
export function buildFullProjection(root) {
  const resolved = resolveGraph(root);
  let rationale = { nodes: [], edges: [] };
  try { rationale = buildRationaleLayer(root); } catch { /* rationale is best-effort; absence != failure */ }

  const nodeById = new Map();
  for (const node of resolved.nodes) nodeById.set(node.id, node);
  for (const node of rationale.nodes) if (!nodeById.has(node.id)) nodeById.set(node.id, node);

  const edgeByKey = new Map();
  for (const edge of resolved.edges) edgeByKey.set(edgeSortKey(edge), edge);
  for (const edge of rationale.edges) if (!edgeByKey.has(edgeSortKey(edge))) edgeByKey.set(edgeSortKey(edge), edge);

  const edges = [...edgeByKey.values()];
  return { nodes: [...nodeById.values()], edges, layers: layersOf(edges) };
}

/**
 * Builds the sorted, signed committed projection and - only when `apply:true` -
 * atomically writes it (tmp + rename) to `<projectMap>/graph/graph.json`.
 * Dry-run by default: always RETURNS the projection, disk untouched unless
 * `apply` is set (constitution section 8). Preserves `graph.layers` (the honest
 * manifest of built layers) or derives it from the edges when absent.
 *
 * @param {string} root project root
 * @param {{nodes:Array<object>, edges:Array<object>, layers?:string[]}} graph raw build output
 * @param {{apply?: boolean}} [options]
 * @returns {{schemaVersion:1, graphSignature:string, layers:string[], nodes:Array<object>, edges:Array<object>}}
 */
export function writeCommittedProjection(root, graph, { apply = false } = {}) {
  const nodes = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = [...graph.edges].sort((a, b) => {
    const ka = edgeSortKey(a);
    const kb = edgeSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const layers = Array.isArray(graph.layers) ? [...graph.layers].sort() : layersOf(edges);
  const projection = { schemaVersion: 1, graphSignature: graphSignature(nodes, edges), layers, nodes, edges };

  if (apply) {
    const graphDir = join(pathsFor(root).projectMap, 'graph');
    if (!existsSync(graphDir)) mkdirSync(graphDir, { recursive: true });
    const target = join(graphDir, 'graph.json');
    const tmp = `${target}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(projection, null, 2) + '\n', 'utf-8');
    renameSync(tmp, target);
  }

  return projection;
}

/**
 * Incremental merge (replace-per-source, never silently shrink). Replaces the
 * contribution of each `changedSources` file with its freshly-extracted
 * `incoming` nodes/edges, prunes each `deletedSources` file's contribution
 * entirely, and carries every other (unchanged) source forward untouched.
 * Edges left dangling by a deletion are pruned; a synthetic `unresolved:` edge
 * target is exempt (it is intentionally node-less).
 *
 * Never silently shrinks: a `changedSources` file that HAD nodes before but
 * whose `incoming` brought NONE is a suspected parse failure, not a deletion —
 * it throws (Graphify's never-shrink safety). To remove a file deliberately,
 * pass it in `deletedSources`, not `changedSources`.
 *
 * Returns an unsorted `{nodes, edges}` (feed it to `writeCommittedProjection`).
 *
 * @param {{nodes:Array<object>, edges:Array<object>}} previous prior projection
 * @param {{nodes:Array<object>, edges:Array<object>}} incoming re-extraction of the changed files
 * @param {{changedSources?:string[], deletedSources?:string[]}} [options]
 * @returns {{nodes:Array<object>, edges:Array<object>}}
 * @throws {Error} when a changed source produced no nodes (suspected silent shrink)
 */
export function mergeProjection(previous, incoming, { changedSources = [], deletedSources = [] } = {}) {
  const changed = new Set(changedSources);
  const deleted = new Set(deletedSources);
  const replaced = new Set([...changed, ...deleted]);
  const wasReplaced = (owner) => owner !== null && replaced.has(owner);

  // Shrink guard: a changed (not deleted) source that had nodes but brought none back.
  const prevOwners = new Set(previous.nodes.map((n) => n.sourceFile).filter(Boolean));
  const incomingOwners = new Set(incoming.nodes.map((n) => n.sourceFile).filter(Boolean));
  for (const src of changed) {
    if (!deleted.has(src) && prevOwners.has(src) && !incomingOwners.has(src)) {
      throw new Error(`mergeProjection: refused - changed source "${src}" produced no nodes (suspected silent shrink); pass it in deletedSources to prune deliberately`);
    }
  }

  const nodeById = new Map();
  for (const node of previous.nodes) {
    if (!wasReplaced(node.sourceFile ?? null)) nodeById.set(node.id, node);
  }
  for (const node of incoming.nodes) nodeById.set(node.id, node);

  const edgeByKey = new Map();
  for (const edge of previous.edges) {
    if (!wasReplaced(ownerFileOf(edge.source))) edgeByKey.set(edgeSortKey(edge), edge);
  }
  for (const edge of incoming.edges) edgeByKey.set(edgeSortKey(edge), edge);

  const nodes = [...nodeById.values()];
  const survivingIds = new Set(nodes.map((n) => n.id));

  // Prune edges left dangling by a deletion (synthetic `unresolved:` targets exempt).
  const edges = [...edgeByKey.values()].filter((edge) => {
    if (!survivingIds.has(edge.source)) return false;
    if (typeof edge.target === 'string' && edge.target.startsWith('unresolved:')) return true;
    return survivingIds.has(edge.target);
  });

  return { nodes, edges };
}

if (basename(process.argv[1] ?? '') === 'project-map-graph.mjs') {
  const root = process.cwd();
  const apply = process.argv.slice(2).includes('--apply');
  const extractOnly = process.argv.slice(2).includes('--extract-only');
  const graph = extractOnly ? extractSymbols(root) : buildFullProjection(root);
  const projection = writeCommittedProjection(root, graph, { apply });
  if (apply) {
    console.log(`wrote graph.json - ${projection.nodes.length} nodes, ${projection.edges.length} edges, layers [${projection.layers.join(', ')}], signature ${projection.graphSignature}`);
  } else {
    process.stdout.write(JSON.stringify(projection, null, 2) + '\n');
  }
}
