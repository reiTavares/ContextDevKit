#!/usr/bin/env node
/**
 * selfcheck-session-autonomy-usage.mjs — receipt-usage.mjs invariants (Session
 * Autonomy Receipt, spec §5 + §18).
 *
 * Asserts the structural and behavioral contracts of the token-accounting +
 * executor-breakdown assembler WITHOUT exercising end-to-end receipt generation:
 *   1. Module imports and exports its documented API.
 *   2. buildUsageBlock maps buckets correctly (freshInput→inputTokens, etc.)
 *      and sets observedTokens to the accounted total.
 *   3. An ABSENT bucket category stays `null`, never `0` (#19).
 *   4. reconcileUsage returns 'matched' on equal totals, 'mismatch' on
 *      differing, and the single-sided / 'unavailable' verdicts correctly.
 *   5. The executor breakdown keeps a deterministic executor at tokens:0/cost:0
 *      and preserves a model executor's tokens; output is frozen.
 *   6. accountedTotal never double-counts and never invents a 0 for empty input.
 *
 * Entry point: `runSessionAutonomyUsageChecks({ ok, bad }, { KIT })`.
 * Standalone runnable: node tools/selfcheck-session-autonomy-usage.mjs
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_PATH = (KIT) =>
  resolve(KIT, 'templates/contextkit/tools/scripts/economics/session-autonomy/receipt-usage.mjs');

/**
 * Runs all receipt-usage invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runSessionAutonomyUsageChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking session-autonomy receipt-usage (spec §5, §18)...');

  let usageMod;
  try {
    usageMod = await import(pathToFileURL(MODULE_PATH(KIT)).href);
    ok('receipt-usage.mjs imports without error');
  } catch (err) {
    bad(`receipt-usage.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  const { buildUsageBlock, reconcileUsage, buildExecutorBreakdown, accountedTotal } = usageMod;
  for (const [name, fn] of Object.entries({ buildUsageBlock, reconcileUsage, buildExecutorBreakdown, accountedTotal })) {
    if (typeof fn === 'function') ok(`exports ${name}()`);
    else bad(`missing export: ${name}`);
  }
  if (typeof buildUsageBlock !== 'function') return;

  checkUsageBlock(rep, buildUsageBlock);
  checkReconciliation(rep, reconcileUsage);
  checkExecutorBreakdown(rep, buildExecutorBreakdown);
  checkAccountedTotal(rep, accountedTotal);
}

/** 2 + 3: bucket mapping, observedTokens, and absent-category-stays-null. */
function checkUsageBlock({ ok, bad }, buildUsageBlock) {
  const block = buildUsageBlock({
    buckets: { freshInput: 100, output: 40, cacheRead: 25, cacheWrite: 5 },
    total: 170,
  });
  const mappedOk = block.inputTokens === 100 && block.outputTokens === 40
    && block.cacheReadTokens === 25 && block.cacheWriteTokens === 5;
  if (mappedOk) ok('buildUsageBlock maps buckets → receipt fields');
  else bad(`buildUsageBlock bucket mapping wrong: ${JSON.stringify(block)}`);

  if (block.observedTokens === 170) ok('buildUsageBlock observedTokens = accounted total');
  else bad(`observedTokens expected 170, got ${block.observedTokens}`);

  // reasoning was absent from the source → MUST stay null, never 0 (#19).
  if (block.reasoningTokens === null) ok('absent category stays null (not 0)');
  else bad(`absent reasoning should be null, got ${block.reasoningTokens}`);

  if (Object.isFrozen(block)) ok('buildUsageBlock output is frozen');
  else bad('buildUsageBlock output should be frozen');

  const empty = buildUsageBlock(null);
  if (empty.inputTokens === null && empty.observedTokens === null) {
    ok('buildUsageBlock(null) → all-null block');
  } else {
    bad(`buildUsageBlock(null) should be all-null, got ${JSON.stringify(empty)}`);
  }
}

