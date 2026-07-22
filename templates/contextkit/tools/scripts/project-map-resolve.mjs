#!/usr/bin/env node
/**
 * Two-phase cross-file resolver — regex tier (GC2-T1, WF-0071/BIZ-0004).
 *
 * Turns the structural nodes/edges from graph-extract.mjs (modules, files,
 * symbols + contains/imports edges) into resolved calls edges, honoring the
 * frozen GC0 contract (gc0-report.md section 2):
 *
 *   - a call whose name is same-file-declared OR imported AND uniquely declared
 *     in the SAME language family -> calls edge, resolution EXTRACTED,
 *     evidenceClass GRAPH_DERIVED, to that symbol node;
 *   - anything else (unknown name, multiple candidates, cross-family) -> ONE
 *     calls edge, resolution AMBIGUOUS, evidenceClass HEURISTIC, to a synthetic
 *     unresolved:<name> target that is NEVER promoted to a real node;
 *   - the cross-language phantom guard demotes any EXTRACTED calls edge whose
 *     source-file family differs from its target-file family to AMBIGUOUS — a
 *     cross-family call is a fabricated fact and is refused, never dropped
 *     silently (constitution section 8: UNKNOWN, never a phantom EXTRACTED).
 *     resolveCall is already family-safe, so the guard is defense-in-depth.
 *
 * Source attribution is FILE-level at the regex tier (file:<path> is the actor):
 * "this file calls X". Declarations (function/def/class NAME) are NOT counted as
 * calls. Symbol->symbol caller precision is an AST-tier (WF-0074) improvement —
 * deliberately deferred, not faked.
 *
 * dedupNodes collapses near-duplicate labels within the same kind+family via
 * Jaro-Winkler similarity + union-find, deterministically, never across a
 * language family. MinHash/LSH blocking is DEFERRED (not needed at this scale).
 *
 * Zero non-node: imports beyond the sibling graph-extract.mjs.
 */
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { extractSymbols } from './graph-extract.mjs';
import { disposeParser, extractAstFile, grammarForPath, loadTreeSitter } from './graph-ast.mjs';

/** Extension -> interop family for the cross-language phantom guard (GC0 section 2). */
const FAMILY = {
  '.js': 'web', '.jsx': 'web', '.mjs': 'web', '.cjs': 'web', '.ts': 'web',
  '.tsx': 'web', '.vue': 'web', '.svelte': 'web',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.rb': 'ruby',
};

/** Control-flow / keyword tokens that look like calls but are not (noise filter). */
const NON_CALL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await',
  'typeof', 'new', 'super', 'def', 'func', 'fn', 'class', 'and', 'or', 'not',
  'in', 'is', 'del', 'print', 'len', 'range', 'match', 'with', 'else', 'elif',
  'require', 'import', 'export', 'const', 'let', 'var', 'do', 'try',
]);

/** Language family for a repo-relative file path (other when unknown). */
function familyOf(filePath) {
  return FAMILY[extname(filePath).toLowerCase()] || 'other';
}

/**
 * Scans one source file's text for the call names it issues and the local names
 * it imports. A declaration (function/def/class/func/fn NAME) is NOT a call.
 * Pure; no I/O. Deterministic (insertion-ordered).
 *
 * @param {string} text file contents
 * @returns {{ callNames: string[], importedNames: Set<string> }}
 */
