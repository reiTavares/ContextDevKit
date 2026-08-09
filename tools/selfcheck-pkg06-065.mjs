#!/usr/bin/env node
/**
 * CDK-065 self-check — benchmark-task.mjs (PKG-06, continuous per-completed-task benchmark).
 *
 * Verifies five invariants:
 *   (a) recordTask() appends a valid record to the ledger (hermetic temp ledger).
 *   (b) recordTask() with completed:false is still recorded but marked completed=false.
 *   (c) summarize() with 2 completed + 1 incomplete → correct count/completedCount/tokensPerCompletedTask.
 *   (d) summarize() on an empty ledger returns tokensPerCompletedTask===0 (no NaN / divide-by-zero).
 *   (e) recordTask() with invalid inputs (missing taskId, NaN tokens) returns null and does NOT
 *       write to the ledger — fail-open, no throw.
 *
 * Hermetic: writes only to an OS temp directory. The real ledger is never touched.
 * Standalone runnable: node tools/selfcheck-pkg06-065.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the module under test. */
const BENCH_MODULE_PATH = resolve(
  __dirname,
  '../templates/contextkit/tools/scripts/benchmark-task.mjs',
);
const BENCH_MODULE_URL = pathToFileURL(BENCH_MODULE_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
let recordTask, summarize;
try {
  ({ recordTask, summarize } = await import(BENCH_MODULE_URL));
} catch (err) {
  console.error(`FATAL: cannot import benchmark-task.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Temp directory setup — cleaned up in finally below
// ---------------------------------------------------------------------------
const tmpBase = mkdtempSync(resolve(tmpdir(), 'cdk065-'));
const ledgerPath = resolve(tmpBase, 'benchmark-ledger.json');

try {
  // ---------------------------------------------------------------------------
  // (a) recordTask() appends a valid completed record
  // ---------------------------------------------------------------------------
  console.log('\n(a) recordTask() appends a valid completed record\n');

  const rec1 = recordTask(
    { taskId: 'CDK-065-a', tokens: 2000, model: 'sonnet', completed: true },
    { ledgerPath },
  );

  rec1 !== null
    ? ok('recordTask() returned a non-null record for valid completed input')
    : bad('recordTask() returned null for valid completed input');

  if (rec1 !== null) {
    rec1.taskId === 'CDK-065-a'
      ? ok(`rec1.taskId === 'CDK-065-a'`)
      : bad(`rec1.taskId should be 'CDK-065-a', got '${rec1.taskId}'`);

    rec1.tokens === 2000
      ? ok('rec1.tokens === 2000')
      : bad(`rec1.tokens should be 2000, got ${rec1.tokens}`);

    rec1.model === 'sonnet'
      ? ok("rec1.model === 'sonnet'")
      : bad(`rec1.model should be 'sonnet', got '${rec1.model}'`);

    rec1.completed === true
      ? ok('rec1.completed === true')
      : bad(`rec1.completed should be true, got ${rec1.completed}`);

    typeof rec1.ts === 'string' && rec1.ts.length > 0
      ? ok(`rec1.ts is an ISO string: '${rec1.ts}'`)
      : bad(`rec1.ts should be a non-empty ISO string, got ${JSON.stringify(rec1.ts)}`);
  }

  // Verify persistence: the ledger file exists and contains the record.
  let persisted;
  try {
    persisted = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (readErr) {
    bad(`ledger file is unreadable after recordTask(): ${readErr?.message}`);
    persisted = null;
  }

  if (persisted !== null) {
    Array.isArray(persisted) && persisted.length === 1
      ? ok('ledger file contains exactly 1 record after first recordTask()')
      : bad(`ledger should contain 1 record, found ${Array.isArray(persisted) ? persisted.length : 'non-array'}`);
  }

  // ---------------------------------------------------------------------------
  // (b) recordTask() with completed:false is still recorded, marked false
  // ---------------------------------------------------------------------------
  console.log('\n(b) recordTask() with completed:false is recorded but marked incomplete\n');

  const rec2 = recordTask(
    { taskId: 'CDK-065-b', tokens: 500, completed: false },
    { ledgerPath },
  );

  rec2 !== null
    ? ok('recordTask() returned a non-null record for completed:false input')
    : bad('recordTask() returned null for completed:false input');

  if (rec2 !== null) {
    rec2.completed === false
      ? ok('rec2.completed === false  (incomplete task marked correctly)')
      : bad(`rec2.completed should be false, got ${rec2.completed}`);
  }

  // ---------------------------------------------------------------------------
  // (c) summarize() with 2 completed + 1 incomplete → correct metrics
  // ---------------------------------------------------------------------------
  console.log('\n(c) summarize() — 2 completed + 1 incomplete\n');

  // Add a third record (second completed) to reach the 2-completed / 1-incomplete scenario.
  const rec3 = recordTask(
    { taskId: 'CDK-065-c', tokens: 3000, completed: true },
    { ledgerPath },
  );

  rec3 !== null
    ? ok('third recordTask() (completed) succeeded')
    : bad('third recordTask() returned null unexpectedly');

  const summary = summarize(undefined, { ledgerPath });

  summary.count === 3
    ? ok(`summary.count === 3  (total records: completed + incomplete)`)
    : bad(`summary.count should be 3, got ${summary.count}`);

  summary.completedCount === 2
    ? ok('summary.completedCount === 2')
    : bad(`summary.completedCount should be 2, got ${summary.completedCount}`);

  // totalTokens = 2000 (rec1) + 500 (rec2) + 3000 (rec3) = 5500
  summary.totalTokens === 5500
    ? ok('summary.totalTokens === 5500  (all records, including incomplete)')
    : bad(`summary.totalTokens should be 5500, got ${summary.totalTokens}`);

  // tokensPerCompletedTask = (2000 + 3000) / 2 = 2500
  const expectedPerTask = 2500;
  summary.tokensPerCompletedTask === expectedPerTask
    ? ok(`summary.tokensPerCompletedTask === ${expectedPerTask}  (completed tokens / completedCount)`)
    : bad(`summary.tokensPerCompletedTask should be ${expectedPerTask}, got ${summary.tokensPerCompletedTask}`);

  // Sanity: no NaN or Infinity in the summary values.
  const numericFields = ['count', 'completedCount', 'totalTokens', 'tokensPerCompletedTask'];
  const nanFields = numericFields.filter((k) => !Number.isFinite(summary[k]));
  nanFields.length === 0
    ? ok('no NaN or Infinity in summary numeric fields')
    : bad(`NaN/Infinity found in summary fields: ${nanFields.join(', ')}`);

  // ---------------------------------------------------------------------------
  // (d) summarize() on an empty ledger → tokensPerCompletedTask === 0 (no NaN)
  // ---------------------------------------------------------------------------
  console.log('\n(d) summarize() on an empty ledger — no divide-by-zero\n');

  const emptyLedgerPath = resolve(tmpBase, 'empty-ledger.json');
  // Do not create the file — readLedger must handle a missing file gracefully.
  const emptySummary = summarize(undefined, { ledgerPath: emptyLedgerPath });

  emptySummary.count === 0
    ? ok('emptySummary.count === 0')
    : bad(`emptySummary.count should be 0, got ${emptySummary.count}`);

  emptySummary.completedCount === 0
    ? ok('emptySummary.completedCount === 0')
    : bad(`emptySummary.completedCount should be 0, got ${emptySummary.completedCount}`);

  emptySummary.tokensPerCompletedTask === 0
    ? ok('emptySummary.tokensPerCompletedTask === 0  (no divide-by-zero)')
    : bad(`emptySummary.tokensPerCompletedTask should be 0, got ${emptySummary.tokensPerCompletedTask}`);

  !Number.isNaN(emptySummary.tokensPerCompletedTask) && Number.isFinite(emptySummary.tokensPerCompletedTask)
    ? ok('tokensPerCompletedTask is neither NaN nor Infinity when ledger is empty')
    : bad('tokensPerCompletedTask is NaN or Infinity on empty ledger — divide-by-zero bug!');

  // Also test with explicit empty array input (the records-param path).
  const explicitEmpty = summarize([], { ledgerPath: emptyLedgerPath });
  explicitEmpty.tokensPerCompletedTask === 0 && !Number.isNaN(explicitEmpty.tokensPerCompletedTask)
    ? ok('summarize([]) → tokensPerCompletedTask === 0 (explicit empty-array path)')
    : bad(`summarize([]) → tokensPerCompletedTask should be 0, got ${explicitEmpty.tokensPerCompletedTask}`);

  // ---------------------------------------------------------------------------
  // (e) recordTask() with invalid inputs returns null and does not write
  // ---------------------------------------------------------------------------
  console.log('\n(e) recordTask() invalid inputs — fail-open, no throw, no write\n');

  const badLedgerPath = resolve(tmpBase, 'bad-inputs-ledger.json');

  // Missing taskId.
  let nullRec;
  try {
    nullRec = recordTask({ taskId: undefined, tokens: 100, completed: true }, { ledgerPath: badLedgerPath });
  } catch (err) {
    bad(`recordTask(missing taskId) threw instead of returning null: ${err?.message}`);
    nullRec = 'threw';
  }
  nullRec === null
    ? ok('recordTask({ taskId: undefined }) returned null  (fail-open)')
    : bad(`recordTask(missing taskId) should return null, got: ${JSON.stringify(nullRec)}`);

  // NaN tokens.
  let nanRec;
  try {
    nanRec = recordTask({ taskId: 'test', tokens: NaN, completed: true }, { ledgerPath: badLedgerPath });
  } catch (err) {
    bad(`recordTask(NaN tokens) threw instead of returning null: ${err?.message}`);
    nanRec = 'threw';
  }
  nanRec === null
    ? ok('recordTask({ tokens: NaN }) returned null  (fail-open)')
    : bad(`recordTask(NaN tokens) should return null, got: ${JSON.stringify(nanRec)}`);

  // Negative tokens.
  let negRec;
  try {
    negRec = recordTask({ taskId: 'test', tokens: -1, completed: true }, { ledgerPath: badLedgerPath });
  } catch (err) {
    bad(`recordTask(negative tokens) threw instead of returning null: ${err?.message}`);
    negRec = 'threw';
  }
  negRec === null
    ? ok('recordTask({ tokens: -1 }) returned null  (fail-open)')
    : bad(`recordTask(negative tokens) should return null, got: ${JSON.stringify(negRec)}`);

  // Null input guard.
  let nullInputRec;
  try {
    nullInputRec = recordTask(null, { ledgerPath: badLedgerPath });
  } catch (err) {
    bad(`recordTask(null) threw instead of returning null: ${err?.message}`);
    nullInputRec = 'threw';
  }
  nullInputRec === null
    ? ok('recordTask(null) returned null  (null-input guard)')
    : bad(`recordTask(null) should return null, got: ${JSON.stringify(nullInputRec)}`);

  // The bad-inputs ledger must NOT have been created (no successful writes).
  let badLedgerExists = false;
  try {
    readFileSync(badLedgerPath, 'utf8');
    badLedgerExists = true;
  } catch {
    badLedgerExists = false;
  }
  !badLedgerExists
    ? ok('bad-inputs ledger was NOT created — invalid inputs did not write to disk')
    : bad('bad-inputs ledger was unexpectedly created — invalid inputs should not write');

} finally {
  // Clean up temp directory (best-effort — do not fail the suite on cleanup error).
  try {
    rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-065 benchmark-task self-check: all checks passed.\n'
    : `\n  FAIL — CDK-065 benchmark-task self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