/** 4: every reconciliation verdict. */
function checkReconciliation({ ok, bad }, reconcileUsage) {
  const matched = reconcileUsage({ providerReportedTotal: 500, normalizedCalculatedTotal: 500 });
  assertStatus({ ok, bad }, matched, 'matched', 'equal totals → matched');

  const mismatch = reconcileUsage({ providerReportedTotal: 500, normalizedCalculatedTotal: 480 });
  assertStatus({ ok, bad }, mismatch, 'mismatch', 'differing totals → mismatch');
  // The two totals must NEVER be summed — both fields survive independently.
  if (mismatch.providerReportedTotal === 500 && mismatch.normalizedCalculatedTotal === 480) {
    ok('reconcileUsage keeps both totals separate (no double-count)');
  } else {
    bad('reconcileUsage must preserve both totals separately');
  }

  const providerOnly = reconcileUsage({ providerReportedTotal: 500 });
  assertStatus({ ok, bad }, providerOnly, 'provider-total-only', 'provider only → provider-total-only');

  const calcOnly = reconcileUsage({ normalizedCalculatedTotal: 500 });
  assertStatus({ ok, bad }, calcOnly, 'calculated-total-only', 'calculated only → calculated-total-only');

  const none = reconcileUsage({});
  assertStatus({ ok, bad }, none, 'unavailable', 'neither total → unavailable');

  if (Object.isFrozen(matched)) ok('reconcileUsage output is frozen');
  else bad('reconcileUsage output should be frozen');
}

/** 5: deterministic zero vs model tokens, plus include-all + frozen. */
function checkExecutorBreakdown({ ok, bad }, buildExecutorBreakdown) {
  const breakdown = buildExecutorBreakdown([
    { type: 'deterministic', executorId: 'scripts-first', calls: 3 },
    { type: 'model', model: 'claude-x', tokens: 1200, cost: 0.42 },
    { type: 'model', model: 'retry', tokens: 90 }, // overhead retry is NOT excluded (#6)
  ]);

  const det = breakdown[0];
  if (det.tokens === 0 && det.cost === 0) ok('deterministic executor stays tokens:0/cost:0');
  else bad(`deterministic executor expected 0/0, got ${det.tokens}/${det.cost}`);

  const model = breakdown[1];
  if (model.tokens === 1200 && model.cost === 0.42) ok('model executor preserves tokens/cost');
  else bad(`model executor wrong: ${model.tokens}/${model.cost}`);

  // Missing numeric on the model executor → null, not 0 (#19).
  if (model.cacheReadTokens === null) ok('model executor missing numeric → null (not 0)');
  else bad(`model executor missing numeric should be null, got ${model.cacheReadTokens}`);

  if (breakdown.length === 3) ok('breakdown includes ALL executors (retry kept, #6)');
  else bad(`breakdown should keep all 3 executors, got ${breakdown.length}`);

  if (Object.isFrozen(breakdown) && Object.isFrozen(det)) ok('breakdown + elements are frozen');
  else bad('breakdown and its elements should be frozen');

  const empty = buildExecutorBreakdown(null);
  if (Array.isArray(empty) && empty.length === 0) ok('buildExecutorBreakdown(null) → []');
  else bad('buildExecutorBreakdown(null) should be []');
}

/** 6: accountedTotal sums without double-counting; null on empty. */
function checkAccountedTotal({ ok, bad }, accountedTotal) {
  const total = accountedTotal([
    { type: 'deterministic' },        // 0
    { type: 'model', tokens: 1200 },  // 1200
    { type: 'model', tokens: 90 },    // 90
  ]);
  if (total === 1290) ok('accountedTotal sums executor tokens (1290, no double-count)');
  else bad(`accountedTotal expected 1290, got ${total}`);

  if (accountedTotal([]) === null) ok('accountedTotal([]) → null (not 0)');
  else bad(`accountedTotal([]) should be null, got ${accountedTotal([])}`);

  if (accountedTotal(null) === null) ok('accountedTotal(null) → null');
  else bad('accountedTotal(null) should be null');
}

/** Asserts a reconciliation result carries the expected status. */
function assertStatus({ ok, bad }, result, expected, label) {
  if (result.reconciliationStatus === expected) ok(label);
  else bad(`${label}: expected '${expected}', got '${result.reconciliationStatus}'`);
}

// ---------------------------------------------------------------------------
// Standalone runner
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('selfcheck-session-autonomy-usage.mjs')) {
  const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
  let failures = 0;
  const ok = (msg) => console.log(`  ✓ ${msg}`);
  const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };
  await runSessionAutonomyUsageChecks({ ok, bad }, { KIT });
  console.log(failures === 0 ? '\nAll session-autonomy usage checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures ? 1 : 0);
}
