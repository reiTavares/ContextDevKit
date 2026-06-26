#!/usr/bin/env node
/**
 * WF-0057 W2.4 (ADR-0122) — selftest for the concentration+fragmentation
 * symmetry detector. Covers §34.1 (cohesive >500-line file → KEEP_COHESIVE,
 * not split, not blocking), §34.7 (one-consumer pass-through wrapper →
 * REMOVE_WRAPPER candidate), §34.6 (artificial fragmentation detected), §34.19
 * (both directions evaluated), plus: a god-module → SPLIT but only
 * ADVISORY/REVIEW_REQUIRED (never auto-block), and recommendations without §32
 * evidence stay ADVISORY.
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
const detectorPath = resolve(KIT, SCRIPTS + '/fragmentation-detector.mjs');
existsSync(detectorPath) ? ok('fragmentation-detector.mjs exists') : bad('fragmentation-detector.mjs NOT FOUND');

let mod;
try {
  mod = await import(pathToFileURL(detectorPath).href);
} catch (err) {
  bad('Failed to import fragmentation-detector.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const {
  detectConcentration, detectFragmentation, analyzeModularityBalance,
} = mod;

for (const [n, f] of [
  ['detectConcentration', detectConcentration],
  ['detectFragmentation', detectFragmentation],
  ['analyzeModularityBalance', analyzeModularityBalance],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}

const Enforcement = { BLOCKING: 'BLOCKING', REVIEW_REQUIRED: 'REVIEW_REQUIRED', ADVISORY: 'ADVISORY' };
const Action = { SPLIT: 'SPLIT', MERGE: 'MERGE', REMOVE_WRAPPER: 'REMOVE_WRAPPER', KEEP_COHESIVE: 'KEEP_COHESIVE', OBSERVE: 'OBSERVE' };
const one = (arr) => (Array.isArray(arr) && arr.length === 1 ? arr[0] : null);

console.log('\n§34.1 — cohesive >500-line file → KEEP_COHESIVE, not split, not blocking');
const cohesive = one(detectConcentration({
  path: 'templates/contextkit/runtime/big-but-cohesive.mjs',
  lineCount: 540,
  fanOut: 2,
  responsibilities: ['render-one-report'],
}));
cohesive ? ok('a single finding returned for the cohesive file') : bad('expected exactly one finding');
cohesive && cohesive.recommendedAction === Action.KEEP_COHESIVE ? ok('action KEEP_COHESIVE (not SPLIT)') : bad('action: ' + (cohesive && cohesive.recommendedAction));
cohesive && cohesive.recommendedAction !== Action.SPLIT ? ok('540-line cohesive file is NOT split') : bad('cohesive file was split!');
cohesive && cohesive.enforcement !== Enforcement.BLOCKING ? ok('cohesive finding never BLOCKING (line count cannot block, §11)') : bad('cohesive finding reached BLOCKING!');
cohesive && cohesive.reasonCodes.includes('COHESIVE_SINGLE_RESPONSIBILITY') ? ok('reasonCode COHESIVE_SINGLE_RESPONSIBILITY') : bad('cohesive reasonCodes: ' + (cohesive && cohesive.reasonCodes));

console.log('\ngod-module → SPLIT candidate but only ADVISORY/REVIEW_REQUIRED (never auto-block)');
const godNoEvidence = one(detectConcentration({
  path: 'src/everything-manager.js',
  lineCount: 600,
  fanOut: 20,
  responsibilities: ['http', 'persistence', 'validation', 'rendering'],
}));
godNoEvidence && godNoEvidence.recommendedAction === Action.SPLIT ? ok('multi-responsibility + high fan-out → SPLIT candidate') : bad('god-module action: ' + (godNoEvidence && godNoEvidence.recommendedAction));
godNoEvidence && godNoEvidence.enforcement !== Enforcement.BLOCKING ? ok('god-module SPLIT is NEVER BLOCKING') : bad('god-module reached BLOCKING!');
godNoEvidence && godNoEvidence.enforcement === Enforcement.ADVISORY ? ok('SPLIT without §32 evidence stays ADVISORY (never mandatory)') : bad('no-evidence SPLIT enforcement: ' + (godNoEvidence && godNoEvidence.enforcement));
godNoEvidence && godNoEvidence.reasonCodes.includes('SPLIT_EVIDENCE_MISSING') ? ok('reasonCode SPLIT_EVIDENCE_MISSING when evidence absent') : bad('missing SPLIT_EVIDENCE_MISSING code');

const godWithEvidence = one(detectConcentration({
  path: 'src/everything-manager.js',
  fanOut: 20,
  responsibilities: ['http', 'persistence', 'validation', 'rendering'],
  splitEvidence: { independentResponsibility: true, newContract: true, couplingWontBounce: true },
}));
godWithEvidence && godWithEvidence.enforcement === Enforcement.REVIEW_REQUIRED ? ok('SPLIT WITH full §32 evidence → REVIEW_REQUIRED') : bad('with-evidence SPLIT enforcement: ' + (godWithEvidence && godWithEvidence.enforcement));
godWithEvidence && godWithEvidence.enforcement !== Enforcement.BLOCKING ? ok('even with evidence, SPLIT never BLOCKING (semantic dim, fork #3)') : bad('with-evidence SPLIT reached BLOCKING!');

console.log('\n§34.7 — one-consumer pass-through wrapper → REMOVE_WRAPPER candidate');
const wrapper = one(detectFragmentation({
  path: 'src/user-service-wrapper.js',
  fanIn: 1,
  fanOut: 1,
  passThrough: true,
  ownLogic: false,
}));
wrapper ? ok('a finding returned for the one-consumer wrapper') : bad('expected a wrapper finding');
wrapper && wrapper.recommendedAction === Action.REMOVE_WRAPPER ? ok('action REMOVE_WRAPPER') : bad('wrapper action: ' + (wrapper && wrapper.recommendedAction));
wrapper && wrapper.reasonCodes.includes('SINGLE_CONSUMER') ? ok('reasonCode SINGLE_CONSUMER') : bad('wrapper reasonCodes: ' + (wrapper && wrapper.reasonCodes));
wrapper && wrapper.enforcement !== Enforcement.BLOCKING ? ok('wrapper finding never BLOCKING') : bad('wrapper reached BLOCKING!');
wrapper && wrapper.enforcement === Enforcement.ADVISORY ? ok('REMOVE_WRAPPER without merge-evidence stays ADVISORY') : bad('wrapper enforcement: ' + (wrapper && wrapper.enforcement));

console.log('\n§34.6 — artificial fragmentation detected (pass-through chain in a co-change cluster)');
const fragment = one(detectFragmentation({
  path: 'src/step-two-forwarder.js',
  fanIn: 1,
  fanOut: 1,
  passThrough: true,
  ownLogic: false,
  coChangeCluster: true,
}));
// fanIn<=1 path wins first (REMOVE_WRAPPER) — exercise the chain via a multi-consumer link.
const chain = one(detectFragmentation({
  path: 'src/step-two-forwarder.js',
  fanIn: 2,
  fanOut: 1,
  passThrough: true,
  ownLogic: false,
  coChangeCluster: true,
}));
chain ? ok('artificial fragmentation surfaced a finding') : bad('expected a fragmentation finding');
chain && chain.recommendedAction === Action.MERGE ? ok('pass-through chain + co-change → MERGE candidate') : bad('chain action: ' + (chain && chain.recommendedAction));
chain && chain.reasonCodes.includes('CO_CHANGE_CLUSTER') ? ok('reasonCode CO_CHANGE_CLUSTER') : bad('chain reasonCodes: ' + (chain && chain.reasonCodes));
chain && chain.enforcement !== Enforcement.BLOCKING ? ok('fragmentation finding never BLOCKING') : bad('fragmentation reached BLOCKING!');

const chainWithEvidence = one(detectFragmentation({
  path: 'src/step-two-forwarder.js',
  fanIn: 2, passThrough: true, ownLogic: false, coChangeCluster: true,
  mergeEvidence: { singleCoherentJourney: true, boundariesPreserved: true },
}));
chainWithEvidence && chainWithEvidence.enforcement === Enforcement.REVIEW_REQUIRED ? ok('MERGE WITH full §32 merge-evidence → REVIEW_REQUIRED') : bad('with-evidence MERGE enforcement: ' + (chainWithEvidence && chainWithEvidence.enforcement));

console.log('\nnegative cases — a real boundary is NOT flagged as fragmentation');
detectFragmentation({ path: 'src/payment-adapter.js', fanIn: 4, fanOut: 3, passThrough: false, ownLogic: true }).length === 0
  ? ok('a unit with own logic + multiple consumers yields no fragmentation finding') : bad('false-positive fragmentation on a real module');
detectFragmentation({ path: 'src/port.js', fanIn: 1, passThrough: true, ownLogic: true }).length === 0
  ? ok('a single-consumer unit WITH own logic is not a wrapper') : bad('flagged a unit that has its own logic');

console.log('\n§34.19 — symmetry: BOTH directions evaluated in one pass');
const merged = analyzeModularityBalance({
  modules: [
    { path: 'src/everything-manager.js', fanOut: 20, responsibilities: ['a', 'b', 'c'] },
    { path: 'src/cohesive.mjs', lineCount: 600, fanOut: 1, responsibilities: ['one-thing'] },
  ],
  graph: [
    { path: 'src/wrap.js', fanIn: 1, passThrough: true, ownLogic: false },
  ],
});
const actions = merged.map((f) => f.recommendedAction);
actions.includes(Action.SPLIT) ? ok('concentration direction produced a SPLIT') : bad('no SPLIT from the modules pass');
actions.includes(Action.REMOVE_WRAPPER) ? ok('fragmentation direction produced a REMOVE_WRAPPER') : bad('no REMOVE_WRAPPER from the graph pass');
actions.includes(Action.KEEP_COHESIVE) ? ok('cohesive module kept (KEEP_COHESIVE) — line count alone never split it') : bad('cohesive module was not KEEP_COHESIVE');
merged.every((f) => f.enforcement !== Enforcement.BLOCKING) ? ok('NO finding in the symmetric pass is BLOCKING (modularity is never auto-block)') : bad('a modularity finding reached BLOCKING!');

console.log('\ndefensive — bad input throws (fail-fast, constitution §4/§8)');
const threw = (fn) => { try { fn(); return false; } catch { return true; } };
threw(() => detectConcentration(null)) ? ok('detectConcentration(null) throws') : bad('null did not throw');
threw(() => detectConcentration({})) ? ok('detectConcentration without path throws') : bad('no-path did not throw');
threw(() => detectFragmentation({})) ? ok('detectFragmentation without path throws') : bad('no-path did not throw');
Array.isArray(analyzeModularityBalance(null)) && analyzeModularityBalance(null).length === 0 ? ok('analyzeModularityBalance(null) → [] (defensive)') : bad('null signals not handled');

console.log('\nzero-dep invariant');
{
  const content = readFileSync(detectorPath, 'utf-8');
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m, dirty = null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) { dirty = m[1]; break; }
  }
  dirty === null ? ok('zero-dep: fragmentation-detector.mjs imports only node:/relative')
    : bad('zero-dep violation: imports ' + dirty);
}

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
