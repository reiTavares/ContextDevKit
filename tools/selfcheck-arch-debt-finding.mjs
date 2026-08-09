#!/usr/bin/env node
/**
 * WF-0057 W2 (ADR-0122) — selftest for the arch-debt finding contract.
 * Covers: makeFinding validation/defaults, liftLegacyFinding lossless round-trip
 * + line-budget→ADVISORY, mayOverride authority rule, resolveMissingEvidence
 * never PASS, isFloorBreach, ciShouldBlock blocks only on BLOCKING+VIOLATION.
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
const findingPath = resolve(KIT, SCRIPTS + '/finding.mjs');
const enumsPath = resolve(KIT, SCRIPTS + '/finding-enums.mjs');
existsSync(findingPath) ? ok('finding.mjs exists') : bad('finding.mjs NOT FOUND');
existsSync(enumsPath) ? ok('finding-enums.mjs exists') : bad('finding-enums.mjs NOT FOUND');

let mod;
try {
  mod = await import(pathToFileURL(findingPath).href);
} catch (err) {
  bad('Failed to import finding.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const {
  makeFinding, liftLegacyFinding, mayOverride, resolveMissingEvidence,
  isFloorBreach, ciShouldBlock, isApproval, baselineDisposition,
  Enforcement, FindingStatus, EvidenceClass, GateOutcome, RecommendedAction,
  Principal, BaselineClass, Dimension, DebtClass, PASSING_OUTCOMES,
} = mod;

for (const [n, f] of [
  ['makeFinding', makeFinding], ['liftLegacyFinding', liftLegacyFinding],
  ['mayOverride', mayOverride], ['resolveMissingEvidence', resolveMissingEvidence],
  ['isFloorBreach', isFloorBreach], ['ciShouldBlock', ciShouldBlock],
  ['isApproval', isApproval], ['baselineDisposition', baselineDisposition],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}

console.log('\nEnum cardinality (§27/§2/§6.1)');
Object.keys(RecommendedAction).length === 15 ? ok('RecommendedAction has 15 values') : bad('RecommendedAction count: ' + Object.keys(RecommendedAction).length);
Object.keys(EvidenceClass).length === 9 ? ok('EvidenceClass has 9 values') : bad('EvidenceClass count: ' + Object.keys(EvidenceClass).length);
Object.keys(GateOutcome).length === 9 ? ok('GateOutcome has 9 values') : bad('GateOutcome count: ' + Object.keys(GateOutcome).length);
Object.keys(BaselineClass).length === 8 ? ok('BaselineClass has 7+UNKNOWN values') : bad('BaselineClass count: ' + Object.keys(BaselineClass).length);
Object.keys(Dimension).length === 12 ? ok('Dimension has 12 values') : bad('Dimension count: ' + Object.keys(Dimension).length);
PASSING_OUTCOMES instanceof Set && !PASSING_OUTCOMES.has('UNKNOWN') && !PASSING_OUTCOMES.has('SKIPPED')
  ? ok('PASSING_OUTCOMES excludes UNKNOWN/SKIPPED') : bad('PASSING_OUTCOMES wrong');

console.log('\nmakeFinding validation + defaults');
const minimal = makeFinding({ id: 'r:p:1', ruleId: 'r', path: 'src/x.js' });
minimal.status === FindingStatus.OBSERVATION ? ok('default status OBSERVATION') : bad('default status: ' + minimal.status);
minimal.enforcement === Enforcement.ADVISORY ? ok('default enforcement ADVISORY') : bad('default enforcement: ' + minimal.enforcement);
minimal.principal === Principal.UNKNOWN ? ok('default principal UNKNOWN') : bad('default principal: ' + minimal.principal);
minimal.confidence === 0.5 ? ok('default confidence 0.5') : bad('default confidence: ' + minimal.confidence);
minimal.recommendedAction === RecommendedAction.OBSERVE ? ok('default action OBSERVE') : bad('default action: ' + minimal.recommendedAction);
Array.isArray(minimal.interest) && minimal.interest.length === 0 ? ok('default interest []') : bad('default interest not []');

const threw = (fn) => { try { fn(); return false; } catch { return true; } };
threw(() => makeFinding(null)) ? ok('makeFinding(null) throws') : bad('makeFinding(null) did not throw');
threw(() => makeFinding({ ruleId: 'r', path: 'p' })) ? ok('missing id throws') : bad('missing id did not throw');
threw(() => makeFinding({ id: 'i', ruleId: 'r' })) ? ok('missing path throws') : bad('missing path did not throw');
threw(() => makeFinding({ id: 'i', ruleId: 'r', path: 'p', status: 'BOGUS' })) ? ok('invalid status throws') : bad('invalid status did not throw');
threw(() => makeFinding({ id: 'i', ruleId: 'r', path: 'p', confidence: 2 })) ? ok('confidence out of range throws') : bad('confidence 2 did not throw');
// fork #2: BLOCKING requires deterministic-tier evidence.
threw(() => makeFinding({ id: 'i', ruleId: 'r', path: 'p', enforcement: 'BLOCKING', evidence: { class: 'HEURISTIC', source: 's', ref: 'r' } }))
  ? ok('BLOCKING + HEURISTIC evidence throws (fork #2)') : bad('BLOCKING+HEURISTIC did not throw');
let blockingOk = false;
try { makeFinding({ id: 'i', ruleId: 'r', path: 'p', status: 'VIOLATION', enforcement: 'BLOCKING', evidence: { class: 'DETERMINISTIC', source: 's', ref: 'r' } }); blockingOk = true; } catch { blockingOk = false; }
blockingOk ? ok('BLOCKING + DETERMINISTIC evidence accepted') : bad('BLOCKING+DETERMINISTIC rejected wrongly');

console.log('\nliftLegacyFinding lossless round-trip + line-budget→ADVISORY');
const legacyLine = { kind: 'line-budget', severity: 5, path: 'src/big.js', line: 400, message: '400 lines — RED ZONE' };
const lifted = liftLegacyFinding(legacyLine);
lifted.path === legacyLine.path ? ok('path round-trips') : bad('path lost: ' + lifted.path);
lifted.line === legacyLine.line ? ok('line round-trips') : bad('line lost: ' + lifted.line);
lifted.message === legacyLine.message ? ok('message round-trips') : bad('message lost');
lifted.ruleId === 'line-budget' ? ok('kind → ruleId') : bad('ruleId: ' + lifted.ruleId);
lifted.evidence.class === EvidenceClass.HEURISTIC ? ok('legacy → HEURISTIC evidence') : bad('evidence: ' + lifted.evidence.class);
lifted.reasonCodes[0] === 'LINE_BUDGET' ? ok('reasonCode LINE_BUDGET') : bad('reasonCode: ' + lifted.reasonCodes[0]);
// THE crucial behavior: severity-5 line-budget must NOT become BLOCKING.
lifted.enforcement === Enforcement.ADVISORY ? ok('line-budget → ADVISORY (NOT BLOCKING, fork #2)') : bad('line-budget enforcement: ' + lifted.enforcement);
lifted.enforcement !== Enforcement.BLOCKING ? ok('line count alone can never block') : bad('line-budget reached BLOCKING');
const legacySnip = { kind: 'srp-and', severity: 2, path: 'src/y.js', line: 12, snippet: 'function fetchAndSave()', message: 'joins two responsibilities' };
const liftedSnip = liftLegacyFinding(legacySnip);
liftedSnip.snippet === legacySnip.snippet ? ok('snippet round-trips') : bad('snippet lost');
liftedSnip.enforcement === Enforcement.ADVISORY ? ok('srp-and → ADVISORY') : bad('srp-and enforcement: ' + liftedSnip.enforcement);
const legacyNoLine = { kind: 'react-state-loop', severity: 3, path: 'src/C.jsx', message: 'extract a hook' };
liftLegacyFinding(legacyNoLine).id === 'react-state-loop:src/C.jsx:file' ? ok('missing line → id anchor "file"') : bad('id anchor wrong');
threw(() => liftLegacyFinding({ severity: 1 })) ? ok('legacy without kind/path throws') : bad('bad legacy did not throw');

console.log('\nmayOverride authority rule (§16, fork #3)');
const det = makeFinding({ id: 'd', ruleId: 'F1', path: 'p', status: 'VIOLATION', evidence: { class: 'DETERMINISTIC', source: 's', ref: 'r' } });
const sem = makeFinding({ id: 's', ruleId: 'D12', path: 'p', enforcement: 'OBSERVE_ONLY', evidence: { class: 'SEMANTIC', source: 'architect', ref: 'r' } });
const heur = makeFinding({ id: 'h', ruleId: 'H', path: 'p', evidence: { class: 'HEURISTIC', source: 't', ref: 'r' } });
mayOverride(sem, det) === false ? ok('SEMANTIC cannot override DETERMINISTIC') : bad('SEMANTIC overrode DETERMINISTIC!');
mayOverride(heur, det) === false ? ok('HEURISTIC cannot override DETERMINISTIC') : bad('HEURISTIC overrode DETERMINISTIC!');
const schema = makeFinding({ id: 'sc', ruleId: 'S', path: 'p', evidence: { class: 'SCHEMA_DERIVED', source: 's', ref: 'r' } });
mayOverride(schema, det) === true ? ok('SCHEMA_DERIVED (rank 1) may override DETERMINISTIC (rank 2)') : bad('schema could not override deterministic');
mayOverride(det, sem) === true ? ok('DETERMINISTIC may override SEMANTIC') : bad('deterministic could not override semantic');

console.log('\nresolveMissingEvidence never returns PASS (§16)');
const r1 = resolveMissingEvidence({ status: FindingStatus.VIOLATION });
r1 === FindingStatus.UNKNOWN ? ok('errored evidence → UNKNOWN') : bad('expected UNKNOWN got ' + r1);
r1 !== FindingStatus.PASS ? ok('never PASS (violation path)') : bad('returned PASS!');
const r2 = resolveMissingEvidence({ status: FindingStatus.SKIPPED });
r2 === FindingStatus.SKIPPED ? ok('skipped rule stays SKIPPED') : bad('expected SKIPPED got ' + r2);
resolveMissingEvidence(null) === FindingStatus.UNKNOWN ? ok('null finding → UNKNOWN (defensive)') : bad('null not UNKNOWN');
[FindingStatus.PASS].includes(resolveMissingEvidence({ status: 'PASS' })) ? bad('PASS leaked through!') : ok('even a PASS-status finding with missing evidence → UNKNOWN');

console.log('\nisFloorBreach (§5.3 lexicographic)');
isFloorBreach({ risk: { securityFloor: true } }) ? ok('securityFloor → breach') : bad('securityFloor missed');
isFloorBreach({ risk: { dataIntegrityFloor: true } }) ? ok('dataIntegrityFloor → breach') : bad('dataIntegrityFloor missed');
isFloorBreach({ risk: { operationalFloor: true } }) ? ok('operationalFloor → breach') : bad('operationalFloor missed');
isFloorBreach({ risk: { securityFloor: false, dataIntegrityFloor: false, operationalFloor: false } }) === false ? ok('no floor → no breach') : bad('false positive breach');
isFloorBreach({ securityFloor: true }) ? ok('accepts a bare Risk object') : bad('bare Risk not handled');
isFloorBreach(null) === false ? ok('null → no breach (defensive)') : bad('null tripped a breach');

console.log('\nciShouldBlock keys on BLOCKING+VIOLATION, NOT severity (§7)');
const blockerF = makeFinding({ id: 'b', ruleId: 'F1', path: 'p', status: 'VIOLATION', enforcement: 'BLOCKING', evidence: { class: 'DETERMINISTIC', source: 's', ref: 'r' } });
ciShouldBlock([blockerF]) === true ? ok('BLOCKING + VIOLATION blocks') : bad('did not block on BLOCKING+VIOLATION');
ciShouldBlock([lifted]) === false ? ok('severity-5 ADVISORY line-budget does NOT block') : bad('line-budget blocked CI!');
const blockingPass = makeFinding({ id: 'bp', ruleId: 'F1', path: 'p', status: 'PASS', enforcement: 'BLOCKING', evidence: { class: 'DETERMINISTIC', source: 's', ref: 'r' } });
ciShouldBlock([blockingPass]) === false ? ok('BLOCKING but PASS does not block') : bad('BLOCKING+PASS blocked');
ciShouldBlock([sem, heur, lifted]) === false ? ok('no blocking finding → no block') : bad('non-blocking set blocked CI');
ciShouldBlock(blockerF) === true ? ok('accepts a single finding') : bad('single finding not handled');

console.log('\nisApproval + baselineDisposition (§6)');
isApproval(GateOutcome.PASS) && isApproval(GateOutcome.DEBT_ACCEPTED) ? ok('PASS/DEBT_ACCEPTED are approvals') : bad('approval set wrong');
isApproval(GateOutcome.UNKNOWN) === false && isApproval(GateOutcome.SKIPPED) === false ? ok('UNKNOWN/SKIPPED not approvals') : bad('UNKNOWN/SKIPPED counted as approval!');
baselineDisposition(BaselineClass.PRE_EXISTING, false) === 'REPORT' ? ok('pre-existing → REPORT (no unrelated block)') : bad('pre-existing disposition wrong');
baselineDisposition(BaselineClass.INTRODUCED, false) === 'BLOCK' ? ok('introduced+unacceptable → BLOCK') : bad('introduced disposition wrong');
baselineDisposition(BaselineClass.REDUCED, true) === 'POSITIVE' ? ok('reduced → POSITIVE') : bad('reduced disposition wrong');
baselineDisposition(BaselineClass.UNKNOWN, true) === 'REVIEW' ? ok('unknown delta → REVIEW (never silent pass)') : bad('unknown delta disposition wrong');

console.log('\nzero-dep invariant');
for (const p of [findingPath, enumsPath]) {
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
