#!/usr/bin/env node
/**
 * WF-0057 W2 (ADR-0122) — selftest for the arch-debt DebtClassifier +
 * DebtRiskEvaluator. Covers: valid (dimension,debtClass) pairs accepted &
 * invalid rejected (§4); risk is a multi-factor OBJECT, not a scalar average
 * (§5.3); a floor breach forces the max disposition regardless of low other
 * factors (§20.3, lexicographic); principal/interest stay within bounded enums
 * (§5.1/§5.2). Zero-dep, node:/relative only, Windows-safe. Exit 0/1.
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
const classifierPath = resolve(KIT, SCRIPTS + '/debt-classifier.mjs');
const taxonomyPath = resolve(KIT, SCRIPTS + '/debt-taxonomy.mjs');
existsSync(classifierPath) ? ok('debt-classifier.mjs exists') : bad('debt-classifier.mjs NOT FOUND');
existsSync(taxonomyPath) ? ok('debt-taxonomy.mjs exists') : bad('debt-taxonomy.mjs NOT FOUND');

let mod;
try {
  mod = await import(pathToFileURL(classifierPath).href);
} catch (err) {
  bad('Failed to import debt-classifier.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const { classify, evaluateRisk, evaluateDebt, DIMENSION_DEBTCLASS, DEFAULT_RISK } = mod;

// Pull the enums from the contract so the test asserts against the SAME source.
const findingMod = await import(pathToFileURL(resolve(KIT, SCRIPTS + '/finding.mjs')).href);
const { Dimension, DebtClass, Principal, Interest, isFloorBreach } = findingMod;

const threw = (fn) => { try { fn(); return false; } catch { return true; } };

for (const [n, f] of [
  ['classify', classify], ['evaluateRisk', evaluateRisk], ['evaluateDebt', evaluateDebt],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}
DIMENSION_DEBTCLASS && typeof DIMENSION_DEBTCLASS === 'object'
  ? ok('DIMENSION_DEBTCLASS table exported') : bad('DIMENSION_DEBTCLASS not exported');

console.log('\nclassify: valid (dimension,debtClass) pairs accepted (§4)');
const valid = [
  [Dimension.ARCHITECTURE_CONFORMANCE, DebtClass.ARCHITECTURAL],
  [Dimension.ARCHITECTURE_CONFORMANCE, DebtClass.GOVERNANCE],
  [Dimension.MODULARITY, DebtClass.DESIGN],
  [Dimension.SECURITY_PRIVACY, DebtClass.SECURITY],
  [Dimension.SECURITY_PRIVACY, DebtClass.PRIVACY],
  [Dimension.DATA_CONTRACTS, DebtClass.MIGRATION],
  [Dimension.COGNITIVE_COHERENCE, DebtClass.AGENT_EXECUTION],
];
let allValid = true;
for (const [d, c] of valid) {
  const out = classify({ dimension: d, debtClass: c });
  if (out.dimension !== d || out.debtClass !== c) { allValid = false; bad(`classify lost the pair (${d}, ${c})`); }
}
allValid ? ok(valid.length + ' allowed pairs accepted & returned intact') : bad('some allowed pairs failed');
// classify must not mutate its input.
const sig = { dimension: Dimension.MODULARITY, debtClass: DebtClass.CODE, extra: 1 };
classify(sig);
sig.extra === 1 ? ok('classify does not mutate the input signal') : bad('classify mutated input');

console.log('\nclassify: invalid pairs / enums rejected fail-fast (§4, §8)');
// (dimension, debtClass) outside the §4 table — both valid enums, wrong pairing.
threw(() => classify({ dimension: Dimension.MODULARITY, debtClass: DebtClass.SECURITY }))
  ? ok('out-of-table pair (MODULARITY, SECURITY) throws') : bad('out-of-table pair did NOT throw');
threw(() => classify({ dimension: Dimension.COMPLEXITY, debtClass: DebtClass.MIGRATION }))
  ? ok('out-of-table pair (COMPLEXITY, MIGRATION) throws') : bad('out-of-table pair did NOT throw');
threw(() => classify({ dimension: 'BOGUS', debtClass: DebtClass.CODE }))
  ? ok('invalid dimension throws') : bad('invalid dimension did NOT throw');
threw(() => classify({ dimension: Dimension.COMPLEXITY, debtClass: 'BOGUS' }))
  ? ok('invalid debtClass throws') : bad('invalid debtClass did NOT throw');
threw(() => classify(null)) ? ok('classify(null) throws') : bad('classify(null) did NOT throw');

console.log('\nevaluateRisk: risk is a multi-factor OBJECT, not a scalar average (§5.3)');
const benign = classify({ dimension: Dimension.COMPLEXITY, debtClass: DebtClass.CODE });
const risk = evaluateRisk(benign, { blastRadius: 'MEDIUM', impact: 'LOW', probability: 'HIGH' });
(typeof risk === 'object' && risk !== null && typeof risk !== 'number')
  ? ok('risk is an object (not a number)') : bad('risk is not an object');
const factorKeys = ['probability', 'impact', 'blastRadius', 'detectability', 'reversibility', 'compounding', 'timeToManifest'];
factorKeys.every((k) => k in risk) ? ok('risk carries all 7 bounded factor bands') : bad('risk missing a factor band');
['securityFloor', 'dataIntegrityFloor', 'operationalFloor'].every((k) => k in risk)
  ? ok('risk carries the 3 floor flags') : bad('risk missing a floor flag');
// Independent factors are NOT collapsed — distinct inputs survive distinctly.
(risk.blastRadius === 'MEDIUM' && risk.impact === 'LOW' && risk.probability === 'HIGH')
  ? ok('distinct factor bands are preserved independently (no averaging)') : bad('factors were collapsed/averaged');
// Unsupplied factors default to UNKNOWN, never coerced to 0/LOW (§5.3).
const sparse = evaluateRisk(benign, {});
sparse.detectability === 'UNKNOWN' && sparse.reversibility === 'UNKNOWN'
  ? ok('unsupplied factors default to UNKNOWN (not 0)') : bad('unsupplied factor not UNKNOWN');
// An out-of-enum band is coerced to UNKNOWN, not trusted.
evaluateRisk(benign, { impact: 'CATASTROPHIC' }).impact === 'UNKNOWN'
  ? ok('invalid band coerced to UNKNOWN') : bad('invalid band leaked through');
isFloorBreach(sparse) === false ? ok('benign risk → no floor breach') : bad('benign tripped a floor');

console.log('\nfloor breach forces MAX disposition regardless of low factors (§20.3 lexicographic)');
// A security-class finding flagged as a confirmed breach, but with deliberately
// LOW/UNKNOWN other factors — the floor must still dominate.
const secFinding = classify({ dimension: Dimension.SECURITY_PRIVACY, debtClass: DebtClass.SECURITY });
const secRisk = evaluateRisk(secFinding, {
  securityBreach: true, probability: 'LOW', impact: 'LOW', blastRadius: 'LOW',
  detectability: 'HIGH', reversibility: 'HIGH', compounding: 'LOW',
});
secRisk.securityFloor === true ? ok('security-class + breach → securityFloor true') : bad('securityFloor not set');
isFloorBreach(secRisk) === true ? ok('isFloorBreach true despite all-low other factors') : bad('floor washed away by low factors!');
(secRisk.impact === 'HIGH' && secRisk.blastRadius === 'HIGH' && secRisk.probability === 'HIGH')
  ? ok('harm-bearing bands forced HIGH by the floor (not averaged from LOW)') : bad('floor did not force harm bands HIGH');
// Explicit floor override also works, even on a non-security debtClass.
const dataFinding = classify({ dimension: Dimension.RELIABILITY, debtClass: DebtClass.DATA });
const dataRisk = evaluateRisk(dataFinding, { dataIntegrityBreach: true, impact: 'LOW' });
dataRisk.dataIntegrityFloor === true && isFloorBreach(dataRisk) ? ok('data-class + breach → dataIntegrityFloor') : bad('dataIntegrityFloor missed');
// A breach flag on a NON-floor-bearing class must NOT trip the floor.
const codeRisk = evaluateRisk(benign, { securityBreach: true });
codeRisk.securityFloor === false && isFloorBreach(codeRisk) === false
  ? ok('breach flag on a CODE-class finding does not trip security floor') : bad('CODE-class spuriously tripped floor');
// Explicit floor override path (operational).
const opFinding = classify({ dimension: Dimension.OPERATIONS_DELIVERY, debtClass: DebtClass.OPERATIONAL });
evaluateRisk(opFinding, { operationalFloor: true }).operationalFloor === true
  ? ok('explicit operationalFloor override honored') : bad('operationalFloor override ignored');

console.log('\nevaluateDebt: principal/interest within bounded enums; disposition reflects floor (§5.1/§5.2)');
const debt = evaluateDebt(benign, { principal: Principal.MEDIUM, interest: [Interest.FUTURE_CHANGE_COST, Interest.TESTING_COST] });
debt.principal === Principal.MEDIUM ? ok('valid principal preserved') : bad('principal lost: ' + debt.principal);
Object.values(Principal).includes(debt.principal) ? ok('principal is a bounded enum value') : bad('principal out of enum');
(Array.isArray(debt.interest) && debt.interest.every((i) => Object.values(Interest).includes(i)))
  ? ok('interest[] all bounded enum values') : bad('interest has an out-of-enum value');
debt.interest.length === 2 ? ok('both valid interest categories kept') : bad('interest count: ' + debt.interest.length);
debt.disposition === 'SCORED' ? ok('benign debt → disposition SCORED') : bad('benign disposition: ' + debt.disposition);
// Invalid principal/interest are coerced, not trusted.
const dirty = evaluateDebt(benign, { principal: 'HUGE', interest: ['BOGUS_COST', Interest.REVIEW_COST] });
dirty.principal === Principal.UNKNOWN ? ok('invalid principal → UNKNOWN') : bad('invalid principal leaked: ' + dirty.principal);
(dirty.interest.length === 1 && dirty.interest[0] === Interest.REVIEW_COST)
  ? ok('invalid interest filtered out, valid kept') : bad('interest filter wrong: ' + JSON.stringify(dirty.interest));
evaluateDebt(benign, {}).interest.length === 0 ? ok('no interest supplied → []') : bad('default interest not []');
// A floored finding reports disposition MAX.
const flooredDebt = evaluateDebt(secFinding, { securityBreach: true, principal: Principal.SMALL });
flooredDebt.disposition === 'MAX' ? ok('floored finding → disposition MAX') : bad('floored disposition: ' + flooredDebt.disposition);

console.log('\nDEFAULT_RISK re-export + table integrity');
DEFAULT_RISK && DEFAULT_RISK.probability === 'UNKNOWN' && DEFAULT_RISK.securityFloor === false
  ? ok('DEFAULT_RISK re-exported (all UNKNOWN, no floor)') : bad('DEFAULT_RISK wrong/missing');
Object.keys(DIMENSION_DEBTCLASS).length === Object.keys(Dimension).length
  ? ok('DIMENSION_DEBTCLASS covers all 12 dimensions') : bad('table dimension count: ' + Object.keys(DIMENSION_DEBTCLASS).length);

console.log('\nzero-dep invariant');
for (const p of [classifierPath, taxonomyPath]) {
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
