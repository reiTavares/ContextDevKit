#!/usr/bin/env node
/**
 * Self-test for graph-extract.mjs + project-map-graph.mjs (GC1-T2,
 * WF-0071/BIZ-0004) -- standalone entrypoint (exit 0/1), sibling-dispatched
 * like selfcheck-blast-radius.mjs.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const SCRIPTS = 'templates/contextkit/tools/scripts';
const graphExtractPath = resolve(KIT, SCRIPTS + '/graph-extract.mjs');
const projectMapGraphPath = resolve(KIT, SCRIPTS + '/project-map-graph.mjs');
function buildFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'graph-extract-selfcheck-'));
  mkdirSync(join(root, 'pkgA', 'src'), { recursive: true });
  mkdirSync(join(root, 'pkgB', 'src'), { recursive: true });
  mkdirSync(join(root, 'contextkit', 'memory', 'project-map'), { recursive: true });
  writeFileSync(join(root, 'pkgA', 'src', 'util.js'), 'export function helperOne() { return 1; }', 'utf-8');
  writeFileSync(join(root, 'pkgB', 'src', 'util.js'), 'export function helperTwo() { return 2; }', 'utf-8');
  writeFileSync(
    join(root, 'contextkit', 'memory', 'project-map', 'manifest.json'),
    JSON.stringify({ modules: [{ path: 'pkgA', deps: ['pkgB'] }, { path: 'pkgB', deps: [] }] }, null, 2),
    'utf-8',
  );
  return root;
}
function findImportSpecifiers(source) {
  const specifiers = [];
  for (const rawLine of source.split(String.fromCharCode(10))) {
    const line = rawLine.trim();
    if (line.indexOf('import ') !== 0) continue;
    const fromAt = line.lastIndexOf('from ');
    if (fromAt === -1) continue;
    const rest = line.slice(fromAt + 5).trim();
    const quoteChar = rest.charAt(0);
    if (quoteChar !== String.fromCharCode(39) && quoteChar !== String.fromCharCode(34)) continue;
    const closeAt = rest.indexOf(quoteChar, 1);
    if (closeAt === -1) continue;
    specifiers.push(rest.slice(1, closeAt));
  }
  return specifiers;
}
export async function runGraphExtractChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let extractSymbols, loadTreeSitter, writeCommittedProjection;
  try {
    ({ extractSymbols, loadTreeSitter } = await import(pathToFileURL(graphExtractPath).href));
    ({ writeCommittedProjection } = await import(pathToFileURL(projectMapGraphPath).href));
  } catch (err) {
    record('module import', false, 'failed to import graph-extract/project-map-graph: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'extractSymbols, loadTreeSitter, writeCommittedProjection imported');
  const root = buildFixtureRoot();
  try {
    const { nodes, edges } = extractSymbols(root);
    const nodeIds = new Set(nodes.map((n) => n.id));

    const containsEdges = edges.filter((e) => e.relation === 'contains');
    const hierarchyOk = containsEdges.length > 0
      && containsEdges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      && containsEdges.some((e) => e.source.startsWith('mod:') && e.target.startsWith('file:'))
      && containsEdges.some((e) => e.source.startsWith('file:') && e.target.startsWith('sym:'));
    record('contains edges form module-file-symbol hierarchy, no dangling endpoint', hierarchyOk,
      containsEdges.length + ' contains edges, ' + nodes.length + ' nodes');
    const importsEdges = edges.filter((e) => e.relation === 'imports');
    const evidenceOk = containsEdges.every((e) => e.evidenceClass === 'DETERMINISTIC')
      && importsEdges.length > 0
      && importsEdges.every((e) => e.evidenceClass === 'GRAPH_DERIVED')
      && edges.every((e) => e.resolution !== 'EXTRACTED' || (nodeIds.has(e.source) && nodeIds.has(e.target)));
    record('evidenceClass: contains=DETERMINISTIC, imports=GRAPH_DERIVED, no orphan EXTRACTED edge', evidenceOk,
      containsEdges.length + ' contains, ' + importsEdges.length + ' imports');
    const first = writeCommittedProjection(root, extractSymbols(root), { apply: false });
    const second = writeCommittedProjection(root, extractSymbols(root), { apply: false });
    const byteIdentical = JSON.stringify(first) === JSON.stringify(second);
    const nodeIdsOut = first.nodes.map((n) => n.id);
    const nodesSorted = JSON.stringify(nodeIdsOut) === JSON.stringify([...nodeIdsOut].sort());
    const edgeKeys = first.edges.map((e) => e.source + ' ' + e.target + ' ' + e.relation);
    const edgesSorted = JSON.stringify(edgeKeys) === JSON.stringify([...edgeKeys].sort());
    const validHex = first.graphSignature.length === 12 && !/[^0-9a-f]/.test(first.graphSignature);
    const signatureStable = first.graphSignature === second.graphSignature && validHex;
    const projectionOk = byteIdentical && nodesSorted && edgesSorted && signatureStable;
    record('writeCommittedProjection: deterministic, sorted, stable signature', projectionOk,
      'byteIdentical=' + byteIdentical + ' nodesSorted=' + nodesSorted + ' edgesSorted=' + edgesSorted + ' signature=' + first.graphSignature);
    let parserResult;
    let parserThrew = false;
    try {
      parserResult = await loadTreeSitter();
    } catch {
      parserThrew = true;
    }
    record('loadTreeSitter degrades to null, never throws', !parserThrew && parserResult === null,
      parserThrew ? 'threw' : 'got ' + String(parserResult));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const violations = [];
  for (const path of [graphExtractPath, projectMapGraphPath]) {
    const source = readFileSync(path, 'utf-8');
    for (const specifier of findImportSpecifiers(source)) {
      if (specifier.indexOf('node:') !== 0 && specifier.charAt(0) !== '.') {
        violations.push(path.split(sep).pop() + ': ' + specifier);
      }
    }
  }
  record('zero-dep invariant (node:* + relative siblings only)', violations.length === 0,
    violations.length === 0 ? 'no third-party imports' : 'violations: ' + violations.join(', '));

  return results;
}
if (process.argv[1]?.endsWith('selfcheck-graph-extract.mjs')) {
  const results = await runGraphExtractChecks();
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
