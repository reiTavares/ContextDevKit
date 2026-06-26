#!/usr/bin/env node
/**
 * WF-0057 W3 (ADR-0122) — selftest for the FITNESS-FUNCTION registry (§17).
 *
 * Covers: a valid declaration registers; a missing-field declaration throws
 * (fail-fast); a BLOCKING fn with non-deterministic evidence is rejected (Fork-2
 * invariant); OBSERVE_ONLY fns run but their findings are non-influencing
 * (Fork-3); the pre-registered floor catalogue holds F1-F3 + security/reliability/
 * testability as BLOCKING and cognitive-coherence as OBSERVE_ONLY; DISABLED is
 * skipped; a thrown evaluate is recorded (fail-closed) without killing siblings.
 *
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
const registryPath = resolve(KIT, SCRIPTS + '/fitness-registry.mjs');
const cataloguePath = resolve(KIT, SCRIPTS + '/fitness-catalogue.mjs');
existsSync(registryPath) ? ok('fitness-registry.mjs exists') : bad('fitness-registry.mjs NOT FOUND');
existsSync(cataloguePath) ? ok('fitness-catalogue.mjs exists') : bad('fitness-catalogue.mjs NOT FOUND');

let mod;
try {
  mod = await import(pathToFileURL(registryPath).href);
} catch (err) {
  bad('Failed to import fitness-registry.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const {
  FitnessType, RolloutState, createRegistry, registerFitness, runFitness,
  influencingFindings, buildDefaultRegistry,
} = mod;

console.log('\nexports');
for (const [n, v] of [
  ['createRegistry', createRegistry], ['registerFitness', registerFitness],
  ['runFitness', runFitness], ['influencingFindings', influencingFindings],
  ['buildDefaultRegistry', buildDefaultRegistry],
]) {
  typeof v === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}
FitnessType && RolloutState ? ok('FitnessType + RolloutState enums exported') : bad('enums missing');

/** A minimal valid declaration factory. */
const validDef = (over = {}) => ({
  id: 'T.sample', description: 'a sample fitness function', scope: 'changed-files',
  owner: 'architect', evidenceSource: 'DETERMINISTIC', severity: 'BLOCKER',
  enforcement: 'BLOCKING', relatedDecisions: ['ADR-0122'], failureMessage: 'it failed',
  remediation: 'fix it', rolloutState: 'ACTIVE', type: 'STATIC',
  evaluate: () => [], ...over,
});

console.log('\nvalid declaration registers');
const reg = createRegistry();
const desc = registerFitness(reg, validDef());
desc && desc.id === 'T.sample' && reg.functions.length === 1 && reg.byId.has('T.sample')
  ? ok('a valid declaration registers and is indexed by id') : bad('valid declaration did not register');
Object.isFrozen(desc) ? ok('registered descriptor is frozen') : bad('descriptor not frozen');

console.log('\nmissing-field declaration throws (fail-fast §8)');
for (const field of ['id', 'owner', 'evidenceSource', 'failureMessage', 'rolloutState', 'type']) {
  const broken = validDef();
  delete broken[field];
  let threw = false;
  try { registerFitness(createRegistry(), broken); } catch { threw = true; }
  threw ? ok('missing "' + field + '" throws') : bad('missing "' + field + '" did NOT throw');
}
let emptyArrThrew = false;
try { registerFitness(createRegistry(), validDef({ relatedDecisions: [] })); } catch { emptyArrThrew = true; }
emptyArrThrew ? ok('empty relatedDecisions array throws') : bad('empty array passed');
let noEvalThrew = false;
try { registerFitness(createRegistry(), validDef({ evaluate: undefined })); } catch { noEvalThrew = true; }
noEvalThrew ? ok('missing evaluate() throws') : bad('missing evaluate passed');

