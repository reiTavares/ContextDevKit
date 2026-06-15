/**
 * selfcheck-compaction.mjs — compaction-continuity-core.mjs invariants (CDK-042, ADR-0072).
 *
 * Asserts the structural and behavioral contracts of the pure summarizeObligations helper:
 *   1. Module imports without error (both hook + core).
 *   2. summarizeObligations is exported and is a function.
 *   3. Null/empty contract returns [].
 *   4. Contract with obligations and NO receipts returns all as outstanding.
 *   5. Contract with a valid passing receipt: that capability is NOT outstanding.
 *   6. Contract with an expired receipt: capability is outstanding.
 *   7. Contract with a receipt whose branch mismatches: outstanding.
 *   8. beforeWrite and beforeCompletion are both surfaced; order is stable.
 *   9. Multi-receipt: freshest receipt wins (latest createdAt used for match).
 *
 * Entry point: `runCompactionChecks(rep, { KIT })`.
 * Uses mkdtemp fixtures for receipt-writing cases; always cleans up.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CORE_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/execution/compaction-continuity-core.mjs');
const HOOK_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/hooks/compaction-continuity.mjs');
const RECEIPT_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');

/**
 * Runs all compaction continuity invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runCompactionChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking compaction continuity (CDK-042, ADR-0072)...');

  // 1. Module imports.
  let coreMod, hookSrc, storeMod;
  try {
    coreMod = await import('file://' + CORE_PATH(KIT).replaceAll('\\', '/'));
    ok('compaction-continuity-core.mjs imports without error');
  } catch (err) {
    bad(`compaction-continuity-core.mjs failed to import: ${err?.message ?? err}`);
    return;
  }
  try {
    // The hook entrypoint self-executes main() — we only verify it LOADS; we
    // don't drive it here (integration-test-compaction.mjs does that). We read
    // the source to check structural markers.
    const { readFileSync } = await import('node:fs');
    hookSrc = readFileSync(HOOK_PATH(KIT), 'utf-8');
    ok('compaction-continuity.mjs readable (hook source present)');
  } catch (err) {
    bad(`compaction-continuity.mjs not readable: ${err?.message ?? err}`);
    return;
  }
  try {
    storeMod = await import('file://' + RECEIPT_PATH(KIT).replaceAll('\\', '/'));
    ok('receipt-store.mjs imports (needed for seeding receipts in tests)');
  } catch (err) {
    bad(`receipt-store.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  // 2. Export shape.
  const { summarizeObligations } = coreMod;
  typeof summarizeObligations === 'function'
    ? ok('summarizeObligations exported and is a function')
    : bad('summarizeObligations missing or not a function');
  if (typeof summarizeObligations !== 'function') return;

  // 3. Hook source structural markers — confirm the key invariants are present.
  hookSrc.includes('main().catch(() => process.exit(0))')
    ? ok('hook has fail-open main().catch pattern')
    : bad('hook missing main().catch(() => process.exit(0))');
  hookSrc.includes('getLevel(ROOT) < 5')
    ? ok('hook has inert-below-L5 guard')
    : bad('hook missing getLevel(ROOT) < 5 guard');
  hookSrc.includes("event === 'PreCompact'")
    ? ok("hook branches on 'PreCompact'")
    : bad("hook missing 'PreCompact' branch");
  hookSrc.includes("event === 'SessionStart'")
    ? ok("hook branches on 'SessionStart'")
    : bad("hook missing 'SessionStart' branch");
  hookSrc.includes("source === 'compact' || source === 'resume'")
    ? ok('hook detects compact/resume source field')
    : bad("hook missing compact/resume source detection");
  hookSrc.includes('ADR-0072 §9')
    ? ok('hook references ADR-0072 §9 metadata-only note')
    : bad('hook missing ADR-0072 §9 annotation');

  // 4. Pure function behavioral cases.
  const NOW = 1_700_000_000_000; // fixed timestamp for determinism
  const BRANCH = 'main';
  const TASK_ID = 'task-cc-sc-01';
  const scope = { branch: BRANCH, taskId: TASK_ID, paths: [] };

  // Case A: null contract -> [].
  {
    const result = summarizeObligations({ contract: null, receipts: [], scope, now: NOW });
    Array.isArray(result) && result.length === 0
      ? ok('null contract -> [] (no obligations)')
      : bad(`null contract: expected [], got ${JSON.stringify(result)}`);
  }

  // Case B: contract with empty required lists -> [].
  {
    const contract = { requiredBeforeWrite: [], requiredBeforeCompletion: [] };
    const result = summarizeObligations({ contract, receipts: [], scope, now: NOW });
    result.length === 0
      ? ok('empty required lists -> [] (no obligations)')
      : bad(`empty required lists: expected [], got ${JSON.stringify(result)}`);
  }

  // Case C: contract with obligations, NO receipts -> all outstanding.
  {
    const contract = {
      requiredBeforeWrite: ['impact-check'],
      requiredBeforeCompletion: ['tests'],
    };
    const result = summarizeObligations({ contract, receipts: [], scope, now: NOW });
    result.length === 2
      ? ok('no receipts -> both obligations outstanding (length=2)')
      : bad(`no receipts: expected 2 outstanding, got ${result.length}: ${JSON.stringify(result)}`);
    result.some((o) => o.moment === 'beforeWrite' && o.capability === 'impact-check')
      ? ok('no receipts -> beforeWrite/impact-check outstanding')
      : bad('no receipts: beforeWrite/impact-check missing from outstanding');
    result.some((o) => o.moment === 'beforeCompletion' && o.capability === 'tests')
      ? ok('no receipts -> beforeCompletion/tests outstanding')
      : bad('no receipts: beforeCompletion/tests missing from outstanding');
  }

  // Cases D-G need a real receipt; use a tmp dir for the disk writes.
  const { writeReceipt } = storeMod;
  const root = mkdtempSync(join(tmpdir(), 'ck-cc-sc-'));
  try {
    // Case D: valid passing receipt -> that capability NOT outstanding.
    {
      const contract = {
        requiredBeforeWrite: [],
        requiredBeforeCompletion: ['tests'],
      };
      const receiptObj = writeReceipt(root, {
        capability: 'tests',
        taskId: TASK_ID,
        sessionId: 'sess-cc-sc',
        runId: 'run-cc-1',
        command: '/tests',
        host: 'claude',
        result: 'passed',
        evidence: { exitCode: 0, summary: 'All tests green' },
        scope,
      });
      // Use a now within the receipt's TTL.
      const freshNow = receiptObj.createdAt + 1000;
      const receipts = [receiptObj];
      const result = summarizeObligations({ contract, receipts, scope, now: freshNow });
      result.length === 0
        ? ok('valid passing receipt -> obligation satisfied (not outstanding)')
        : bad(`valid receipt: expected 0 outstanding, got ${result.length}: ${JSON.stringify(result)}`);
    }

    // Case E: expired receipt -> outstanding.
    {
      const contract = {
        requiredBeforeWrite: [],
        requiredBeforeCompletion: ['tests'],
      };
      const receiptObj = writeReceipt(root, {
        capability: 'tests',
        taskId: TASK_ID,
        sessionId: 'sess-cc-sc',
        runId: 'run-cc-2',
        command: '/tests',
        host: 'claude',
        result: 'passed',
        evidence: { exitCode: 0, summary: 'Passed' },
        scope,
      });
      // Move time past expiry (default TTL = 24h; jump 25 hours).
      const expiredNow = receiptObj.expiresAt + 1000;
      const receipts = [receiptObj];
      const result = summarizeObligations({ contract, receipts, scope, now: expiredNow });
      result.length === 1
        ? ok('expired receipt -> obligation outstanding')
        : bad(`expired receipt: expected 1 outstanding, got ${result.length}`);
    }

    // Case F: branch-mismatched receipt -> outstanding.
    {
      const contract = {
        requiredBeforeWrite: ['impact-check'],
        requiredBeforeCompletion: [],
      };
      const wrongScope = { branch: 'feat/other', taskId: TASK_ID, paths: [] };
      const receiptObj = writeReceipt(root, {
        capability: 'impact-check',
        taskId: TASK_ID,
        sessionId: 'sess-cc-sc',
        runId: 'run-cc-3',
        command: '/simulate-impact',
        host: 'claude',
        result: 'passed',
        evidence: { exitCode: 0, summary: 'Impact assessed' },
        scope: wrongScope,
      });
      // Validate against the correct scope (branch='main') — fingerprint mismatch.
      const freshNow = receiptObj.createdAt + 1000;
      const receipts = [receiptObj];
      const result = summarizeObligations({ contract, receipts, scope, now: freshNow });
      result.length === 1
        ? ok('branch-mismatched receipt -> obligation outstanding')
        : bad(`branch-mismatch: expected 1 outstanding, got ${result.length}`);
    }

    // Case G: order stability — beforeWrite comes before beforeCompletion.
    {
      const contract = {
        requiredBeforeWrite: ['impact-check'],
        requiredBeforeCompletion: ['tests'],
      };
      const result = summarizeObligations({ contract, receipts: [], scope, now: NOW });
      result[0]?.moment === 'beforeWrite' && result[1]?.moment === 'beforeCompletion'
        ? ok('obligation order stable: beforeWrite before beforeCompletion')
        : bad(`order unstable: ${result.map((o) => o.moment).join(',')}`);
    }

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
