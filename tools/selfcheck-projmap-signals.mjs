#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };
const SCRIPTS = 'templates/contextkit/tools/scripts';
const signalsPath = resolve(KIT, SCRIPTS + '/project-map-signals.mjs');
const insightsPath = resolve(KIT, SCRIPTS + '/project-map-insights.mjs');
existsSync(signalsPath) ? ok('signals module exists') : bad('signals module NOT FOUND');
let structuralSignals, coChange, GRAPH_EVIDENCE_CLASS, HISTORY_EVIDENCE_CLASS, computeInsights;
try {
  const mod = await import(pathToFileURL(signalsPath).href);
  ({ structuralSignals, coChange, GRAPH_EVIDENCE_CLASS, HISTORY_EVIDENCE_CLASS } = mod);
  typeof structuralSignals === 'function' ? ok('structuralSignals exported as function') : bad('structuralSignals not a function');
  typeof coChange === 'function' ? ok('coChange exported as function') : bad('coChange not a function');
  GRAPH_EVIDENCE_CLASS === 'GRAPH_DERIVED' ? ok('GRAPH_EVIDENCE_CLASS is GRAPH_DERIVED') : bad('GRAPH_EVIDENCE_CLASS wrong: ' + GRAPH_EVIDENCE_CLASS);
  HISTORY_EVIDENCE_CLASS === 'HISTORY_DERIVED' ? ok('HISTORY_EVIDENCE_CLASS is HISTORY_DERIVED') : bad('HISTORY_EVIDENCE_CLASS wrong: ' + HISTORY_EVIDENCE_CLASS);
} catch (err) {
  bad('Failed to import project-map-signals.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
try {
  ({ computeInsights } = await import(pathToFileURL(insightsPath).href));
  typeof computeInsights === 'function' ? ok('computeInsights still exported (superset)') : bad('computeInsights not a function');
} catch (err) {
  bad('Failed to import project-map-insights.mjs: ' + (err && err.message || err));
}

console.log('\nFixture: 4-module graph with cycle a->b->c->a + isolated d');
const modules = [
  { path: 'a', deps: ['b', 'c'] },
  { path: 'b', deps: ['c'] },
  { path: 'c', deps: ['a'] },
  { path: 'd', deps: [] },
];
const sig = structuralSignals(modules);
sig.evidenceClass === 'GRAPH_DERIVED' ? ok('structuralSignals declares evidenceClass GRAPH_DERIVED') : bad('evidenceClass wrong: ' + sig.evidenceClass);
const pm = sig.perModule;
pm.a.fanOut === 2 ? ok('a.fanOut is 2') : bad('a.fanOut expected 2 got ' + pm.a.fanOut);
pm.b.fanOut === 1 ? ok('b.fanOut is 1') : bad('b.fanOut expected 1 got ' + pm.b.fanOut);
pm.c.fanOut === 1 ? ok('c.fanOut is 1') : bad('c.fanOut expected 1 got ' + pm.c.fanOut);
pm.d.fanOut === 0 ? ok('d.fanOut is 0 (isolated)') : bad('d.fanOut expected 0 got ' + pm.d.fanOut);
pm.a.fanIn === 1 ? ok('a.fanIn is 1 (imported by c)') : bad('a.fanIn expected 1 got ' + pm.a.fanIn);
pm.b.fanIn === 1 ? ok('b.fanIn is 1 (imported by a)') : bad('b.fanIn expected 1 got ' + pm.b.fanIn);
pm.c.fanIn === 2 ? ok('c.fanIn is 2 (imported by a,b)') : bad('c.fanIn expected 2 got ' + pm.c.fanIn);
pm.d.fanIn === 0 ? ok('d.fanIn is 0 (isolated)') : bad('d.fanIn expected 0 got ' + pm.d.fanIn);
const near = (x, y) => Math.abs(x - y) < 1e-9;
near(pm.a.instability, 2 / 3) ? ok('a.instability is 2/3') : bad('a.instability expected 0.666 got ' + pm.a.instability);
near(pm.b.instability, 1 / 2) ? ok('b.instability is 0.5') : bad('b.instability expected 0.5 got ' + pm.b.instability);
near(pm.c.instability, 1 / 3) ? ok('c.instability is 1/3') : bad('c.instability expected 0.333 got ' + pm.c.instability);
pm.d.instability === 0 ? ok('d.instability is 0 (0/0 case defined as 0)') : bad('d.instability expected 0 got ' + pm.d.instability);
pm.a.blastRadius === 2 ? ok('a.blastRadius is 2 (cycle-safe)') : bad('a.blastRadius expected 2 got ' + pm.a.blastRadius);
pm.b.blastRadius === 2 ? ok('b.blastRadius is 2 (cycle-safe)') : bad('b.blastRadius expected 2 got ' + pm.b.blastRadius);
pm.c.blastRadius === 2 ? ok('c.blastRadius is 2 (cycle-safe)') : bad('c.blastRadius expected 2 got ' + pm.c.blastRadius);
pm.d.blastRadius === 0 ? ok('d.blastRadius is 0 (no importers)') : bad('d.blastRadius expected 0 got ' + pm.d.blastRadius);

const empty = structuralSignals([]);
Object.keys(empty.perModule).length === 0 ? ok('structuralSignals([]) yields empty perModule') : bad('empty modules should yield empty perModule');
const nullSafe = structuralSignals(null);
nullSafe && Object.keys(nullSafe.perModule).length === 0 ? ok('structuralSignals(null) degrades to empty (no throw)') : bad('null modules should not throw');
const dangling = structuralSignals([{ path: 'x', deps: ['ghost'] }]);
dangling.perModule.x.fanOut === 0 ? ok('edge to unmapped module dropped (fanOut 0)') : bad('dangling dep counted: ' + dangling.perModule.x.fanOut);
const selfdep = structuralSignals([{ path: 'y', deps: ['y'] }]);
selfdep.perModule.y.fanOut === 0 && selfdep.perModule.y.fanIn === 0 ? ok('self-edge ignored (fanIn/fanOut 0)') : bad('self-edge not ignored');

console.log('\ncoChange degradation contract (UNKNOWN/SKIPPED is not PASS)');
const noReader = coChange(undefined);
noReader.available === false && noReader.evidenceClass === 'HISTORY_DERIVED' && /no git-log reader/.test(noReader.reason)
  ? ok('coChange(no reader) -> available:false with reason (not a zero)')
  : bad('coChange(no reader) wrong: ' + JSON.stringify(noReader));
const noGit = coChange(() => null);
noGit.available === false && /unavailable/.test(noGit.reason)
  ? ok('coChange(null history) -> available:false')
  : bad('coChange(null history) wrong: ' + JSON.stringify(noGit));
const emptyHist = coChange(() => []);
emptyHist.available === false ? ok('coChange(empty []) -> available:false') : bad('coChange([]) wrong: ' + JSON.stringify(emptyHist));
const threw = coChange(() => { throw new Error('boom'); });
threw.available === false && /git log failed/.test(threw.reason)
  ? ok('coChange(reader throws) -> available:false (caught)')
  : bad('coChange(throw) wrong: ' + JSON.stringify(threw));
const shallow = coChange(() => [['a'], ['b']], { minCommits: 5 });
shallow.available === false && /too shallow/.test(shallow.reason)
  ? ok('coChange(shallow < minCommits) -> available:false (no fabrication)')
  : bad('coChange(shallow) wrong: ' + JSON.stringify(shallow));

console.log('\ncoChange happy path (sufficient history)');
const history = [
  ['src/a.js', 'src/b.js'],
  ['src/a.js', 'src/b.js'],
  ['src/a.js', 'src/b.js', 'src/c.js'],
  ['src/c.js'],
  ['src/a.js', 'src/b.js'],
];
const cc = coChange(() => history, { minCommits: 5, minPairCount: 2 });
cc.available === true ? ok('coChange(5 commits) -> available:true') : bad('coChange happy not available: ' + JSON.stringify(cc));
cc.evidenceClass === 'HISTORY_DERIVED' ? ok('coChange declares evidenceClass HISTORY_DERIVED') : bad('coChange evidenceClass wrong: ' + cc.evidenceClass);
cc.commits === 5 ? ok('coChange.commits is 5') : bad('coChange.commits expected 5 got ' + cc.commits);
const top = cc.pairs[0];
top && top.files[0] === 'src/a.js' && top.files[1] === 'src/b.js' && top.count === 4
  ? ok('top co-change pair (src/a.js, src/b.js) count 4')
  : bad('top pair wrong: ' + JSON.stringify(top));
cc.pairs.every((p) => p.count >= 2) ? ok('pairs below minPairCount excluded') : bad('pairs include count<2: ' + JSON.stringify(cc.pairs));

console.log('\ncomputeInsights non-breaking superset');
if (typeof computeInsights === 'function') {
  const ins = computeInsights(modules);
  Array.isArray(ins.cycles) && Array.isArray(ins.orphans) && Array.isArray(ins.oversized)
    ? ok('computeInsights still returns cycles/orphans/oversized (legacy keys intact)')
    : bad('computeInsights legacy keys missing');
  ins.structural && ins.structural.perModule && ins.structural.perModule.a
    ? ok('computeInsights now also returns structural.perModule (superset)')
    : bad('computeInsights missing structural signals');
  ins.structural && ins.structural.evidenceClass === 'GRAPH_DERIVED'
    ? ok('computeInsights.structural.evidenceClass is GRAPH_DERIVED')
    : bad('computeInsights.structural evidenceClass wrong');
  ins.orphans.includes('d') ? ok('computeInsights.orphans includes isolated d (unchanged)') : bad('orphan detection changed');
}

console.log('\nzero-dep invariant');
for (const p of [signalsPath, insightsPath]) {
  const content = readFileSync(p, 'utf-8');
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m, dirty = null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) { dirty = m[1]; break; }
  }
  dirty === null ? ok('zero-dep: ' + p.split(/[\/]/).pop() + ' imports only node:/relative')
    : bad('zero-dep violation in ' + p + ': imports ' + dirty);
}

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
