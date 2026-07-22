#!/usr/bin/env node
/**
 * Self-test for graph-ast.mjs (WF-0080/BIZ-0004, ADR-0147) — the Tier-1 AST path.
 * Standalone (exit 0/1), sibling-dispatched like the other graph selfchecks.
 *
 * Two arms:
 *   - DEGRADE arm (always runs): an unsupported language / absent grammar ->
 *     loadTreeSitter returns null; grammarForPath is null for unknown extensions.
 *     This proves the absent-safe contract even where the optional dep is missing.
 *   - REAL-PARSE arm (runs only when web-tree-sitter + a JS grammar are present):
 *     a fixture with a same-file call yields exactly one tier:'ast'/EXTRACTED
 *     edge; a method call (`x.m()`) and a commented-out/unknown call yield NONE
 *     (no phantom); output is deterministic.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/graph-ast.mjs');

export async function runGraphAstChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(modPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph-ast imported');

  // DEGRADE arm — always runs, no optional dep needed.
  record('grammarForPath maps JS/TS, null for unsupported', m.grammarForPath('a.js') === 'javascript' && m.grammarForPath('a.ts') === 'typescript' && m.grammarForPath('a.cob') === null,
    'js=' + m.grammarForPath('a.js') + ' cob=' + m.grammarForPath('a.cob'));

  const noGrammar = await m.loadTreeSitter(KIT, 'cobol');
  record('loadTreeSitter(unsupported) -> null (degrade to regex, never throws)', noGrammar === null, String(noGrammar));

  const missingRoot = await m.loadTreeSitter('/nonexistent-root-xyz', 'javascript');
  record('loadTreeSitter(absent grammar dir) -> null (degrade)', missingRoot === null, String(missingRoot));

  // REAL-PARSE arm — only when the optional dependency + a JS grammar are present.
  const parser = await m.loadTreeSitter(KIT, 'javascript');
  if (!parser) {
    record('real-parse arm SKIPPED (web-tree-sitter/grammar not installed here)', true, 'degrade arm proven; real parse needs the optional dep');
  } else {
    const src = [
      'export function alpha() { return beta(); }', // same-file call -> edge
      'function beta() { return obj.method(); }',   // method call -> NO edge (AT2)
      'function gamma() { return unknownFn(); }',   // unknown callee -> NO edge',
      '// commentedCall() should never be an edge',
    ].join('\n');
    const { edges } = m.extractAstFile(src, parser, 'fix/a.js');
    const callEdges = edges.filter((e) => e.relation === 'calls');
    const onlyBeta = callEdges.length === 1 && callEdges[0].target === 'sym:fix/a.js#beta';
    record('AST same-file call -> exactly one edge (beta); method/unknown/comment -> none', onlyBeta,
      JSON.stringify(callEdges.map((e) => e.target)));
    record('AST edge is tier:ast + EXTRACTED + GRAPH_DERIVED', callEdges.every((e) => e.tier === 'ast' && e.resolution === 'EXTRACTED' && e.evidenceClass === 'GRAPH_DERIVED'),
      JSON.stringify(callEdges[0]));
    const a = JSON.stringify(m.extractAstFile(src, parser, 'fix/a.js').edges);
    const b = JSON.stringify(m.extractAstFile(src, parser, 'fix/a.js').edges);
    record('AST extraction deterministic (twice -> deeply equal)', a === b, a === b ? 'identical' : 'DIVERGED');
    if (typeof m.disposeParser === 'function') m.disposeParser(parser);
  }

  // Zero STATIC non-node: imports (web-tree-sitter is a DYNAMIC import -> hot-path safe).
  const source = readFileSync(modPath, 'utf-8');
  const staticBad = source.split(String.fromCharCode(10))
    .filter((l) => l.trim().indexOf('import ') === 0 && l.indexOf(' from ') !== -1)
    .map((l) => { const at = l.lastIndexOf('from '); const r = l.slice(at + 5).trim(); return r.slice(1, r.indexOf(r[0], 1)); })
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero STATIC non-node: imports (web-tree-sitter reached only via dynamic import)', staticBad.length === 0,
    staticBad.length === 0 ? 'clean (dynamic import only)' : staticBad.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-ast.mjs')) {
  const results = await runGraphAstChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log();
  console.log(results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log();
  console.log(failCount > 0 ? 'FAIL' : 'PASS');
  // WASM-safe exit: process.exit() while Emscripten has pending async trips the
  // libuv teardown assertion (exit 127 on Windows). Set exitCode + let the loop
  // drain naturally instead (root cause, verified: forced-exit=127, drain=0).
  process.exitCode = failCount > 0 ? 1 : 0;
}
