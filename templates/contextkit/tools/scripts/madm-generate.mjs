/**
 * madm-generate.mjs — Minimum Viable Auto-Domain-Map generator (BIZ-0005 / WF-0076,
 * ADR-0143 §MADM). Seeds a DECLARED domain map from the committed structural graph
 * (BIZ-0004, `graph-query.mjs::loadProjection`) so the already-BLOCKING+ACTIVE DDD
 * Class-A structural rules light up WITHOUT a human hand-authoring bounded contexts.
 *
 * FREEZE-AND-RATCHET (the safety key, ADR-0143): the generated map is a BASELINE of
 * the CURRENT structure — `allowedRelations` = the inter-context edges that exist
 * right now, frozen. It therefore can NEVER block existing code; only a NEW
 * cross-context edge (or a NEW public-contract removal, wired separately) can fire on
 * a later run. A wrong boundary guess can only MISS a pre-existing violation (a
 * false-negative, which the constitution prefers), never false-block the tree.
 *
 * PROFILE GATE (proportionality, artifact-schemas `neverForProfiles`): returns a
 * null map for every profile below `domain-driven`/`distributed-domain`. A thin
 * CRUD/script project (`no-code`/`simple`/`modular`) gets NO map — no ceremony.
 *
 * PROVENANCE: every derived element carries `provenance:"auto-derived"` + a
 * confidence. `demoteAutoFinding` turns a BLOCKING finding sourced from a
 * low-confidence auto element into OBSERVE_ONLY — a layperson who cannot correct a
 * bad auto-boundary is never blocked by one.
 *
 * INTENT RULES STAY DORMANT: this never emits aggregates, invariants, or domain
 * events (a call graph shows structure, not business rules). Those 3 Class-A intent
 * rules remain human-declared / OBSERVE_ONLY.
 *
 * PURE + fail-open: no clock, no randomness; deterministic (sorted) so a re-gen is
 * byte-identical. A missing/unparsable graph yields `{ map: null, reason }` — never
 * a throw. Zero runtime dependencies beyond the sibling `graph-query.mjs`.
 *
 * @module tools/scripts/madm-generate
 */
import { loadProjection } from './graph-query.mjs';

/** MADM schema version — bump on any breaking shape change. */
export const MADM_VERSION = '1.0.0';

/** Profiles a MADM is generated for (proportionality gate). */
export const MADM_PROFILES = Object.freeze(['domain-driven', 'distributed-domain']);

/** Path-segment hints that classify a context as infrastructure (edge-of-the-onion). */
const INFRA_HINTS = Object.freeze([
  'db', 'database', 'http', 'adapter', 'adapters', 'client', 'clients', 'infra',
  'infrastructure', 'persistence', 'transport', 'gateway', 'repository', 'repositories',
  'store', 'io', 'net', 'rpc', 'queue', 'cache',
]);

/** Path-segment hints that classify a context as domain (the core). */
const DOMAIN_HINTS = Object.freeze([
  'domain', 'core', 'model', 'models', 'entity', 'entities', 'aggregate', 'aggregates',
  'usecase', 'use-case', 'usecases', 'service', 'services', 'policy', 'policies',
]);

/** Confidence bands stamped on derived elements. */
const CONFIDENCE = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

/**
 * Generate a Minimum Viable Auto-Domain-Map for `root`. PURE given the on-disk graph;
 * fail-open. Returns `{ map, reason, provenance }` where `map` is the declared-map
 * shape `project-map-compare.mjs` reads, or `null` when profile-gated / graph-absent.
 *
 * @param {string} root project root (the graph is resolved under it).
 * @param {{ profile?: string }} [opts]
 * @returns {{ map: object|null, reason: string, provenance: object }}
 */
