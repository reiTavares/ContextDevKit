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
  console.log('Checking canonical governance modes + gate registry (ADR-0158)...');

  let modes, bypass, registry, gateMode, defaults;
  try {
    const modesPath = resolve(KIT, 'templates/contextkit/runtime/execution/enforcement-modes.mjs');
    const bypassPath = resolve(KIT, 'templates/contextkit/runtime/execution/bypass-store.mjs');
    const registryPath = resolve(KIT, 'templates/contextkit/runtime/governance/gate-registry.mjs');
    const gateModePath = resolve(KIT, 'templates/contextkit/runtime/governance/gate-mode.mjs');
    const defaultsPath = resolve(KIT, 'templates/contextkit/runtime/config/defaults.mjs');
    modes = await import('file://' + modesPath.replaceAll('\\', '/'));
    bypass = await import('file://' + bypassPath.replaceAll('\\', '/'));
    registry = await import('file://' + registryPath.replaceAll('\\', '/'));
    gateMode = await import('file://' + gateModePath.replaceAll('\\', '/'));
    defaults = await import('file://' + defaultsPath.replaceAll('\\', '/'));
  } catch (err) {
    bad(`governance module failed to import: ${err?.message ?? err}`);
    return;
  }

  const { ENFORCEMENT_MODES, resolveEnforcementMode, decide } = modes;
  const { writeBypass, readBypass, readBypasses, isBypassValid } = bypass;
  const { DEFAULT_CONFIG } = defaults;
  const { GATE_IDS, GUARDED_GATE_IDS, OVERRIDE_METADATA_FIELDS } = registry;
  const {
    buildHumanOverrideMetadata,
    evaluateGateObservation,
    resolveGateMode,
    resolveGovernanceMatrix,
  } = gateMode;

  JSON.stringify(ENFORCEMENT_MODES) === JSON.stringify(['off', 'shadow', 'canary', 'guarded'])
    ? ok('modes: canonical enum is exact') : bad(`modes: wrong enum ${JSON.stringify(ENFORCEMENT_MODES)}`);
  resolveEnforcementMode(null) === 'canary' && resolveEnforcementMode({}) === 'canary'
    ? ok('modes: missing config -> canary') : bad('modes: missing config did not become canary');
  resolveEnforcementMode({ enforcement: { mode: 'advisory' } }) === 'canary'
    ? ok('modes: advisory aliases to canary') : bad('modes: advisory alias failed');
  const aliasWarnings = [];
  resolveEnforcementMode({ enforcement: { mode: 'strict' } }, { onWarning: (message) => aliasWarnings.push(message) }) === 'guarded'
    && aliasWarnings.some((message) => message.includes('deprecated'))
    ? ok('modes: strict aliases to guarded with warning') : bad('modes: strict alias/warning failed');
  const throwingConfig = Object.defineProperty({}, 'governance', { get() { throw new Error('fixture'); } });
  resolveEnforcementMode(throwingConfig) === 'canary'
    ? ok('modes: resolver error -> canary') : bad('modes: resolver error did not become canary');

  const matrix = resolveGovernanceMatrix(DEFAULT_CONFIG);
  const guardedIds = Object.entries(matrix.modes).filter(([, mode]) => mode === 'guarded').map(([id]) => id);
  guardedIds.length === 3 && guardedIds.every((id) => GUARDED_GATE_IDS.includes(id))
    ? ok('matrix: only QA, DDD invariants, and technical debt are guarded')
    : bad(`matrix: guarded allowlist drifted: ${guardedIds.join(', ')}`);
  matrix.modes['architecture-debt'] === 'canary' && matrix.modes['privacy-lgpd'] === 'shadow'
    && matrix.modes['graph-first'] === 'canary'
    ? ok('matrix: architecture, LGPD, and graph defaults match contract')
    : bad('matrix: non-blocking defaults drifted');
  GATE_IDS.length === 16 && matrix.failurePolicy === 'continue'
    ? ok('matrix: registry complete and failurePolicy=continue') : bad('matrix: registry/failure policy malformed');
  resolveGateMode({ governance: { defaultMode: 'canary', failurePolicy: 'continue', humanAuthority: 'owner-wins', gates: { 'privacy-lgpd': 'guarded' } } }, 'privacy-lgpd').mode === 'canary'
    ? ok('allowlist: guarded outside allowlist clamps to canary') : bad('allowlist: LGPD was allowed to become guarded');
  resolveGateMode(null, 'qa-signoff').mode === 'canary'
    ? ok('gate resolver: missing config -> canary') : bad('gate resolver: missing config did not become canary');

  const shadowGate = resolveGateMode(DEFAULT_CONFIG, 'privacy-lgpd');
  evaluateGateObservation({ gate: shadowGate, moment: 'postflight', observation: { status: 'violated' } }).decision === 'silent'
    ? ok('shadow: violation is silent and non-blocking') : bad('shadow: violation leaked or blocked');
  const canaryGate = resolveGateMode(DEFAULT_CONFIG, 'architecture-debt');
  evaluateGateObservation({ gate: canaryGate, moment: 'postflight', observation: { status: 'violated' } }).decision === 'warn'
    ? ok('canary: violation warns and does not block') : bad('canary: violation semantics wrong');
  const qaGate = { id: 'qa-signoff', mode: 'guarded' };
  const qaFacts = { status: 'violated', deterministic: true, applicable: true, evidenced: true, transition: 'done' };
  evaluateGateObservation({ gate: qaGate, moment: 'completion', observation: qaFacts }).decision === 'deny'
    ? ok('guarded: evidenced QA violation denies only completion') : bad('guarded: applicable QA violation did not deny');
  evaluateGateObservation({ gate: qaGate, moment: 'write-preflight', observation: qaFacts }).decision === 'warn'
    ? ok('guarded: QA never blocks implementation start') : bad('guarded: QA blocked write-preflight');
  evaluateGateObservation({ gate: qaGate, moment: 'completion', observation: { status: 'error' } }).decision === 'warn'
    ? ok('guarded: evaluator error continues') : bad('guarded: evaluator error blocked');

  const override = buildHumanOverrideMetadata('qa-signoff', {
    actor: 'owner', reason: 'explicit release decision', scope: { taskId: '410' },
    baseRevision: 7, outcome: 'accepted', timestamp: '2026-08-08T12:00:00.000Z',
    expiresAt: '2099-08-08T12:15:00.000Z',
  });
  OVERRIDE_METADATA_FIELDS.every((field) => Object.hasOwn(override, field))
    && evaluateGateObservation({
      gate: qaGate,
      moment: 'completion',
      observation: { ...qaFacts, override, currentRevision: 7, currentScope: { taskId: '410' } },
    }).decision === 'allow'
    ? ok('override: complete audit metadata allows owner override without grade')
    : bad('override: metadata or owner-wins behavior failed');

  const root2 = mkdtempSync(join(tmpdir(), 'ck-enf-sc-'));
  try {
    const scope = { branch: 'feat/x', taskId: 'task-sc-01', paths: ['src/a.mjs'] };
    const contract = { requiredBeforeWrite: ['qa-signoff'], requiredBeforeCompletion: ['qa-signoff'] };
    const base = { mode: 'canary', contract, moment: 'beforeWrite', scope, root: root2 };
    decide(base).decision === 'warn' ? ok('compat decide: canary never denies') : bad('compat decide: canary semantics wrong');
    decide({ ...base, mode: 'shadow' }).visibility === 'silent'
      ? ok('compat decide: shadow remains silent') : bad('compat decide: shadow visibility wrong');
    const guardedFacts = { gateId: 'qa-signoff', violation: { deterministic: true, applicable: true, evidenced: true, transition: 'done' } };
    decide({ ...base, ...guardedFacts, mode: 'guarded', moment: 'beforeCompletion' }).decision === 'deny'
      ? ok('compat decide: guarded uses central allowlist') : bad('compat decide: guarded allowlist failed');

    writeBypass(root2, { capability: 'qa-signoff', taskId: 'task-sc-01', branch: 'feat/x', reason: 'pre-approved', actor: 'human-lead', approvedBy: 'alice' });
    const guardBypassed = decide({ ...base, ...guardedFacts, mode: 'guarded', moment: 'beforeCompletion' });
    guardBypassed.decision === 'allow' ? ok('guarded: valid bypass -> allow') : bad(`guarded: bypass should allow, got ${guardBypassed.decision}`);
    guardBypassed.bypassed.includes('qa-signoff') ? ok('guarded: bypass in bypassed list (not satisfied)') : bad('guarded: bypass not in bypassed list');
    !guardBypassed.satisfied.includes('qa-signoff') ? ok('anti-theatre: bypassed != satisfied') : bad('anti-theatre: bypass wrongly counted as satisfied');

    const bp = readBypass(root2, 'task-sc-01', 'qa-signoff');
    const { valid: bv } = isBypassValid(bp, { capability: 'qa-signoff', taskId: 'task-sc-01', branch: 'feat/x' });
    bv ? ok('isBypassValid: valid bypass -> valid') : bad('isBypassValid: expected valid');

    const allBp = readBypasses(root2, 'task-sc-01');
    allBp.length >= 1 ? ok(`readBypasses: returns ${allBp.length} bypass(es)`) : bad('readBypasses: expected >= 1');

    isBypassValid(null, { capability: 'x', taskId: 'y', branch: 'z' }).valid === false
      ? ok('isBypassValid: null bypass -> invalid') : bad('isBypassValid: null should be invalid');

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
