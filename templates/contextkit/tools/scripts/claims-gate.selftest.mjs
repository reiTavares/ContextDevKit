#!/usr/bin/env node
/**
 * claims-gate.selftest.mjs — unit tests for COMP-001 claims gate (card #354).
 *
 * Plain node:assert, no test framework. Exits non-zero on any failure.
 * Mirrors the project's assert-based selftest idiom used across this scripts/
 * directory.
 *
 * Run: node templates/contextkit/tools/scripts/claims-gate.selftest.mjs
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Converts an absolute path to a file:// URL string (handles Windows drive letters). */
function pathToFileUrl(absPath) {
  return 'file://' + absPath.replaceAll('\\', '/');
}

const { evaluateClaims } = await import(
  pathToFileUrl(resolve(__dirname, 'claims-gate.mjs'))
);

let passed = 0;
let failed = 0;

/**
 * Runs one named assertion and records pass/fail.
 *
 * @param {string} label  human-readable test name
 * @param {() => void} fn assertion callback — throws on failure
 */
function test(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${err.message}`);
    failed += 1;
  }
}

console.log('\nclaims-gate selftest\n');

// ── Test 1: proven claim with no evidenceIds → refused ────────────────────
test('proven with no evidenceIds is refused', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-001', text: 'We are 100% faster', tier: 'proven', evidenceIds: [], snapshotDate: '2026-01-15' },
  ]);
  assert.equal(ok, false, 'ok must be false');
  assert.equal(verdicts[0].publishable, false, 'verdict must be refused');
  const reasons = verdicts[0].reasons.join(' ');
  assert.ok(/evidenceIds/i.test(reasons), `reason must mention evidenceIds — got: ${reasons}`);
});

// ── Test 2: proven claim with evidenceIds + snapshotDate → publishable ────
test('proven with evidenceIds and snapshotDate is publishable', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-002', text: 'Independently verified', tier: 'proven', evidenceIds: ['receipt-001'], snapshotDate: '2026-03-10' },
  ]);
  assert.equal(ok, true, 'ok must be true');
  assert.equal(verdicts[0].publishable, true, 'verdict must be publishable');
  assert.equal(verdicts[0].reasons.length, 0, 'no reasons on a passing claim');
});

// ── Test 3: blocked claim → never publishable ──────────────────────────────
test('blocked claim is never publishable', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-003', text: 'Retracted claim', tier: 'blocked', evidenceIds: ['e-1'], snapshotDate: '2026-01-01' },
  ]);
  assert.equal(ok, false, 'ok must be false');
  assert.equal(verdicts[0].publishable, false, 'blocked verdict must be refused');
  const reasons = verdicts[0].reasons.join(' ');
  assert.ok(/blocked/i.test(reasons), `reason must mention "blocked" — got: ${reasons}`);
});

// ── Test 4: misleading claim → never publishable ───────────────────────────
test('misleading claim is never publishable', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-004', text: 'Cherry-picked stat', tier: 'misleading', evidenceIds: ['e-2'], snapshotDate: '2026-02-01' },
  ]);
  assert.equal(ok, false, 'ok must be false');
  assert.equal(verdicts[0].publishable, false, 'misleading verdict must be refused');
  const reasons = verdicts[0].reasons.join(' ');
  assert.ok(/misleading/i.test(reasons), `reason must mention "misleading" — got: ${reasons}`);
});

// ── Test 5: unknown tier → refused ────────────────────────────────────────
test('unknown tier is refused with a typed reason', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-005', text: 'Some claim', tier: 'magic', evidenceIds: ['e-3'], snapshotDate: '2026-04-01' },
  ]);
  assert.equal(ok, false, 'ok must be false');
  assert.equal(verdicts[0].publishable, false, 'unknown-tier verdict must be refused');
  const reasons = verdicts[0].reasons.join(' ');
  assert.ok(/unknown tier/i.test(reasons), `reason must mention "Unknown tier" — got: ${reasons}`);
});

// ── Test 6: the famous bad measured claim (ADR-0080) → refused ────────────
test('measured claim with empty evidenceIds and no snapshotDate is refused', () => {
  const badClaim = { id: 'C-006', text: '80% token savings', tier: 'measured', evidenceIds: [], snapshotDate: '' };
  const { ok, verdicts } = evaluateClaims([badClaim]);
  assert.equal(ok, false, 'ok must be false');
  assert.equal(verdicts[0].publishable, false, 'bad measured claim must be refused');
  const reasons = verdicts[0].reasons.join(' ');
  assert.ok(/evidenceIds/i.test(reasons), `reason must flag evidenceIds — got: ${reasons}`);
  assert.ok(/snapshotDate/i.test(reasons), `reason must flag snapshotDate — got: ${reasons}`);
});

// ── Test 7: measured with reps < 3 → refused (ADR-0080 hard rule) ─────────
test('measured with reps=1 is refused on the reps rule', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-007', text: 'Measured saving', tier: 'measured', evidenceIds: ['e-4'], snapshotDate: '2026-05-01', reps: 1 },
  ]);
  assert.equal(ok, false, 'ok must be false');
  assert.equal(verdicts[0].publishable, false, 'low-reps verdict must be refused');
  const reasons = verdicts[0].reasons.join(' ');
  assert.ok(/reps/i.test(reasons), `reason must mention reps — got: ${reasons}`);
});

// ── Test 8: measured with reps >= 3 + evidence + date → publishable ────────
test('measured with reps=3, evidenceIds, and snapshotDate is publishable', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-008', text: 'Solid measurement', tier: 'measured', evidenceIds: ['e-5', 'e-6', 'e-7'], snapshotDate: '2026-05-20', reps: 3 },
  ]);
  assert.equal(ok, true, 'ok must be true');
  assert.equal(verdicts[0].publishable, true, 'full measured claim must be publishable');
  // Only WARN reasons would be acceptable, but there should be none with reps=3.
  const hardReasons = verdicts[0].reasons.filter((r) => !r.startsWith('WARN:'));
  assert.equal(hardReasons.length, 0, `no hard failures expected — got: ${hardReasons.join('; ')}`);
});

// ── Test 9: mixed batch — one good, one refused → ok=false ────────────────
test('mixed batch of claims is refused when any claim fails', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-good', text: 'Fine', tier: 'supported', evidenceIds: ['e-ok'], snapshotDate: '2026-06-01' },
    { id: 'C-bad', text: 'No evidence', tier: 'supported', evidenceIds: [], snapshotDate: '2026-06-01' },
  ]);
  assert.equal(ok, false, 'ok must be false when any claim fails');
  assert.equal(verdicts.find((v) => v.id === 'C-good')?.publishable, true, 'good claim in batch passes');
  assert.equal(verdicts.find((v) => v.id === 'C-bad')?.publishable, false, 'bad claim in batch fails');
});

// ── Test 10: empty array → ok=false (fails-closed with no claims) ──────────
test('empty claims array is not ok (fails-closed: zero claims is not a pass)', () => {
  const { ok, verdicts } = evaluateClaims([]);
  assert.equal(ok, false, 'empty manifest must not pass the gate');
  assert.equal(verdicts.length, 0, 'verdicts must be empty');
});

// ── Test 11: measured missing reps (absent) → publishable with WARN ────────
test('measured with absent reps but good evidence emits WARN and passes', () => {
  const { ok, verdicts } = evaluateClaims([
    { id: 'C-009', text: 'No reps field', tier: 'measured', evidenceIds: ['e-10'], snapshotDate: '2026-06-15' },
  ]);
  assert.equal(ok, true, 'ok must be true — absent reps is WARN only, not a hard block');
  assert.equal(verdicts[0].publishable, true, 'claim must be publishable with WARN');
  const warnReasons = verdicts[0].reasons.filter((r) => r.startsWith('WARN:'));
  assert.ok(warnReasons.length > 0, 'WARN reason expected for absent reps');
});

// ── Test 12: malformed item (non-object) in array → refused gracefully ─────
test('malformed non-object claim is refused without throwing', () => {
  const { ok, verdicts } = evaluateClaims([null]);
  assert.equal(ok, false, 'ok must be false');
  assert.equal(verdicts[0].publishable, false, 'null claim must be refused');
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} test(s): ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
