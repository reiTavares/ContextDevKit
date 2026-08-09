#!/usr/bin/env node
/**
 * WF-0057 W2.2 (ADR-0122) — selftest for the ArchitectureConformanceEvaluator.
 * Covers the §34 acceptance rows owned by this wave:
 *   §34.3  a NEW dependency cycle blocks (BLOCKING + VIOLATION)
 *   §34.15 a cycle already in the baseline does NOT block (baseline-relative)
 *   §34.4  a boundary / dependency-direction violation is detected
 *   §34.5  a legit adapter boundary passes
 *   §34.2  a duplicate canonical state authority blocks (short 2nd writer)
 *   §34.22 missing graph/baseline evidence → UNKNOWN, never PASS (fail-closed)
 * Plus: BLOCKING findings always carry a deterministic-tier evidence class (the
 * makeFinding invariant), and pre-existing boundary/authority claims don't block.
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
const evalPath = resolve(KIT, SCRIPTS + '/conformance-evaluator.mjs');
const rulesPath = resolve(KIT, SCRIPTS + '/conformance-rules.mjs');
existsSync(evalPath) ? ok('conformance-evaluator.mjs exists') : bad('conformance-evaluator.mjs NOT FOUND');
existsSync(rulesPath) ? ok('conformance-rules.mjs exists') : bad('conformance-rules.mjs NOT FOUND');

let mod, rules, contract;
try {
  mod = await import(pathToFileURL(evalPath).href);
  rules = await import(pathToFileURL(rulesPath).href);
  contract = await import(pathToFileURL(resolve(KIT, SCRIPTS + '/finding.mjs')).href);
} catch (err) {
  bad('Failed to import evaluator/rules/contract: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const { evaluateConformance } = mod;
const { newCycles, boundaryViolations, duplicateStateAuthorities, cycleKey } = rules;
const { Enforcement, FindingStatus, EvidenceClass, DETERMINISTIC_TIER, ciShouldBlock } = contract;

for (const [n, f] of [
  ['evaluateConformance', evaluateConformance], ['newCycles', newCycles],
  ['boundaryViolations', boundaryViolations],
  ['duplicateStateAuthorities', duplicateStateAuthorities], ['cycleKey', cycleKey],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}

/** A BLOCKING finding must always carry a deterministic-tier evidence class. */
const assertBlocking = (f, label) => {
  if (!f) { bad(label + ': no finding'); return; }
  f.enforcement === Enforcement.BLOCKING ? ok(label + ': BLOCKING') : bad(label + ': enforcement ' + f.enforcement);
  f.status === FindingStatus.VIOLATION ? ok(label + ': VIOLATION') : bad(label + ': status ' + f.status);
  DETERMINISTIC_TIER.has(f.evidence.class) ? ok(label + ': deterministic-tier evidence (' + f.evidence.class + ')') : bad(label + ': evidence ' + f.evidence.class);
};

console.log('\n§34.3 — a NEW forbidden cycle blocks');
const cyclesNow = [['a/index.mjs', 'b/index.mjs']]; // a→b→a
const cleanBaseline = { cycles: [], forbiddenEdges: [], stateAuthorities: [] };
const r1 = evaluateConformance({ insights: { cycles: cyclesNow }, baseline: cleanBaseline });
const cycleF = r1.find((f) => f.ruleId === 'F1.forbidden-cycle');
cycleF ? ok('new cycle produced a finding') : bad('new cycle produced NO finding');
assertBlocking(cycleF, 'F1 new cycle');
ciShouldBlock(r1) === true ? ok('new cycle → ciShouldBlock true') : bad('new cycle did not block CI');
cycleF && cycleF.reasonCodes.includes('NEW_FORBIDDEN_CYCLE') ? ok('reasonCode NEW_FORBIDDEN_CYCLE') : bad('missing reasonCode');

