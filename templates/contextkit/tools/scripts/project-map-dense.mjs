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
import { extname, join, relative, sep } from 'node:path';
import { extractSymbols } from './project-map-symbols.mjs';

/** Per-file symbol cap — high enough to be effectively complete for real files. */
const DENSE_CAP_PER_FILE = 400;

/** Directories never walked (mirrors project-map-core's exclude set). */
const EXCLUDE = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
  'vendor', 'target', '.venv', 'venv', '__pycache__', '.cache', 'coverage',
  '.idea', '.vscode', 'contextkit', '.claude', '.agents', '.codex',
]);

/** Extension → language label (mirrors project-map-core's EXT_LANG for extractors). */
const EXT_LANG = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.vue': 'vue', '.svelte': 'svelte',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.rb': 'ruby',
};

/** Recursively collects source-file paths (repo-relative), excluding EXCLUDE dirs. */
function walk(root, absDir, acc) {
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.isDirectory()) { if (EXCLUDE.has(ent.name)) continue; }
    const full = join(absDir, ent.name);
    if (ent.isDirectory()) {
      if (EXCLUDE.has(ent.name)) continue;
      walk(root, full, acc);
    } else if (EXT_LANG[extname(ent.name).toLowerCase()]) {
      acc.push(relative(root, full).split(sep).join('/'));
    }
  }
}

/**
 * Builds the dense symbol index by walking the repo (scanProject keeps only
 * counts, not file paths — so this does its own bounded walk over the same scope).
 * @param {string} root - repo root
 * @returns {{ byModule: Array<{module:string, files:Array<{file:string,symbols:string[]}>}>,
 *   bySymbol: Record<string,string[]>, fileCount: number, symbolCount: number }}
 */
export function buildDenseIndex(root) {
  const files = [];
  try { if (statSync(root).isDirectory()) walk(root, root, files); } catch { /* best-effort */ }
  files.sort();

  const groups = {};
  const bySymbol = {};
  let fileCount = 0, symbolCount = 0;

  for (const rel of files) {
    const lang = EXT_LANG[extname(rel).toLowerCase()];
    if (!lang) continue;
    let text = '';
    try { text = readFileSync(join(root, rel), 'utf-8'); } catch { continue; }
    const names = extractSymbols(text, lang, rel, DENSE_CAP_PER_FILE).map((s) => s.name);
    if (names.length === 0) continue;
    const unique = [...new Set(names)];
    const module = rel.split('/').slice(0, 2).join('/') || rel;
    (groups[module] ||= []).push({ file: rel, symbols: unique });
    fileCount++;
    symbolCount += unique.length;
    for (const name of unique) (bySymbol[name] ||= []).push(rel);
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
