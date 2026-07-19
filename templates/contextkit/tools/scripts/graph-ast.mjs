#!/usr/bin/env node
/**
 * AST-tier extraction (WF-0080/BIZ-0004, ADR-0147) - the Tier-1 precision path.
 *
 * `loadTreeSitter(root, lang)` loads web-tree-sitter (WASM) + a per-language
 * grammar blob, ABSENT-SAFE: any failure (runtime missing, grammar missing,
 * parse init error) returns null so the caller stays on the regex Tier-0 floor
 * (ADR-0134/0147). It searches a vendored dir first, then the optionalDependency
 * install, so it works both after AT4 vendoring and during development.
 *
 * `extractAstFile(text, parser, filePath)` walks the real parse tree and emits
 * `calls` edges tagged `tier:'ast'` - the ONLY BLOCKING-eligible marker
 * (ADR-0137) - for same-file-resolved calls (the unambiguous AT1 case; cross-file
 * receiver-type resolution is AT2). No string heuristics: a call is an AST
 * call_expression whose callee is a declared function in the same file, so a
 * commented-out or string-literal "call" can never produce a phantom edge.
 *
 * NOT on the zero-dep hot path: no `runtime/hooks/**` file imports this module;
 * `web-tree-sitter` is reached only through the dynamic import here (the hot-path
 * purity proof gates this). Deterministic: the grammar version is pinned; nodes
 * are visited in child order; edges are deduped + returned in discovery order for
 * the writer to sort.
 */
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Extension -> tree-sitter grammar name (JS/TS family first; ADR-0147). */
const GRAMMAR_BY_EXT = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'tsx',
};

/** Grammar name for a repo-relative path, or null when unsupported. */
export function grammarForPath(filePath) {
  return GRAMMAR_BY_EXT[extname(filePath).toLowerCase()] || null;
}

/**
 * Candidate `.wasm` paths for a grammar: the vendored dir (AT4 shipped posture)
 * first, then the optionalDependency install (development). First existing wins.
 * @param {string} root project root
 * @param {string} grammar tree-sitter grammar name
 * @returns {string[]}
 */
function grammarCandidates(root, grammar) {
  return [
    join(root, 'contextkit', 'tools', 'vendor', 'tree-sitter', `tree-sitter-${grammar}.wasm`),
    join(root, 'templates', 'contextkit', 'tools', 'vendor', 'tree-sitter', `tree-sitter-${grammar}.wasm`),
    join(root, 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${grammar}.wasm`),
  ];
}

/**
 * Loads a web-tree-sitter parser for `lang`, absent-safe. Returns a ready parser
 * or null (any failure degrades to the regex tier; never throws). The dynamic
 * import is the ONLY reach for the optional dependency (ADR-0147).
 *
 * @param {string} root project root
 * @param {string} lang grammar name (e.g. 'javascript') OR a file path
 * @returns {Promise<object|null>} a parser with `.parse(text)`, or null
 */
export async function loadTreeSitter(root, lang) {
  try {
    const grammar = GRAMMAR_BY_EXT[extname(String(lang)).toLowerCase()] || lang;
    const wasm = grammarCandidates(root, grammar).find((p) => existsSync(p));
    if (!wasm) return null;
    const TS = await import('web-tree-sitter');
    const Parser = TS.Parser || TS.default?.Parser;
    const Language = TS.Language || TS.default?.Language;
    if (!Parser || !Language) return null;
    await Parser.init();
    const parser = new Parser();
    const language = await Language.load(wasm);
    parser.setLanguage(language);
    return parser;
  } catch {
    return null;
  }
}

/** Recursively collects parse-tree nodes whose type is in `types`. */
function collect(node, types, acc) {
  if (!node) return acc;
  if (types.has(node.type)) acc.push(node);
  const count = node.childCount || 0;
  for (let i = 0; i < count; i++) collect(node.child(i), types, acc);
  return acc;
}

/** Field-safe child accessor (older/newer web-tree-sitter both handled). */
function field(node, name) {
  return typeof node.childForFieldName === 'function' ? node.childForFieldName(name) : null;
}

const DECL_TYPES = new Set([
  'function_declaration', 'generator_function_declaration',
]);
const CALL_TYPES = new Set(['call_expression']);

/**
 * Extracts AST-tier `calls` edges from one file's real parse tree. Only
 * same-file-declared callees resolve (EXTRACTED, tier:'ast'); a method call
 * (`x.method()`) or an unknown callee is left for AT2 / the regex tier, never
 * fabricated. Deterministic + deduped.
 *
 * @param {string} text file contents
 * @param {object} parser a parser from loadTreeSitter()
 * @param {string} filePath repo-relative path (forward-slash)
 * @returns {{ edges: Array<object> }}
 */
export function extractAstFile(text, parser, filePath) {
  let tree;
  try { tree = parser.parse(text); } catch { return { edges: [] }; }
  const root = tree?.rootNode;
  if (!root) return { edges: [] };

  const declared = new Set();
  for (const decl of collect(root, DECL_TYPES, [])) {
    const nameNode = field(decl, 'name');
    if (nameNode && nameNode.text) declared.add(nameNode.text);
  }

  const source = `file:${filePath}`;
  const seen = new Set();
  const edges = [];
  const callNodes = collect(root, CALL_TYPES, []);
  for (const call of callNodes) {
    const fn = field(call, 'function');
    if (!fn || fn.type !== 'identifier' || !fn.text) continue; // method calls -> AT2
    const name = fn.text;
    if (!declared.has(name)) continue; // same-file resolution only (AT1)
    const target = `sym:${filePath}#${name}`;
    const key = `${source} ${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      source,
      target,
      relation: 'calls',
      resolution: 'EXTRACTED',
      confidenceScore: null,
      evidenceClass: 'GRAPH_DERIVED',
      tier: 'ast',
    });
  }
  // Release the WASM parse tree — undeleted handles trip the libuv teardown
  // assertion (exit 127 on Windows), which would look like a builder failure.
  try { if (tree && typeof tree.delete === 'function') tree.delete(); } catch { /* best-effort */ }
  return { edges };
}

/** Releases a parser's WASM resources (best-effort; call when done with a batch). */
export function disposeParser(parser) {
  try { if (parser && typeof parser.delete === 'function') parser.delete(); } catch { /* best-effort */ }
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-ast.mjs') {
  const root = process.cwd();
  loadTreeSitter(root, 'javascript').then((parser) => {
    process.stdout.write(JSON.stringify({ parserLoaded: parser !== null }, null, 2) + '\n');
  });
}
