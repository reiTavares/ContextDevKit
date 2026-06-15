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
import { runCompletionChecks } from './selfcheck-completion.mjs';
import { runSubagentChecks } from './selfcheck-subagent.mjs';
import { runCompactionChecks } from './selfcheck-compaction.mjs';
import { runStatuslineChecks } from './selfcheck-statusline.mjs';

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
  // =========================================================================
  // CDK-023: ENFORCEMENT MODES + BYPASS CHECKS
  // =========================================================================
  console.log('Checking enforcement modes + bypass (CDK-023, ADR-0072)...');

  let modes, bypass;
  try {
    const modesPath = resolve(KIT, 'templates/contextkit/runtime/execution/enforcement-modes.mjs');
    const bypassPath = resolve(KIT, 'templates/contextkit/runtime/execution/bypass-store.mjs');
    modes = await import('file://' + modesPath.replaceAll('\\', '/'));
    bypass = await import('file://' + bypassPath.replaceAll('\\', '/'));
  } catch (err) {
    bad(`enforcement-modes or bypass-store failed to import: ${err?.message ?? err}`);
    return;
  }

  const { resolveEnforcementMode, decide } = modes;
  const { writeBypass, readBypass, readBypasses, isBypassValid } = bypass;

  // Verify exports.
  for (const [mod, name] of [['enforcement-modes', 'resolveEnforcementMode'], ['enforcement-modes', 'decide'],
       ['bypass-store', 'writeBypass'], ['bypass-store', 'readBypass'], ['bypass-store', 'readBypasses'], ['bypass-store', 'isBypassValid']]) {
    const fn = mod === 'enforcement-modes' ? modes[name] : bypass[name];
    typeof fn === 'function' ? ok(`export: ${name} present`) : bad(`export: ${name} missing`);
  }

  // --- resolveEnforcementMode ---
  resolveEnforcementMode(null) === 'advisory' ? ok('mode: null config -> advisory') : bad('mode: null config not advisory');
  resolveEnforcementMode({}) === 'advisory' ? ok('mode: empty config -> advisory') : bad('mode: empty config not advisory');
  resolveEnforcementMode({ enforcement: { mode: 'unknown' } }) === 'advisory'
    ? ok('mode: unknown value -> advisory') : bad('mode: unknown value not advisory');
  resolveEnforcementMode({ enforcement: { mode: 'guarded' } }) === 'guarded'
    ? ok('mode: guarded honored') : bad('mode: guarded not honored');
  resolveEnforcementMode({ enforcement: { mode: 'strict' } }) === 'strict'
    ? ok('mode: strict honored') : bad('mode: strict not honored');

  const root2 = mkdtempSync(join(tmpdir(), 'ck-enf-sc-'));
  try {
    const scope = { branch: 'feat/x', taskId: 'task-sc-01', paths: ['src/a.mjs'] };
    const contract = { requiredBeforeExploration: ['sim-impact'], requiredBeforeWrite: ['qa-signoff'], requiredBeforeCompletion: ['adr-review'] };
    const base = { mode: 'advisory', contract, moment: 'beforeWrite', scope, root: root2 };

    // Advisory + missing -> warn, never deny.
    const advMissing = decide({ ...base, mode: 'advisory' });
    advMissing.decision === 'warn' ? ok('advisory: missing -> warn (never deny)') : bad(`advisory: expected warn, got ${advMissing.decision}`);
    advMissing.missing.includes('qa-signoff') ? ok('advisory: qa-signoff in missing') : bad('advisory: qa-signoff not in missing');

    // Guarded + missing beforeWrite -> deny.
    const guardDeny = decide({ ...base, mode: 'guarded' });
    guardDeny.decision === 'deny' ? ok('guarded: missing beforeWrite -> deny') : bad(`guarded: expected deny, got ${guardDeny.decision}`);

    // Guarded + missing beforeExploration -> warn only.
    const guardExpl = decide({ ...base, mode: 'guarded', moment: 'beforeExploration' });
    guardExpl.decision === 'warn' ? ok('guarded: missing beforeExploration -> warn') : bad(`guarded: expected warn at exploration, got ${guardExpl.decision}`);

    // Strict + any missing -> deny.
    const strictDeny = decide({ ...base, mode: 'strict', moment: 'beforeExploration' });
    strictDeny.decision === 'deny' ? ok('strict: any missing -> deny') : bad(`strict: expected deny, got ${strictDeny.decision}`);

    // Write a valid human-approved bypass and verify guarded allows + reports as 'bypassed' not 'satisfied'.
    writeBypass(root2, { capability: 'qa-signoff', taskId: 'task-sc-01', branch: 'feat/x', reason: 'pre-approved', actor: 'human-lead', approvedBy: 'alice' });
    const guardBypassed = decide({ ...base, mode: 'guarded' });
    guardBypassed.decision === 'allow' ? ok('guarded: valid bypass -> allow') : bad(`guarded: bypass should allow, got ${guardBypassed.decision}`);
    guardBypassed.bypassed.includes('qa-signoff') ? ok('guarded: bypass in bypassed list (not satisfied)') : bad('guarded: bypass not in bypassed list');
    !guardBypassed.satisfied.includes('qa-signoff') ? ok('anti-theatre: bypassed != satisfied') : bad('anti-theatre: bypass wrongly counted as satisfied');

    // Expired bypass does not rescue.
    writeBypass(root2, { capability: 'adr-review', taskId: 'task-sc-01', branch: 'feat/x', reason: 'old', actor: 'dev', approvedBy: 'bob' }, { ttlMs: 0 });
    const expiredBypass = decide({ ...base, mode: 'guarded', moment: 'beforeCompletion', now: Date.now() + 999_999 });
    expiredBypass.decision === 'deny' ? ok('expired bypass: still deny under guarded') : bad(`expired bypass: expected deny, got ${expiredBypass.decision}`);

    // Grade-4 floor: actor='auto' bypass of requiresHumanApproval capability is invalid.
    writeBypass(root2, { capability: 'sim-impact', taskId: 'task-sc-01', branch: 'feat/x', reason: 'auto-self', actor: 'auto', approvedBy: '' });
    // approvedBy='' will be stored but the actor='auto' + requiresHumanApproval check in isBypassValid blocks it
    // Actually writeBypass won't throw for approvedBy='', only validateBypassInput checks required fields
    // isBypassValid will catch actor='auto' when requiresHumanApproval=true
    const autoBypass = decide({ ...base, mode: 'strict', moment: 'beforeExploration', requiresHumanApproval: true });
    autoBypass.decision === 'deny' ? ok('grade-4 floor: auto bypass of human-approval cap -> deny') : bad(`grade-4 floor: expected deny, got ${autoBypass.decision}`);

    // Scope isolation: bypass for (cap A, task X) does NOT satisfy (cap A, task Y).
    const otherScope = { ...scope, taskId: 'task-sc-DIFFERENT' };
    const isolatedResult = decide({ ...base, mode: 'guarded', scope: otherScope });
    isolatedResult.decision === 'deny' ? ok('scope isolation: bypass for task X does not rescue task Y') : bad(`scope isolation: expected deny for different task, got ${isolatedResult.decision}`);

    // Scope isolation: bypass for (cap A, task X) does NOT satisfy (cap B, task X).
    const otherCapContract = { requiredBeforeWrite: ['other-capability'] };
    const otherCapResult = decide({ ...base, mode: 'guarded', contract: otherCapContract });
    otherCapResult.decision === 'deny' ? ok('scope isolation: bypass for cap-A does not rescue cap-B') : bad(`scope isolation: expected deny for different cap, got ${otherCapResult.decision}`);

    // isBypassValid - direct checks.
    const bp = readBypass(root2, 'task-sc-01', 'qa-signoff');
    const { valid: bv } = isBypassValid(bp, { capability: 'qa-signoff', taskId: 'task-sc-01', branch: 'feat/x' });
    bv ? ok('isBypassValid: valid bypass -> valid') : bad('isBypassValid: expected valid');

    const allBp = readBypasses(root2, 'task-sc-01');
    allBp.length >= 1 ? ok(`readBypasses: returns ${allBp.length} bypass(es)`) : bad('readBypasses: expected >= 1');

    isBypassValid(null, { capability: 'x', taskId: 'y', branch: 'z' }).valid === false
      ? ok('isBypassValid: null bypass -> invalid') : bad('isBypassValid: null should be invalid');

    // writeBypass throws on missing required field.
    let threwOnMissing = false;
    try { writeBypass(root2, { capability: 'x', taskId: 'y' }); } catch (e) { threwOnMissing = e instanceof TypeError; }
    threwOnMissing ? ok('writeBypass: missing field -> TypeError') : bad('writeBypass: missing field did not throw TypeError');

  } finally {
    rmSync(root2, { recursive: true, force: true });
  }

  // CDK-040: completion evaluator checks (delegated to sibling to respect line budget).
  await runCompletionChecks({ ok, bad }, { KIT });
  // PKG-04 remainder (delegated to siblings — same budget discipline):
  await runSubagentChecks({ ok, bad }, { KIT });   // CDK-041
  await runCompactionChecks({ ok, bad }, { KIT });  // CDK-042
  await runStatuslineChecks({ ok, bad }, { KIT });  // CDK-043
}