function scanFile(text) {
  const importedNames = new Set();
  const importRe = /import\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s+from/g;
  let im;
  while ((im = importRe.exec(text))) {
    if (im[1]) {
      for (const part of im[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) importedNames.add(name);
      }
    } else if (im[2]) {
      importedNames.add(im[2]);
    }
  }
  const callNames = [];
  const seen = new Set();
  const callRe = /(?:^|[^.\w$])(function\s+|def\s+|class\s+|func\s+|fn\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  let cm;
  while ((cm = callRe.exec(text))) {
    if (cm[1]) continue;
    const name = cm[2];
    if (!NON_CALL.has(name) && !seen.has(name)) { seen.add(name); callNames.push(name); }
  }
  return { callNames, importedNames };
}

/** Builds a calls edge with the given resolution/evidence class. */
function callsEdge(source, target, resolution, evidenceClass, context) {
  const edge = { source, target, relation: 'calls', resolution, confidenceScore: null, evidenceClass };
  if (context) edge.context = context;
  return edge;
}

/**
 * Indexes the extractor's symbol nodes for resolution: which symbol names are
 * declared in which files, and the node id for a (file, name) pair.
 *
 * @param {Array<{id:string, kind:string, label:string, sourceFile?:string}>} nodes
 * @returns {{ declaredByFile: Map<string, Set<string>>, idByFileName: Map<string, string>,
 *   filesByName: Map<string, string[]> }}
 */
function indexSymbols(nodes) {
  const declaredByFile = new Map();
  const idByFileName = new Map();
  const filesByName = new Map();
  for (const node of nodes) {
    if (node.kind !== 'function' || !node.sourceFile) continue;
    const file = node.sourceFile;
    if (!declaredByFile.has(file)) declaredByFile.set(file, new Set());
    declaredByFile.get(file).add(node.label);
    idByFileName.set(`${file}#${node.label}`, node.id);
    if (!filesByName.has(node.label)) filesByName.set(node.label, []);
    filesByName.get(node.label).push(file);
  }
  return { declaredByFile, idByFileName, filesByName };
}

/**
 * Resolves one call name issued from file to a target + confidence, per the GC0
 * contract. Conservative: EXTRACTED only when a same-family definition is
 * proven; otherwise AMBIGUOUS to a synthetic (non-node) target.
 *
 * @returns {{ target:string, resolution:string, evidenceClass:string, context?:string }}
 */
function resolveCall(name, file, index, importedNames) {
  const family = familyOf(file);
  if (index.declaredByFile.get(file)?.has(name)) {
    return { target: index.idByFileName.get(`${file}#${name}`), resolution: 'EXTRACTED', evidenceClass: 'GRAPH_DERIVED' };
  }
  const candidates = index.filesByName.get(name) || [];
  const sameFamily = candidates.filter((f) => familyOf(f) === family);
  if (importedNames.has(name) && sameFamily.length === 1) {
    return { target: index.idByFileName.get(`${sameFamily[0]}#${name}`), resolution: 'EXTRACTED', evidenceClass: 'GRAPH_DERIVED' };
  }
  const crossFamily = candidates.filter((f) => familyOf(f) !== family);
  const context = crossFamily.length
    ? `cross-family candidates: ${crossFamily.sort().join(', ')}`
    : (candidates.length ? `ambiguous candidates: ${[...candidates].sort().join(', ')}` : 'unresolved');
  return { target: `unresolved:${name}`, resolution: 'AMBIGUOUS', evidenceClass: 'HEURISTIC', context };
}

/**
 * Two-phase resolver. Phase 1 reads each file and scans call/import facts;
 * Phase 2 resolves them cross-file, then the phantom guard demotes any
 * cross-family EXTRACTED call. Returns {nodes, edges} with edges sorted by
 * (source, target, relation); nodes unchanged (no synthetic node is added).
 *
 * @param {string} root project root
 * @returns {{nodes: object[], edges: object[]}}
 */
/**
 * Two-phase resolver, now AST-first (WF-0080/AT2, ADR-0147). Phase 1 tries the
 * Tier-1 AST path per file (same-file function calls + receiver-typed method
 * calls — `this.m()`, `new X().m()`, `const v = new X(); v.m()` — proven from a
 * real parse, tagged `tier:'ast'`), then fills in with the Tier-0 regex scan for
 * whatever the AST could not prove (a language with no grammar, or a call the
 * AST tier legitimately can't resolve). The AST edge wins on a duplicate
 * source->target (more precise); regex NEVER overwrites an AST-proven edge.
 * Phase 2 resolves cross-file, then the phantom guard demotes any cross-family
 * EXTRACTED call. Returns {nodes, edges} with edges sorted by
 * (source, target, relation); AST-derived class/method nodes are merged in.
 *
 * @param {string} root project root
 * @returns {Promise<{nodes: object[], edges: object[]}>}
 */
export async function resolveGraph(root) {
  const base = extractSymbols(root);
  const index = indexSymbols(base.nodes);
  const nodeById = new Map(base.nodes.map((n) => [n.id, n]));
  const files = base.nodes.filter((n) => n.kind === 'file' && n.sourceFile).map((n) => n.sourceFile);

  // One parser per grammar for the whole resolve pass — loading the WASM
  // grammar is per-language, not per-file (AT2 perf; AT1 loaded fresh per call).
  const parserCache = new Map();
  const parserFor = async (grammar) => {
    if (!parserCache.has(grammar)) parserCache.set(grammar, await loadTreeSitter(root, grammar));
    return parserCache.get(grammar);
  };

  const astNodes = [];
  const astEdgeKeys = new Set(); // "source target" already proven by AST — regex must not duplicate it.
  const callEdges = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(join(root, file), 'utf-8'); } catch { continue; }

    const grammar = grammarForPath(file);
    if (grammar) {
      const parser = await parserFor(grammar);
      if (parser) {
        const ast = extractAstFile(text, parser, file);
        for (const node of ast.nodes) astNodes.push(node);
        for (const edge of ast.edges) {
          if (edge.relation === 'calls') astEdgeKeys.add(`${edge.source} ${edge.target}`);
          callEdges.push(edge);
        }
      }
    }

    const { callNames, importedNames } = scanFile(text);
    const source = `file:${file}`;
    for (const name of callNames) {
      const r = resolveCall(name, file, index, importedNames);
      if (r.resolution === 'EXTRACTED') {
        if (astEdgeKeys.has(`${source} ${r.target}`)) continue; // AST already proved this edge, more precisely.
        const targetNode = nodeById.get(r.target);
        if (targetNode && targetNode.sourceFile && familyOf(targetNode.sourceFile) !== familyOf(file)) {
          callEdges.push(callsEdge(source, `unresolved:${name}`, 'AMBIGUOUS', 'HEURISTIC', 'phantom-guard: cross-family'));
          continue;
        }
      }
      callEdges.push(callsEdge(source, r.target, r.resolution, r.evidenceClass, r.context));
    }
  }
  for (const parser of parserCache.values()) if (parser) disposeParser(parser);

  // AST class/method nodes are more precise than the regex tier's generic
  // symbol scan (project-map-dense.mjs's `class\s+(\w+)` regex already emits a
  // bare kind:'function' node for a class name like "Shape") — an AST-proven
  // class/method REFINES that id's kind rather than colliding with it; the AST
  // node always wins on a shared id when it carries a class/method kind.
  const allNodesById = new Map(nodeById);
  for (const node of astNodes) {
    const existing = allNodesById.get(node.id);
    if (!existing || node.kind === 'class' || node.kind === 'method') allNodesById.set(node.id, node);
  }
  const allNodeIds = new Set(allNodesById.keys());

  const safeCallEdges = callEdges.filter(
    (e) => e.resolution !== 'EXTRACTED' || (allNodeIds.has(e.source) && allNodeIds.has(e.target)),
  );

  const edges = [...base.edges, ...safeCallEdges].sort(
    (a, b) => (a.source + ' ' + a.target + ' ' + a.relation)
      .localeCompare(b.source + ' ' + b.target + ' ' + b.relation),
  );
  return { nodes: [...allNodesById.values()], edges };
}

