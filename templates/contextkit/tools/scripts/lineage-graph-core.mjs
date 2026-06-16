/**
 * lineage-graph-core.mjs — Pure builders for the CDK-070 lineage graph.
 *
 * No I/O — callers pass a `sources` object (collected by lineage-graph.mjs).
 * Graph schema:
 *   Node = { id, type, label, ref }   type ∈ {adr,workflow,card,session,receipt,telemetry}
 *   Edge = { from, to, rel, confidence }  confidence ∈ {'direct','derived'}
 * Namespaced ids: adr:<num>, wf:<slug>, card:<id>, session:<num>,
 *   receipt:<taskId>/<capability>, tele:<sessionId>
 *
 * Zero runtime dependencies. Advisory, fail-open everywhere.
 * Cohesion note: all pure graph construction in one file for isolated testability.
 * ADR-0072 / CDK-070.
 *
 * @typedef {'adr'|'workflow'|'card'|'session'|'receipt'|'telemetry'} NodeType
 * @typedef {{ id: string, type: NodeType, label: string, ref: any }} Node
 * @typedef {{ from: string, to: string, rel: string, confidence: 'direct'|'derived' }} Edge
 * @typedef {{ nodes: Node[], edges: Edge[], stats: object }} Graph
 */

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

/**
 * Builds a flat Node array from the collected sources object.
 * @param {{ adrs?:any[], workflows?:any[], cards?:any[], sessions?:any[], receipts?:any[], telemetry?:any[] }} sources
 * @returns {Node[]}
 */
