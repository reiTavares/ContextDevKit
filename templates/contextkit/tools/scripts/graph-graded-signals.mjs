#!/usr/bin/env node
/**
 * Graph-derived graded arch-debt signals (SR2, WF-0073/BIZ-0004) — the ENFORCES
 * verb, governed by ADR-0137.
 *
 * Reads the committed graph projection and produces graded findings for the
 * arch-debt gate: symbol/file-level import cycles and god-node concentration.
 * The promotion ladder (ADR-0125): OBSERVE_ONLY -> ADVISORY -> BLOCKING, and a
 * finding may carry a BLOCKING enforcement level ONLY when it is built on
 * confident, resolved Tier-1 (AST, EXTRACTED) edges — i.e. evidenceClass is in
 * the deterministic tier. Regex-tier (Tier-0, HEURISTIC) and semantic (Tier-2)
 * signals stay ADVISORY forever. Because the AST parser is not installed yet
 * (WF-0074), every signal today resolves to ADVISORY — that is the honest,
 * shadow-calibration posture, not a limitation to paper over.
 *
 * Hard invariants (ADR-0137):
 *   - a partial/absent graph -> UNKNOWN, never a fabricated "0 cycles" pass;
 *   - a finding message is STRUCTURAL (ruleId + node ids + metric), never a
 *     string lifted from a node's free text (injection-laundering firewall);
 *   - no finding claims a BLOCKING level on a non-deterministic evidence class.
 *
 * Pure, deterministic. Reads pre-computed JSON only (hot-path safe). Zero
 * non-`node:` imports beyond the sibling graph-query.
 */
import { loadProjection } from './graph-query.mjs';

/** Evidence classes that MAY carry a blocking floor (mirrors finding-enums DETERMINISTIC_TIER). */
const DETERMINISTIC_TIER = new Set(['SCHEMA_DERIVED', 'DETERMINISTIC', 'GRAPH_DERIVED', 'TEST_DERIVED']);
/** Relations whose cycles indicate a real dependency loop. */
const CYCLE_RELATIONS = new Set(['imports', 'imports_from', 're_exports', 'calls']);

/**
 * The enforcement level a finding may carry, per the ADR-0137 ladder. A finding
 * is only BLOCKING-eligible when its evidence is deterministic AND every edge it
 * rests on is a resolved (EXTRACTED) Tier-1 edge. Otherwise ADVISORY.
 * @param {string} evidenceClass
 * @param {boolean} allExtracted every supporting edge is EXTRACTED
 * @returns {'ADVISORY'|'BLOCKING'}
 */
function enforcementFor(evidenceClass, allExtracted) {
  return DETERMINISTIC_TIER.has(evidenceClass) && allExtracted ? 'BLOCKING' : 'ADVISORY';
}

/** Builds a directed adjacency of only cycle-relevant edges, keeping the edge objects. */
function cycleAdjacency(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!CYCLE_RELATIONS.has(e.relation)) continue;
    if (e.target.startsWith('unresolved:')) continue; // never build a cycle through a synthetic node
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e);
  }
  return adj;
}

/**
 * Elementary directed cycles via DFS back-edges, rotation-normalized + deduped
 * (mirrors project-map-insights cycle discovery). Bounded to keep it tractable.
 * @param {Map<string, object[]>} adj
 * @param {number} [maxCycles=50]
 * @returns {Array<{ nodes:string[], edges:object[] }>}
 */
function findCycles(adj, maxCycles = 50) {
  const cycles = [];
  const seenKeys = new Set();
  const state = new Map(); // 0=unvisited,1=in-stack,2=done
  const stack = [];
  const edgeStack = [];
  const nodes = [...adj.keys()].sort();

  const normalize = (cycleNodes) => {
    let min = 0;
    for (let i = 1; i < cycleNodes.length; i++) if (cycleNodes[i] < cycleNodes[min]) min = i;
    return cycleNodes.slice(min).concat(cycleNodes.slice(0, min)).join('>');
  };

  const dfs = (node) => {
    if (cycles.length >= maxCycles) return;
    state.set(node, 1); stack.push(node);
    for (const edge of (adj.get(node) || [])) {
      const next = edge.target;
      if (state.get(next) === 1) {
        const at = stack.indexOf(next);
        if (at !== -1) {
          const cycleNodes = stack.slice(at);
          const key = normalize(cycleNodes);
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cycles.push({ nodes: cycleNodes.slice(), edges: edgeStack.slice(at).concat(edge) });
          }
        }
      } else if (!state.has(next) || state.get(next) === 0) {
        edgeStack.push(edge);
        dfs(next);
        edgeStack.pop();
      }
    }
    stack.pop(); state.set(node, 2);
  };

  for (const node of nodes) if (!state.has(node)) dfs(node);
  return cycles.slice(0, maxCycles);
}

/** A structural finding — message never contains node free text (injection firewall). */
function finding(ruleId, dimension, enforcement, evidenceClass, subjects, metric) {
  return {
    ruleId, dimension, enforcement, evidenceClass,
    subjects: [...subjects].sort(),
    metric,
    message: `${ruleId}: ${metric} over ${subjects.length} node(s)`,
    status: 'PRESENT',
  };
}

/**
 * Collects graded graph-derived findings from the committed projection. Absent
 * graph -> a single UNKNOWN finding, never a fabricated clean pass.
 *
 * @param {string} root project root
 * @param {{godNodeDegree?:number}} [opts]
 * @returns {{available:false, status:'UNKNOWN', reason:string, evidenceClass:string}
 *   | {available:true, findings:object[], evidenceClass:string}}
 */
export function collectGradedSignals(root, opts = {}) {
  const projection = loadProjection(root);
  if (!projection.available) {
    return { available: false, status: 'UNKNOWN', reason: projection.reason, evidenceClass: 'GRAPH_DERIVED' };
  }
  const findings = [];

  // 1. Import/call cycles.
  const adj = cycleAdjacency(projection.edges);
  for (const cycle of findCycles(adj)) {
    const allExtracted = cycle.edges.every((e) => e.resolution === 'EXTRACTED');
    // A cycle is only as strong as its weakest edge's evidence.
    const evidenceClass = allExtracted && cycle.edges.every((e) => DETERMINISTIC_TIER.has(e.evidenceClass))
      ? 'GRAPH_DERIVED' : 'HEURISTIC';
    findings.push(finding('graph.cycle', 'MODULARITY', enforcementFor(evidenceClass, allExtracted),
      evidenceClass, cycle.nodes, `import/call cycle length ${cycle.nodes.length}`));
  }

  // 2. God-node concentration (degree well above the field).
  const degree = new Map();
  for (const e of projection.edges) {
    if (e.source.startsWith('unresolved:') || e.target.startsWith('unresolved:')) continue;
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const threshold = opts.godNodeDegree || 100;
  for (const [id, deg] of [...degree.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (deg < threshold) continue;
    // God-node degree is structural (edge count), deterministic — but it is an
    // OBSERVE-style smell, so it stays ADVISORY regardless of edge resolution.
    findings.push(finding('graph.god-node', 'COGNITIVE_COHERENCE', 'ADVISORY', 'GRAPH_DERIVED', [id], `degree ${deg}`));
  }

  return { available: true, findings, evidenceClass: 'GRAPH_DERIVED' };
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-graded-signals.mjs') {
  const out = collectGradedSignals(process.cwd());
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