console.log('\n§34.15 — a cycle already in the baseline does NOT block');
const baselineWithCycle = { cycles: [['a/index.mjs', 'b/index.mjs']], forbiddenEdges: [], stateAuthorities: [] };
const r2 = evaluateConformance({ insights: { cycles: cyclesNow }, baseline: baselineWithCycle });
r2.some((f) => f.ruleId === 'F1.forbidden-cycle' && f.status === FindingStatus.VIOLATION)
  ? bad('pre-existing cycle wrongly blocked') : ok('pre-existing cycle did NOT block (baseline-relative)');
ciShouldBlock(r2) === false ? ok('pre-existing cycle → ciShouldBlock false') : bad('pre-existing cycle blocked CI');
// Rotation-independence: b→a→b is the SAME cycle as a→b→a.
newCycles([['b/index.mjs', 'a/index.mjs']], baselineWithCycle.cycles).length === 0
  ? ok('rotation-independent cycle key (b→a == a→b)') : bad('rotation made the cycle look new');

console.log('\n§34.4 — a boundary / dependency-direction violation is detected');
const layerRules = {
  layers: { domain: ['src/domain'], infra: ['src/infra'], transport: ['src/http'] },
  forbidden: [{ from: 'domain', to: 'infra' }, { from: 'domain', to: 'transport' }],
  invertPairs: [{ from: 'domain', to: 'infra' }],
  adapters: ['src/infra/adapters'],
};
const leakyModules = [
  { path: 'src/domain/order.mjs', deps: ['src/infra/db-client.mjs'] }, // domain → infra: VIOLATION
  { path: 'src/infra/db-client.mjs', deps: [] },
];
const r3 = evaluateConformance({
  insights: { cycles: [] }, modules: leakyModules, baseline: cleanBaseline, layerRules,
});
const boundaryF = r3.find((f) => f.ruleId === 'F2.boundary');
boundaryF ? ok('boundary violation produced a finding') : bad('boundary violation NOT detected');
assertBlocking(boundaryF, 'F2 boundary');
boundaryF && boundaryF.recommendedAction === 'INVERT_DEPENDENCY' ? ok('domain→infra → INVERT_DEPENDENCY') : bad('action: ' + (boundaryF && boundaryF.recommendedAction));
// A clean direction (infra → domain) must NOT fire.
const cleanDir = boundaryViolations(
  [{ path: 'src/infra/db-client.mjs', deps: ['src/domain/order.mjs'] }, { path: 'src/domain/order.mjs', deps: [] }],
  layerRules, [],
);
cleanDir.length === 0 ? ok('infra→domain (correct direction) does NOT fire') : bad('correct direction wrongly flagged');

console.log('\n§34.5 — a legit adapter boundary passes');
const adapterModules = [
  { path: 'src/infra/adapters/order-repo.mjs', deps: ['src/domain/order.mjs'] }, // adapter touches domain: legit
  { path: 'src/domain/order.mjs', deps: [] },
];
// Adapter importing INFRA (still its own layer infra) — and the allow-listed adapter path.
const adapterLeak = [
  { path: 'src/infra/adapters/order-repo.mjs', deps: ['src/infra/db-client.mjs'] },
  { path: 'src/infra/db-client.mjs', deps: [] },
];
const r5 = evaluateConformance({ insights: { cycles: [] }, modules: adapterModules, baseline: cleanBaseline, layerRules });
r5.some((f) => f.ruleId === 'F2.boundary') ? bad('adapter→domain wrongly blocked') : ok('adapter→domain passes (no finding)');
boundaryViolations(adapterLeak, { ...layerRules, forbidden: [{ from: 'infra', to: 'infra' }] }, []).length === 0
  ? ok('allow-listed adapter path is exempt from boundary rule') : bad('adapter path not exempted');

