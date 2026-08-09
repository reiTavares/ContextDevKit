#!/usr/bin/env node
/**
 * Self-test for graph-query.mjs (IF1, WF-0072/BIZ-0004) — standalone entrypoint
 * (exit 0/1), sibling-dispatched like the WF-0071 selfchecks.
 *
 * Asserts the ADR-0136 read contract: correct reverse-callers / reverse-consumers
 * / bounded hub-avoiding neighborhood / god-nodes / shortest-path on a fixture,
 * AND that EVERY query degrades to `{available:false}` on an absent projection —
 * never a fabricated caller/consumer/path/pass.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const queryPath = resolve(KIT, 'templates/contextkit/tools/scripts/graph-query.mjs');

/** A fixture projection with a deliberate hub (`sym:hub`) of high degree. */
function fixtureProjection() {
  const nodes = [{ id: 'sym:seed' }, { id: 'sym:hub' }, { id: 'sym:a' }, { id: 'sym:b' }, { id: 'file:x' }];
  const edges = [
    { source: 'sym:a', target: 'sym:seed', relation: 'calls' },
    { source: 'sym:b', target: 'sym:seed', relation: 'calls' },
    { source: 'file:x', target: 'sym:seed', relation: 'imports' },
    { source: 'sym:seed', target: 'sym:hub', relation: 'calls' },
  ];
  // Make sym:hub a real hub: 60 distinct callers (> floor 50).
  for (let i = 0; i < 60; i++) { nodes.push({ id: `sym:c${i}` }); edges.push({ source: `sym:c${i}`, target: 'sym:hub', relation: 'calls' }); }
  return { available: true, nodes, edges, signature: 'fix' };
}

const ABSENT = { available: false, reason: 'no committed graph projection', evidenceClass: 'GRAPH_DERIVED' };

function findImportSpecifiers(source) {
  const out = [];
  for (const raw of source.split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (line.indexOf('import ') !== 0) continue;
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

export async function runGraphQueryChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let q;
  try { q = await import(pathToFileURL(queryPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph-query imported');

  const proj = fixtureProjection();

  const rc = q.reverseCallers(proj, 'sym:seed');
  record('reverseCallers correct + evidence GRAPH_DERIVED', rc.available && JSON.stringify(rc.callers) === JSON.stringify(['sym:a', 'sym:b']) && rc.evidenceClass === 'GRAPH_DERIVED',
    JSON.stringify(rc.callers));

  const rcons = q.reverseConsumers(proj, 'sym:seed');
  record('reverseConsumers includes calls + imports edges', rcons.available && JSON.stringify(rcons.consumers) === JSON.stringify(['file:x', 'sym:a', 'sym:b']),
    JSON.stringify(rcons.consumers));

  const bounded = q.boundedReachability(proj, 'sym:seed', 40);
  const hubExcluded = bounded.available && bounded.excludedHubs.includes('sym:hub')
    && !bounded.nodes.includes('sym:c0');
  record('boundedReachability refuses to expand THROUGH the hub (hub-avoiding BFS)', hubExcluded,
    'excludedHubs=' + JSON.stringify(bounded.excludedHubs) + ' pulledInHubCaller=' + bounded.nodes.includes('sym:c0'));

  const gods = q.godNodes(proj, 3);
  const topIsHub = gods.available && gods.godNodes[0].id === 'sym:hub' && gods.godNodes[0].degree === 61;
  record('godNodes ranks the hub first, deterministic', topIsHub, JSON.stringify(gods.godNodes.slice(0, 2)));

  const sp = q.shortestPath(proj, 'sym:a', 'sym:hub');
  const spOk = sp.available && JSON.stringify(sp.path) === JSON.stringify(['sym:a', 'sym:seed', 'sym:hub']);
  const unreachable = q.shortestPath(proj, 'sym:a', 'sym:nope');
  record('shortestPath correct; unreachable -> empty path', spOk && unreachable.available && unreachable.path.length === 0,
    'path=' + JSON.stringify(sp.path));

  const degradeAll = [
    q.reverseCallers(ABSENT, 'x'), q.reverseConsumers(ABSENT, 'x'),
    q.boundedReachability(ABSENT, 'x'), q.godNodes(ABSENT), q.shortestPath(ABSENT, 'x', 'y'),
  ].every((r) => r.available === false && typeof r.reason === 'string');
  record('EVERY query degrades to {available:false} on absent projection (no fabrication)', degradeAll,
    degradeAll ? 'all 5 degrade' : 'a query fabricated a result');

  // QA-review gap: loadProjection's PARTIAL branches (missing nodes/edges arrays;
  // unparsable JSON) had no fixture. Prove each degrades to {available:false} with a
  // distinct reason -- never a fabricated empty graph read as 'valid but empty'.
  const writeGraph = (body) => {
    const root = mkdtempSync(join(tmpdir(), 'graph-query-partial-'));
    const dir = join(root, 'contextkit', 'memory', 'project-map', 'graph');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'graph.json'), body, 'utf-8');
    return root;
  };
  const missingRoot = writeGraph(JSON.stringify({ schemaVersion: 1, graphSignature: 'x' }));
  try {
    const r = q.loadProjection(missingRoot);
    record('partial graph (missing nodes/edges arrays) -> {available:false}, not a fabricated empty read',
      r.available === false && /missing nodes\/edges/.test(r.reason), JSON.stringify(r.reason));
  } finally { rmSync(missingRoot, { recursive: true, force: true }); }
  const badRoot = writeGraph('{ this is not valid json ]');
  try {
    const r = q.loadProjection(badRoot);
    record('malformed graph (unparsable JSON) -> {available:false}, distinct reason, never throws',
      r.available === false && /unparsable/.test(r.reason), JSON.stringify(r.reason));
  } finally { rmSync(badRoot, { recursive: true, force: true }); }

  const violations = findImportSpecifiers(readFileSync(queryPath, 'utf-8'))
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero-dep invariant (node:* + relative siblings only)', violations.length === 0,
    violations.length === 0 ? 'clean' : violations.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-query.mjs')) {
  const results = await runGraphQueryChecks();
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
