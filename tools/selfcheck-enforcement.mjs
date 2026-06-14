/**
 * selfcheck-enforcement.mjs — RECEIPT STORE invariants (CDK-022, ADR-0072).
 *
 * Asserts the structural and behavioral contracts of receipt-store.mjs:
 *   1. writeReceipt → readReceipt round-trip; fingerprint is ALWAYS computed
 *      (a bogus caller-supplied fingerprint is overwritten).
 *   2. isReceiptValid returns true for a fresh passing receipt with matching scope.
 *   3. NEGATIVE — each invalid case returns valid=false with the exact reason:
 *        - wrong branch, wrong taskId, expired, fingerprint mismatch (tampered),
 *          result='failed', result='skipped', missing evidence (throws).
 *   4. writeReceipt throws on an out-of-taxonomy result.
 *   5. Forge-resistance: a hand-built receipt whose fingerprint does not match
 *      the scope is rejected by isReceiptValid.
 *
 * Entry point: `runEnforcementChecks(rep, { KIT })` where `rep = { ok, bad }`.
 * Uses a mkdtemp fixture; always cleans up even on failure.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const RECEIPT_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');

/**
 * Runs all receipt-store invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runEnforcementChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking receipt store (CDK-022, ADR-0072)...');

  let store;
  try {
    store = await import('file://' + RECEIPT_PATH(KIT).replaceAll('\\', '/'));
  } catch (err) {
    bad(`receipt-store.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  const { writeReceipt, readReceipt, readReceipts, isReceiptValid, computeFingerprint, RESULTS } = store;

  // Verify all exports are present.
  for (const name of ['writeReceipt', 'readReceipt', 'readReceipts', 'isReceiptValid', 'computeFingerprint', 'RESULTS']) {
    if (typeof store[name] !== 'function' && name !== 'RESULTS') bad(`${name} not exported as a function`);
    else if (name === 'RESULTS' && !Array.isArray(store[name])) bad('RESULTS not exported as an array');
    else ok(`export: ${name} present`);
  }

  const root = mkdtempSync(join(tmpdir(), 'ck-receipt-sc-'));
  try {
    const scope = { branch: 'feat/test', taskId: 'task-001', paths: ['src/a.mjs', 'src/b.mjs'] };
    const baseReceipt = {
      capability: 'qa-signoff', taskId: 'task-001', sessionId: 'sess-1',
      runId: 'run-1', command: '/qa-signoff', host: 'claude',
      result: 'passed', evidence: { exitCode: 0, summary: 'All checks green' },
      scope,
    };

    // 1. Round-trip + fingerprint is computed (caller value overwritten).
    const bogusFingerprint = 'aaaa1111';
    const stored = writeReceipt(root, { ...baseReceipt, fingerprint: bogusFingerprint });
    stored && stored.fingerprint !== bogusFingerprint
      ? ok('round-trip: caller fingerprint overwritten by computed value')
      : bad('round-trip: caller fingerprint was NOT overwritten');

    const computedFp = computeFingerprint(scope);
    stored.fingerprint === computedFp
      ? ok('round-trip: stored fingerprint matches computeFingerprint(scope)')
      : bad(`round-trip: fingerprint mismatch — stored=${stored.fingerprint} computed=${computedFp}`);

    const loaded = readReceipt(root, 'task-001', 'qa-signoff');
    loaded && loaded.capability === 'qa-signoff' && loaded.result === 'passed'
      ? ok('round-trip: readReceipt returns the persisted receipt')
      : bad('round-trip: readReceipt did not return the persisted receipt');

    // 2. Valid receipt + matching scope → isReceiptValid.valid === true.
    const { valid, reason } = isReceiptValid(loaded, scope);
    valid ? ok('isReceiptValid: passing receipt + matching scope → valid') : bad(`isReceiptValid: expected valid, got reason=${reason}`);

    // 3a. Wrong branch.
    const wrongBranch = isReceiptValid(loaded, { ...scope, branch: 'main' });
    !wrongBranch.valid && wrongBranch.reason.includes('branch mismatch')
      ? ok('negative: wrong branch → branch mismatch reason')
      : bad(`negative: wrong branch — got valid=${wrongBranch.valid} reason=${wrongBranch.reason}`);

    // 3b. Wrong taskId.
    const wrongTask = isReceiptValid(loaded, { ...scope, taskId: 'other-task' });
    !wrongTask.valid && wrongTask.reason.includes('taskId mismatch')
      ? ok('negative: wrong taskId → taskId mismatch reason')
      : bad(`negative: wrong taskId — got valid=${wrongTask.valid} reason=${wrongTask.reason}`);

    // 3c. Expired receipt (expiresAt in the past).
    const expiredStored = writeReceipt(root, { ...baseReceipt, capability: 'expired-cap' }, { ttlMs: 0 });
    const expiredLoaded = readReceipt(root, 'task-001', 'expired-cap');
    const expiredCheck = isReceiptValid(expiredLoaded, scope, expiredStored.expiresAt + 1);
    !expiredCheck.valid && expiredCheck.reason === 'expired'
      ? ok('negative: expired receipt → expired reason')
      : bad(`negative: expired — got valid=${expiredCheck.valid} reason=${expiredCheck.reason}`);

    // 3d. Tampered scope (mutate paths after write → fingerprint mismatch → stale).
    const tamperedScope = { ...scope, paths: ['src/a.mjs', 'src/INJECTED.mjs'] };
    const tampered = isReceiptValid(loaded, tamperedScope);
    !tampered.valid && tampered.reason === 'stale: fingerprint mismatch'
      ? ok('negative: tampered paths → stale: fingerprint mismatch')
      : bad(`negative: tampered paths — got valid=${tampered.valid} reason=${tampered.reason}`);

    // 3e. result='failed'.
    const failedStored = writeReceipt(root, { ...baseReceipt, capability: 'failed-cap', result: 'failed' });
    const failedLoaded = readReceipt(root, 'task-001', 'failed-cap');
    const failedCheck = isReceiptValid(failedLoaded, scope);
    !failedCheck.valid && failedCheck.reason.includes('failed')
      ? ok('negative: result=failed → not passed reason')
      : bad(`negative: result=failed — got valid=${failedCheck.valid} reason=${failedCheck.reason}`);

    // 3f. result='skipped'.
    const skippedStored = writeReceipt(root, { ...baseReceipt, capability: 'skipped-cap', result: 'skipped' });
    const skippedLoaded = readReceipt(root, 'task-001', 'skipped-cap');
    const skippedCheck = isReceiptValid(skippedLoaded, scope);
    !skippedCheck.valid && skippedCheck.reason.includes('skipped')
      ? ok('negative: result=skipped → not passed reason')
      : bad(`negative: result=skipped — got valid=${skippedCheck.valid} reason=${skippedCheck.reason}`);

    // 3g. Missing evidence (writeReceipt throws).
    let threwOnMissingEvidence = false;
    try { writeReceipt(root, { ...baseReceipt, evidence: null }); }
    catch (err) { threwOnMissingEvidence = err instanceof TypeError; }
    threwOnMissingEvidence
      ? ok('negative: missing evidence → writeReceipt throws TypeError')
      : bad('negative: missing evidence — writeReceipt did not throw');

    // 4. Out-of-taxonomy result → throws RangeError.
    let threwOnBadResult = false;
    try { writeReceipt(root, { ...baseReceipt, result: 'superpass' }); }
    catch (err) { threwOnBadResult = err instanceof RangeError; }
    threwOnBadResult
      ? ok('taxonomy: out-of-taxonomy result → writeReceipt throws RangeError')
      : bad('taxonomy: out-of-taxonomy result — writeReceipt did not throw RangeError');

    // 5. Forge-resistance: hand-built object with wrong fingerprint is rejected.
    const forged = { ...loaded, fingerprint: 'deadbeef0000' };
    const forgeCheck = isReceiptValid(forged, scope);
    !forgeCheck.valid && forgeCheck.reason === 'stale: fingerprint mismatch'
      ? ok('forge-resistance: hand-built receipt with wrong fingerprint → stale')
      : bad(`forge-resistance: forged receipt not rejected — valid=${forgeCheck.valid} reason=${forgeCheck.reason}`);

    // RESULTS taxonomy completeness.
    RESULTS.includes('passed') && !RESULTS.includes('superpass')
      ? ok('RESULTS: taxonomy includes passed and excludes invented values')
      : bad('RESULTS: taxonomy malformed');

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
