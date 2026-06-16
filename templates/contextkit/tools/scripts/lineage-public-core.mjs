/**
 * lineage-public-core.mjs — Pure redaction of a lineage graph to a public-safe view.
 *
 * CDK-071 / ADR-0072. Read-only, advisory, unregistered, fail-open.
 * No I/O — callers pass the full graph built by lineage-graph.mjs.
 *
 * Public projection rules:
 *   - KEEP: adr nodes projected to {number,title,status,decision} only.
 *   - KEEP: edges between surviving public nodes (from/to/rel only, no refs).
 *   - DROP: workflow, card, session, receipt, telemetry nodes.
 *   - DROP: all node.ref objects (contain host, scope, fingerprints, file-paths).
 *
 * The `redacted` array lists the dropped field families so callers can audit
 * exactly what was stripped (§8: skipped ≠ pass — consumers see what was dropped).
 *
 * Zero runtime dependencies — pure functions only.
 *
 * @typedef {{ number: string, title: string, status: string, decision: string }} PublicAdr
 * @typedef {{ from: string, to: string, rel: string }} PublicEdge
 * @typedef {{ adrs: PublicAdr[], edges: PublicEdge[], redacted: string[] }} PublicGraph
 */

/**
 * Field families stripped during redaction. Listed explicitly so the output is
 * self-documenting (consumers and auditors see exactly what was removed).
 * Labels use hyphen-case (no camelCase key names) to avoid leaking internal
 * identifiers into the public surface.
 */
const REDACTED_FAMILIES = Object.freeze([
  'session-ids',
  'receipt-fingerprints',
  'card-owner-ids',
  'host',
  'cost-telemetry',
  'file-paths',
  'scope',
]);

/**
 * Projects a node-type string to a boolean indicating public visibility.
 * Only `adr` nodes are retained in the public view.
 *
 * @param {string} nodeType  e.g. 'adr', 'workflow', 'card', 'session', 'receipt', 'telemetry'
 * @returns {boolean}
 */
function isPublicNodeType(nodeType) {
  return nodeType === 'adr';
}

/**
 * Projects a full ADR node's `ref` object to the public catalog fields only.
 * Unknown or missing fields default to empty string.
 *
 * @param {object} adrRef  raw ref from the lineage graph adr node
 * @returns {PublicAdr}
 */
function projectAdrRef(adrRef) {
  const safeRef = (adrRef && typeof adrRef === 'object') ? adrRef : {};
  return {
    number:   String(safeRef.number   ?? '????'),
    title:    String(safeRef.title    ?? ''),
    status:   String(safeRef.status   ?? ''),
    decision: String(safeRef.decision ?? ''),
  };
}

/**
 * Redacts a full lineage graph to a public-safe projection.
 *
 * Keeps only `adr` nodes, projected to {number,title,status,decision}.
 * Keeps only edges whose both endpoints remain in the public node set.
 * Drops receipt, session, telemetry, workflow, and card nodes entirely.
 *
 * @param {{ nodes?: object[], edges?: object[] }} graph  full lineage graph
 * @returns {PublicGraph}
 */
export function redactGraph(graph) {
  const safeGraph = (graph && typeof graph === 'object') ? graph : {};
  const allNodes  = Array.isArray(safeGraph.nodes) ? safeGraph.nodes : [];
  const allEdges  = Array.isArray(safeGraph.edges) ? safeGraph.edges : [];

  // Collect public node ids first — only adr nodes survive
  const publicNodeIds = new Set();
  const publicAdrs = [];

  for (const node of allNodes) {
    if (!node || typeof node !== 'object') continue;
    if (!isPublicNodeType(node.type)) continue;
    publicNodeIds.add(node.id);
    publicAdrs.push(projectAdrRef(node.ref));
  }

  // Keep edges only when both endpoints are public
  const publicEdges = [];
  for (const edge of allEdges) {
    if (!edge || typeof edge !== 'object') continue;
    if (!publicNodeIds.has(edge.from) || !publicNodeIds.has(edge.to)) continue;
    publicEdges.push({
      from: String(edge.from ?? ''),
      to:   String(edge.to   ?? ''),
      rel:  String(edge.rel  ?? ''),
    });
  }

  return {
    adrs:     publicAdrs,
    edges:    publicEdges,
    redacted: Array.from(REDACTED_FAMILIES),
  };
}
