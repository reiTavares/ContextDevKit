#!/usr/bin/env node
/**
 * Self-test for project-map-resolve.mjs (GC2-T1, WF-0071/BIZ-0004) — standalone
 * entrypoint (exit 0/1), sibling-dispatched like selfcheck-graph-extract.mjs.
 *
 * Asserts the GC0 resolver contract:
 *   1. same-file + import-resolved calls -> EXTRACTED/GRAPH_DERIVED to the real
 *      symbol node (endpoint exists).
 *   2. no EXTRACTED edge lacks a proven endpoint; an unresolved target never
 *      becomes a real node.
 *   3. a JS/PY name collision -> AMBIGUOUS (never EXTRACTED, never dropped) and
 *      the phantom guard forbids any cross-family EXTRACTED calls edge.
 *   4. dedupNodes never fuzzy-merges code symbols (survivors == input); it DOES
 *      merge near-duplicate semantic (concept) nodes, never across kind.
 *   5. determinism: resolveGraph twice on the same fixture -> deeply equal.
 *   6. zero-dep invariant (node:* + relative siblings only).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const resolvePath = resolve(KIT, 'templates/contextkit/tools/scripts/project-map-resolve.mjs');

function buildFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'resolve-selfcheck-'));
  mkdirSync(join(root, 'web', 'src'), { recursive: true });
  mkdirSync(join(root, 'py', 'src'), { recursive: true });
  writeFileSync(join(root, 'web', 'src', 'a.js'),
    'export function alpha() { return 1; }\nexport function beta() { return alpha(); }\n', 'utf-8');
  writeFileSync(join(root, 'web', 'src', 'b.js'),
    "import { alpha } from './a.js';\nexport function gamma() { return alpha(); }\n", 'utf-8');
  writeFileSync(join(root, 'web', 'src', 'c.js'),
    'export function delta() { return mystery(); }\n', 'utf-8');
  writeFileSync(join(root, 'web', 'src', 'e.js'),
    'export function epsilon() { return foo(); }\n', 'utf-8');
  writeFileSync(join(root, 'py', 'src', 'd.py'),
    'def foo():\n    return 1\n', 'utf-8');
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
    const q = rest.charAt(0);
    if (q !== String.fromCharCode(39) && q !== String.fromCharCode(34)) continue;
    const closeAt = rest.indexOf(q, 1);
    if (closeAt === -1) continue;
    specifiers.push(rest.slice(1, closeAt));
  }
  return specifiers;
}

export async function runResolveChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let resolveGraph, dedupNodes;
  try {
    ({ resolveGraph, dedupNodes } = await import(pathToFileURL(resolvePath).href));
  } catch (err) {
    record('module import', false, 'failed to import project-map-resolve: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'resolveGraph, dedupNodes imported');

  const root = buildFixtureRoot();
  try {
    const g = resolveGraph(root);
    const nodeIds = new Set(g.nodes.map((n) => n.id));
    const calls = g.edges.filter((e) => e.relation === 'calls');

    const alphaId = 'sym:web/src/a.js#alpha';
    const sameFile = calls.find((e) => e.source === 'file:web/src/a.js' && e.target === alphaId);
    const imported = calls.find((e) => e.source === 'file:web/src/b.js' && e.target === alphaId);
    const resolvedOk = sameFile && sameFile.resolution === 'EXTRACTED' && sameFile.evidenceClass === 'GRAPH_DERIVED'
      && imported && imported.resolution === 'EXTRACTED' && imported.evidenceClass === 'GRAPH_DERIVED';
    record('same-file + import-resolved calls -> EXTRACTED/GRAPH_DERIVED', !!resolvedOk,
      'sameFile=' + JSON.stringify(sameFile?.resolution) + ' imported=' + JSON.stringify(imported?.resolution));

    const extractedOk = calls.filter((e) => e.resolution === 'EXTRACTED')
      .every((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    const noSyntheticNode = ![...nodeIds].some((id) => id.startsWith('unresolved:'));
    record('EXTRACTED edges have real endpoints; no unresolved: node', extractedOk && noSyntheticNode,
      'extractedOk=' + extractedOk + ' noSyntheticNode=' + noSyntheticNode);

    const fooEdge = calls.find((e) => e.source === 'file:web/src/e.js' && e.target === 'unresolved:foo');
    const fooAmbiguous = fooEdge && fooEdge.resolution === 'AMBIGUOUS' && fooEdge.evidenceClass === 'HEURISTIC';
    const noCrossFamilyExtracted = !calls.some(
      (e) => e.resolution === 'EXTRACTED' && e.source.startsWith('file:web/') && e.target.startsWith('sym:py/'),
    );
    record('JS/PY collision -> AMBIGUOUS; phantom guard blocks cross-family EXTRACTED', !!fooAmbiguous && noCrossFamilyExtracted,
      'fooEdge=' + JSON.stringify(fooEdge?.resolution) + ' noCrossFamilyExtracted=' + noCrossFamilyExtracted);

    const codeDedup = dedupNodes(g.nodes);
    const codeUntouched = codeDedup.nodes.length === g.nodes.length && Object.keys(codeDedup.aliases).length === 0;
    const conceptNodes = [
      { id: 'concept:auth-flow', kind: 'concept', label: 'authentication flow' },
      { id: 'concept:auth-flows', kind: 'concept', label: 'authentication flows' },
      { id: 'concept:billing', kind: 'concept', label: 'billing' },
    ];
    const conceptDedup = dedupNodes(conceptNodes);
    const conceptMerged = conceptDedup.nodes.length === 2 && Object.keys(conceptDedup.aliases).length === 1;
    record('dedupNodes: code symbols untouched, near-duplicate concepts merged', codeUntouched && conceptMerged,
      'codeUntouched=' + codeUntouched + ' conceptSurvivors=' + conceptDedup.nodes.length);

    const a = JSON.stringify(resolveGraph(root));
    const b = JSON.stringify(resolveGraph(root));
    record('resolveGraph deterministic (twice -> deeply equal)', a === b, a === b ? 'identical' : 'DIVERGED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const violations = [];
  const source = readFileSync(resolvePath, 'utf-8');
  for (const spec of findImportSpecifiers(source)) {
    if (spec.indexOf('node:') !== 0 && spec.charAt(0) !== '.') violations.push(spec);
  }
  record('zero-dep invariant (node:* + relative siblings only)', violations.length === 0,
    violations.length === 0 ? 'no third-party imports' : 'violations: ' + violations.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-resolve.mjs')) {
  const results = await runResolveChecks();
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