export function generateMadm(root, { profile } = {}) {
  if (!MADM_PROFILES.includes(profile)) {
    return { map: null, reason: `profile "${profile ?? '(none)'}" below domain-driven — no map (proportionality)`, provenance: base(profile) };
  }
  let projection;
  try {
    projection = loadProjection(root);
  } catch (err) {
    return { map: null, reason: `graph load threw: ${err?.message ?? err}`, provenance: base(profile) };
  }
  if (!projection || projection.available !== true) {
    return { map: null, reason: projection?.reason || 'no committed graph projection', provenance: base(profile) };
  }

  const filePaths = collectFilePaths(projection.nodes);
  if (filePaths.length === 0) {
    return { map: null, reason: 'graph has no file/module nodes with a path — nothing to derive', provenance: base(profile) };
  }

  const contexts = deriveContexts(filePaths);
  const pathToCtx = contextIndex(contexts);
  const allowedRelations = deriveAllowedRelations(projection.edges, projection.nodes, pathToCtx);
  const { domainPaths, infrastructurePaths } = classifyContextPaths(contexts);

  const map = {
    schemaVersion: MADM_VERSION,
    contexts: contexts.map((ctx) => ({ name: ctx.name, path: ctx.path, internalPaths: ctx.internalPaths })),
    domainPaths,
    infrastructurePaths,
    allowedRelations,
  };
  return { map, reason: 'ok', provenance: provenanceFor(profile, contexts, allowedRelations) };
}

/**
 * Demote a BLOCKING fitness finding to OBSERVE_ONLY when it is sourced from a
 * low-confidence auto-derived element (ADR-0143 provenance-aware demotion). A finding
 * with no provenance, or high/medium confidence, passes through unchanged.
 *
 * @param {object} finding a fitness finding (has at least `enforcement`).
 * @param {object} [source] the MADM element it was derived from (has `confidence`).
 * @returns {object} the finding, possibly with `enforcement: 'OBSERVE_ONLY'` + a note.
 */
export function demoteAutoFinding(finding, source) {
  if (!finding || typeof finding !== 'object') return finding;
  const confidence = source && typeof source === 'object' ? source.confidence : undefined;
  const isBlocking = finding.enforcement === 'BLOCKING' || finding.enforcement === 'BLOCK';
  if (isBlocking && confidence === CONFIDENCE.LOW) {
    return { ...finding, enforcement: 'OBSERVE_ONLY', demotedFrom: finding.enforcement, demotionReason: 'auto-derived low-confidence boundary (ADR-0143 provenance demotion)' };
  }
  return finding;
}

// ---------------------------------------------------------------------------
// Derivation (pure, deterministic)
// ---------------------------------------------------------------------------

/** Collect distinct forward-slash file paths from file/module graph nodes. */
function collectFilePaths(nodes) {
  const set = new Set();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || (node.kind !== 'file' && node.kind !== 'module')) continue;
    const raw = node.sourceFile || node.path || node.file;
    if (typeof raw === 'string' && raw.length > 0) set.add(norm(raw));
  }
  return [...set].sort();
}

/**
 * Derive bounded-context candidates: one per top-level source directory. Root-level
 * files bucket into a `(root)` context. `internalPaths` = the depth-2 subdirs under
 * the context (a deep import into these is a boundary violation downstream).
 */
function deriveContexts(filePaths) {
  const byTop = new Map();
  for (const path of filePaths) {
    const top = topSegment(path);
    if (!byTop.has(top)) byTop.set(top, new Set());
    const sub = secondSegment(path);
    if (sub) byTop.get(top).add(`${top}/${sub}`);
  }
  // Root-level loose files are NOT a bounded context (a context is a directory), and
  // the comparator cannot match an empty path prefix — emitting a path-less `(root)`
  // context would self-inflict a permanent "declared context absent" finding. Skip it.
  return [...byTop.keys()].filter((top) => top !== '(root)').sort().map((top) => ({
    name: top,
    path: top,
    internalPaths: [...byTop.get(top)].sort(),
  }));
}

