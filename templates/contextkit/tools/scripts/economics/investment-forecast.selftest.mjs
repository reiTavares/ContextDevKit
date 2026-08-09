#!/usr/bin/env node
/**
 * Self-test for investment-forecast.mjs — BIZ-0001 / WF-0036 Wave A5 (A5-T1).
 *
 * Asserts both hard acceptance criteria:
 *   (a) No-data input → every forecast field (except schemaVersion/confidence)
 *       reports 'unknown'; confidence itself is 'unknown'. (forecast-unknown-when-no-data)
 *   (b) Same inputs twice → identical quota timing recommendation.
 *       (quota-deterministic)
 *
 * Run via: node templates/contextkit/tools/scripts/economics/investment-forecast.selftest.mjs
 * Exit code 0 = all pass; non-zero = at least one failure.
 */

import { buildForecast, quotaTimingRecommendation, forecastFromRaw, FORECAST_SCHEMA_VERSION }
  from './investment-forecast.mjs';
// buildForecast + quotaTimingRecommendation are re-exported by investment-forecast.mjs
// from investment-forecast-core.mjs — no direct core import needed in the test.

// ---------------------------------------------------------------------------
// Minimal assertion helpers — no test-framework dependency.
// ---------------------------------------------------------------------------

let failures = 0;

/**
 * Asserts strict equality.
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
 * Asserts that every leaf value in a (possibly nested) object equals 'unknown',
 * skipping the listed skipKeys at the top level.
 * @param {string} label
 * @param {object} obj
 * @param {string[]} skipKeys
 */
function allUnknown(label, obj, skipKeys = []) {
  const check = (node, path) => {
    if (node !== null && typeof node === 'object') {
      for (const [key, val] of Object.entries(node)) {
        check(val, path ? `${path}.${key}` : key);
      }
    } else {
      if (node !== 'unknown') {
        console.error(`FAIL [${label}]: ${path} is ${JSON.stringify(node)}, expected 'unknown'`);
        failures++;
      }
    }
  };
  for (const [key, val] of Object.entries(obj)) {
    if (!skipKeys.includes(key)) check(val, key);
  }
}

// ---------------------------------------------------------------------------
// Test A — forecast-unknown-when-no-data
// ---------------------------------------------------------------------------
//
// Supplying empty / null signals: no decisions, no savings, no snapshots,
// no budget, no routing model data, no session row.
// Expected: every forecast leaf (except schemaVersion, confidence) = 'unknown'.
// Expected confidence = 'unknown'.
// ---------------------------------------------------------------------------

console.log('--- Test A: forecast-unknown-when-no-data ---');

const emptyForecast = buildForecast({});

eq('A.schemaVersion', emptyForecast.schemaVersion, FORECAST_SCHEMA_VERSION);
eq('A.confidence',    emptyForecast.confidence,    'unknown');

// All domain leaf fields must be 'unknown'.
allUnknown('A.routing',  emptyForecast.routing,  []);
allUnknown('A.savings',  emptyForecast.savings,  []);
allUnknown('A.quota',    emptyForecast.quota,    []);
allUnknown('A.budget',   emptyForecast.budget,   []);
allUnknown('A.models',   emptyForecast.models,   []);
allUnknown('A.pressure', emptyForecast.pressure, []);

// Also test via forecastFromRaw with empty arrays.
const { forecast: emptyViaRaw } = forecastFromRaw({});
eq('A2.confidence', emptyViaRaw.confidence, 'unknown');
allUnknown('A2.routing',  emptyViaRaw.routing,  []);
allUnknown('A2.savings',  emptyViaRaw.savings,  []);
allUnknown('A2.quota',    emptyViaRaw.quota,    []);
allUnknown('A2.budget',   emptyViaRaw.budget,   []);
allUnknown('A2.models',   emptyViaRaw.models,   []);
allUnknown('A2.pressure', emptyViaRaw.pressure, []);

// quota recommendation with no hosts → 'unknown'.
const noHostRec = quotaTimingRecommendation(emptyForecast, null, { now: 1000 });
eq('A3.recommendation', noHostRec.recommendation, 'unknown');
eq('A3.confidence',     noHostRec.confidence,     'unknown');
eq('A3.capturedAt',     noHostRec.capturedAt,      1000);

console.log('--- Test A done ---\n');

