/**
 * Architecture-conformance FLOOR RULES (WF-0057 W2.2, ADR-0122) — the pure,
 * deterministic predicates the `ArchitectureConformanceEvaluator` composes. Split
 * from `conformance-evaluator.mjs` because the rule bodies (cycle diffing, layer
 * classification, edge-direction policy, state-authority counting) are a distinct,
 * individually-testable concern from the evaluator's orchestration/fail-closed
 * envelope (constitution §1 cohesive seam). Each rule is a pure function: graph +
 * baseline + config in, a list of `{ ... }` violation descriptors out — the
 * evaluator lifts those into validated `Finding`s.
 *
 * GRAPH_DERIVED only (cycles, edge direction) and SCHEMA_DERIVED (declared state
 * ownership). Baseline-relative by construction: a rule returns ONLY what is NEW
 * vs the baseline, so an untouched legacy violation never blocks unrelated work
 * (W0-contracts §25, test §34.15). Zero runtime deps, ESM, node:/relative only.
 */

/** Normalize one cycle (array of module paths) to a stable, rotation-independent key. */
export function cycleKey(cycle) {
  const nodes = (cycle || []).filter((n) => typeof n === 'string' && n);
  if (nodes.length === 0) return '';
  const min = nodes.indexOf([...nodes].sort()[0]);
  return [...nodes.slice(min), ...nodes.slice(0, min)].join('>');
}

/** Build a Set of normalized cycle keys from a `string[][]` cycle list. */
function cycleKeySet(cycles) {
  const set = new Set();
  for (const cycle of cycles || []) {
    const key = cycleKey(cycle);
    if (key) set.add(key);
  }
  return set;
}

/**
 * F1 — new forbidden dependency cycle. A cycle blocks ONLY when its normalized key
 * is absent from the baseline (pre-existing cycles are reported elsewhere, never
 * block unrelated work). Pure diff over the two cycle lists.
 *
 * @param {string[][]} cycles   cycles in the current graph (from computeInsights)
 * @param {string[][]} baselineCycles  cycles in the baseline graph
 * @returns {Array<{key:string, nodes:string[]}>} the NEW cycles only
 */
