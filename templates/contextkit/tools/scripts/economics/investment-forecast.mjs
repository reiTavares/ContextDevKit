/**
 * Investment-forecast adapter — BIZ-0001 / WF-0036 Wave A5 (A5-T1).
 *
 * Thin composition adapter: wires raw data arrays from the six upstream
 * sources into buildForecast + quotaTimingRecommendation (core logic in
 * investment-forecast-core.mjs). This file owns the data-loading seam ONLY —
 * no computation here beyond null-guarding empty arrays.
 *
 * Upstream sources composed (reuse-not-fork mandate):
 *   - routing/routing-telemetry.mjs   → routingTelemetrySummary
 *   - economy/economy-savings.mjs     → savingsSummary
 *   - economics/quota-snapshots.mjs   → quotaSummary
 *   - economics/budgets.mjs           → evaluateBudget
 *   - economics/routing-economics.mjs → routingSummary
 *   - economics/session-pressure.mjs  → deriveSignals, pressureScore
 *
 * Re-exports the full core surface so callers need only one import path.
 *
 * DETERMINISTIC: no Date.now(), no Math.random(), no new Date(). All clock
 * context is injected via opts.now and forwarded to core unchanged.
 * Zero runtime dependencies — node:* or relative imports only.
 *
 * @module investment-forecast
 */

import { routingTelemetrySummary }      from '../routing/routing-telemetry.mjs';
import { savingsSummary }               from '../economy/economy-savings.mjs';
import { quotaSummary }                 from './quota-snapshots.mjs';
import { evaluateBudget }               from './budgets.mjs';
import { routingSummary }               from './routing-economics.mjs';
import { deriveSignals, pressureScore } from './session-pressure.mjs';
import {
  buildForecast,
  quotaTimingRecommendation,
  FORECAST_SCHEMA_VERSION,
  QUOTA_TIMING_VALUES,
  QUOTA_LOW_THRESHOLD,
  skipped,
} from './investment-forecast-core.mjs';

// Re-export the full core surface.
export {
  buildForecast,
  quotaTimingRecommendation,
  FORECAST_SCHEMA_VERSION,
  QUOTA_TIMING_VALUES,
  QUOTA_LOW_THRESHOLD,
};

// ---------------------------------------------------------------------------
// forecastFromRaw
// ---------------------------------------------------------------------------

/**
 * High-level convenience: builds a full forecast + timing recommendation from
 * raw data arrays. Does NOT touch the filesystem — callers supply pre-read
 * arrays (e.g. from readDecisions, readSavingsSync, readSnapshots).
 *
 * Null-guard rule: callers must NOT pass a zeroed-out summary from an empty
 * aggregator as if it were real data. This function enforces that contract by
 * passing null to buildForecast whenever the source array is empty, because a
 * total=0 from an empty decisions array is NOT a measured observation.
 *
 * @param {{
 *   decisions?:      object[],
 *   savingsRecords?: object[],
 *   snapshots?:      object[],
 *   budgetConfig?:   { spend?: object, budget?: object, context?: object }|null,
 *   byModel?:        Record<string, object>,
 *   sessionRow?:     object|null,
 * }} raw - Pre-loaded raw arrays from upstream data sources.
 * @param {{ now?: number }} [opts] - Injected wall-clock epoch ms (forwarded to timing).
 * @returns {Readonly<{ forecast: Readonly<object>, timing: Readonly<object> }>}
 */
export function forecastFromRaw(raw = {}, opts = {}) {
  const {
    decisions      = [],
    savingsRecords = [],
    snapshots      = [],
    budgetConfig   = null,
    byModel        = {},
    sessionRow     = null,
  } = raw;

  // Null-guard: empty arrays must not produce zeroed summaries that look real.
  const telemetrySummary  = decisions.length            > 0
    ? routingTelemetrySummary(decisions)
    : null;

  const savingsSummaryObj = savingsRecords.length        > 0
    ? savingsSummary(savingsRecords)
    : null;

  // quotaSummary returns skipped() for empty/non-array input — no null-guard needed.
  const quotaSummaryObj   = quotaSummary(snapshots);

  const routingSummaryObj = Object.keys(byModel).length > 0
    ? routingSummary({ byModel })
    : null;

  // Budget: only evaluate when a well-formed config is provided.
  const budgetAdvisory = (budgetConfig?.spend && budgetConfig?.budget)
    ? evaluateBudget(budgetConfig.spend, budgetConfig.budget, budgetConfig.context ?? {})
    : skipped('no budget config provided');

  // Session pressure.
  const signals       = deriveSignals(sessionRow);
  const pressureResult = pressureScore(signals);

  const forecast = buildForecast({
    telemetrySummary,
    savingsSummaryObj,
    quotaSummaryObj,
    budgetAdvisory,
    routingSummaryObj,
    pressureResult,
  });

  // Extract latest-per-host array for the timing recommendation.
  const latestQuotaHosts =
    (quotaSummaryObj && quotaSummaryObj.status !== 'skipped')
      ? quotaSummaryObj.latest
      : null;

  const timing = quotaTimingRecommendation(forecast, latestQuotaHosts, opts);

  return Object.freeze({ forecast, timing });
}