/** Build a prefix→contextName index for resolving a module/file path to its context. */
function contextIndex(contexts) {
  return contexts
    .filter((ctx) => ctx.path.length > 0)
    .map((ctx) => ({ prefix: ctx.path, name: ctx.name }))
    .sort((a, b) => b.prefix.length - a.prefix.length); // longest-prefix first
}

/**
 * Freeze the CURRENT inter-context relations as the allow-list. Walks `imports`
 * edges, resolves each endpoint's path to a context, and collects distinct
 * cross-context [from,to] pairs — sorted for determinism. This is the ratchet
 * baseline: only relations NOT in this set fire on a later run.
 */
function deriveAllowedRelations(edges, nodes, pathIndex) {
  const idToPath = nodeIdToPath(nodes);
  const pairs = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || edge.relation !== 'imports') continue;
    const fromPath = idToPath.get(edge.source);
    const toPath = idToPath.get(edge.target);
    if (!fromPath || !toPath) continue;
    const fromCtx = ctxOf(fromPath, pathIndex);
    const toCtx = ctxOf(toPath, pathIndex);
    if (fromCtx && toCtx && fromCtx !== toCtx) pairs.add(`${fromCtx} ${toCtx}`);
  }
  return [...pairs].sort().map((key) => key.split(' '));
}

/** Map a graph node id (`file:x` / `mod:x`) to its best-known forward-slash path. */
function nodeIdToPath(nodes) {
  const map = new Map();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node.id !== 'string') continue;
    const raw = node.sourceFile || node.path || node.file || label(node);
    if (typeof raw === 'string' && raw.length > 0) map.set(node.id, norm(raw));
  }
  return map;
}

/** Classify each context's path as domain or infrastructure by segment hint. */
function classifyContextPaths(contexts) {
  const domainPaths = [];
  const infrastructurePaths = [];
  for (const ctx of contexts) {
    if (ctx.path.length === 0) continue;
    const segs = ctx.path.toLowerCase().split('/');
    if (segs.some((s) => INFRA_HINTS.includes(s))) infrastructurePaths.push(ctx.path);
    else if (segs.some((s) => DOMAIN_HINTS.includes(s))) domainPaths.push(ctx.path);
  }
  return { domainPaths: domainPaths.sort(), infrastructurePaths: infrastructurePaths.sort() };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Base provenance stamp (no map produced). */
function base(profile) {
  return { generator: 'madm', version: MADM_VERSION, provenance: 'auto-derived', profile: profile ?? null, confidence: CONFIDENCE.LOW };
}

/**
 * Provenance for a produced map. contexts (structural) are HIGH; the frozen relation
 * baseline is HIGH (it is observed, not guessed); domain/infra path LABELS are the
 * only heuristic → LOW (they drive the demotion path).
 */
function provenanceFor(profile, contexts, allowedRelations) {
  return {
    generator: 'madm', version: MADM_VERSION, provenance: 'auto-derived', profile,
    contexts: { count: contexts.length, confidence: CONFIDENCE.HIGH },
    allowedRelations: { count: allowedRelations.length, confidence: CONFIDENCE.HIGH },
    pathLabels: { confidence: CONFIDENCE.LOW, note: 'domain/infra labels are heuristic — findings sourced from them demote to OBSERVE_ONLY' },
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Forward-slash normalise. */
function norm(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

/** Top-level directory segment, or `(root)` for a bare filename. */
function topSegment(path) {
  const slash = path.indexOf('/');
  return slash === -1 ? '(root)' : path.slice(0, slash);
}

/** Second path segment (depth-2 dir) if it names a further directory, else ''. */
function secondSegment(path) {
  const parts = path.split('/');
  return parts.length >= 3 ? parts[1] : '';
}

/** Longest-prefix context name for a path, or null. */
function ctxOf(path, pathIndex) {
  for (const entry of pathIndex) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) return entry.name;
  }
  return null;
}

/** A module node's label as a last-resort path (`mod:tools` → `tools`). */
function label(node) {
  if (typeof node.label === 'string' && node.label.length > 0) return node.label;
  const id = String(node.id);
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}