export function newCycles(cycles, baselineCycles) {
  const baseKeys = cycleKeySet(baselineCycles);
  const out = [];
  for (const cycle of cycles || []) {
    const key = cycleKey(cycle);
    if (key && !baseKeys.has(key)) out.push({ key, nodes: [...cycle] });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Longest matching layer prefix wins, so `domain/infra` beats `domain`. */
function classifyLayer(path, layers) {
  let best = null;
  let bestLen = -1;
  for (const [layer, prefixes] of Object.entries(layers || {})) {
    for (const prefix of prefixes || []) {
      const norm = String(prefix).replaceAll('\\', '/');
      if ((path === norm || path.startsWith(norm)) && norm.length > bestLen) {
        best = layer;
        bestLen = norm.length;
      }
    }
  }
  return best;
}

/** Set of `"from→to"` edge keys present in the baseline (pre-existing, never block). */
function baselineEdgeSet(baselineEdges) {
  const set = new Set();
  for (const edge of baselineEdges || []) {
    if (edge && edge.from && edge.to) set.add(`${edge.from}→${edge.to}`);
  }
  return set;
}

/** True iff this importer is an explicitly-allowed adapter (legit boundary crossing). */
function isAdapter(fromPath, fromLayer, rules) {
  const adapters = (rules.adapters || []).map((p) => String(p).replaceAll('\\', '/'));
  if (adapters.some((a) => fromPath === a || fromPath.startsWith(a))) return true;
  return Array.isArray(rules.adapterLayers) && rules.adapterLayers.includes(fromLayer);
}

/**
 * F2 — boundary / dependency-direction violation. An edge `from → to` violates a
 * boundary when (fromLayer → toLayer) is in `rules.forbidden` AND the importer is
 * not a declared adapter. Baseline-relative: an edge already in `baselineEdges`
 * is pre-existing and never blocks. The recommended action distinguishes a
 * domain→infra leak (INVERT_DEPENDENCY) from a generic boundary breach
 * (RESTORE_BOUNDARY).
 *
 * @param {Array<{path:string, deps?:string[]}>} modules  graph modules (edge model)
 * @param {{layers:Object, forbidden:Array<{from:string,to:string}>, adapters?:string[], adapterLayers?:string[], invertPairs?:Array<{from:string,to:string}>}} rules
 * @param {Array<{from:string,to:string}>} [baselineEdges]  pre-existing forbidden edges
 * @returns {Array<{from:string, to:string, fromLayer:string, toLayer:string, action:'INVERT_DEPENDENCY'|'RESTORE_BOUNDARY'}>}
 */
export function boundaryViolations(modules, rules, baselineEdges) {
  if (!rules || !Array.isArray(rules.forbidden) || rules.forbidden.length === 0) return [];
  const forbidden = new Set(rules.forbidden.map((p) => `${p.from}→${p.to}`));
  const invert = new Set((rules.invertPairs || []).map((p) => `${p.from}→${p.to}`));
  const known = new Set((modules || []).map((m) => m.path));
  const baseEdges = baselineEdgeSet(baselineEdges);
  const out = [];
  for (const mod of modules || []) {
    const fromLayer = classifyLayer(mod.path, rules.layers);
    if (!fromLayer) continue;
    for (const dep of mod.deps || []) {
      if (!known.has(dep) || dep === mod.path) continue;
      const toLayer = classifyLayer(dep, rules.layers);
      if (!toLayer) continue;
      const pair = `${fromLayer}→${toLayer}`;
      if (!forbidden.has(pair)) continue;
      if (baseEdges.has(`${mod.path}→${dep}`)) continue; // pre-existing, don't block
      if (isAdapter(mod.path, fromLayer, rules)) continue; // legit adapter boundary
      out.push({
        from: mod.path,
        to: dep,
        fromLayer,
        toLayer,
        action: invert.has(pair) ? 'INVERT_DEPENDENCY' : 'RESTORE_BOUNDARY',
      });
    }
  }
  return out.sort((a, b) => `${a.from}→${a.to}`.localeCompare(`${b.from}→${b.to}`));
}

/**
 * F3 — duplicate canonical state authority. Each declared write-authority claims a
 * `state` for a `module`; the `ownership` map names the ONE canonical owner per
 * state. A claim by a non-owner is a duplicate authority. Baseline-relative: a
 * claim already in `baselineAuthorities` is pre-existing and never blocks; only a
 * NEW non-owner claim (a short module that just appeared as a second writer)
 * blocks (test §34.2).
 *
 * @param {Array<{state:string, module:string}>} writeAuthorities  declared writers
 * @param {Record<string,string>} ownership  canonical owner module per state key
 * @param {Array<{state:string, module:string}>} [baselineAuthorities]  pre-existing claims
 * @returns {Array<{state:string, module:string, owner:string}>} new duplicate authorities
 */
export function duplicateStateAuthorities(writeAuthorities, ownership, baselineAuthorities) {
  if (!ownership || typeof ownership !== 'object') return [];
  const baseClaims = new Set(
    (baselineAuthorities || []).map((a) => `${a.state}::${a.module}`),
  );
  const out = [];
  for (const claim of writeAuthorities || []) {
    if (!claim || !claim.state || !claim.module) continue;
    const owner = ownership[claim.state];
    if (!owner) continue; // unowned state → not this floor's concern
    if (claim.module === owner) continue; // the canonical owner, legit
    if (baseClaims.has(`${claim.state}::${claim.module}`)) continue; // pre-existing
    out.push({ state: claim.state, module: claim.module, owner });
  }
  return out.sort(
    (a, b) => a.state.localeCompare(b.state) || a.module.localeCompare(b.module),
  );
}
