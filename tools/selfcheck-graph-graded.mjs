#!/usr/bin/env node
/**
 * Self-test for graph-graded-signals.mjs (SR2, WF-0073/BIZ-0004) — standalone
 * entrypoint (exit 0/1), sibling-dispatched like the other WF-0073 selfchecks.
 *
 * Asserts the ADR-0137 ENFORCES contract on a fixture projection:
 *   - a resolved (EXTRACTED/GRAPH_DERIVED) import cycle -> a BLOCKING finding;
 *   - an INFERRED/HEURISTIC cycle -> ADVISORY only (no BLOCKING on a
 *     non-deterministic evidence class — the core invariant);
 *   - a god-node -> ADVISORY;
 *   - finding messages are structural (ids + metric), never node free text;
 *   - an absent projection -> {available:false, status:'UNKNOWN'}, never a
 *     fabricated "0 cycles" pass.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/graph-graded-signals.mjs');

/** Writes a fixture projection with the given edges; returns the temp root. */
function fixtureRoot(nodes, edges) {
  const root = mkdtempSync(join(tmpdir(), 'graded-sc-'));
  const dir = join(root, 'contextkit', 'memory', 'project-map', 'graph');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({ schemaVersion: 1, graphSignature: 's', nodes, edges }), 'utf-8');
  return root;
}

function importEdge(s, t, resolution, evidenceClass) {
  return { source: s, target: t, relation: 'imports', resolution, evidenceClass };
}

export async function runGradedSignalsChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(modPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph-graded-signals imported');

  // 1. Resolved (Tier-1) cycle -> BLOCKING.
  const nodes3 = [{ id: 'file:a' }, { id: 'file:b' }, { id: 'file:c' }];
  const resolvedCycle = [
    importEdge('file:a', 'file:b', 'EXTRACTED', 'GRAPH_DERIVED'),
    importEdge('file:b', 'file:c', 'EXTRACTED', 'GRAPH_DERIVED'),
    importEdge('file:c', 'file:a', 'EXTRACTED', 'GRAPH_DERIVED'),
  ];
  let root = fixtureRoot(nodes3, resolvedCycle);
  try {
    const r = m.collectGradedSignals(root);
    const cyc = r.available && r.findings.find((f) => f.ruleId === 'graph.cycle');
    record('resolved Tier-1 cycle -> BLOCKING', !!cyc && cyc.enforcement === 'BLOCKING' && cyc.evidenceClass === 'GRAPH_DERIVED',
      cyc ? cyc.enforcement + '/' + cyc.evidenceClass : 'no cycle finding');
    const structural = !!cyc && !/\balert\b|ignore previous|<script/i.test(cyc.message) && cyc.message.includes('graph.cycle');
    record('cycle finding message is structural (no node free text)', structural, cyc ? JSON.stringify(cyc.message) : 'n/a');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 2. INFERRED/HEURISTIC cycle -> ADVISORY only (the core ADR-0137 invariant).
  const inferredCycle = [
    importEdge('file:a', 'file:b', 'INFERRED', 'HEURISTIC'),
    importEdge('file:b', 'file:a', 'INFERRED', 'HEURISTIC'),
  ];
  root = fixtureRoot([{ id: 'file:a' }, { id: 'file:b' }], inferredCycle);
  try {
    const r = m.collectGradedSignals(root);
    const cyc = r.available && r.findings.find((f) => f.ruleId === 'graph.cycle');
    const advisoryOk = !!cyc && cyc.enforcement === 'ADVISORY';
    const noBlockingOnHeuristic = r.available && !r.findings.some((f) => f.enforcement === 'BLOCKING' && f.evidenceClass === 'HEURISTIC');
    record('INFERRED cycle -> ADVISORY; no BLOCKING on a non-deterministic class', advisoryOk && noBlockingOnHeuristic,
      cyc ? cyc.enforcement + '/' + cyc.evidenceClass : 'no cycle finding');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 3. God-node -> ADVISORY.
  const gnNodes = [{ id: 'sym:hub' }];
  const gnEdges = [];
  for (let i = 0; i < 120; i++) { gnNodes.push({ id: 'sym:c' + i }); gnEdges.push({ source: 'sym:c' + i, target: 'sym:hub', relation: 'calls', resolution: 'EXTRACTED', evidenceClass: 'GRAPH_DERIVED' }); }
  root = fixtureRoot(gnNodes, gnEdges);
  try {
    const r = m.collectGradedSignals(root, { godNodeDegree: 100 });
    const god = r.available && r.findings.find((f) => f.ruleId === 'graph.god-node');
    record('god-node -> ADVISORY, subject is the hub id', !!god && god.enforcement === 'ADVISORY' && god.subjects[0] === 'sym:hub',
      god ? god.enforcement + ' ' + JSON.stringify(god.subjects) : 'no god-node finding');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 4. Absent projection -> UNKNOWN.
  const empty = mkdtempSync(join(tmpdir(), 'graded-empty-'));
  try {
    const r = m.collectGradedSignals(empty);
    record('absent projection -> UNKNOWN (no fabricated pass)', r.available === false && r.status === 'UNKNOWN',
      'available=' + r.available + ' status=' + r.status);
  } finally { rmSync(empty, { recursive: true, force: true }); }

  const source = readFileSync(modPath, 'utf-8');
  const bad = source.split(String.fromCharCode(10))
    .filter((l) => l.trim().indexOf('import ') === 0 && l.indexOf(' from ') !== -1)
    .map((l) => { const at = l.lastIndexOf('from '); const r = l.slice(at + 5).trim(); return r.slice(1, r.indexOf(r[0], 1)); })
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero-dep invariant (node:* + relative siblings only)', bad.length === 0, bad.length === 0 ? 'clean' : bad.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-graded.mjs')) {
  const results = await runGradedSignalsChecks();
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
