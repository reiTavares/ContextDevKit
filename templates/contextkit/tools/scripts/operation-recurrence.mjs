/**
 * Operation recurrence + outcome weekly planning interface — BIZ-0001 / WF-0036 Wave A5 (A5-T2).
 *
 * Thin composition adapter: wires the core recurrence/outcome logic (operation-recurrence-core.mjs)
 * with the investment-forecast adapter (economics/investment-forecast.mjs, A5-T1) to expose
 * a single `weeklyPlanningView` surface for other tooling to call.
 *
 * This file owns the COMPOSITION SEAM only — no domain logic here. All computation
 * lives in the imported core modules.
 *
 * Re-exports the full core surface so callers need only one import path.
 *
 * DETERMINISTIC: no Date.now(), no Math.random(), no new Date(). All clock
 * context is injected via opts.now and forwarded unchanged.
 * Zero runtime dependencies — node:* or relative imports only.
 *
 * @module operation-recurrence
 */

import {
  detectRecurrence,
  compareOutcome,
  buildOutcomeReport,
  RECURRENCE_SCHEMA_VERSION,
  DEFAULT_RECURRENCE_THRESHOLD,
  PROMOTION_RECOMMENDATIONS,
} from './operation-recurrence-core.mjs';

import {
  buildForecast,
  quotaTimingRecommendation,
} from './economics/investment-forecast.mjs';

// Re-export the full core surface.
export {
  detectRecurrence,
  compareOutcome,
  buildOutcomeReport,
  RECURRENCE_SCHEMA_VERSION,
  DEFAULT_RECURRENCE_THRESHOLD,
  PROMOTION_RECOMMENDATIONS,
};

// ---------------------------------------------------------------------------
// weeklyPlanningView
// ---------------------------------------------------------------------------

/**
 * Produces the combined weekly planning view: recurrence detection + outcome
 * comparison + quota-aware investment timing. Deterministic — every time-
 * sensitive value must come from `opts.now`.
 *
 * Callers supply:
 *   - `operations`: array of operation summaries (id, contextId, kind, status).
 *   - `expectedOutcomes`: from business.json / business-outcome.json.
 *   - `forecastSignals` (optional): same shape as `buildForecast`'s argument
 *     (telemetrySummary, savingsSummaryObj, …). Absent → all forecast = 'unknown'.
 *   - `latestQuotaHosts` (optional): quota host rows (from quotaSummary().latest).
 *   - `opts.threshold` (optional): recurrence threshold override.
 *   - `opts.now` (optional): injected epoch ms for capturedAt fields.
 *
 * Returns a frozen object with:
 *   - `recurrence` — output of `detectRecurrence`.
 *   - `outcomeReport` — output of `buildOutcomeReport` (three-way compare).
 *   - `forecast` — investment forecast (from A5-T1 core).
 *   - `timing` — quota timing recommendation (from A5-T1 core).
 *
 * @param {{
 *   businessId:       string,
 *   operations?:      object[],
 *   expectedOutcomes?: Array<{ outcome: string, forecast?: unknown, actual?: unknown }>,
 *   forecastSignals?:  object | null,
 *   latestQuotaHosts?: object[] | null,
 * }} params
 * @param {{ threshold?: number, now?: number }} [opts]
 * @returns {Readonly<{
 *   recurrence:    Readonly<object>,
 *   outcomeReport: Readonly<object>,
 *   forecast:      Readonly<object>,
 *   timing:        Readonly<object>,
 * }>}
 */
export function weeklyPlanningView(params = {}, opts = {}) {
  const {
    businessId        = 'unknown',
    operations        = [],
    expectedOutcomes  = [],
    forecastSignals   = null,
    latestQuotaHosts  = null,
  } = params;

  const recurrenceOpts = {
    threshold: (typeof opts.threshold === 'number' && opts.threshold > 0)
      ? opts.threshold
      : DEFAULT_RECURRENCE_THRESHOLD,
  };

  const recurrence   = detectRecurrence(operations, recurrenceOpts);
  const forecast     = buildForecast(forecastSignals ?? {});
  const timing       = quotaTimingRecommendation(forecast, latestQuotaHosts, { now: opts.now });

  const outcomeReport = buildOutcomeReport({
    businessId,
    expectedOutcomes,
    forecastObj: forecast,
    now: opts.now,
  });

  return Object.freeze({ recurrence, outcomeReport, forecast, timing });
}