export function buildNodes(sources) {
  const s = sources && typeof sources === 'object' ? sources : {};
  const adrs      = Array.isArray(s.adrs)      ? s.adrs      : [];
  const workflows = Array.isArray(s.workflows)  ? s.workflows  : [];
  const cards     = Array.isArray(s.cards)      ? s.cards     : [];
  const sessions  = Array.isArray(s.sessions)   ? s.sessions  : [];
  const receipts  = Array.isArray(s.receipts)   ? s.receipts  : [];
  const telemetry = Array.isArray(s.telemetry)  ? s.telemetry : [];
  const nodes = [];

  for (const adr of adrs) {
    if (!adr) continue;
    const num = String(adr.number ?? '????');
    nodes.push({ id: `adr:${num}`, type: 'adr', label: adr.title || `ADR-${num}`, ref: adr });
  }
  for (const wf of workflows) {
    if (!wf || wf.malformed) continue;
    const slug = String(wf.slug ?? '');
    nodes.push({ id: `wf:${slug}`, type: 'workflow', label: wf.slug || '(unnamed)', ref: wf });
  }
  for (const card of cards) {
    if (!card) continue;
    const id = String(card.id ?? '');
    nodes.push({ id: `card:${id}`, type: 'card', label: card.title || id, ref: card });
  }
  for (const sess of sessions) {
    if (!sess) continue;
    const num = String(sess.number ?? '');
    nodes.push({ id: `session:${num}`, type: 'session', label: sess.title || sess.slug || `session-${num}`, ref: sess });
  }
  for (const receipt of receipts) {
    if (!receipt) continue;
    const taskId = String(receipt.taskId ?? '');
    const cap    = String(receipt.capability ?? '');
    nodes.push({ id: `receipt:${taskId}/${cap}`, type: 'receipt', label: `${taskId}/${cap}`, ref: receipt });
  }
  for (const tele of telemetry) {
    if (!tele) continue;
    const sessId = String(tele.sessionId ?? '');
    nodes.push({ id: `tele:${sessId}`, type: 'telemetry', label: `tele-${sessId}`, ref: tele });
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Edge builders
// ---------------------------------------------------------------------------

/**
 * Builds edges between the collected sources. All resolution is defensive.
 * @param {{ adrs?:any[], workflows?:any[], cards?:any[], receipts?:any[], telemetry?:any[] }} sources
 * @param {Node[]} nodes
 * @returns {Edge[]}
 */
export function buildEdges(sources, nodes) {
  const s = sources && typeof sources === 'object' ? sources : {};
  const adrs      = Array.isArray(s.adrs)      ? s.adrs      : [];
  const workflows = Array.isArray(s.workflows)  ? s.workflows  : [];
  const cards     = Array.isArray(s.cards)      ? s.cards     : [];
  const receipts  = Array.isArray(s.receipts)   ? s.receipts  : [];
  const telemetry = Array.isArray(s.telemetry)  ? s.telemetry : [];

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [];

  /** Adds an edge only when both endpoints exist. */
  function link(from, to, rel, confidence) {
    if (nodeIds.has(from) && nodeIds.has(to)) edges.push({ from, to, rel, confidence });
  }

  // adr → workflow (derived): ADR number appears in any phase ref value
  for (const wf of workflows) {
    if (!wf || wf.malformed) continue;
    const slug = String(wf.slug ?? '');
    const phaseRefs = phaseRefStrings(wf);
    for (const adr of adrs) {
      if (!adr) continue;
      const num = String(adr.number ?? '????');
      const pats = [num, `ADR-${num}`, `adr-${num}`];
      if (phaseRefs.some((ref) => pats.some((pat) => ref.includes(pat)))) {
        link(`adr:${num}`, `wf:${slug}`, 'drives', 'derived');
      }
    }
  }

  // workflow → card (direct): card.workflow === workflow.slug
  for (const card of cards) {
    if (!card) continue;
    const wfSlug = String(card.workflow ?? '');
    if (wfSlug) link(`wf:${wfSlug}`, `card:${String(card.id ?? '')}`, 'ships', 'direct');
  }

  // card → session (direct): ownerSessionId, or fallback to receipt.sessionId
  for (const card of cards) {
    if (!card) continue;
    const cardId  = String(card.id ?? '');
    const sessId  = String(card.ownerSessionId ?? '');
    if (sessId) {
      link(`card:${cardId}`, `session:${sessId}`, 'workedIn', 'direct');
    } else {
      const match = receipts.find((r) => r && String(r.taskId ?? '') === cardId && r.sessionId);
      if (match) link(`card:${cardId}`, `session:${String(match.sessionId)}`, 'workedIn', 'direct');
    }
  }

  // card → receipt (direct): receipt.taskId === card.id
  for (const receipt of receipts) {
    if (!receipt) continue;
    const taskId = String(receipt.taskId ?? '');
    const cap    = String(receipt.capability ?? '');
    link(`card:${taskId}`, `receipt:${taskId}/${cap}`, 'attests', 'direct');
  }

  // session → telemetry (direct): UsageEvent.sessionId matches a session node
  // card → telemetry (direct): UsageEvent.taskId matches a card node
  for (const tele of telemetry) {
    if (!tele) continue;
    const sessId = String(tele.sessionId ?? '');
    const taskId = String(tele.taskId ?? '');
    if (sessId) link(`session:${sessId}`, `tele:${sessId}`, 'costs', 'direct');
    if (taskId) link(`card:${taskId}`, `tele:${sessId}`, 'costs', 'direct');
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Stats helper
// ---------------------------------------------------------------------------

/**
 * Computes summary stats from built nodes and edges.
 * The I/O layer merges in `sources: { present, skipped }`.
 * @param {Node[]} nodes @param {Edge[]} edges
 * @returns {{ byType: Record<string,number>, edgeCount: number }}
 */
export function computeStats(nodes, edges) {
  const byType = {};
  for (const node of nodes) byType[node.type] = (byType[node.type] ?? 0) + 1;
  return { byType, edgeCount: edges.length };
}

// ---------------------------------------------------------------------------
// Subgraph extraction
// ---------------------------------------------------------------------------

/**
 * BFS subgraph from rootId — treats edges as undirected for reachability.
 * Returns only reachable nodes + edges plus recomputed stats.
 * @param {Graph} graph @param {string} rootId
 * @returns {{ nodes: Node[], edges: Edge[], stats: object }}
 */
export function subgraphFrom(graph, rootId) {
  const nodeMap = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
  if (!nodeMap.has(rootId)) return { nodes: [], edges: [], stats: computeStats([], []) };

  const adj = new Map();
  for (const edge of (graph.edges ?? [])) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    if (!adj.has(edge.to))   adj.set(edge.to,   []);
    adj.get(edge.from).push(edge.to);
    adj.get(edge.to).push(edge.from);
  }

  const visited = new Set([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const nb of (adj.get(queue.shift()) ?? [])) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
  }

  const subNodes = (graph.nodes ?? []).filter((n) => visited.has(n.id));
  const subEdges = (graph.edges ?? []).filter((e) => visited.has(e.from) && visited.has(e.to));
  return { nodes: subNodes, edges: subEdges, stats: computeStats(subNodes, subEdges) };
}

// ---------------------------------------------------------------------------
// Digest renderer
// ---------------------------------------------------------------------------

/**
 * Renders a compact human-readable summary of the graph.
 * @param {Graph} graph @returns {string}
 */
export function renderDigest(graph) {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const stats  = graph.stats ?? computeStats(nodes, edges);
  const byType = stats.byType ?? {};
  const lines  = [`Lineage graph: ${nodes.length} nodes, ${edges.length} edges`];

  for (const type of ['adr', 'workflow', 'card', 'session', 'receipt', 'telemetry']) {
    const count = byType[type] ?? 0;
    if (count > 0) lines.push(`  ${type}: ${count}`);
  }

  const srcPresent = stats.sources?.present ?? [];
  const srcSkipped = stats.sources?.skipped ?? [];
  if (srcPresent.length > 0) lines.push(`  sources present: ${srcPresent.join(', ')}`);
  if (srcSkipped.length > 0) lines.push(`  sources skipped: ${srcSkipped.join(', ')}`);

  const sample = edges.slice(0, 40);
  if (sample.length > 0) {
    lines.push('', 'Edges:');
    for (const edge of sample) lines.push(`  ${edge.from} --${edge.rel}--> ${edge.to} (${edge.confidence})`);
    if (edges.length > 40) lines.push(`  … and ${edges.length - 40} more`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Collects all non-empty phase ref strings from a workflow object.
 * @param {object} wf @returns {string[]}
 */
function phaseRefStrings(wf) {
  const phases = wf?.phases;
  if (!phases || typeof phases !== 'object') return [];
  return Object.values(phases).map((ps) => ps?.ref).filter(Boolean).map(String);
}
