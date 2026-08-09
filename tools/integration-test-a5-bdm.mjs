#!/usr/bin/env node
/**
 * Integration suite — BIZ-0001 / WF-0036 Wave A5 (Economics: forecast + recurrence).
 *
 * Backs Gate G-A5 by:
 *   (1) Spawning the two A5 behavioural selftests next to their SOURCE modules:
 *         - economics/investment-forecast.selftest.mjs  (A5-T1)
 *         - operation-recurrence.selftest.mjs           (A5-T2)
 *   (2) Running inline assertions for acceptance criteria NOT covered by the
 *       selftests: budget-mode block → defer-quota-low; case-insensitive grouping;
 *       Object.isFrozen on weeklyPlanningView output.
 *
 * Thin spawning runner (mirrors `tools/run-suites.mjs`). Zero-dependency, `node:*`
 * only, Windows-safe (array-arg spawnSync, no shell string). Exit 0 = pass, 1 = fail.
 *
 * @module integration-test-a5-bdm
 */
import { spawnSync }        from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath }    from 'node:url';

import {
  buildForecast,
  quotaTimingRecommendation,
} from '../templates/contextkit/tools/scripts/economics/investment-forecast-core.mjs';

import {
  detectRecurrence,
  weeklyPlanningView,
  DEFAULT_RECURRENCE_THRESHOLD,
} from '../templates/contextkit/tools/scripts/operation-recurrence.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIT     = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');

const SELFTESTS = [
  'economics/investment-forecast.selftest.mjs',
  'operation-recurrence.selftest.mjs',
];

// Fixed epoch for deterministic time injection — no wall-clock calls here.
const FIXED_NOW = 1718200000000;

// ---------------------------------------------------------------------------
// Minimal inline assertion helpers
// ---------------------------------------------------------------------------

let inlineFailures = 0;

/**
 * Strict equality assertion.
 * @param {string} label
 * @param {unknown} actual
 * @param {unknown} expected
 */
