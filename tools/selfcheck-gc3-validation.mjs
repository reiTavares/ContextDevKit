#!/usr/bin/env node
/**
 * GC3-T1 validation suite (WF-0071/BIZ-0004) — determinism, degradation,
 * incremental merge, and a multi-language golden fixture. Standalone entrypoint
 * (exit 0/1), sibling-dispatched like the other WF-0071 selfchecks.
 *
 * Closes the GC0 acceptance criteria the earlier waves left partial:
 *   #2 golden fixtures per language — expected contains/imports edge set, no phantom;
 *   #4 byte-identical committed projection regardless of node/edge INPUT ORDER
 *      (the real hash-seed / Map-iteration-order hazard the writer must neutralize);
 *   #5 degrade-to-UNKNOWN when the parser is absent (regex tier still yields a graph);
 *   #6 incremental merge: replace-per-source, prune-on-delete, never silently shrink,
 *      and full-rebuild == incremental-merge equivalence.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const S = 'templates/contextkit/tools/scripts';
const extractPath = resolve(KIT, S + '/graph-extract.mjs');
const graphPath = resolve(KIT, S + '/project-map-graph.mjs');

/** Multi-language fixture: web (js) + py + go, with a manifest import edge. */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gc3-selfcheck-'));
  mkdirSync(join(root, 'web', 'src'), { recursive: true });
  mkdirSync(join(root, 'svc', 'py'), { recursive: true });
  mkdirSync(join(root, 'svc', 'go'), { recursive: true });
  mkdirSync(join(root, 'contextkit', 'memory', 'project-map'), { recursive: true });
  writeFileSync(join(root, 'web', 'src', 'a.js'), 'export function alpha() { return 1; }\n', 'utf-8');
  writeFileSync(join(root, 'svc', 'py', 'b.py'), 'def beta():\n    return 2\n', 'utf-8');
  writeFileSync(join(root, 'svc', 'go', 'c.go'), 'package svc\nfunc Gamma() int { return 3 }\n', 'utf-8');
  writeFileSync(
    join(root, 'contextkit', 'memory', 'project-map', 'manifest.json'),
    JSON.stringify({ modules: [{ path: 'web', deps: ['svc'] }, { path: 'svc', deps: [] }] }, null, 2),
    'utf-8',
  );
  return root;
}

/** Deterministic shuffle (seeded LCG) — reorders an array without Math.random. */
function shuffled(arr, seed) {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function runGc3Checks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let extractSymbols, loadTreeSitter, writeCommittedProjection, mergeProjection;
  try {
    ({ extractSymbols, loadTreeSitter } = await import(pathToFileURL(extractPath).href));
    ({ writeCommittedProjection, mergeProjection } = await import(pathToFileURL(graphPath).href));
  } catch (err) {
    record('module import', false, 'import failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'extract + graph modules imported');

  const root = buildFixture();
  try {
    const graph = extractSymbols(root);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));

    // #2 golden: each language's function is a node; contains + imports edges; no phantom.
    const goldenNodes = ['sym:web/src/a.js#alpha', 'sym:svc/py/b.py#beta', 'sym:svc/go/c.go#Gamma']
      .every((id) => nodeIds.has(id));
    const importsWebToSvc = graph.edges.some(
      (e) => e.relation === 'imports' && e.source === 'mod:web' && e.target === 'mod:svc',
    );
    const everyEndpointReal = graph.edges.every(
      (e) => e.relation !== 'contains' || (nodeIds.has(e.source) && nodeIds.has(e.target)),
    );
    record('#2 multi-language golden: js/py/go symbols + imports edge, no phantom contains', goldenNodes && importsWebToSvc && everyEndpointReal,
      'goldenNodes=' + goldenNodes + ' importsWebToSvc=' + importsWebToSvc + ' everyEndpointReal=' + everyEndpointReal);

    // #4 determinism: shuffle node/edge INPUT order -> committed projection byte-identical.
    const baseline = JSON.stringify(writeCommittedProjection(root, graph, { apply: false }));
    let shuffleStable = true;
    for (const seed of [1, 7, 42, 99]) {
      const perturbed = { nodes: shuffled(graph.nodes, seed), edges: shuffled(graph.edges, seed * 3 + 1) };
      if (JSON.stringify(writeCommittedProjection(root, perturbed, { apply: false })) !== baseline) { shuffleStable = false; break; }
    }
    record('#4 committed projection byte-identical under shuffled input order (hash-seed hazard)', shuffleStable,
      shuffleStable ? 'stable across 4 shuffles' : 'DIVERGED');

    // #5 degrade: parser absent -> regex tier still produced a non-empty graph.
    let parserNull = false;
    try { parserNull = (await loadTreeSitter()) === null; } catch { parserNull = false; }
    record('#5 degrade-to-regex: parser absent yet graph non-empty', parserNull && graph.nodes.length > 0,
      'parserNull=' + parserNull + ' nodes=' + graph.nodes.length);

    // #6a replace-per-source: re-extract with a's symbol renamed -> only a's node changes.
    writeFileSync(join(root, 'web', 'src', 'a.js'), 'export function alphaRenamed() { return 1; }\n', 'utf-8');
    const incoming = extractSymbols(root);
    const merged = mergeProjection(graph, incoming, { changedSources: ['web/src/a.js'] });
    const mergedIds = new Set(merged.nodes.map((n) => n.id));
    const replaced = mergedIds.has('sym:web/src/a.js#alphaRenamed') && !mergedIds.has('sym:web/src/a.js#alpha')
      && mergedIds.has('sym:svc/py/b.py#beta') && mergedIds.has('sym:svc/go/c.go#Gamma');
    record('#6a incremental replace-per-source: changed file swapped, others carried forward', replaced,
      'has renamed=' + mergedIds.has('sym:web/src/a.js#alphaRenamed') + ' dropped old=' + !mergedIds.has('sym:web/src/a.js#alpha'));

    // #6b full-rebuild == incremental-merge (same committed projection).
    const fullAfter = JSON.stringify(writeCommittedProjection(root, incoming, { apply: false }));
    const mergedProj = JSON.stringify(writeCommittedProjection(root, merged, { apply: false }));
    record('#6b full-rebuild == incremental-merge (byte-identical projection)', fullAfter === mergedProj,
      fullAfter === mergedProj ? 'identical' : 'DIVERGED');

    // #6c prune-on-delete: delete b.py -> its node gone, no dangling edge.
    const afterDelete = mergeProjection(incoming, { nodes: [], edges: [] }, { deletedSources: ['svc/py/b.py'] });
    const delIds = new Set(afterDelete.nodes.map((n) => n.id));
    const pruned = !delIds.has('sym:svc/py/b.py#beta') && !delIds.has('file:svc/py/b.py')
      && afterDelete.edges.every((e) => delIds.has(e.source) && (e.target.startsWith('unresolved:') || delIds.has(e.target)));
    record('#6c prune-on-delete: deleted file node gone, no dangling edge', pruned,
      'beta gone=' + !delIds.has('sym:svc/py/b.py#beta'));

    // #6d shrink guard: a changed source that produced no nodes throws.
    let threw = false;
    try { mergeProjection(incoming, { nodes: [], edges: [] }, { changedSources: ['svc/py/b.py'] }); }
    catch { threw = true; }
    record('#6d shrink guard: changed source with zero incoming nodes throws (never silent shrink)', threw,
      threw ? 'threw as required' : 'DID NOT THROW');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-gc3-validation.mjs')) {
  const results = await runGc3Checks();
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