console.log('\nBLOCKING + non-deterministic evidence is rejected (Fork-2)');
let blockingSemThrew = false;
try { registerFitness(createRegistry(), validDef({ id: 'T.bad', evidenceSource: 'SEMANTIC' })); }
catch { blockingSemThrew = true; }
blockingSemThrew ? ok('BLOCKING + SEMANTIC evidence is rejected') : bad('BLOCKING + SEMANTIC was accepted!');
let blockingHeurThrew = false;
try { registerFitness(createRegistry(), validDef({ id: 'T.bad2', evidenceSource: 'HEURISTIC' })); }
catch { blockingHeurThrew = true; }
blockingHeurThrew ? ok('BLOCKING + HEURISTIC evidence is rejected') : bad('BLOCKING + HEURISTIC was accepted!');
// But OBSERVE_ONLY + SEMANTIC is fine (not blocking).
let observeSemOk = true;
try { registerFitness(createRegistry(), validDef({ id: 'T.obs', enforcement: 'OBSERVE_ONLY', rolloutState: 'OBSERVE_ONLY', evidenceSource: 'SEMANTIC' })); }
catch { observeSemOk = false; }
observeSemOk ? ok('OBSERVE_ONLY + SEMANTIC evidence is permitted') : bad('OBSERVE_ONLY + SEMANTIC wrongly rejected');

console.log('\ninvalid enum values throw');
for (const [field, val] of [['enforcement', 'NOPE'], ['rolloutState', 'NOPE'], ['type', 'NOPE'], ['evidenceSource', 'NOPE']]) {
  let threw = false;
  try { registerFitness(createRegistry(), validDef({ [field]: val })); } catch { threw = true; }
  threw ? ok('invalid ' + field + ' "' + val + '" throws') : bad('invalid ' + field + ' passed');
}

console.log('\nduplicate id throws');
let dupThrew = false;
const dupReg = createRegistry();
registerFitness(dupReg, validDef());
try { registerFitness(dupReg, validDef()); } catch { dupThrew = true; }
dupThrew ? ok('duplicate id is rejected') : bad('duplicate id accepted');

console.log('\nrunFitness — OBSERVE_ONLY runs but does not influence (Fork-3)');
const runReg = createRegistry();
const fakeFinding = (id) => ({ id, ruleId: id, path: 'p', status: 'VIOLATION', enforcement: 'OBSERVE_ONLY' });
registerFitness(runReg, validDef({ id: 'R.active', evaluate: () => [fakeFinding('a1')] }));
registerFitness(runReg, validDef({
  id: 'R.observe', enforcement: 'OBSERVE_ONLY', rolloutState: 'OBSERVE_ONLY',
  evidenceSource: 'SEMANTIC', evaluate: () => [fakeFinding('o1')],
}));
const run1 = runFitness(runReg, { any: 'context' });
run1.findings.length === 2 ? ok('runFitness collects findings from active + observe-only fns') : bad('expected 2 findings, got ' + run1.findings.length);
const observeFinding = run1.findings.find((f) => f.fitnessId === 'R.observe');
observeFinding && observeFinding.influencing === false
  ? ok('OBSERVE_ONLY finding is stamped influencing:false') : bad('OBSERVE_ONLY finding influences!');
const activeFinding = run1.findings.find((f) => f.fitnessId === 'R.active');
activeFinding && activeFinding.influencing === true
  ? ok('ACTIVE finding is stamped influencing:true') : bad('ACTIVE finding not influencing');
const influencing = influencingFindings(run1);
influencing.length === 1 && influencing[0].fitnessId === 'R.active'
  ? ok('influencingFindings excludes the OBSERVE_ONLY finding') : bad('influencingFindings wrong: ' + influencing.length);

console.log('\nrunFitness — DISABLED is skipped');
const disReg = createRegistry();
registerFitness(disReg, validDef({ id: 'R.disabled', rolloutState: 'DISABLED', evaluate: () => [fakeFinding('d1')] }));
registerFitness(disReg, validDef({ id: 'R.on', evaluate: () => [fakeFinding('e1')] }));
const run2 = runFitness(disReg, {});
run2.skipped.includes('R.disabled') && run2.findings.length === 1 && run2.findings[0].fitnessId === 'R.on'
  ? ok('DISABLED fitness function is skipped (no findings collected)') : bad('DISABLED not skipped: ' + JSON.stringify(run2.skipped));

