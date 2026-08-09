#!/usr/bin/env node
/**
 * Self-test for operation-recurrence.mjs — BIZ-0001 / WF-0036 Wave A5 (A5-T2).
 *
 * Asserts BOTH hard acceptance criteria:
 *   (a) RECURRENCE-DETERMINISTIC: same operation inputs twice → identical recommendation.
 *   (b) OUTCOME-THREE-WAY: compareOutcome / buildOutcomeReport produces expected/forecast/actual
 *       three-way object, with actual = 'unknown' when no actual data is supplied.
 *
 * Run via:
 *   node templates/contextkit/tools/scripts/operation-recurrence.selftest.mjs
 *
 * Exit code 0 = all pass; non-zero = at least one failure.
 */

import {
  detectRecurrence,
  compareOutcome,
  buildOutcomeReport,
  weeklyPlanningView,
  RECURRENCE_SCHEMA_VERSION,
  DEFAULT_RECURRENCE_THRESHOLD,
} from './operation-recurrence.mjs';

// Minimal assertion helpers — no test-framework dependency.
let failures = 0;

/**
 * Strict equality assertion.
 * @param {string} label
 * @param {unknown} actual
 * @param {unknown} expected
 */
function eq(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL [${label}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failures++;
  }
}

/**
 * Truthiness assertion.
 * @param {string} label
 * @param {unknown} value
 */
function ok(label, value) {
  if (!value) {
    console.error(`FAIL [${label}]: expected truthy, got ${JSON.stringify(value)}`);
    failures++;
  }
}

// Shared fixtures
const FIXED_NOW = 1718100000000;

const OPS = [
  { id: 'OP-0001', contextId: 'BIZ-0001', kind: 'MAINTENANCE' },
  { id: 'OP-0002', contextId: 'BIZ-0001', kind: 'MAINTENANCE' },
  { id: 'OP-0003', contextId: 'BIZ-0001', kind: 'MAINTENANCE' },
  { id: 'OP-0004', contextId: 'BIZ-0001', kind: 'IMPROVEMENT' },
  { id: 'OP-0005', contextId: 'BIZ-0002', kind: 'MAINTENANCE' },
];

// Test A — RECURRENCE-DETERMINISTIC (acceptance criterion a)
console.log('--- Test A: recurrence-deterministic ---');

const result1 = detectRecurrence(OPS, { threshold: DEFAULT_RECURRENCE_THRESHOLD });
const result2 = detectRecurrence(OPS, { threshold: DEFAULT_RECURRENCE_THRESHOLD });

eq('A.schemaVersion', result1.schemaVersion, RECURRENCE_SCHEMA_VERSION);
eq('A.groups.length', result1.groups.length, result2.groups.length);

for (let i = 0; i < result1.groups.length; i++) {
  eq(`A.groups[${i}].recommendation`, result1.groups[i].recommendation, result2.groups[i].recommendation);
  eq(`A.groups[${i}].count`, result1.groups[i].count, result2.groups[i].count);
}
eq('A.promotionCandidates.length',
  result1.promotionCandidates.length,
  result2.promotionCandidates.length);
const biz1Maint = result1.groups.find((g) => g.contextId === 'BIZ-0001' && g.kind.toUpperCase() === 'MAINTENANCE');
ok('A.biz1Maint.found', biz1Maint);
eq('A.biz1Maint.recommendation', biz1Maint?.recommendation, 'promote-to-business');
eq('A.biz1Maint.count', biz1Maint?.count, 3);
const biz1Impr = result1.groups.find((g) => g.contextId === 'BIZ-0001' && g.kind.toUpperCase() === 'IMPROVEMENT');
ok('A.biz1Impr.found', biz1Impr);
eq('A.biz1Impr.recommendation', biz1Impr?.recommendation, 'no-action');
const biz2Maint = result1.groups.find((g) => g.contextId === 'BIZ-0002' && g.kind.toUpperCase() === 'MAINTENANCE');
ok('A.biz2Maint.found', biz2Maint);
eq('A.biz2Maint.recommendation', biz2Maint?.recommendation, 'no-action');
eq('A.promotionCandidates.length.value', result1.promotionCandidates.length, 1);
eq('A.promotionCandidate.contextId', result1.promotionCandidates[0]?.contextId, 'BIZ-0001');
const lowThresh = detectRecurrence(OPS, { threshold: 2 });
const lbiz1Maint = lowThresh.groups.find((g) => g.contextId === 'BIZ-0001' && g.kind.toUpperCase() === 'MAINTENANCE');
eq('A.lowThresh.biz1Maint.recommendation', lbiz1Maint?.recommendation, 'promote-to-business');

console.log('--- Test A done ---\n');

// Test B — OUTCOME-THREE-WAY with actual = 'unknown' (acceptance criterion b)
console.log('--- Test B: outcome-three-way, actual unknown ---');

const noActualOutcome = compareOutcome({
  label: 'NL requests classified',
  expected: 'working-classifier+fixtures',
  forecast: 'unknown',
  now: FIXED_NOW,
});

