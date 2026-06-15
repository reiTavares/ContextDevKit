/**
 * selfcheck-statusline.mjs — computeComplianceSegment invariants (CDK-043, ADR-0072).
 *
 * Table-driven unit tests for the PURE computeComplianceSegment function exported
 * from statusline.mjs. The function is tested in isolation: no I/O, all inputs
 * supplied inline, `now` pinned to a fixed timestamp.
 *
 * Cases:
 *   1. Null contract → '' (segment absent).
 *   2. Contract with empty requiredBeforeCompletion → '' (segment absent).
 *   3. Contract requiring ['tests','lint'], NO valid receipts → '⚠ 0/2 evidence'.
 *   4. Contract requiring ['tests','lint'], ONE valid receipt (tests only) → '⚠ 1/2 evidence'.
 *   5. Contract requiring ['tests'], valid receipt (passed, unexpired, scope-matched) → '✓ 1/1 evidence'.
 *   6. Non-array requiredBeforeCompletion → '' (segment absent).
 *   7. Any thrown error inside pure fn is impossible (no I/O), but isReceiptValid
 *      with null receipt is handled (null guard in the map loop).
 *
 * Entry point: `runStatuslineChecks(rep, { KIT })`.
 * Uses writeReceipt from receipt-store.mjs to build valid fixture receipts via a
 * tmp dir; always cleans up even on failure.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const STATUSLINE_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/statusline.mjs');
const RECEIPT_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');

/** Fixed "now" for all validity checks — a timestamp 1 hour in the past of a 24h TTL. */
const FIXED_NOW = 1_000_000_000_000; // arbitrary fixed epoch ms

/**
 * Runs all computeComplianceSegment invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runStatuslineChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking computeComplianceSegment (CDK-043, ADR-0072)...');

  let computeComplianceSegment, writeReceipt, computeFingerprint;
  try {
    const slMod = await import('file://' + STATUSLINE_PATH(KIT).replaceAll('\\', '/'));
    computeComplianceSegment = slMod.computeComplianceSegment;
  } catch (err) {
    bad(`statusline.mjs failed to import: ${err?.message ?? err}`);
    return;
  }
  try {
    const storeMod = await import('file://' + RECEIPT_PATH(KIT).replaceAll('\\', '/'));
    writeReceipt = storeMod.writeReceipt;
    computeFingerprint = storeMod.computeFingerprint;
  } catch (err) {
    bad(`receipt-store.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  typeof computeComplianceSegment === 'function'
    ? ok('export: computeComplianceSegment present')
    : bad('export: computeComplianceSegment missing');

  if (typeof computeComplianceSegment !== 'function') return;

  const scope = { branch: 'feat/test', taskId: 'task-sl-sc-01', paths: [] };

  // --- Pure function cases (no disk I/O needed) ---

  // Case 1: null contract → '' (segment absent).
  {
    const result = computeComplianceSegment({ contract: null, receipts: [], scope, now: FIXED_NOW });
    result === ''
      ? ok('null contract → segment absent (empty string)')
      : bad(`null contract: expected '', got '${result}'`);
  }

  // Case 2: empty requiredBeforeCompletion → '' (segment absent).
  {
    const contract = { requiredBeforeCompletion: [] };
    const result = computeComplianceSegment({ contract, receipts: [], scope, now: FIXED_NOW });
    result === ''
      ? ok('empty requiredBeforeCompletion → segment absent')
      : bad(`empty required: expected '', got '${result}'`);
  }

  // Case 6: non-array requiredBeforeCompletion → '' (segment absent).
  {
    const contract = { requiredBeforeCompletion: 'tests' };
    const result = computeComplianceSegment({ contract, receipts: [], scope, now: FIXED_NOW });
    result === ''
      ? ok('non-array requiredBeforeCompletion → segment absent')
      : bad(`non-array: expected '', got '${result}'`);
  }

  // Case 3: two required, no valid receipts → '⚠ 0/2 evidence'.
  {
    const contract = { requiredBeforeCompletion: ['tests', 'lint'] };
    const result = computeComplianceSegment({ contract, receipts: [], scope, now: FIXED_NOW });
    result === '⚠ 0/2 evidence'
      ? ok('no receipts → ⚠ 0/2 evidence')
      : bad(`no receipts: expected '⚠ 0/2 evidence', got '${result}'`);
  }

  // Cases 4 & 5 require seeded receipts — use a tmp dir.
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ck-sl-sc-'));
  try {
    const baseReceipt = {
      taskId: 'task-sl-sc-01',
      sessionId: 'sess-sl-sc',
      runId: 'run-sl-sc',
      command: '/tests',
      host: 'claude',
      result: 'passed',
      evidence: { exitCode: 0, summary: 'Tests green' },
      scope,
    };

    // Seed a valid 'tests' receipt.
    writeReceipt(tmpRoot, { ...baseReceipt, capability: 'tests' });

    // Read it back directly via readJsonSafe-style path construction so we
    // supply it to the pure function without filesystem coupling.
    const { join: pjoin } = await import('node:path');
    const { readJsonSafe } = await import(
      'file://' + resolve(KIT, 'templates/contextkit/runtime/hooks/safe-io.mjs').replaceAll('\\', '/')
    );
    const receiptsDir = pjoin(tmpRoot, 'contextkit/pipeline/state/task-sl-sc-01/receipts');
    const testReceipt = readJsonSafe(pjoin(receiptsDir, 'tests.json'), null);

    if (!testReceipt) {
      bad('fixture: could not read seeded tests receipt back from tmp dir');
    } else {
      // Case 4: two required, one valid → '⚠ 1/2 evidence'.
      {
        const contract = { requiredBeforeCompletion: ['tests', 'lint'] };
        const result = computeComplianceSegment({
          contract,
          receipts: [testReceipt],
          scope,
          now: FIXED_NOW,
        });
        result === '⚠ 1/2 evidence'
          ? ok('one of two satisfied → ⚠ 1/2 evidence')
          : bad(`1-of-2: expected '⚠ 1/2 evidence', got '${result}'`);
      }

      // Case 5: one required, one valid → '✓ 1/1 evidence'.
      {
        const contract = { requiredBeforeCompletion: ['tests'] };
        const result = computeComplianceSegment({
          contract,
          receipts: [testReceipt],
          scope,
          now: FIXED_NOW,
        });
        result === '✓ 1/1 evidence'
          ? ok('all satisfied → ✓ 1/1 evidence')
          : bad(`all-satisfied: expected '✓ 1/1 evidence', got '${result}'`);
      }

      // Case 7: expired receipt → still missing → '⚠ 0/1 evidence'.
      {
        const expiredReceipt = { ...testReceipt, expiresAt: FIXED_NOW - 1 };
        const contract = { requiredBeforeCompletion: ['tests'] };
        const result = computeComplianceSegment({
          contract,
          receipts: [expiredReceipt],
          scope,
          now: FIXED_NOW,
        });
        result === '⚠ 0/1 evidence'
          ? ok('expired receipt counts as missing → ⚠ 0/1 evidence')
          : bad(`expired: expected '⚠ 0/1 evidence', got '${result}'`);
      }
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