function eq(label, actual, expected) {
  if (actual !== expected) {
    console.error(`  FAIL [${label}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    inlineFailures++;
  } else {
    console.log(`  PASS [${label}]`);
  }
}

/**
 * Truthiness assertion.
 * @param {string} label
 * @param {unknown} value
 */
function ok(label, value) {
  if (!value) {
    console.error(`  FAIL [${label}]: expected truthy, got ${JSON.stringify(value)}`);
    inlineFailures++;
  } else {
    console.log(`  PASS [${label}]`);
  }
}

// ---------------------------------------------------------------------------
// Phase 1: spawn selftests
// ---------------------------------------------------------------------------

console.log('\nWF-0036 A5 — Economics: investment-forecast + operation-recurrence\n');

let spawnFailures = 0;
for (const rel of SELFTESTS) {
  const child = spawnSync(
    process.execPath,
    [resolve(SCRIPTS, rel)],
    { cwd: KIT, encoding: 'utf-8' },
  );
  process.stdout.write(child.stdout || '');
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) {
    spawnFailures += 1;
    console.error(`  FAIL selftest ${rel} exited ${child.status}`);
  } else {
    console.log(`  PASS selftest ${rel}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: inline acceptance criteria not covered by the selftests
// ---------------------------------------------------------------------------

console.log('\n--- Inline A5 gap assertions ---\n');

// ------------------------------------------------------------------
// Gap A: budget mode='block' → 'defer-quota-low' (A5-T1, criterion 4)
// The selftests cover pressure/quota-low/invest-now but not the
// budget-block branch of quotaTimingRecommendation.
// ------------------------------------------------------------------

console.log('Gap A — budget mode block → defer-quota-low');

const blockForecast = buildForecast({
  budgetAdvisory: { mode: 'block', ratio: 0.95, status: undefined },
});
// Comfortable hosts (remainingPct >= 20) so we reach the budget check.
const comfortableHosts = [{ host: 'claude-code', remainingPct: 80 }];
const blockRec = quotaTimingRecommendation(blockForecast, comfortableHosts, { now: FIXED_NOW });
eq('A.block.recommendation', blockRec.recommendation, 'defer-quota-low');
eq('A.block.confidence',     blockRec.confidence,     'derived');
eq('A.block.capturedAt',     blockRec.capturedAt,      FIXED_NOW);

// Budget mode='downgrade' must also yield 'defer-quota-low'.
const downgradeForecast = buildForecast({
  budgetAdvisory: { mode: 'downgrade', ratio: 0.85, status: undefined },
});
const downgradeRec = quotaTimingRecommendation(downgradeForecast, comfortableHosts, { now: FIXED_NOW });
eq('A.downgrade.recommendation', downgradeRec.recommendation, 'defer-quota-low');

// ------------------------------------------------------------------
// Gap B: case-insensitive grouping (A5-T2, criterion 6)
// 'MAINTENANCE' and 'maintenance' must land in the same group.
// ------------------------------------------------------------------

console.log('\nGap B — case-insensitive operation grouping');

const mixedCaseOps = [
  { id: 'OP-C01', contextId: 'BIZ-0099', kind: 'MAINTENANCE' },
  { id: 'OP-C02', contextId: 'BIZ-0099', kind: 'maintenance' },
  { id: 'OP-C03', contextId: 'BIZ-0099', kind: 'Maintenance' },
];
const caseResult = detectRecurrence(mixedCaseOps, { threshold: DEFAULT_RECURRENCE_THRESHOLD });

// All three should collapse into a single group.
eq('B.groups.length',           caseResult.groups.length,              1);
eq('B.group.count',             caseResult.groups[0]?.count,           3);
eq('B.group.recommendation',    caseResult.groups[0]?.recommendation,  'promote-to-business');
// contextId and kind are stored with their original casing from the FIRST occurrence;
// group key itself is lowercase — verify the key contains only lowercase tokens.
ok('B.key.lowercase', typeof caseResult.groups[0]?.key === 'string' &&
  caseResult.groups[0].key === caseResult.groups[0].key.toLowerCase());

// ------------------------------------------------------------------
// Gap C: weeklyPlanningView results are frozen (A5-T2, criterion 8)
// Object.isFrozen must be true on every top-level value.
// ------------------------------------------------------------------

console.log('\nGap C — weeklyPlanningView output is frozen');

const view = weeklyPlanningView(
  {
    businessId:       'BIZ-0099',
    operations:       mixedCaseOps,
    expectedOutcomes: [
      { outcome: 'stability goal', target: 'green', actual: null },
    ],
    forecastSignals:  null,
    latestQuotaHosts: null,
  },
  { threshold: DEFAULT_RECURRENCE_THRESHOLD, now: FIXED_NOW },
);

ok('C.view.frozen',              Object.isFrozen(view));
ok('C.view.recurrence.frozen',   Object.isFrozen(view.recurrence));
ok('C.view.outcomeReport.frozen', Object.isFrozen(view.outcomeReport));
ok('C.view.forecast.frozen',     Object.isFrozen(view.forecast));
ok('C.view.timing.frozen',       Object.isFrozen(view.timing));

// Outcome actual must be 'unknown' when no data is provided (constitution §8).
eq('C.outcome.actual.unknown',   view.outcomeReport.outcomes[0]?.actual, 'unknown');

// Timing must be deterministic across two identical calls (criterion 8).
const view2 = weeklyPlanningView(
  {
    businessId:       'BIZ-0099',
    operations:       mixedCaseOps,
    expectedOutcomes: [
      { outcome: 'stability goal', target: 'green', actual: null },
    ],
    forecastSignals:  null,
    latestQuotaHosts: null,
  },
  { threshold: DEFAULT_RECURRENCE_THRESHOLD, now: FIXED_NOW },
);
eq('C.timing.deterministic',     view.timing.recommendation,  view2.timing.recommendation);
eq('C.timing.capturedAt',        view.timing.capturedAt,      view2.timing.capturedAt);

// ------------------------------------------------------------------
// Gap D: empty operations → zero candidates (criterion: empty/edge)
// ------------------------------------------------------------------

console.log('\nGap D — empty operations array');

const emptyView = weeklyPlanningView(
  { businessId: 'BIZ-0099', operations: [], expectedOutcomes: [] },
  { now: FIXED_NOW },
);
eq('D.recurrence.groups',     emptyView.recurrence.groups.length,             0);
eq('D.recurrence.candidates', emptyView.recurrence.promotionCandidates.length, 0);

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------

console.log('\n--- Inline gap assertions done ---\n');

const totalFailures = spawnFailures + inlineFailures;

if (totalFailures === 0) {
  console.log('A5 investment-forecast + operation-recurrence suite: PASS\n');
} else {
  console.error(
    `A5 suite: FAIL — ${spawnFailures} selftest failure(s), ${inlineFailures} inline failure(s)\n`,
  );
}

process.exit(totalFailures === 0 ? 0 : 1);
