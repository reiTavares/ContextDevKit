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

/**
 * Per-language grammar registry (WF-0080/AT2, ADR-0147) — the single source for
 * which grammars ship + their pinned version, so a version bump is one reviewable
 * diff (risk R3), never silent churn. A language absent here degrades that
 * language to the regex tier only — `grammarForPath` returns null, the caller
 * never attempts a WASM load for it. JS/TS family first (ADR-0147); a new
 * language is added here, not by inventing a parallel lookup.
 */
export const GRAMMAR_REGISTRY = Object.freeze({
  javascript: { extensions: ['.js', '.jsx', '.mjs', '.cjs'], version: '0.1.12' },
  typescript: { extensions: ['.ts'], version: '0.1.12' },
  tsx: { extensions: ['.tsx'], version: '0.1.12' },
});

/** Extension -> grammar name, derived from GRAMMAR_REGISTRY (single source). */
const GRAMMAR_BY_EXT = Object.freeze(
  Object.fromEntries(
    Object.entries(GRAMMAR_REGISTRY).flatMap(([grammar, { extensions }]) => extensions.map((ext) => [ext, grammar])),
  ),
);

/** Grammar name for a repo-relative path, or null when unsupported (degrade to regex). */
export function grammarForPath(filePath) {
  return GRAMMAR_BY_EXT[extname(filePath).toLowerCase()] || null;
}