// ---------------------------------------------------------------------------
// Test B — quota-deterministic: same inputs → same output
// ---------------------------------------------------------------------------
//
// Run quotaTimingRecommendation twice with identical arguments. Every field in
// the result must be the same. Note: opts.now is INJECTED so there is no
// internal wall-clock call to produce divergence.
// ---------------------------------------------------------------------------

console.log('--- Test B: quota-deterministic ---');

const stableForecast = buildForecast({
  telemetrySummary: { total: 10, netBenefitUnits: 2, fableAutoSelected: 0 },
  savingsSummaryObj: { totalSaved: 100, entries: 3, sessions: 1 },
  // No quota, budget, routing model, pressure — intentionally partial.
});

const stableHosts = [
  { host: 'claude-code', remainingPct: 55, usedPct: 45, captureMethod: 'manual', confidence: 'inferred' },
];

const FIXED_NOW = 1718000000000; // deterministic epoch

const rec1 = quotaTimingRecommendation(stableForecast, stableHosts, { now: FIXED_NOW });
const rec2 = quotaTimingRecommendation(stableForecast, stableHosts, { now: FIXED_NOW });

eq('B.recommendation', rec1.recommendation, rec2.recommendation);
eq('B.confidence',     rec1.confidence,     rec2.confidence);
eq('B.capturedAt',     rec1.capturedAt,     rec2.capturedAt);
eq('B.reasons.length', rec1.reasons.length, rec2.reasons.length);
for (let i = 0; i < rec1.reasons.length; i++) {
  eq(`B.reasons[${i}]`, rec1.reasons[i], rec2.reasons[i]);
}
eq('B.schemaVersion',  rec1.schemaVersion,  rec2.schemaVersion);

// Also confirm the recommendation value is one of the known valid ones.
const VALID = ['invest-now', 'defer-quota-low', 'split-pressure', 'observe', 'unknown'];
if (!VALID.includes(rec1.recommendation)) {
  console.error(`FAIL [B.valid]: recommendation '${rec1.recommendation}' not in QUOTA_TIMING_VALUES`);
  failures++;
}

console.log('--- Test B done ---\n');

// ---------------------------------------------------------------------------
// Test C — invest-now path (positive data, healthy quota)
// ---------------------------------------------------------------------------

console.log('--- Test C: invest-now path ---');

const healthyForecast = buildForecast({
  telemetrySummary:  { total: 5, netBenefitUnits: 3, fableAutoSelected: 0 },
  savingsSummaryObj: { totalSaved: 200, entries: 5, sessions: 2 },
  quotaSummaryObj:   { status: undefined, hosts: 1, latest: [{ host: 'anthropic', remainingPct: 80 }] },
  budgetAdvisory:    { status: undefined, mode: 'observe', ratio: 0.3 },
});

const healthyHosts = [{ host: 'anthropic', remainingPct: 80, captureMethod: 'manual' }];
const rec3 = quotaTimingRecommendation(healthyForecast, healthyHosts, { now: FIXED_NOW });
eq('C.recommendation', rec3.recommendation, 'invest-now');
eq('C.confidence',     rec3.confidence,     'derived');

console.log('--- Test C done ---\n');

// ---------------------------------------------------------------------------
// Test D — defer-quota-low path (quota below threshold)
// ---------------------------------------------------------------------------

console.log('--- Test D: defer-quota-low path ---');

const lowForecast = buildForecast({
  quotaSummaryObj: { hosts: 1, latest: [{ host: 'anthropic', remainingPct: 10 }] },
});
const lowHosts = [{ host: 'anthropic', remainingPct: 10, captureMethod: 'manual' }];
const rec4 = quotaTimingRecommendation(lowForecast, lowHosts, { now: FIXED_NOW });
eq('D.recommendation', rec4.recommendation, 'defer-quota-low');

console.log('--- Test D done ---\n');

// ---------------------------------------------------------------------------
// Test E — split-pressure path
// ---------------------------------------------------------------------------

console.log('--- Test E: split-pressure path ---');

const highPressureForecast = buildForecast({
  pressureResult: { band: 'critical', status: undefined, score: 80 },
});
const rec5 = quotaTimingRecommendation(highPressureForecast, healthyHosts, { now: FIXED_NOW });
eq('E.recommendation', rec5.recommendation, 'split-pressure');

console.log('--- Test E done ---\n');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

if (failures === 0) {
  console.log('investment-forecast.selftest.mjs: PASS (all assertions green)');
  process.exit(0);
} else {
  console.error(`investment-forecast.selftest.mjs: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}