console.log('\n§34.2 — a (short) module creating a 2nd state authority blocks');
const ownership = { 'session.tokens': 'src/economy/token-ledger.mjs' };
const writeAuthorities = [
  { state: 'session.tokens', module: 'src/economy/token-ledger.mjs' }, // canonical owner: legit
  { state: 'session.tokens', module: 'src/util/quick-writer.mjs' },    // 2nd writer: VIOLATION
];
const r6 = evaluateConformance({ insights: { cycles: [] }, baseline: cleanBaseline, ownership, writeAuthorities });
const stateF = r6.find((f) => f.ruleId === 'F3.state-authority');
stateF ? ok('duplicate state authority produced a finding') : bad('duplicate authority NOT detected');
assertBlocking(stateF, 'F3 state authority');
stateF && stateF.recommendedAction === 'CONSOLIDATE_STATE' ? ok('action CONSOLIDATE_STATE') : bad('action: ' + (stateF && stateF.recommendedAction));
stateF && stateF.evidence.class === EvidenceClass.SCHEMA_DERIVED ? ok('F3 evidence SCHEMA_DERIVED') : bad('F3 evidence: ' + (stateF && stateF.evidence.class));
// The canonical owner alone must NOT fire.
duplicateStateAuthorities([{ state: 'session.tokens', module: 'src/economy/token-ledger.mjs' }], ownership, []).length === 0
  ? ok('canonical owner alone does NOT fire') : bad('owner wrongly flagged as duplicate');
// A pre-existing duplicate (in baseline) does NOT block.
const baselineWithDup = { cycles: [], forbiddenEdges: [], stateAuthorities: [{ state: 'session.tokens', module: 'src/util/quick-writer.mjs' }] };
const r6b = evaluateConformance({ insights: { cycles: [] }, baseline: baselineWithDup, ownership, writeAuthorities });
r6b.some((f) => f.ruleId === 'F3.state-authority' && f.status === FindingStatus.VIOLATION)
  ? bad('pre-existing duplicate authority wrongly blocked') : ok('pre-existing duplicate authority did NOT block');

console.log('\n§34.22 — missing graph/baseline evidence → UNKNOWN, never PASS (fail-closed)');
const rMissingGraph = evaluateConformance({ insights: null, baseline: cleanBaseline });
const f1Unknown = rMissingGraph.find((f) => f.ruleId === 'F1.forbidden-cycle');
f1Unknown && f1Unknown.status === FindingStatus.UNKNOWN ? ok('missing graph → F1 UNKNOWN') : bad('missing graph not UNKNOWN: ' + (f1Unknown && f1Unknown.status));
f1Unknown && f1Unknown.status !== FindingStatus.PASS ? ok('missing graph never PASS') : bad('missing graph leaked PASS');
ciShouldBlock(rMissingGraph) === false ? ok('UNKNOWN is not a BLOCKING VIOLATION (routes to REVIEW downstream)') : bad('UNKNOWN wrongly counted as a CI block');
const rMissingBaseline = evaluateConformance({ insights: { cycles: cyclesNow }, baseline: null });
rMissingBaseline.some((f) => f.status === FindingStatus.UNKNOWN) ? ok('missing baseline → UNKNOWN (not "everything is new")') : bad('missing baseline did not fail closed');
rMissingBaseline.some((f) => f.status === FindingStatus.VIOLATION)
  ? bad('missing baseline manufactured a VIOLATION') : ok('missing baseline did NOT manufacture a VIOLATION');
// F3 fails closed too when ownership is given but baseline is absent.
const rF3NoBaseline = evaluateConformance({ insights: { cycles: [] }, baseline: null, ownership, writeAuthorities });
rF3NoBaseline.some((f) => f.ruleId === 'F3.state-authority' && f.status === FindingStatus.UNKNOWN)
  ? ok('F3 missing baseline → UNKNOWN') : bad('F3 did not fail closed without baseline');

console.log('\nclean graph + clean baseline → no findings (no false positive)');
const rClean = evaluateConformance({
  insights: { cycles: [] }, modules: [{ path: 'src/domain/x.mjs', deps: [] }],
  baseline: cleanBaseline, layerRules, ownership, writeAuthorities: [{ state: 'session.tokens', module: 'src/economy/token-ledger.mjs' }],
});
rClean.length === 0 ? ok('clean conformance → zero findings') : bad('clean state produced ' + rClean.length + ' findings: ' + rClean.map((f) => f.ruleId).join(','));
ciShouldBlock(rClean) === false ? ok('clean → ciShouldBlock false') : bad('clean state blocked CI');

console.log('\nzero-dep invariant');
for (const p of [evalPath, rulesPath]) {
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