/** Pinned grammar version for a grammar name, or null when the language has no registry entry. */
export function grammarVersionFor(grammar) {
  return GRAMMAR_REGISTRY[grammar]?.version ?? null;
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
const CLASS_TYPES = new Set(['class_declaration']);
const METHOD_TYPES = new Set(['method_definition']);

/**
 * Walks a node's `.parent` chain to the nearest enclosing `class_declaration`'s
 * name — how `this.method()` proves a receiver type (AT2). Null when the call
 * is not inside any class (e.g. a plain function), so `this` stays unresolved
 * rather than a guessed type.
 */
function enclosingClassName(node) {
  let p = node.parent;
  while (p) {
    if (p.type === 'class_declaration') {
      const nameNode = field(p, 'name');
      return nameNode && nameNode.text ? nameNode.text : null;
    }
    p = p.parent;
  }
  return null;
}

/**
 * Collects same-file class declarations: className -> Set(methodName), plus
 * the `sym:` method/class nodes and the DETERMINISTIC `method` edges linking
 * them (GC0 id scheme `sym:<file>#<Class>.<method>`). This is the per-file
 * "grammar registry" of provable receiver types AT2's call resolution checks
 * against — a method not in this set is a phantom guard refusal, never a
 * fabricated edge.
 */
function collectClasses(root, filePath) {
  const classes = new Map();
  const nodes = [];
  const edges = [];
  for (const cls of collect(root, CLASS_TYPES, [])) {
    const nameNode = field(cls, 'name');
    if (!nameNode || !nameNode.text) continue;
    const className = nameNode.text;
    const classId = `sym:${filePath}#${className}`;
    const methods = new Set();
    const bodyNode = field(cls, 'body');
    if (bodyNode) {
      for (const md of collect(bodyNode, METHOD_TYPES, [])) {
        const mNameNode = field(md, 'name');
        if (!mNameNode || !mNameNode.text) continue;
        const methodName = mNameNode.text;
        methods.add(methodName);
        const methodId = `sym:${filePath}#${className}.${methodName}`;
        nodes.push({ id: methodId, kind: 'method', label: methodName, sourceFile: filePath });
        edges.push({ source: classId, target: methodId, relation: 'method', resolution: 'EXTRACTED', confidenceScore: null, evidenceClass: 'DETERMINISTIC' });
      }
    }
    nodes.push({ id: classId, kind: 'class', label: className, sourceFile: filePath });
    classes.set(className, methods);
  }
  return { classes, nodes, edges };
}

/**
 * Same-file `const <name> = new <Class>()` bindings — the ONLY variable-typing
 * signal AT2 trusts (a `const` cannot be reassigned to a different type, so the
 * proof holds for the binding's whole scope). `let`/`var` are deliberately NOT
 * tracked here: a reassignable binding cannot prove a receiver type, and a
 * guessed type would be a fabricated edge (constitution section 8).
 */
function collectVarClassBindings(root) {
  const bindings = new Map();
  for (const lex of collect(root, new Set(['lexical_declaration']), [])) {
    if (lex.child(0)?.text !== 'const') continue;
    for (const decl of collect(lex, new Set(['variable_declarator']), [])) {
      const nameNode = field(decl, 'name');
      const valueNode = field(decl, 'value');
      if (!nameNode || nameNode.type !== 'identifier' || !valueNode || valueNode.type !== 'new_expression') continue;
      const ctor = field(valueNode, 'constructor');
      if (ctor && ctor.text && !bindings.has(nameNode.text)) bindings.set(nameNode.text, ctor.text);
    }
  }
  return bindings;
}

/**
 * Resolves a `call_expression`'s callee to a `calls` edge, or `null` when no
 * edge can be proven (the caller leaves it for the regex tier's AMBIGUOUS
 * marker — AT2 never fabricates). Two provable shapes:
 *   - same-file function call (AT1): `fn()` where `fn` is a declared function.
 *   - receiver-typed method call (AT2): `x.method()` where `x`'s class is
 *     proven (`this` inside that class, `new X().method()`, or a `const`
 *     binding) AND that class declares `method` — the phantom guard: a proven
 *     type calling an UNDECLARED method is refused, not guessed.
 */
function resolveCallEdge(call, fn, filePath, declared, classes, varBindings) {
  const source = `file:${filePath}`;
  if (fn.type === 'identifier' && fn.text) {
    if (!declared.has(fn.text)) return null;
    return { source, target: `sym:${filePath}#${fn.text}`, relation: 'calls', resolution: 'EXTRACTED', confidenceScore: null, evidenceClass: 'GRAPH_DERIVED', tier: 'ast' };
  }
  if (fn.type !== 'member_expression') return null;
  const objectNode = field(fn, 'object');
  const propertyNode = field(fn, 'property');
  if (!objectNode || !propertyNode || !propertyNode.text) return null; // computed member (a[b]()) -> unresolved
  const methodName = propertyNode.text;
  let receiverClass = null;
  if (objectNode.type === 'this') {
    receiverClass = enclosingClassName(call);
  } else if (objectNode.type === 'new_expression') {
    const ctor = field(objectNode, 'constructor');
    receiverClass = ctor && ctor.text ? ctor.text : null;
  } else if (objectNode.type === 'identifier' && varBindings.has(objectNode.text)) {
    receiverClass = varBindings.get(objectNode.text);
  }
  if (!receiverClass) return null; // type not provable -> regex tier marks AMBIGUOUS
  const methods = classes.get(receiverClass);
  if (!methods || !methods.has(methodName)) return null; // phantom guard: known type, undeclared method
  return { source, target: `sym:${filePath}#${receiverClass}.${methodName}`, relation: 'calls', resolution: 'EXTRACTED', confidenceScore: null, evidenceClass: 'GRAPH_DERIVED', tier: 'ast' };
}

/**
 * Extracts AST-tier nodes + `calls` edges from one file's real parse tree.
 * AT1 same-file function calls plus AT2 receiver-typed method calls
 * (`this.m()`, `new X().m()`, `const v = new X(); v.m()`) resolve to
 * EXTRACTED/`tier:'ast'`; a method call whose receiver type cannot be proven,
 * or a proven type calling an undeclared method, is left unresolved for the
 * regex tier — never fabricated (the phantom guard). Deterministic + deduped.
 *
 * @param {string} text file contents
 * @param {object} parser a parser from loadTreeSitter()
 * @param {string} filePath repo-relative path (forward-slash)
 * @returns {{ nodes: Array<object>, edges: Array<object> }}
 */
export function extractAstFile(text, parser, filePath) {
  let tree;
  try { tree = parser.parse(text); } catch { return { nodes: [], edges: [] }; }
  const root = tree?.rootNode;
  if (!root) return { nodes: [], edges: [] };

  const declared = new Set();
  for (const decl of collect(root, DECL_TYPES, [])) {
    const nameNode = field(decl, 'name');
    if (nameNode && nameNode.text) declared.add(nameNode.text);
  }
  const { classes, nodes: classNodes, edges: methodEdges } = collectClasses(root, filePath);
  const varBindings = collectVarClassBindings(root);

  const seen = new Set();
  const edges = [...methodEdges];
  for (const call of collect(root, CALL_TYPES, [])) {
    const fn = field(call, 'function');
    if (!fn) continue;
    const edge = resolveCallEdge(call, fn, filePath, declared, classes, varBindings);
    if (!edge) continue;
    const key = `${edge.source} ${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }
  // Release the WASM parse tree — undeleted handles trip the libuv teardown
  // assertion (exit 127 on Windows), which would look like a builder failure.
  try { if (tree && typeof tree.delete === 'function') tree.delete(); } catch { /* best-effort */ }
  return { nodes: classNodes, edges };
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
