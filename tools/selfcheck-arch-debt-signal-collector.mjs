#!/usr/bin/env node
/**
 * WF-0057 W2 (ADR-0122) — selftest for the StructuralSignalCollector.
 * Covers: line-count signal is ALWAYS ADVISORY (never BLOCKING, even at huge
 * line counts); its message carries no "Split by responsibility"/"useful lines";
 * change-amplification maps blast-radius bands correctly and yields UNKNOWN on
 * missing signals (never fabricated). Mirrors selfcheck-arch-debt-finding.mjs.
 * Zero-dep, node:/relative only, Windows-safe. Standalone entrypoint (exit 0/1).
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };

const SCRIPTS = 'templates/contextkit/tools/scripts/arch-debt';
const collectorPath = resolve(KIT, SCRIPTS + '/signal-collector.mjs');
existsSync(collectorPath) ? ok('signal-collector.mjs exists') : bad('signal-collector.mjs NOT FOUND');

let mod;
try {
  mod = await import(pathToFileURL(collectorPath).href);
} catch (err) {
  bad('Failed to import signal-collector.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const {
  lineCountSignal, changeAmplificationSignal, collectStructuralSignals,
  DEFAULT_LINE_BANDS,
} = mod;

for (const [n, f] of [
  ['lineCountSignal', lineCountSignal],
  ['changeAmplificationSignal', changeAmplificationSignal],
  ['collectStructuralSignals', collectStructuralSignals],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}
DEFAULT_LINE_BANDS && typeof DEFAULT_LINE_BANDS.yellow === 'number' && typeof DEFAULT_LINE_BANDS.elevated === 'number'
  ? ok('DEFAULT_LINE_BANDS exported with yellow/elevated') : bad('DEFAULT_LINE_BANDS malformed');

const threw = (fn) => { try { fn(); return false; } catch { return true; } };

console.log('\nline-count signal: ALWAYS advisory, never blocking');
const small = lineCountSignal({ path: 'src/small.js', lines: 50 });
Array.isArray(small) && small.length === 0 ? ok('below yellow band → no finding') : bad('small file emitted a finding');

const yellow = lineCountSignal({ path: 'src/mid.js', lines: 250 });
yellow.length === 1 ? ok('yellow band → one finding') : bad('yellow band finding count: ' + yellow.length);
yellow[0].enforcement === 'ADVISORY' ? ok('yellow band → ADVISORY') : bad('yellow enforcement: ' + yellow[0].enforcement);
yellow[0].evidence.class === 'HEURISTIC' ? ok('yellow band → HEURISTIC evidence') : bad('yellow evidence: ' + yellow[0].evidence.class);
yellow[0].reasonCodes[0] === 'FILE_SIZE_YELLOW_BAND' ? ok('yellow reasonCode') : bad('yellow reasonCode: ' + yellow[0].reasonCodes[0]);

const elevated = lineCountSignal({ path: 'src/big.js', lines: 400 });
elevated[0].reasonCodes[0] === 'FILE_SIZE_ELEVATED_BAND' ? ok('elevated band reasonCode') : bad('elevated reasonCode: ' + elevated[0].reasonCodes[0]);
elevated[0].enforcement === 'ADVISORY' ? ok('elevated band → ADVISORY') : bad('elevated enforcement: ' + elevated[0].enforcement);

// THE crucial property: even an absurd line count can never become BLOCKING.
const huge = lineCountSignal({ path: 'src/huge.js', lines: 100000 });
huge[0].enforcement === 'ADVISORY' ? ok('100k lines still ADVISORY') : bad('huge enforcement: ' + huge[0].enforcement);
huge[0].enforcement !== 'BLOCKING' ? ok('line count alone can NEVER block (any size)') : bad('huge file reached BLOCKING');

console.log('\nline-count message hygiene (no split verdict, no "useful lines")');
const msg = elevated[0].message;
!/split by responsibility/i.test(msg) ? ok('message contains no "Split by responsibility"') : bad('message says "Split by responsibility": ' + msg);
!/useful lines/i.test(msg) ? ok('message does not call it "useful lines"') : bad('message says "useful lines": ' + msg);
/requests structural review/i.test(msg) && /does not determine a split/i.test(msg)
  ? ok('message frames size as a review request, not a split') : bad('message framing wrong: ' + msg);
elevated[0].dimension === 'COGNITIVE_COHERENCE' ? ok('dimension COGNITIVE_COHERENCE') : bad('dimension: ' + elevated[0].dimension);

console.log('\nline-count validation (fail-fast)');
threw(() => lineCountSignal(null)) ? ok('null metrics throws') : bad('null metrics did not throw');
threw(() => lineCountSignal({ lines: 300 })) ? ok('missing path throws') : bad('missing path did not throw');
threw(() => lineCountSignal({ path: 'p' })) ? ok('missing lines throws') : bad('missing lines did not throw');
threw(() => lineCountSignal({ path: 'p', lines: 'NaN' })) ? ok('non-number lines throws') : bad('non-number lines did not throw');

console.log('\nchange-amplification: band mapping (§19)');
const sigWorse = { before: { 'm/a.js': { blastRadius: 3 } }, after: { 'm/a.js': { blastRadius: 7 } } };
const worse = changeAmplificationSignal(['m/a.js'], sigWorse);
worse.length === 1 ? ok('one finding per changed module') : bad('amp finding count: ' + worse.length);
worse[0].reasonCodes[0] === 'CHANGE_AMPLIFICATION_WORSENED' ? ok('after > before → WORSENED') : bad('worse reasonCode: ' + worse[0].reasonCodes[0]);
worse[0].enforcement === 'OBSERVE_ONLY' ? ok('change-amp → OBSERVE_ONLY') : bad('amp enforcement: ' + worse[0].enforcement);
worse[0].enforcement !== 'BLOCKING' ? ok('change-amp can never block') : bad('change-amp reached BLOCKING');
worse[0].evidence.class === 'GRAPH_DERIVED' ? ok('change-amp → GRAPH_DERIVED evidence') : bad('amp evidence: ' + worse[0].evidence.class);
worse[0].status === 'OBSERVATION' ? ok('known delta → OBSERVATION status') : bad('worse status: ' + worse[0].status);

const sigBetter = { before: { 'm/a.js': { blastRadius: 9 } }, after: { 'm/a.js': { blastRadius: 2 } } };
changeAmplificationSignal(['m/a.js'], sigBetter)[0].reasonCodes[0] === 'CHANGE_AMPLIFICATION_IMPROVED'
  ? ok('after < before → IMPROVED') : bad('improved mapping wrong');

const sigSame = { before: { 'm/a.js': { blastRadius: 5 } }, after: { 'm/a.js': { blastRadius: 5 } } };
changeAmplificationSignal(['m/a.js'], sigSame)[0].reasonCodes[0] === 'CHANGE_AMPLIFICATION_UNCHANGED'
  ? ok('after === before → UNCHANGED') : bad('unchanged mapping wrong');

console.log('\nchange-amplification: UNKNOWN on missing signals (never fabricate)');
const noSig = changeAmplificationSignal(['m/a.js'], {});
noSig[0].reasonCodes[0] === 'CHANGE_AMPLIFICATION_UNKNOWN' ? ok('no signals → UNKNOWN reasonCode') : bad('missing-signal reasonCode: ' + noSig[0].reasonCodes[0]);
noSig[0].status === 'UNKNOWN' ? ok('no signals → UNKNOWN status (≠ PASS)') : bad('missing-signal status: ' + noSig[0].status);
noSig[0].enforcement === 'OBSERVE_ONLY' ? ok('UNKNOWN still OBSERVE_ONLY (never blocks)') : bad('unknown enforcement: ' + noSig[0].enforcement);

const halfSig = changeAmplificationSignal(['m/a.js'], { before: { 'm/a.js': { blastRadius: 4 } } });
halfSig[0].status === 'UNKNOWN' ? ok('one side missing (after absent) → UNKNOWN') : bad('half-signal status: ' + halfSig[0].status);
const notInGraph = changeAmplificationSignal(['m/ghost.js'], { before: { 'm/a.js': { blastRadius: 1 } }, after: { 'm/a.js': { blastRadius: 1 } } });
notInGraph[0].status === 'UNKNOWN' ? ok('module not in graph → UNKNOWN (no faked 0)') : bad('off-graph status: ' + notInGraph[0].status);

threw(() => changeAmplificationSignal('not-an-array')) ? ok('non-array changedModules throws') : bad('non-array did not throw');
changeAmplificationSignal([], {}).length === 0 ? ok('no changed modules → no findings') : bad('empty changedModules emitted findings');

console.log('\ncollectStructuralSignals composes both, never blocks');
const all = collectStructuralSignals({
  fileMetrics: [{ path: 'src/big.js', lines: 400 }, { path: 'src/ok.js', lines: 10 }],
  changedModules: ['m/a.js'],
  signals: sigWorse,
});
all.length === 2 ? ok('merges line + amp, drops sub-band file (2 findings)') : bad('collect count: ' + all.length);
all.every((f) => f.enforcement !== 'BLOCKING') ? ok('collector NEVER emits BLOCKING') : bad('collector emitted a BLOCKING finding');
collectStructuralSignals({}).length === 0 ? ok('empty input → no findings (defensive)') : bad('empty input emitted findings');

console.log('\nzero-dep invariant');
{
  const content = readFileSync(collectorPath, 'utf-8');
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m, dirty = null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) { dirty = m[1]; break; }
  }
  dirty === null ? ok('zero-dep: signal-collector.mjs imports only node:/relative')
    : bad('zero-dep violation: imports ' + dirty);
}

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