console.log('\nrunFitness — a thrown evaluate is recorded fail-closed, siblings survive');
const errReg = createRegistry();
registerFitness(errReg, validDef({ id: 'R.boom', evaluate: () => { throw new Error('kaboom'); } }));
registerFitness(errReg, validDef({ id: 'R.fine', evaluate: () => [fakeFinding('f1')] }));
const run3 = runFitness(errReg, {});
run3.errored.includes('R.boom') ? ok('a thrown evaluate is recorded as errored (fail-closed)') : bad('thrown evaluate not recorded');
run3.findings.some((f) => f.fitnessId === 'R.fine')
  ? ok('a throwing fitness function does not take down its siblings') : bad('a throw killed sibling fns');

console.log('\npre-registered floor catalogue (§17, Fork-2/Fork-3)');
const defaultReg = await buildDefaultRegistry();
const byId = defaultReg.byId;
const expectBlocking = ['F1.forbidden-cycle', 'F2.boundary', 'F3.state-authority', 'floor.security', 'floor.reliability', 'floor.testability'];
for (const id of expectBlocking) {
  const fn = byId.get(id);
  fn && fn.enforcement === 'BLOCKING' && fn.rolloutState === 'ACTIVE'
    ? ok('catalogue has "' + id + '" as BLOCKING/ACTIVE') : bad('"' + id + '" missing or not BLOCKING/ACTIVE');
}
for (const id of ['F1.forbidden-cycle', 'F2.boundary', 'F3.state-authority']) {
  const fn = byId.get(id);
  fn && ['GRAPH_DERIVED', 'SCHEMA_DERIVED'].includes(fn.evidenceSource)
    ? ok('"' + id + '" carries a deterministic-tier evidence source') : bad('"' + id + '" evidence not deterministic-tier');
}
const cog = byId.get('observe.cognitive-coherence');
cog && cog.rolloutState === 'OBSERVE_ONLY' && cog.enforcement === 'OBSERVE_ONLY'
  ? ok('cognitive-coherence is OBSERVE_ONLY (Fork-3)') : bad('cognitive-coherence not OBSERVE_ONLY');
const cha = byId.get('observe.change-amplification');
cha && cha.rolloutState === 'OBSERVE_ONLY' ? ok('change-amplification is OBSERVE_ONLY (Fork-3)') : bad('change-amplification not OBSERVE_ONLY');
const line = byId.get('signal.line-count');
line && line.rolloutState === 'ADVISORY' && line.enforcement === 'ADVISORY'
  ? ok('line-count is ADVISORY (ADR-0122 demotion)') : bad('line-count not ADVISORY');
defaultReg.functions.length === 9 ? ok('catalogue holds all 9 fitness functions') : bad('expected 9, got ' + defaultReg.functions.length);

console.log('\ncatalogue functions wire to the W2 analyzers (no findings on empty context)');
const emptyRun = runFitness(defaultReg, {});
emptyRun.errored.length === 0 ? ok('default catalogue runs over an empty context without throwing') : bad('catalogue errored: ' + JSON.stringify(emptyRun.errored));
// F1/F2/F3 fail-closed to UNKNOWN findings on missing graph/baseline (never silently empty when conformance is provided emptyish).
const conformanceRun = runFitness(defaultReg, { conformance: {} });
conformanceRun.findings.some((f) => f.fitnessId === 'F1.forbidden-cycle' && f.status === 'UNKNOWN')
  ? ok('F1 fail-closes to UNKNOWN when graph/baseline evidence is missing (never silent PASS)') : bad('F1 did not fail-closed');

console.log('\nzero-dep invariant');
for (const p of [registryPath, cataloguePath]) {
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
