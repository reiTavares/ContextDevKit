/**
 * Project-map DENSE symbol index (`--dense`) — the grep replacement.
 *
 * The default map samples ≤25 symbols per TOP-LEVEL module (a cheap orientation
 * aid). On a large repo that collapses, e.g., 535 files of `internal/` into 25
 * names — useless for locating a specific function. This dense pass walks EVERY
 * mapped file and extracts ALL exported symbols (uncapped per file), emitting:
 *   - a forward index  (file → its exported symbols), grouped by module, and
 *   - a reverse index  (symbol → the file(s) that define it) — "where is X?".
 *
 * Reuses the SAME scan scope as the default map (consumes the scanned model's
 * per-module file lists) and the SAME extractor (`extractSymbols`). Additive:
 * only runs under `--dense`, writes its own file, never changes the base map.
 * Pure + best-effort: an unreadable file is skipped, never thrown. [project-map]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { resolveRoots } from './project-map-roots.mjs';

/** Per-file symbol cap — high enough to be effectively complete for real files. */
const DENSE_CAP_PER_FILE = 400;

/**
 * Dense symbol extractors per language — exported AND UNEXPORTED. Unlike the base
 * map's `extractSymbols` (export-only sampling), a dense index must be COMPLETE:
 * a Go helper like `normalizeWorkflowName` (lowercase) must be locatable too.
 */
const DENSE_SYMBOL_RES = {
  javascript: [
    /(?:^|\s)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /(?:^|\s)(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm,
  ],
  python: [/^\s*def\s+([A-Za-z_]\w*)/gm, /^\s*class\s+([A-Za-z_]\w*)/gm],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm, /^type\s+([A-Za-z_]\w*)/gm],
  rust: [/(?:pub\s+)?fn\s+([A-Za-z_]\w*)/g, /(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g],
  ruby: [/^\s*def\s+([A-Za-z_]\w*)/gm, /^\s*(?:class|module)\s+([A-Za-z_]\w*)/gm],
};
DENSE_SYMBOL_RES.typescript = [
  ...DENSE_SYMBOL_RES.javascript,
  /(?:^|\s)(?:export\s+)?(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm,
];
DENSE_SYMBOL_RES.vue = DENSE_SYMBOL_RES.typescript;
DENSE_SYMBOL_RES.svelte = DENSE_SYMBOL_RES.typescript;

/** Extracts exported + unexported symbol names (deduped, capped) from one file. */
function extractDense(text, lang, cap) {
  const out = [];
  const seen = new Set();
  for (const re of DENSE_SYMBOL_RES[lang] || []) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && out.length < cap) {
      const name = m[1];
      if (name && !seen.has(name)) { seen.add(name); out.push(name); }
    }
  }
  return out;
}

/** True for test/spec files, which should never be the primary --find target. */
const TEST_FILE_RE = /(?:_test\.go|_test\.py|test_[^/]*\.py|\.test\.[jt]sx?|\.spec\.[jt]sx?|_spec\.rb|_test\.rb)$/i;

/** Repo-relative path → true when it is a test/spec file (deprioritised in --find). */
export function isTestFile(path) {
  return typeof path === 'string' && TEST_FILE_RE.test(path);
}

/** Extension → language label (mirrors project-map-core's EXT_LANG for extractors). */
const EXT_LANG = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.vue': 'vue', '.svelte': 'svelte',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.rb': 'ruby',
};

/**
 * Recursively collects source-file paths (repo-relative), excluding via the
 * SAME root-anchored `isExcluded` predicate `project-map-core.mjs` uses
 * (CDK-050) — a bare-name exclude like `contextkit` only matches the entry
 * AT the scan root (depth-1), never a same-named directory nested deeper
 * (e.g. the dogfood source tree `templates/contextkit/`). Passing the flat
 * EXCLUDE-by-basename set this walker used before silently dropped every
 * file under `templates/contextkit/` from the dense index — the same
 * dogfood bug `project-map-roots.mjs` already fixed for the base map's
 * walker, never propagated here.
 */
function walk(root, absDir, acc, isExcluded) {
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = join(absDir, ent.name);
    const rel = relative(root, full).replaceAll('\\', '/');
    if (ent.name.startsWith('.') && ent.name !== '.github') { if (isExcluded(rel, ent.name)) continue; }
    if (ent.isDirectory()) {
      if (isExcluded(rel, ent.name)) continue;
      walk(root, full, acc, isExcluded);
    } else if (EXT_LANG[extname(ent.name).toLowerCase()]) {
      acc.push(rel);
    }
  }
}

/**
 * Builds the dense symbol index by walking the repo (scanProject keeps only
 * counts, not file paths — so this does its own bounded walk over the same scope).
 * @param {string} root - repo root
 * @param {object|null} [config] - loaded contextkit config (`config.projectMap.{roots,excludes}`)
 * @returns {{ byModule: Array<{module:string, files:Array<{file:string,symbols:string[]}>}>,
 *   bySymbol: Record<string,string[]>, fileCount: number, symbolCount: number }}
 */
