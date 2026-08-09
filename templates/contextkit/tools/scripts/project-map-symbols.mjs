/**
 * Project-map SYMBOLS — sampled exported-symbol extraction per language.
 *
 * Sibling of `project-map-deps.mjs` (edges): a cheap, capped regex pass that
 * surfaces a navigation aid (NOT an exhaustive index). Pure functions, no I/O.
 * Kept out of `project-map-core.mjs` so the scanner stays under its line budget
 * and each extractor (symbols / deps) owns one concern. [project-map]
 */

/** Symbol extractors per language — cheap regex, capped by the caller. */
const SYMBOL_RES = {
  javascript: [/export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, /export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g],
  typescript: [/export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, /export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/g, /export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g],
  python: [/^\s*def\s+([a-z_]\w*)/gm, /^\s*class\s+([A-Za-z_]\w*)/gm],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, /^type\s+([A-Z]\w*)/gm],
  rust: [/pub\s+fn\s+([a-z_]\w*)/g, /pub\s+struct\s+([A-Za-z_]\w*)/g],
  ruby: [/^\s*def\s+([a-z_]\w*)/gm, /^\s*class\s+([A-Za-z_]\w*)/gm],
};
SYMBOL_RES.vue = SYMBOL_RES.typescript;
SYMBOL_RES.svelte = SYMBOL_RES.typescript;

/**
 * Extract up to `cap` exported symbols from one file's text.
 * @param {string} text file contents
 * @param {string} lang language label (from EXT_LANG)
 * @param {string} file repo-relative path (stamped onto each symbol)
 * @param {number} cap max symbols to return
 * @returns {Array<{file:string, name:string}>}
 */
export function extractSymbols(text, lang, file, cap) {
  const out = [];
  for (const re of SYMBOL_RES[lang] || []) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && out.length < cap) out.push({ file, name: m[1] });
  }
  return out;
}