/** Jaro similarity of two strings (0..1). Pure, deterministic. */
function jaro(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array(a.length).fill(false);
  const bMatch = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true; bMatch[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler similarity (Jaro + common-prefix bonus, prefix capped at 4). */
function jaroWinkler(a, b) {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

/** Union-find find with path compression. */
function find(parent, x) {
  while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
  return x;
}

/**
 * Kinds eligible for fuzzy (Jaro-Winkler) entity resolution — semantic/doc
 * nodes only. Code symbols are content-addressed (sym:<file>#<name>) and MUST
 * NOT be fuzzy-merged: getUser and getUsers are distinct functions, not
 * duplicates, and merging them is a fabricated identity claim (constitution
 * section 8, precision over recall). Fuzzy resolution across variant surface
 * forms of the SAME real entity is deferred to where it actually occurs — the
 * semantic layer (WF-0073, concept/rationale nodes) and cross-repo merge
 * (WF-0074). At the code tier this set is empty, so dedup is exact-id only.
 */
const FUZZY_KINDS = new Set(['concept', 'rationale', 'document']);

/**
 * Deduplicates nodes: always collapse EXACT-id duplicates (defensive — the id
 * scheme prevents them, but two extraction passes could re-introduce one), then
 * fuzzy-merge (Jaro-Winkler >= threshold) ONLY nodes whose kind is in
 * FUZZY_KINDS, within the same kind. Code symbols are never fuzzy-merged.
 * Deterministic: nodes are sorted by id first, so the lexicographically-smallest
 * id is always the canonical survivor. Returns the surviving node set plus an
 * alias map (mergedId -> canonicalId).
 *
 * @param {Array<{id:string, kind:string, label:string, sourceFile?:string}>} nodes
 * @param {number} [threshold=0.92]
 * @returns {{ nodes: object[], aliases: Record<string,string> }}
 */
export function dedupNodes(nodes, threshold = 0.92) {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const parent = sorted.map((_, i) => i);
  // Exact-id dedup (defensive).
  const firstById = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const prev = firstById.get(sorted[i].id);
    if (prev === undefined) firstById.set(sorted[i].id, i);
    else parent[find(parent, i)] = find(parent, prev);
  }
  // Fuzzy near-duplicate merge — semantic/doc kinds only, same kind, never code.
  const fuzzy = [];
  for (let i = 0; i < sorted.length; i++) if (FUZZY_KINDS.has(sorted[i].kind)) fuzzy.push(i);
  for (let a = 0; a < fuzzy.length; a++) {
    for (let b = a + 1; b < fuzzy.length; b++) {
      const i = fuzzy[a], j = fuzzy[b];
      if (sorted[i].kind !== sorted[j].kind) continue;
      if (jaroWinkler(sorted[i].label, sorted[j].label) >= threshold) {
        parent[find(parent, j)] = find(parent, i);
      }
    }
  }
  const aliases = {};
  const survivors = [];
  for (let i = 0; i < sorted.length; i++) {
    const root = find(parent, i);
    if (root === i) survivors.push(sorted[i]);
    else aliases[sorted[i].id] = sorted[root].id;
  }
  return { nodes: survivors, aliases };
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'project-map-resolve.mjs') {
  const out = await resolveGraph(process.cwd());
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