export function buildDenseIndex(root, config = null) {
  const { isExcluded } = resolveRoots(config, root);
  const files = [];
  try { if (statSync(root).isDirectory()) walk(root, root, files, isExcluded); } catch { /* best-effort */ }
  files.sort();

  // Object.create(null) — a real symbol/module name can collide with an
  // inherited Object.prototype member (`valueOf`, `constructor`, `toString`,
  // …). With a plain `{}`, `bySymbol['valueOf'] ||= []` never assigns (the
  // inherited function is already truthy), so the next `.push` throws. A
  // dogfood file literally exports a helper named `valueOf` — this is not a
  // hypothetical.
  const groups = Object.create(null);
  const bySymbol = Object.create(null);
  let fileCount = 0, symbolCount = 0;

  for (const rel of files) {
    const lang = EXT_LANG[extname(rel).toLowerCase()];
    if (!lang) continue;
    let text = '';
    try { text = readFileSync(join(root, rel), 'utf-8'); } catch { continue; }
    const names = extractDense(text, lang, DENSE_CAP_PER_FILE);
    if (names.length === 0) continue;
    const unique = [...new Set(names)];
    const module = rel.split('/').slice(0, 2).join('/') || rel;
    (groups[module] ||= []).push({ file: rel, symbols: unique });
    fileCount++;
    symbolCount += unique.length;
    for (const name of unique) (bySymbol[name] ||= []).push(rel);
  }
  // Source files before test/spec files so --find anchors on the real definition.
  for (const name of Object.keys(bySymbol)) {
    bySymbol[name].sort((a, b) => (isTestFile(a) ? 1 : 0) - (isTestFile(b) ? 1 : 0));
  }
  const byModule = Object.keys(groups).sort().map((module) => ({ module, files: groups[module] }));
  return { byModule, bySymbol, fileCount, symbolCount };
}

/**
 * Finds symbols in the dense index matching an exact or substring query.
 *
 * Returns a frozen array of `{ symbol, files }` objects:
 * - Exact match (case-sensitive) comes first.
 * - Then case-insensitive substring matches (deduped against exact).
 * - Results are sorted and capped at 50 entries.
 * - Non-object index or empty/falsy query → [].
 *
 * Deterministic (no Date.now / Math.random / new Date). Zero runtime deps.
 *
 * @param {ReturnType<typeof buildDenseIndex>} index - built by buildDenseIndex()
 * @param {string} query - symbol name or substring to locate
 * @returns {ReadonlyArray<{ symbol: string, files: string[] }>}
 */
export function findSymbol(index, query) {
  if (!query || typeof query !== 'string' || !index || typeof index !== 'object') return Object.freeze([]);
  const bySymbol = index.bySymbol;
  if (!bySymbol || typeof bySymbol !== 'object') return Object.freeze([]);

  const MAX_RESULTS = 50;
  const seen = new Set();
  const results = [];

  // 1. Exact match (case-sensitive).
  if (Object.prototype.hasOwnProperty.call(bySymbol, query)) {
    seen.add(query);
    results.push({ symbol: query, files: bySymbol[query] });
  }

  // 2. Case-insensitive substring matches (skip already-added exact match).
  const lower = query.toLowerCase();
  for (const name of Object.keys(bySymbol).sort()) {
    if (seen.has(name)) continue;
    if (name.toLowerCase().includes(lower)) {
      seen.add(name);
      results.push({ symbol: name, files: bySymbol[name] });
      if (results.length >= MAX_RESULTS) break;
    }
  }

  return Object.freeze(results.slice(0, MAX_RESULTS));
}

/**
 * Renders the dense index as markdown: a forward index per module, then a reverse
 * symbol→file lookup. The reverse index is what replaces `grep "func Foo"`.
 * @param {{ name?: string, signature?: string }} model
 * @param {ReturnType<typeof buildDenseIndex>} index
 * @returns {string}
 */
export function renderDense(model, index) {
  const out = [
    `# Project map — dense symbol index${model?.name ? ` — ${model.name}` : ''}`,
    '',
    `> Complete exported-symbol index (forward: file → symbols; reverse: symbol → file).`,
    `> Use the reverse index instead of \`grep\`. ${index.fileCount} files · ${index.symbolCount} symbols.`,
    model?.signature ? `> signature \`${model.signature}\`.` : '',
    '',
    '## Reverse index — where is a symbol defined?',
    '',
  ];
  for (const name of Object.keys(index.bySymbol).sort()) {
    out.push(`- \`${name}\` — ${index.bySymbol[name].map((f) => `\`${f}\``).join(', ')}`);
  }
  out.push('', '## Forward index — symbols per file', '');
  for (const mod of index.byModule) {
    out.push(`### \`${mod.module}/\``, '');
    for (const { file, symbols } of mod.files) out.push(`- \`${file}\` — ${symbols.join(', ')}`);
    out.push('');
  }
  return out.filter((l) => l !== '').join('\n') + '\n';
}
