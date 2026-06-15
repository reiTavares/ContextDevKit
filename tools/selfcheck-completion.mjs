/**
 * selfcheck-completion.mjs — evaluateCompletion invariants (CDK-040, ADR-0072).
 *
 * Asserts the structural and behavioral contracts of evaluate-completion.mjs:
 *   1. Null contract -> allow, no reasonCodes.
 *   2. Contract with empty requiredBeforeCompletion -> allow, no reasonCodes.
 *   3. Contract requiring ['tests'], NO receipt, advisory mode -> warn + evidence-missing code.
 *   4. Same, guarded mode -> deny + evidence-missing code.
 *   5. Contract requiring ['tests'] WITH a valid passed receipt -> allow, satisfied includes 'tests'.
 *
 * Anti-theatre (a bypass is not a proof) is exercised at the substrate layer by
 * the decide()/bypass-store checks; evaluateCompletion only forwards
 * detail.bypassed unchanged, so it is not re-asserted here.
 *
 * Entry point: `runCompletionChecks(rep, { KIT })`.
 * Uses mkdtemp fixtures; always cleans up even on failure.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EVAL_COMPL_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/execution/evaluate-completion.mjs');
const RECEIPT_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');

/**
 * Runs all evaluateCompletion invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runCompletionChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking evaluateCompletion (CDK-040, ADR-0072)...');

  let evalMod, storeMod;
  try {
    evalMod = await import('file://' + EVAL_COMPL_PATH(KIT).replaceAll('\\', '/'));
  } catch (err) {
    bad(`evaluate-completion.mjs failed to import: ${err?.message ?? err}`);
    return;
  }
  try {
    storeMod = await import('file://' + RECEIPT_PATH(KIT).replaceAll('\\', '/'));
  } catch (err) {
    bad(`receipt-store.mjs failed to import (needed for receipt seeding): ${err?.message ?? err}`);
    return;
  }

  const { evaluateCompletion } = evalMod;
  const { writeReceipt } = storeMod;

  typeof evaluateCompletion === 'function'
    ? ok('export: evaluateCompletion present')
    : bad('export: evaluateCompletion missing');

  if (typeof evaluateCompletion !== 'function') return;

  const scope = { branch: 'feat/test', taskId: 'task-compl-sc-01', paths: [] };
  const baseReceipt = {
    capability: 'tests', taskId: 'task-compl-sc-01', sessionId: 'sess-sc',
    runId: 'run-sc', command: '/tests', host: 'claude', result: 'passed',
    evidence: { exitCode: 0, summary: 'All tests green' },
    scope,
  };

  // Case 1: null contract -> allow, no reasonCodes.
  {
    const r = evaluateCompletion({ contract: null, scope, mode: 'advisory', root: '/nonexistent' });
    r.decision === 'allow' && r.reasonCodes.length === 0
      ? ok('null contract -> allow, no reasonCodes')
      : bad(`null contract: expected allow/[], got ${r.decision}/${JSON.stringify(r.reasonCodes)}`);
    r.detail.missing.length === 0 && r.detail.satisfied.length === 0
      ? ok('null contract -> detail empty')
      : bad(`null contract: detail not empty — ${JSON.stringify(r.detail)}`);
  }

  // Case 2: contract with empty requiredBeforeCompletion -> allow.
  {
    const contract = { requiredBeforeCompletion: [], signals: { paths: [] } };
    const r = evaluateCompletion({ contract, scope, mode: 'guarded', root: '/nonexistent' });
    r.decision === 'allow' && r.reasonCodes.length === 0
      ? ok('empty requiredBeforeCompletion -> allow, no reasonCodes')
      : bad(`empty required: expected allow/[], got ${r.decision}/${JSON.stringify(r.reasonCodes)}`);
  }

  const contract = {
    requiredBeforeCompletion: ['tests'],
    signals: { paths: [] },
  };

  const root3 = mkdtempSync(join(tmpdir(), 'ck-compl-sc-'));
  try {
    // Case 3: requiring ['tests'], NO receipt, advisory -> warn + evidence-missing.
    {
      const r = evaluateCompletion({ contract, scope, mode: 'advisory', root: root3 });
      r.decision === 'warn'
        ? ok('advisory + no receipt -> warn (never deny)')
        : bad(`advisory + no receipt: expected warn, got ${r.decision}`);
      r.reasonCodes.includes('completion-evidence-missing')
        ? ok('advisory + no receipt -> completion-evidence-missing reasonCode')
        : bad(`advisory + no receipt: reasonCodes=${JSON.stringify(r.reasonCodes)}`);
      r.remediation.length > 0 && r.remediation[0].includes('/tests')
        ? ok('advisory + no receipt -> remediation mentions /tests')
        : bad(`advisory + no receipt: remediation=${JSON.stringify(r.remediation)}`);
      r.detail.missing.includes('tests')
        ? ok('advisory + no receipt -> detail.missing includes tests')
        : bad(`advisory: detail.missing wrong: ${JSON.stringify(r.detail.missing)}`);
    }

    // Case 4: same, guarded -> deny.
    {
      const r = evaluateCompletion({ contract, scope, mode: 'guarded', root: root3 });
      r.decision === 'deny'
        ? ok('guarded + no receipt -> deny')
        : bad(`guarded + no receipt: expected deny, got ${r.decision}`);
      r.reasonCodes.includes('completion-evidence-missing')
        ? ok('guarded + no receipt -> completion-evidence-missing reasonCode')
        : bad(`guarded: reasonCodes=${JSON.stringify(r.reasonCodes)}`);
    }

    // Case 5: requiring ['tests'] WITH a valid passed receipt -> allow, satisfied.
    {
      writeReceipt(root3, { ...baseReceipt });
      const now = Date.now();
      const r = evaluateCompletion({ contract, scope, mode: 'advisory', root: root3, now });
      r.decision === 'allow'
        ? ok('advisory + valid receipt -> allow')
        : bad(`advisory + valid receipt: expected allow, got ${r.decision}`);
      r.reasonCodes.length === 0
        ? ok('advisory + valid receipt -> no reasonCodes')
        : bad(`advisory + valid receipt: reasonCodes=${JSON.stringify(r.reasonCodes)}`);
      r.detail.satisfied.includes('tests')
        ? ok('advisory + valid receipt -> detail.satisfied includes tests')
        : bad(`satisfied: detail.satisfied=${JSON.stringify(r.detail.satisfied)}`);
      r.detail.missing.length === 0
        ? ok('advisory + valid receipt -> detail.missing empty')
        : bad(`satisfied: detail.missing=${JSON.stringify(r.detail.missing)}`);
    }

  } finally {
    rmSync(root3, { recursive: true, force: true });
  }
}
