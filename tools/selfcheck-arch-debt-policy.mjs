#!/usr/bin/env node
/**
 * WF-0057 W3 (ADR-0122) — selftest for the DebtPolicyEngine.
 * Covers the §34 policy rows: floor breach → BLOCKED regardless of PASS findings
 * (§34, lexicographic); low-confidence HEURISTIC smell alone does NOT block
 * (§34.24); a SEMANTIC PASS cannot clear a deterministic VIOLATION (§34.23);
 * line-count ADVISORY alone never BLOCKED (§34.25); UNKNOWN is not approval
 * (§34.22); a DISABLED ruleMode suppresses a finding; per-rule promotion works.
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
const enginePath = resolve(KIT, SCRIPTS + '/policy-engine.mjs');
const outcomesPath = resolve(KIT, SCRIPTS + '/policy-outcomes.mjs');
const findingPath = resolve(KIT, SCRIPTS + '/finding.mjs');
existsSync(enginePath) ? ok('policy-engine.mjs exists') : bad('policy-engine.mjs NOT FOUND');
existsSync(outcomesPath) ? ok('policy-outcomes.mjs exists') : bad('policy-outcomes.mjs NOT FOUND');

let engine, fmod;
try {
  engine = await import(pathToFileURL(enginePath).href);
  fmod = await import(pathToFileURL(findingPath).href);
} catch (err) {
  bad('Failed to import: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const { evaluatePolicy } = engine;
const {
  makeFinding, Enforcement, FindingStatus, EvidenceClass, GateOutcome,
  RecommendedAction, BaselineClass, isApproval,
} = fmod;

typeof evaluatePolicy === 'function' ? ok('evaluatePolicy exported as function') : bad('evaluatePolicy not a function');

// ---- finding builders (valid through makeFinding) ----
const detPass = (id) => makeFinding({
  id, ruleId: 'F1.cycle', path: 'src/a.js', status: FindingStatus.PASS,
  enforcement: Enforcement.BLOCKING, evidence: { class: EvidenceClass.DETERMINISTIC, source: 'map', ref: id },
});
const detViolation = (id, ruleId = 'F1.cycle') => makeFinding({
  id, ruleId, path: 'src/a.js', status: FindingStatus.VIOLATION,
  enforcement: Enforcement.BLOCKING, evidence: { class: EvidenceClass.DETERMINISTIC, source: 'map', ref: id },
});
const floorViolation = (id) => makeFinding({
  id, ruleId: 'F7.security-regression', path: 'src/auth.js', status: FindingStatus.VIOLATION,
  enforcement: Enforcement.BLOCKING, evidence: { class: EvidenceClass.DETERMINISTIC, source: 'sast', ref: id },
  risk: { securityFloor: true, dataIntegrityFloor: false, operationalFloor: false },
});
const heurSmell = (id) => makeFinding({
  id, ruleId: 'srp-and', path: 'src/b.js', status: FindingStatus.WARNING, confidence: 0.4,
  enforcement: Enforcement.ADVISORY, evidence: { class: EvidenceClass.HEURISTIC, source: 'regex', ref: id },
});
const lineBudget = (id) => makeFinding({
  id, ruleId: 'line-budget', path: 'src/big.js', status: FindingStatus.OBSERVATION,
  enforcement: Enforcement.ADVISORY, evidence: { class: EvidenceClass.HEURISTIC, source: 'regex', ref: id },
});
const semObserve = (id, status = FindingStatus.OBSERVATION) => makeFinding({
  id, ruleId: 'D12.coherence', path: 'src/c.js', status,
  enforcement: Enforcement.OBSERVE_ONLY, evidence: { class: EvidenceClass.SEMANTIC, source: 'architect', ref: id },
});
const unknownFinding = (id) => makeFinding({
  id, ruleId: 'F1.cycle', path: 'src/a.js', status: FindingStatus.UNKNOWN,
  enforcement: Enforcement.REVIEW_REQUIRED, evidence: { class: EvidenceClass.GRAPH_DERIVED, source: 'map', ref: id },
});

console.log('\n§34 — floor breach → BLOCKED regardless of many PASS findings (lexicographic)');
const manyPass = [detPass('p1'), detPass('p2'), detPass('p3'), floorViolation('f1'), detPass('p4')];
const r1 = evaluatePolicy(manyPass);
r1.outcome === GateOutcome.BLOCKED ? ok('one floor breach + 4 PASS → BLOCKED') : bad('expected BLOCKED got ' + r1.outcome);
r1.blocking.some((f) => f.id === 'f1') ? ok('floor finding surfaced in blocking[]') : bad('floor finding not in blocking[]');
r1.reasons.includes('LEXICOGRAPHIC_BLOCK') ? ok('LEXICOGRAPHIC_BLOCK reason recorded') : bad('no LEXICOGRAPHIC_BLOCK reason');
isApproval(r1.outcome) === false ? ok('BLOCKED is not an approval') : bad('BLOCKED counted as approval!');

console.log('\n§34.24 — low-confidence HEURISTIC smell alone does NOT block');
const r2 = evaluatePolicy([heurSmell('h1')]);
r2.outcome !== GateOutcome.BLOCKED ? ok('HEURISTIC smell alone is not BLOCKED') : bad('HEURISTIC smell blocked!');
isApproval(r2.outcome) ? ok('HEURISTIC-only outcome is an approval (PASS_WITH_OBSERVATION)') : bad('heuristic-only non-approval: ' + r2.outcome);
r2.outcome === GateOutcome.PASS_WITH_OBSERVATION ? ok('advisory heuristic → PASS_WITH_OBSERVATION') : bad('expected PASS_WITH_OBSERVATION got ' + r2.outcome);
r2.advisory.length === 1 ? ok('heuristic bucketed as advisory') : bad('advisory bucket count: ' + r2.advisory.length);

console.log('\n§34.23 — a SEMANTIC PASS cannot clear a deterministic VIOLATION');
const r3 = evaluatePolicy([detViolation('v1'), semObserve('s1', FindingStatus.PASS)]);
r3.outcome === GateOutcome.BLOCKED ? ok('deterministic VIOLATION + semantic PASS → still BLOCKED') : bad('semantic PASS cleared violation! got ' + r3.outcome);
r3.blocking.some((f) => f.id === 'v1') ? ok('deterministic violation surfaced in blocking[]') : bad('deterministic violation not in blocking[]');

console.log('\n§34.25 — line-count ADVISORY alone → never BLOCKED');
const r4 = evaluatePolicy([lineBudget('l1')]);
r4.outcome !== GateOutcome.BLOCKED ? ok('line-budget advisory alone is not BLOCKED') : bad('line-budget blocked!');
r4.outcome === GateOutcome.PASS_WITH_OBSERVATION ? ok('line-budget alone → PASS_WITH_OBSERVATION') : bad('expected PASS_WITH_OBSERVATION got ' + r4.outcome);
r4.blocking.length === 0 ? ok('no blocking findings for line-budget') : bad('line-budget produced blocking findings');

console.log('\n§34.22 — UNKNOWN → not approval');
const r5 = evaluatePolicy([unknownFinding('u1')]);
r5.outcome === GateOutcome.UNKNOWN ? ok('missing evidence → UNKNOWN outcome') : bad('expected UNKNOWN got ' + r5.outcome);
isApproval(r5.outcome) === false ? ok('UNKNOWN outcome is not an approval') : bad('UNKNOWN counted as approval!');
r5.reasons.some((c) => c.startsWith('MISSING_EVIDENCE')) ? ok('MISSING_EVIDENCE reason recorded') : bad('no MISSING_EVIDENCE reason');
// UNKNOWN must outrank a positive observation in the same set.
const r5b = evaluatePolicy([unknownFinding('u2'), lineBudget('l2')]);
r5b.outcome === GateOutcome.UNKNOWN ? ok('UNKNOWN outranks an advisory observation (non-passing wins)') : bad('UNKNOWN did not outrank advisory: ' + r5b.outcome);

console.log('\nDISABLED ruleMode suppresses a finding (§12)');
const r6 = evaluatePolicy([detViolation('v2', 'F1.cycle')], { 'F1.cycle': Enforcement.DISABLED });
r6.outcome !== GateOutcome.BLOCKED ? ok('DISABLED rule no longer blocks') : bad('DISABLED rule still blocked!');
r6.outcome === GateOutcome.PASS ? ok('only-finding-disabled → PASS (nothing material left)') : bad('expected PASS got ' + r6.outcome);
r6.blocking.length === 0 ? ok('disabled finding not in blocking[]') : bad('disabled finding leaked into blocking[]');
r6.reasons.includes('RULE_DISABLED:F1.cycle') ? ok('RULE_DISABLED reason recorded') : bad('no RULE_DISABLED reason');

console.log('\nper-rule promotion works (§12)');
// An ADVISORY heuristic promoted to REVIEW_REQUIRED must demand review (not block — non-deterministic).
const r7 = evaluatePolicy([heurSmell('h2')], { 'srp-and': Enforcement.REVIEW_REQUIRED });
r7.outcome === GateOutcome.REVIEW_REQUIRED ? ok('promoted heuristic → REVIEW_REQUIRED') : bad('expected REVIEW_REQUIRED got ' + r7.outcome);
isApproval(r7.outcome) === false ? ok('promoted REVIEW_REQUIRED is not an approval') : bad('REVIEW_REQUIRED counted as approval!');
r7.review.length === 1 ? ok('promoted finding bucketed into review[]') : bad('review bucket count: ' + r7.review.length);
// A deterministic BLOCKING violation demoted to ADVISORY must stop blocking.
const r7b = evaluatePolicy([detViolation('v3', 'F2.boundary')], { 'F2.boundary': Enforcement.ADVISORY });
r7b.outcome !== GateOutcome.BLOCKED ? ok('demoted blocking rule no longer BLOCKED') : bad('demoted rule still blocked!');

console.log('\noutcome ladder — PASS / REMEDIATION / DEBT_REDUCED / DEBT_ACCEPTED');
evaluatePolicy([]).outcome === GateOutcome.PASS ? ok('empty findings → PASS') : bad('empty did not PASS');
evaluatePolicy([detPass('p9')]).outcome === GateOutcome.PASS ? ok('all-PASS findings → PASS') : bad('all-pass not PASS');
const remediable = makeFinding({
  id: 'rem1', ruleId: 'D5.reliability', path: 'src/d.js', status: FindingStatus.VIOLATION,
  enforcement: Enforcement.REVIEW_REQUIRED, evidence: { class: EvidenceClass.GRAPH_DERIVED, source: 'map', ref: 'rem1' },
});
evaluatePolicy([remediable]).outcome === GateOutcome.REMEDIATION_REQUIRED ? ok('REVIEW_REQUIRED VIOLATION → REMEDIATION_REQUIRED') : bad('remediation mapping wrong: ' + evaluatePolicy([remediable]).outcome);
const reduced = makeFinding({
  id: 'red1', ruleId: 'F1.cycle', path: 'src/a.js', status: FindingStatus.PASS,
  enforcement: Enforcement.ADVISORY, evidence: { class: EvidenceClass.DETERMINISTIC, source: 'map', ref: 'red1' },
  deltaFromBaseline: BaselineClass.REDUCED,
});
evaluatePolicy([reduced]).outcome === GateOutcome.DEBT_REDUCED ? ok('REDUCED baseline → DEBT_REDUCED') : bad('debt-reduced mapping wrong: ' + evaluatePolicy([reduced]).outcome);
const acceptedF = makeFinding({
  id: 'acc1', ruleId: 'D2.wrapper', path: 'src/e.js', status: FindingStatus.WARNING,
  enforcement: Enforcement.ADVISORY, recommendedAction: RecommendedAction.ACCEPT_TEMPORARILY,
  evidence: { class: EvidenceClass.HEURISTIC, source: 'regex', ref: 'acc1' },
});
evaluatePolicy([acceptedF]).outcome === GateOutcome.DEBT_ACCEPTED ? ok('ACCEPT_TEMPORARILY → DEBT_ACCEPTED') : bad('debt-accepted mapping wrong: ' + evaluatePolicy([acceptedF]).outcome);

console.log('\ndefensive contract');
let threw = false;
try { evaluatePolicy('not-an-array'); } catch { threw = true; }
threw ? ok('evaluatePolicy(non-array) throws') : bad('non-array did not throw');
const rShape = evaluatePolicy([]);
['outcome', 'blocking', 'review', 'advisory', 'reasons'].every((k) => k in rShape) ? ok('result has full shape') : bad('result shape incomplete');
evaluatePolicy([null, undefined, heurSmell('h3')]).outcome === GateOutcome.PASS_WITH_OBSERVATION ? ok('null/undefined findings ignored defensively') : bad('null findings not handled');

console.log('\nzero-dep invariant');
for (const p of [enginePath, outcomesPath]) {
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
