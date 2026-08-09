#!/usr/bin/env node
/**
 * WF-0057 W2 (ADR-0122) — selftest for the arch-debt BLOCKING FLOORS
 * (security F7 §9.6 / reliability §9.5 / testability F8 §9.4).
 *
 * Covers §34.11-15, §34.22/§34.23: security regression on changed lines BLOCKS
 * while unchanged legacy security debt does NOT; irreversible migration w/o
 * rollback BLOCKS; retryable op w/o idempotency detected; critical async w/o
 * observability detected; critical behavior w/o tests BLOCKS; a floor breach
 * forces BLOCKED regardless of high scores elsewhere; missing evidence →
 * UNKNOWN/REVIEW_REQUIRED not PASS; a SEMANTIC opinion cannot clear a floor.
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
const floorsPath = resolve(KIT, SCRIPTS + '/floors.mjs');
const patternsPath = resolve(KIT, SCRIPTS + '/floors-security-patterns.mjs');
const findingPath = resolve(KIT, SCRIPTS + '/finding.mjs');
existsSync(floorsPath) ? ok('floors.mjs exists') : bad('floors.mjs NOT FOUND');
existsSync(patternsPath) ? ok('floors-security-patterns.mjs exists') : bad('patterns NOT FOUND');

let mod, fmod;
try {
  mod = await import(pathToFileURL(floorsPath).href);
  fmod = await import(pathToFileURL(findingPath).href);
} catch (err) {
  bad('Failed to import floors.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const {
  securityFloor, reliabilityFloor, testabilityFloor, evaluateFloors, applyFloors,
} = mod;
const { makeFinding, isFloorBreach } = fmod;

console.log('\nexports');
for (const [n, f] of [
  ['securityFloor', securityFloor], ['reliabilityFloor', reliabilityFloor],
  ['testabilityFloor', testabilityFloor], ['evaluateFloors', evaluateFloors],
  ['applyFloors', applyFloors],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}

const isBlocking = (f) => f.enforcement === 'BLOCKING' && f.status === 'VIOLATION';

console.log('\nsecurity floor F7 (§9.6) — regression on CHANGED lines BLOCKS');
const sqlFinding = securityFloor([{ path: 'src/db.js', addedLines: ['db.query("SELECT * FROM u WHERE id=" + userId)'] }]);
sqlFinding.length === 1 && isBlocking(sqlFinding[0]) && isFloorBreach(sqlFinding[0])
  ? ok('injection sink introduced → BLOCKING + securityFloor tripped') : bad('injection sink not blocked');
sqlFinding[0] && sqlFinding[0].risk.securityFloor === true ? ok('risk.securityFloor === true') : bad('securityFloor not set on risk');
const failOpen = securityFloor([{ path: 'src/auth.js', addedLines: ['  let isAuthorized = true;'] }]);
failOpen.length >= 1 && isBlocking(failOpen[0]) ? ok('fail-open default → BLOCKING') : bad('fail-open not blocked');
const secret = securityFloor([{ path: 'src/cfg.js', addedLines: ['const apiKey = "sk_live_abcdef123456";'] }]);
secret.length >= 1 && isBlocking(secret[0]) ? ok('hardcoded secret → BLOCKING') : bad('secret not blocked');
const removedAuth = securityFloor([{ path: 'src/route.js', removedLines: ['  if (!hasPermission(user)) return res.status(403);'] }]);
removedAuth.length >= 1 && isBlocking(removedAuth[0]) ? ok('removed authz guard → BLOCKING') : bad('removed authz not blocked');

console.log('\nsecurity floor — unchanged legacy debt does NOT block (§34.15)');
// Env-sourced secret + parameterized query on a changed line: no regression.
const cleanChange = securityFloor([{ path: 'src/db.js', addedLines: [
  'const apiKey = process.env.API_KEY;',
  'db.query("SELECT * FROM u WHERE id = ?", [userId]);',
] }]);
cleanChange.length === 0 ? ok('clean changed lines → no security floor') : bad('false positive on clean change: ' + cleanChange.length);
// A dangerous pattern that exists in baseline but is NOT in the changed set is invisible.
const noChange = securityFloor([{ path: 'src/legacy.js', addedLines: [], removedLines: [] }]);
noChange.length === 0 ? ok('untouched legacy security debt does NOT block unrelated work') : bad('legacy debt blocked!');
const env = securityFloor([{ path: 'src/cfg.js', addedLines: ['const password = process.env.DB_PASSWORD;'] }]);
env.length === 0 ? ok('env-sourced secret is not flagged (conservative)') : bad('env secret false positive');

console.log('\nreliability floor (§9.5)');
// §34.12 irreversible migration w/o rollback → BLOCK
const mig = reliabilityFloor({ migrations: [{ path: 'db/003.sql', irreversible: true, hasRollback: false }] });
mig.length === 1 && isBlocking(mig[0]) && mig[0].risk.operationalFloor === true
  ? ok('irreversible migration w/o rollback → BLOCKING (§34.12)') : bad('irreversible migration not blocked');
const migOk = reliabilityFloor({ migrations: [{ path: 'db/004.sql', irreversible: true, hasRollback: true }] });
migOk.length === 0 ? ok('irreversible migration WITH rollback → no block') : bad('migration w/ rollback blocked');
// §34.11 retryable op w/o idempotency → DETECTED (REVIEW, not block)
const retry = reliabilityFloor({ retryableOps: [{ path: 'src/pay.js', idempotent: false }] });
retry.length === 1 && retry[0].enforcement === 'REVIEW_REQUIRED' && !isBlocking(retry[0])
  ? ok('retryable op w/o idempotency → detected (REVIEW, §34.11)') : bad('idempotency not detected as REVIEW');
const retryOk = reliabilityFloor({ retryableOps: [{ path: 'src/pay.js', idempotent: true }] });
retryOk.length === 0 ? ok('idempotent retryable op → no finding') : bad('idempotent op flagged');
// §34.13 critical async w/o observability → DETECTED
const async1 = reliabilityFloor({ criticalAsync: [{ path: 'src/worker.js', observable: false }] });
async1.length === 1 && async1[0].enforcement === 'REVIEW_REQUIRED'
  ? ok('critical async w/o observability → detected (§34.13)') : bad('async observability not detected');

console.log('\ntestability floor F8 (§9.4)');
// §34.14 critical behavior w/o covering test → BLOCK
const noTest = testabilityFloor(
  [{ path: 'src/checkout.js', critical: true }],
  { available: true, coveredPaths: ['src/other.js'] });
noTest.length === 1 && isBlocking(noTest[0])
  ? ok('critical behavior w/o covering test → BLOCKING (§34.14)') : bad('uncovered critical behavior not blocked');
const covered = testabilityFloor(
  [{ path: 'src/checkout.js', critical: true }],
  { available: true, coveredPaths: ['src/checkout.js'] });
covered.length === 0 ? ok('critical behavior WITH covering test → no block') : bad('covered behavior blocked');
const nonCritical = testabilityFloor(
  [{ path: 'src/util.js', critical: false }],
  { available: true, coveredPaths: [] });
nonCritical.length === 0 ? ok('non-critical behavior → no floor') : bad('non-critical behavior flagged');

console.log('\nmissing evidence → UNKNOWN/REVIEW_REQUIRED, never PASS (§34.22)');
const noSelector = testabilityFloor(
  [{ path: 'src/checkout.js', critical: true }],
  { available: false });
noSelector.length === 1 && noSelector[0].status === 'UNKNOWN' && noSelector[0].enforcement === 'REVIEW_REQUIRED'
  ? ok('test-impact selector unavailable → UNKNOWN/REVIEW_REQUIRED (not PASS)') : bad('missing selector did not fail closed');
const noPaths = testabilityFloor([{ path: 'src/checkout.js', critical: true }], null);
noPaths.length === 1 && noPaths[0].status === 'UNKNOWN'
  ? ok('null impactedTests on critical change → UNKNOWN (fail-closed)') : bad('null impactedTests passed silently');
const verdict = applyFloors(noSelector);
verdict.outcome === 'REVIEW_REQUIRED'
  ? ok('applyFloors(UNKNOWN) → REVIEW_REQUIRED, not PASS (§34.22)') : bad('UNKNOWN floor → ' + verdict.outcome);

console.log('\napplyFloors lexicographic short-circuit (§20.3 / Fork-2)');
const verdictBlock = applyFloors(noTest);
verdictBlock.outcome === 'BLOCKED' && verdictBlock.breached === true
  ? ok('a BLOCKING floor VIOLATION → BLOCKED') : bad('floor breach did not BLOCK');
verdictBlock.blockingRuleIds.length === 1 ? ok('BLOCKED names the blocking ruleId') : bad('no blocking ruleId reported');
// A floor breach forces BLOCKED even when surrounded by high-scoring PASS findings.
const highScores = [
  makeFinding({ id: 'p1', ruleId: 'OK1', path: 'a', status: 'PASS', confidence: 1, evidence: { class: 'DETERMINISTIC', source: 's', ref: 'r' } }),
  makeFinding({ id: 'p2', ruleId: 'OK2', path: 'b', status: 'PASS', confidence: 1, evidence: { class: 'SCHEMA_DERIVED', source: 's', ref: 'r' } }),
  ...noTest,
  makeFinding({ id: 'p3', ruleId: 'OK3', path: 'c', status: 'PASS', confidence: 1, evidence: { class: 'GRAPH_DERIVED', source: 's', ref: 'r' } }),
];
applyFloors(highScores).outcome === 'BLOCKED'
  ? ok('floor breach forces BLOCKED despite many high-score PASS findings (no averaging)') : bad('high scores averaged away the floor!');
applyFloors([]).outcome === 'PASS' ? ok('no findings → PASS') : bad('empty set not PASS');

console.log('\nSEMANTIC opinion cannot clear a deterministic floor (§34.23)');
// A model PASS opinion in the set must NOT downgrade the BLOCKED verdict.
const semanticPass = makeFinding({ id: 'sem', ruleId: 'D12.cohesion', path: 'src/checkout.js', status: 'PASS', confidence: 0.6, enforcement: 'OBSERVE_ONLY', evidence: { class: 'SEMANTIC', source: 'architect', ref: 'r' } });
applyFloors([...noTest, semanticPass]).outcome === 'BLOCKED'
  ? ok('SEMANTIC PASS cannot clear a BLOCKING deterministic floor') : bad('SEMANTIC opinion cleared the floor!');
// And a semantic finding can never itself be a BLOCKING floor (makeFinding enforces tier).
let semBlockThrew = false;
try { makeFinding({ id: 'x', ruleId: 'r', path: 'p', status: 'VIOLATION', enforcement: 'BLOCKING', evidence: { class: 'SEMANTIC', source: 's', ref: 'r' } }); }
catch { semBlockThrew = true; }
semBlockThrew ? ok('a SEMANTIC finding cannot even be constructed as a BLOCKING floor') : bad('SEMANTIC reached BLOCKING!');

console.log('\nevaluateFloors fail-closed on a thrown floor');
// Force a throw by injecting a changedFiles entry whose addedLines getter throws.
const boom = { changedFiles: [Object.defineProperty({ path: 'src/x.js' }, 'addedLines', { get() { throw new Error('boom'); } })] };
const evald = evaluateFloors(boom);
const errFinding = evald.find((f) => f.reasonCodes && f.reasonCodes.includes('FLOOR_EVALUATION_ERROR'));
errFinding && errFinding.status === 'UNKNOWN'
  ? ok('a thrown floor → synthetic UNKNOWN finding (fail-closed, not silent skip)') : bad('thrown floor was silently swallowed');
applyFloors(evald).outcome !== 'PASS'
  ? ok('a thrown floor never yields PASS') : bad('thrown floor resolved to PASS!');
// The other floors still run despite one throwing.
const mixedCtx = {
  changedFiles: [Object.defineProperty({ path: 'a' }, 'addedLines', { get() { throw new Error('boom'); } })],
  migrations: undefined,
  reliability: { migrations: [{ path: 'db/x.sql', irreversible: true, hasRollback: false }] },
};
evaluateFloors(mixedCtx).some((f) => f.ruleId.startsWith('R2.irreversible'))
  ? ok('a throwing floor does not take down the other floors') : bad('a throw killed sibling floors');

console.log('\nevaluateFloors union over the full context');
const full = evaluateFloors({
  changedFiles: [{ path: 'src/db.js', addedLines: ['db.exec("DROP " + name)'] }],
  reliability: { migrations: [{ path: 'm.sql', irreversible: true, hasRollback: false }], retryableOps: [{ path: 'p.js', idempotent: false }] },
  changedBehaviors: [{ path: 'src/core.js', critical: true }],
  impactedTests: { available: true, coveredPaths: [] },
});
const blockingCount = full.filter(isBlocking).length;
blockingCount >= 3 ? ok('full context produces all expected BLOCKING floors (' + blockingCount + ')') : bad('expected >=3 BLOCKING, got ' + blockingCount);
applyFloors(full).outcome === 'BLOCKED' ? ok('full context → BLOCKED') : bad('full context not BLOCKED');

console.log('\nzero-dep invariant');
for (const p of [floorsPath, patternsPath]) {
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
