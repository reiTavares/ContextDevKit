#!/usr/bin/env node
/**
 * Hot-path purity proof (RO3, WF-0074/BIZ-0004) — the program-integration
 * invariant of ADR-0134.
 *
 * The zero-dep hot path is `runtime/hooks/**` + `runtime/config/load.mjs`. This
 * proof builds the TRANSITIVE static-import closure of every hot-path entry file
 * and asserts:
 *   1. NO BIZ-0004 graph module (the builder/query/semantic tree) appears in the
 *      closure — a hook must read the pre-computed projection, never import the
 *      builder;
 *   2. NO bare non-`node:` specifier appears ANYWHERE in the closure — the hot
 *      path pulls zero third-party dependencies (Levels 1-3 run with nothing
 *      installed).
 *
 * It follows relative imports across the real `templates/contextkit` tree, so a
 * violation introduced two or three imports deep is still caught. Pure, no deps.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const CK = resolve(KIT, 'templates/contextkit');
const HOOKS_DIR = resolve(CK, 'runtime/hooks');
const CONFIG_LOAD = resolve(CK, 'runtime/config/load.mjs');

/** Every BIZ-0004 graph module basename — none may reach the hot path. */
const GRAPH_MODULES = new Set([
  'blast-radius.mjs', 'graph-extract.mjs', 'project-map-graph.mjs', 'project-map-resolve.mjs',
  'graph-query.mjs', 'graph-consumers.mjs', 'graph.mjs', 'rationale-nodes.mjs',
  'graph-sanitize.mjs', 'graph-graded-signals.mjs', 'graph-egress.mjs',
  // graph-config.mjs + graph-activation.mjs are deliberately hot-path-SAFE
  // (pure, zero-dep) and may be read by a hook — they are NOT in this set.
]);

/** Extracts static import/export-from specifiers from source (best-effort, line-based). */
function staticSpecifiers(source) {
  const out = [];
  for (const raw of source.split(String.fromCharCode(10))) {
    const line = raw.trim();
    const isImport = line.startsWith('import ') || line.startsWith('import(') || line.startsWith('export ') && line.includes(' from ');
    if (!isImport && !line.startsWith('import ')) {
      // also catch `export ... from '...'`
      if (!(line.startsWith('export ') && line.includes(' from '))) continue;
    }
    const fromAt = line.lastIndexOf(' from ');
    let spec = null;
    if (fromAt !== -1) {
      const rest = line.slice(fromAt + 6).trim();
      const q = rest.charAt(0);
      if (q === "'" || q === '"') { const end = rest.indexOf(q, 1); if (end !== -1) spec = rest.slice(1, end); }
    } else if (line.startsWith('import ')) {
      // side-effect import 'x'
      const rest = line.slice(7).trim();
      const q = rest.charAt(0);
      if (q === "'" || q === '"') { const end = rest.indexOf(q, 1); if (end !== -1) spec = rest.slice(1, end); }
    }
    if (spec) out.push(spec);
  }
  return out;
}

/**
 * Builds the transitive closure of files reachable from `entries` via RELATIVE
 * imports, and records every BARE (non-relative, non-`node:`) specifier seen.
 * @param {string[]} entries absolute entry file paths
 * @returns {{ files:Set<string>, bareSpecifiers:Array<{from:string, spec:string}> }}
 */
function importClosure(entries) {
  const files = new Set();
  const bareSpecifiers = [];
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop();
    if (files.has(file) || !existsSync(file)) continue;
    files.add(file);
    let source;
    try { source = readFileSync(file, 'utf-8'); } catch { continue; }
    for (const spec of staticSpecifiers(source)) {
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('.')) {
        let target = resolve(dirname(file), spec);
        if (!existsSync(target) && existsSync(target + '.mjs')) target += '.mjs';
        stack.push(target);
      } else {
        bareSpecifiers.push({ from: file, spec });
      }
    }
  }
  return { files, bareSpecifiers };
}

/** All `.mjs` hook files + the config loader — the hot-path entry set. */
function hotPathEntries() {
  const entries = [];
  try {
    for (const name of readdirSync(HOOKS_DIR)) {
      if (name.endsWith('.mjs')) entries.push(join(HOOKS_DIR, name));
    }
  } catch { /* best-effort */ }
  if (existsSync(CONFIG_LOAD)) entries.push(CONFIG_LOAD);
  return entries;
}

export function runHotPathPurityChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  const entries = hotPathEntries();
  record('hot-path entry set found (hooks + config/load.mjs)', entries.length > 0, entries.length + ' entry files');

  const { files, bareSpecifiers } = importClosure(entries);

  const graphInClosure = [...files].filter((f) => GRAPH_MODULES.has(f.split(sep).pop()));
  record('NO BIZ-0004 graph builder module is reachable from the hot path', graphInClosure.length === 0,
    graphInClosure.length === 0 ? `closure=${files.size} files, 0 graph modules` : 'LEAKED: ' + graphInClosure.map((f) => f.split(sep).pop()).join(', '));

  const bad = bareSpecifiers.filter((b) => b.spec !== 'node:');
  record('NO bare non-node: dependency anywhere in the hot-path closure', bad.length === 0,
    bad.length === 0 ? `${files.size} files scanned, zero third-party imports` : 'DEPS: ' + bad.slice(0, 5).map((b) => b.spec).join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-hotpath-purity.mjs')) {
  const results = runHotPathPurityChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log();
  console.log(results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log();
  console.log(failCount > 0 ? 'FAIL' : 'PASS');
  process.exit(failCount > 0 ? 1 : 0);
}
