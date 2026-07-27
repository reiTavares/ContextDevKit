#!/usr/bin/env node
/**
 * GC4-T1 packaging + hot-path purity suite (WF-0071/BIZ-0004). Standalone
 * entrypoint (exit 0/1), sibling-dispatched like the other WF-0071 selfchecks.
 *
 * Closes acceptance criterion #7 (hot-path zero-dep) and proves the capability
 * gate defaults OFF:
 *   A. isGraphEnabled truth table — only explicit `enabled === true` enables it.
 *   B. every WF-0071 graph module imports ONLY node:* + relative siblings
 *      (zero third-party specifier — Levels 1-3 load them with nothing installed).
 *   C. NO hot-path hook (runtime/hooks/**) nor runtime/config/load.mjs statically
 *      imports a graph module — the builder is invoked on demand, never on the
 *      hot path (immutable rule 1). Since WF-0071 wires no consumers yet, the
 *      expected count is zero; WF-0072 will add ONLY lazy/dynamic reads.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');
const HOOKS = resolve(KIT, 'templates/contextkit/runtime/hooks');
const LOAD = resolve(KIT, 'templates/contextkit/runtime/config/load.mjs');
const configPath = resolve(SCRIPTS, 'graph-config.mjs');

/** Every WF-0071 graph module — all of these must be third-party-dep-free (check B). */
const GRAPH_MODULES = [
  'graph-extract.mjs', 'project-map-graph.mjs', 'project-map-resolve.mjs',
  'blast-radius.mjs', 'graph-config.mjs',
];

/**
 * The subset that must stay OFF the hot path (check C): the builder/resolver tree.
 *
 * `graph-config.mjs` is deliberately EXCLUDED — ADR-0134's own purity proof
 * (`selfcheck-hotpath-purity.mjs`) declares it hot-path-SAFE and readable by a hook,
 * because it has zero imports (not even `node:*`) and only reads a config flag.
 * WF-0071 originally listed it here while no consumer existed ("the expected count is
 * zero" above); WF-0108/ADR-0155 wires the first real consumers (the graph session
 * refresh + the graph-first gate), which single-source the enablement check through
 * `isGraphEnabled` rather than duplicating the flag read in each hook.
 *
 * The teeth stay: importing a BUILDER, RESOLVER or QUERY module from a hook is still
 * a violation, and check B still proves every graph module is dependency-free.
 */
const HOT_PATH_FORBIDDEN = [
  'graph-extract.mjs', 'project-map-graph.mjs', 'project-map-resolve.mjs', 'blast-radius.mjs',
];

/** Static import specifiers in a source string (line-scan; avoids regex fragility). */
function importSpecifiers(source) {
  const out = [];
  for (const raw of source.split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (line.indexOf('import ') !== 0 && line.indexOf('} from') === -1 && line.indexOf('export ') !== 0) continue;
    const fromAt = line.lastIndexOf('from ');
    if (fromAt === -1) continue;
    const rest = line.slice(fromAt + 5).trim();
    const q = rest.charAt(0);
    if (q !== String.fromCharCode(39) && q !== String.fromCharCode(34)) continue;
    const closeAt = rest.indexOf(q, 1);
    if (closeAt === -1) continue;
    out.push(rest.slice(1, closeAt));
  }
  return out;
}

/** Recursively lists *.mjs files under a dir (best-effort; empty on error). */
function listMjs(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listMjs(full));
    else if (ent.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

export async function runGc4Checks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  // A. isGraphEnabled truth table.
  let isGraphEnabled;
  try {
    ({ isGraphEnabled } = await import(pathToFileURL(configPath).href));
  } catch (err) {
    record('import graph-config', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  const cases = [
    [undefined, false], [null, false], [{}, false], [{ projectMap: {} }, false],
    [{ projectMap: { graph: {} } }, false], [{ projectMap: { graph: { enabled: false } } }, false],
    [{ projectMap: { graph: { enabled: 'true' } } }, false], [{ projectMap: { graph: { enabled: 1 } } }, false],
    [{ projectMap: { graph: { enabled: true } } }, true],
  ];
  const truthOk = cases.every(([cfg, want]) => isGraphEnabled(cfg) === want);
  record('A. isGraphEnabled truth table — default OFF, only explicit true enables', truthOk,
    truthOk ? cases.length + ' cases correct' : 'a case diverged');

  // B. graph modules are dep-free (node:* + relative siblings only).
  const depViolations = [];
  for (const mod of GRAPH_MODULES) {
    let source;
    try { source = readFileSync(join(SCRIPTS, mod), 'utf-8'); } catch { depViolations.push(mod + ': missing'); continue; }
    for (const spec of importSpecifiers(source)) {
      if (spec.indexOf('node:') !== 0 && spec.charAt(0) !== '.') depViolations.push(mod + ': ' + spec);
    }
  }
  record('B. graph modules import only node:* + relative siblings (zero third-party)', depViolations.length === 0,
    depViolations.length === 0 ? GRAPH_MODULES.length + ' modules clean' : 'violations: ' + depViolations.join(', '));

  // C. no hot-path file statically imports a graph BUILDER/RESOLVER module.
  const graphSet = new Set(HOT_PATH_FORBIDDEN.map((m) => m.replace(/\.mjs$/, '')));
  const hotFiles = [...listMjs(HOOKS)];
  try { if (statSync(LOAD).isFile()) hotFiles.push(LOAD); } catch { /* load.mjs optional */ }
  const hotViolations = [];
  for (const file of hotFiles) {
    let source;
    try { source = readFileSync(file, 'utf-8'); } catch { continue; }
    for (const spec of importSpecifiers(source)) {
      const base = spec.split('/').pop().replace(/\.mjs$/, '');
      if (graphSet.has(base)) hotViolations.push(file.split(/[\\/]/).pop() + ' -> ' + spec);
    }
  }
  record('C. no hot-path hook / load.mjs statically imports a graph module (#7)', hotViolations.length === 0,
    hotViolations.length === 0 ? hotFiles.length + ' hot-path files scanned, none import a graph module' : 'violations: ' + hotViolations.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-gc4-packaging.mjs')) {
  const results = await runGc4Checks();
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
