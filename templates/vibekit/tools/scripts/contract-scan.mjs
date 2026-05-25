#!/usr/bin/env node
/**
 * Generic Contract Drift detector (L5/L6).
 *
 * "Contract" = the public surface other code/consumers depend on. You declare
 * which files form it via `vibekit/config.json` → `l5.contractGlobs` (prefixes
 * or exact paths). This extracts exported identifiers from those files and
 * compares against a committed baseline, flagging REMOVALS/RENAMES (the
 * breaking changes) — additions are fine.
 *
 * Usage:
 *   node vibekit/tools/scripts/contract-scan.mjs --save     # write/refresh baseline
 *   node vibekit/tools/scripts/contract-scan.mjs            # diff vs baseline (exit 1 on removals)
 *   node vibekit/tools/scripts/contract-scan.mjs --json
 *
 * Baseline: vibekit/memory/contract-baseline.json (commit it).
 * Regex-based, language-agnostic-ish (JS/TS export forms): named/declaration
 * exports incl. `declare`/`abstract`/generators, `export default`, namespace
 * re-exports (`export * [as N] from`), and type-only `export type { … }`. Good
 * signal by default; for AST precision install `acorn` (or point
 * `VIBE_CONTRACT_PARSER` at a parser) — used **only if importable**, so the
 * zero-dep default holds. Advisory by default; wire into CI to block breaking
 * changes without an intentional version bump.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfigSync } from '../../runtime/config/load.mjs';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'vibekit/memory/contract-baseline.json');
const GLOBS = loadConfigSync(ROOT).l5?.contractGlobs || [];

// Declarations: export [declare] [abstract] [async] <kw> NAME (function may be a generator).
const EXPORT_RE = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
// Named (re-)exports incl. type-only blocks: export [type] { a, b as c, type D }.
const NAMED_RE = /export\s*(?:type\s+)?\{([^}]*)\}/g;
// Default export — tracked as the `default` symbol (removing it is breaking).
const DEFAULT_RE = /export\s+default\b/;
// Namespace re-export: export * [as NS] from '...'.
const STAR_RE = /export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/g;

function matchesGlob(rel) {
  return GLOBS.some((g) => rel === g || rel.startsWith(g));
}

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = relative(ROOT, abs).replaceAll('\\', '/');
    if (rel.startsWith('node_modules') || rel.startsWith('.git')) continue;
    if (e.isDirectory()) walk(abs, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name) && matchesGlob(rel)) acc.push(rel);
  }
  return acc;
}

function extractExports(content) {
  const seen = new Set();
  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(content)) !== null) seen.add(m[1]);
  NAMED_RE.lastIndex = 0;
  while ((m = NAMED_RE.exec(content)) !== null) {
    for (const raw of m[1].split(',')) {
      // Drop an inline `type ` modifier and any `as` alias, keep the exposed name.
      const part = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().replace(/[^A-Za-z0-9_$]/g, '');
      if (part) seen.add(part);
    }
  }
  STAR_RE.lastIndex = 0;
  while ((m = STAR_RE.exec(content)) !== null) seen.add(m[1] || `* from ${m[2]}`);
  if (DEFAULT_RE.test(content)) seen.add('default');
  return [...seen];
}

/**
 * Optional AST parser — zero-dep DEFAULT (regex). If a parser module is importable
 * (name from `VIBE_CONTRACT_PARSER`, else `acorn`), use it for precise extraction;
 * otherwise fall back to regex. Installing `acorn` upgrades JS precision opt-in —
 * the kit ships nothing, preserving the zero-dep invariant. [→ ADR-0003]
 */
async function loadParser() {
  const name = process.env.VIBE_CONTRACT_PARSER || 'acorn';
  const spec = /[\\/]/.test(name) ? pathToFileURL(resolve(ROOT, name)).href : name;
  try {
    return await import(spec);
  } catch {
    return null;
  }
}

/** Exported names via AST (precise). Returns null when the file can't be parsed. */
function extractExportsAst(content, parser) {
  let ast;
  try {
    ast = parser.parse(content, { sourceType: 'module', ecmaVersion: 'latest', allowHashBang: true });
  } catch {
    return null;
  }
  const names = new Set();
  for (const node of ast.body || []) {
    if (node.type === 'ExportDefaultDeclaration') {
      names.add('default');
    } else if (node.type === 'ExportAllDeclaration') {
      names.add(node.exported ? node.exported.name : `* from ${node.source?.value ?? ''}`);
    } else if (node.type === 'ExportNamedDeclaration') {
      for (const spec of node.specifiers || []) names.add(spec.exported?.name ?? spec.exported?.value);
      if (node.declaration?.id?.name) names.add(node.declaration.id.name);
      for (const d of node.declaration?.declarations || []) if (d.id?.name) names.add(d.id.name);
    }
  }
  return [...names].filter(Boolean);
}

/** Exported names for one file: AST when a parser is present and the file parses, else regex. */
function extractFor(content, parser) {
  if (parser) {
    const viaAst = extractExportsAst(content, parser);
    if (viaAst) return viaAst;
  }
  return extractExports(content);
}

function snapshot(parser) {
  const surface = {};
  for (const rel of walk(ROOT, [])) {
    try {
      surface[rel] = extractFor(readFileSync(resolve(ROOT, rel), 'utf-8'), parser).sort();
    } catch {
      /* skip */
    }
  }
  return surface;
}

function diff(base, current) {
  const removals = [];
  for (const [file, names] of Object.entries(base)) {
    const now = new Set(current[file] || []);
    for (const name of names) if (!now.has(name)) removals.push(`${file} → ${name}`);
  }
  return removals;
}

async function main() {
  const args = process.argv.slice(2);
  if (GLOBS.length === 0) {
    console.log('ℹ️  No l5.contractGlobs configured — nothing to track. Set them via /vibe-config to enable.');
    return;
  }
  const current = snapshot(await loadParser());
  if (args.includes('--save')) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n', 'utf-8');
    const total = Object.values(current).reduce((n, a) => n + a.length, 0);
    console.log(`✅ contract baseline saved — ${Object.keys(current).length} files, ${total} exported symbols.`);
    return;
  }
  if (!existsSync(BASELINE)) {
    console.log('No baseline yet. Run with --save to create vibekit/memory/contract-baseline.json, then commit it.');
    return;
  }
  const removals = diff(JSON.parse(readFileSync(BASELINE, 'utf-8')), current);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ removals }, null, 2) + '\n');
  } else if (removals.length === 0) {
    console.log('✅ No contract drift — no exported symbols removed/renamed.');
  } else {
    console.error(`🛑 Contract drift — ${removals.length} removed/renamed export(s):`);
    for (const r of removals) console.error(`   - ${r}`);
    console.error('\nIf intentional, bump the version (BREAKING CHANGE) and refresh the baseline with --save.');
  }
  process.exit(removals.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('contract-scan failed:', err?.message ?? err);
  process.exit(1);
});