eq('B.schemaVersion', noActualOutcome.schemaVersion, RECURRENCE_SCHEMA_VERSION);
eq('B.label',    noActualOutcome.label,    'NL requests classified');
eq('B.expected', noActualOutcome.expected, 'working-classifier+fixtures');
eq('B.forecast', noActualOutcome.forecast, 'unknown');
eq('B.actual',   noActualOutcome.actual,   'unknown');  // MUST be 'unknown'
eq('B.delta',    noActualOutcome.delta,    'unknown');  // can't derive delta without actual
eq('B.capturedAt', noActualOutcome.capturedAt, FIXED_NOW);
const nullActualOutcome = compareOutcome({
  label: 'WF/ADR resolution',
  expected: '100%',
  forecast: 'n/a',
  actual: null,
});
eq('B.nullActual', nullActualOutcome.actual, 'unknown');

console.log('--- Test B done ---\n');

// Test C — OUTCOME-THREE-WAY with real actual present
console.log('--- Test C: outcome-three-way, actual present ---');

const metOutcome = compareOutcome({
  label: 'updater regressions',
  expected: 0,
  forecast: 'unknown',
  actual: 0,
  evidence: 'CI suite green',
  now: FIXED_NOW,
});
eq('C.actual', metOutcome.actual, 0);
eq('C.expected', metOutcome.expected, 0);
eq('C.delta', metOutcome.delta, 'met');
eq('C.evidence', metOutcome.evidence, 'CI suite green');
const exceededOutcome = compareOutcome({
  label: 'routing decisions',
  expected: 5,
  forecast: 'unknown',
  actual: 8,
  now: FIXED_NOW,
});
eq('C.exceeded.delta', exceededOutcome.delta, 'exceeded');
const missedOutcome = compareOutcome({
  label: 'routing decisions',
  expected: 10,
  forecast: 'unknown',
  actual: 4,
  now: FIXED_NOW,
});
eq('C.missed.delta', missedOutcome.delta, 'missed');

console.log('--- Test C done ---\n');

// Test D — buildOutcomeReport three-way batch
console.log('--- Test D: buildOutcomeReport ---');

const report = buildOutcomeReport({
  businessId: 'BIZ-0001',
  expectedOutcomes: [
    { outcome: 'NL classifier', target: 'working', forecast: null, actual: null },
    { outcome: 'ADR coverage', target: '100%', forecast: 'n/a', actual: '100%' },
    { outcome: 'WF resolution', target: '100%', forecast: 'n/a', actual: '100%' },
  ],
  now: FIXED_NOW,
});
eq('D.schemaVersion', report.schemaVersion, RECURRENCE_SCHEMA_VERSION);
eq('D.businessId', report.businessId, 'BIZ-0001');
eq('D.outcomes.length', report.outcomes.length, 3);
eq('D.outcomes[0].actual', report.outcomes[0].actual, 'unknown');
eq('D.outcomes[0].delta', report.outcomes[0].delta, 'unknown');
eq('D.outcomes[1].actual', report.outcomes[1].actual, '100%');
eq('D.outcomes[1].delta', report.outcomes[1].delta, 'met');
eq('D.summary.total', report.summary.total, 3);
eq('D.summary.unknown', report.summary.unknown, 1);
eq('D.summary.met', report.summary.met, 2);

console.log('--- Test D done ---\n');

// Test E — weeklyPlanningView integration (both acceptance criteria together)
console.log('--- Test E: weeklyPlanningView integration ---');

const view1 = weeklyPlanningView({
  businessId: 'BIZ-0001',
  operations: OPS,
  expectedOutcomes: [
    { outcome: 'NL classifier', target: 'working', actual: null },
    { outcome: 'ADR coverage', target: '100%', actual: '100%' },
  ],
  forecastSignals: null,
  latestQuotaHosts: null,
}, { threshold: DEFAULT_RECURRENCE_THRESHOLD, now: FIXED_NOW });
const view2 = weeklyPlanningView({
  businessId: 'BIZ-0001',
  operations: OPS,
  expectedOutcomes: [
    { outcome: 'NL classifier', target: 'working', actual: null },
    { outcome: 'ADR coverage', target: '100%', actual: '100%' },
  ],
  forecastSignals: null,
  latestQuotaHosts: null,
}, { threshold: DEFAULT_RECURRENCE_THRESHOLD, now: FIXED_NOW });
eq('E.determinism.rec', view1.recurrence.promotionCandidates.length, view2.recurrence.promotionCandidates.length);
eq('E.determinism.timing', view1.timing.recommendation, view2.timing.recommendation);
eq('E.three-way.actual_missing', view1.outcomeReport.outcomes[0].actual, 'unknown');
eq('E.three-way.forecast', view1.outcomeReport.outcomes[0].forecast, 'unknown');
eq('E.three-way.actual_present', view1.outcomeReport.outcomes[1].actual, '100%');
eq('E.timing', view1.timing.recommendation, 'unknown');

console.log('--- Test E done ---\n');

// Test F — edge cases: empty operations, missing contextId/kind
console.log('--- Test F: edge cases ---');

const emptyResult = detectRecurrence([]);
eq('F.empty.groups', emptyResult.groups.length, 0);
eq('F.empty.promotion', emptyResult.promotionCandidates.length, 0);
const badOps = detectRecurrence([null, { id: 'OP-X' }, { id: 'OP-Y', contextId: null, kind: 'FOO' }]);
eq('F.bad.groups', badOps.groups.length, 0);
const undef = compareOutcome({ label: 'test', expected: '10', forecast: '8' });
eq('F.undef.actual', undef.actual, 'unknown');

console.log('--- Test F done ---\n');

if (failures === 0) {
  console.log('operation-recurrence.selftest.mjs: PASS (all assertions green)');
  process.exit(0);
} else {
  console.error(`operation-recurrence.selftest.mjs: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}
