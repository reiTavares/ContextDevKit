/**
 * Investment-forecast core — BIZ-0001 / WF-0036 Wave A5 (A5-T1).
 *
 * Pure computation layer: constants, helpers, buildForecast, and
 * quotaTimingRecommendation. No filesystem access, no module-level
 * side effects. Consumed by investment-forecast.mjs (the composition adapter
 * that wires raw data arrays in) and by the selftest.
 *
 * Constitution §8 (refuse-by-default):
 *   - Every forecast field that cannot be derived from REAL data is 'unknown'.
 *   - No invented numbers, no "$0" fallback, no assumed pass.
 *   - quotaTimingRecommendation is fully deterministic: same inputs → same
 *     output. Wall-clock context is injected by the caller via opts.now and
 *     stored for traceability only — it is NOT part of the decision logic.
 *
 * DETERMINISTIC: no Date.now(), no Math.random(), no new Date() anywhere here.
 * Zero runtime dependencies — relative imports only.
 *
 * Cohesion note (constitution §1 +10% allowance rationale):
 *   buildForecast and quotaTimingRecommendation share QUOTA_LOW_THRESHOLD,
 *   SPLIT_BANDS, orUnknown, and isFiniteNum. Splitting them would force
 *   cross-file imports for four identifiers, creating premature abstraction.
 *   These two functions are the single coherent responsibility of this file.
 *
 * @module investment-forecast-core
 */

import { skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for forecast result objects. */
export const FORECAST_SCHEMA_VERSION = 'cdk-investment-forecast/1';

/**
 * Valid quota timing recommendations. 'unknown' means insufficient data.
 * @type {Readonly<string[]>}
 */
export const QUOTA_TIMING_VALUES = Object.freeze([
  'invest-now',       // quota comfortable, routing healthy
  'defer-quota-low',  // one or more hosts at < QUOTA_LOW_THRESHOLD
  'split-pressure',   // session pressure is hot/critical → fan-out
  'observe',          // no blocking signal but data sparse; watch before investing
  'unknown',          // insufficient quota data to recommend
]);

/** Remaining-quota % below which we recommend deferral. Policy value; ADR-gated to change. */
export const QUOTA_LOW_THRESHOLD = 20;

/** Pressure bands that trigger a split recommendation (hot or critical). */
const SPLIT_BANDS = new Set(['hot', 'critical']);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns 'unknown' string for any absent, null, NaN, or empty-string value;
 * otherwise returns the value unchanged. Ensures every forecast slot is
 * explicit — never null/undefined (which could be confused with "not applicable").
 *
 * @param {unknown} value
 * @returns {unknown | 'unknown'}
 */
function orUnknown(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    return 'unknown';
  }
  return value;
}

/**
 * Returns true only when v is a finite number (not NaN, not ±Infinity).
 * @param {unknown} v
 * @returns {boolean}
 */
function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// buildForecast
// ---------------------------------------------------------------------------

/**
 * Builds a frozen investment forecast from pre-computed signal summaries.
 *
 * Acceptance contract:
 *   - When ALL signals are absent or null, EVERY forecast field reports 'unknown'
 *     and confidence is 'unknown'. No number is ever invented.
 *   - Callers must pass null (not a zeroed summary) when no source data exists.
 *     A zero from an empty aggregator is "no data", not a real observation.
 *   - Confidence is 'inferred' as soon as at least one real signal is present.
 *
 * @param {{
 *   telemetrySummary?:  object|null,
 *   savingsSummaryObj?: object|null,
 *   quotaSummaryObj?:   object|null,
 *   budgetAdvisory?:    object|null,
 *   routingSummaryObj?: object|null,
 *   pressureResult?:    object|null,
 * }} signals - Pre-computed summaries from the composing modules.
 * @returns {Readonly<object>} Frozen forecast object.
 */
export function buildForecast(signals = {}) {
  const {
    telemetrySummary  = null,
    savingsSummaryObj = null,
    quotaSummaryObj   = null,
    budgetAdvisory    = null,
    routingSummaryObj = null,
    pressureResult    = null,
  } = signals;

  // Routing telemetry.
  const routingDecisions = orUnknown(
    isFiniteNum(telemetrySummary?.total) ? telemetrySummary.total : null
  );
  const netBenefit = orUnknown(
    isFiniteNum(telemetrySummary?.netBenefitUnits) ? telemetrySummary.netBenefitUnits : null
  );
  const fableAutoSelected = orUnknown(
    isFiniteNum(telemetrySummary?.fableAutoSelected) ? telemetrySummary.fableAutoSelected : null
  );

  // Economy savings. Guard entries > 0: totalSaved=0 with entries=0 is "no data".
  const totalSavedTokens = orUnknown(
    (savingsSummaryObj && isFiniteNum(savingsSummaryObj.totalSaved) && savingsSummaryObj.entries > 0)
      ? savingsSummaryObj.totalSaved
      : null
  );
  const savingsEntries = orUnknown(
    (savingsSummaryObj && isFiniteNum(savingsSummaryObj.entries) && savingsSummaryObj.entries > 0)
      ? savingsSummaryObj.entries
      : null
  );

  // Quota.
  const quotaHostCount = orUnknown(
    (quotaSummaryObj && quotaSummaryObj.status !== 'skipped' && isFiniteNum(quotaSummaryObj.hosts))
      ? quotaSummaryObj.hosts
      : null
  );

  // Budget.
  const budgetMode = orUnknown(
    (budgetAdvisory && budgetAdvisory.status !== 'skipped') ? budgetAdvisory.mode : null
  );
  const budgetRatio = orUnknown(
    (budgetAdvisory && budgetAdvisory.status !== 'skipped' && isFiniteNum(budgetAdvisory.ratio))
      ? budgetAdvisory.ratio
      : null
  );

  // Routing model coverage.
  const premiumModelCount = orUnknown(
    (routingSummaryObj && routingSummaryObj.status !== 'skipped' &&
      isFiniteNum(routingSummaryObj.models))
      ? routingSummaryObj.models
      : null
  );

  // Session pressure.
  const pressureBand = orUnknown(
    (pressureResult && pressureResult.status !== 'skipped') ? pressureResult.band : null
  );

  // Confidence: 'unknown' when no signal has real data; 'inferred' once any arrives.
  const hasAnySig =
    routingDecisions !== 'unknown' ||
    totalSavedTokens !== 'unknown' ||
    quotaHostCount   !== 'unknown' ||
    budgetMode       !== 'unknown';

  const confidence = hasAnySig ? 'inferred' : 'unknown';

  return Object.freeze({
    schemaVersion: FORECAST_SCHEMA_VERSION,
    confidence,
    routing:  Object.freeze({ decisions: routingDecisions, netBenefitUnits: netBenefit, fableAutoSelected }),
    savings:  Object.freeze({ totalSavedTokens, entries: savingsEntries }),
    quota:    Object.freeze({ hosts: quotaHostCount }),
    budget:   Object.freeze({ mode: budgetMode, ratio: budgetRatio }),
    models:   Object.freeze({ premiumCount: premiumModelCount }),
    pressure: Object.freeze({ band: pressureBand }),
  });
}

// ---------------------------------------------------------------------------
// quotaTimingRecommendation
// ---------------------------------------------------------------------------

/**
 * Emits a quota-aware timing recommendation from a forecast + quota host list.
 *
 * Determinism contract: same inputs → same output, always.
 * No Date.now(), Math.random(), or new Date() used internally.
 * opts.now is stored in capturedAt for caller traceability only —
 * it does NOT influence the decision logic.
 *
 * Decision tree (evaluated in strict priority order):
 *   1. Pressure band hot|critical → 'split-pressure'.
 *   2. No quota hosts → 'unknown'.
 *   3. Any host remainingPct < QUOTA_LOW_THRESHOLD → 'defer-quota-low'.
 *   4. Budget mode block|downgrade → 'defer-quota-low'.
 *   5. All hosts comfortable + routing net-benefit ≥ 0 → 'invest-now'.
 *   6. All hosts comfortable + routing unknown → 'observe'.
 *   7. Any host remainingPct unobservable → 'observe'.
 *
 * @param {ReturnType<typeof buildForecast>} forecast - Output of buildForecast().
 * @param {object[]|null|undefined} latestQuotaHosts - Latest-per-host quota records
 *   (e.g. from quotaSummary().latest). Null/empty → recommendation 'unknown'.
 * @param {{ now?: number }} [opts] - Caller-injected epoch ms (traceability only).
 * @returns {Readonly<{
 *   schemaVersion: string,
 *   recommendation: string,
 *   reasons: string[],
 *   confidence: 'derived'|'inferred'|'unknown',
 *   capturedAt: number|null,
 * }>}
 */
export function quotaTimingRecommendation(forecast, latestQuotaHosts, opts = {}) {
  const reasons    = [];
  const capturedAt = isFiniteNum(opts?.now) ? opts.now : null;

  // Step 1: pressure.
  const pBand = forecast?.pressure?.band;
  if (typeof pBand === 'string' && SPLIT_BANDS.has(pBand)) {
    reasons.push(`session pressure band=${pBand} — recommend fan-out split before new investment`);
    return Object.freeze({ schemaVersion: FORECAST_SCHEMA_VERSION,
      recommendation: 'split-pressure', reasons, confidence: 'derived', capturedAt });
  }

  // Step 2: no quota data.
  const hosts = Array.isArray(latestQuotaHosts) ? latestQuotaHosts : [];
  if (hosts.length === 0) {
    reasons.push('no quota host data available');
    return Object.freeze({ schemaVersion: FORECAST_SCHEMA_VERSION,
      recommendation: 'unknown', reasons, confidence: 'unknown', capturedAt });
  }

  // Step 3: any host quota low.
  const lowHosts = hosts.filter(h => isFiniteNum(h?.remainingPct) && h.remainingPct < QUOTA_LOW_THRESHOLD);
  if (lowHosts.length > 0) {
    const labels = lowHosts.map(h => `${h.host}=${h.remainingPct}%`).join(', ');
    reasons.push(`quota low on: ${labels} (threshold=${QUOTA_LOW_THRESHOLD}%)`);
    return Object.freeze({ schemaVersion: FORECAST_SCHEMA_VERSION,
      recommendation: 'defer-quota-low', reasons, confidence: 'derived', capturedAt });
  }

  // Step 4: budget block/downgrade.
  const bMode = forecast?.budget?.mode;
  if (bMode === 'block' || bMode === 'downgrade') {
    reasons.push(`budget mode=${bMode} — defer until budget resets`);
    return Object.freeze({ schemaVersion: FORECAST_SCHEMA_VERSION,
      recommendation: 'defer-quota-low', reasons, confidence: 'derived', capturedAt });
  }

  // Step 5-7: comfortable vs unobservable hosts.
  const unknownHosts = hosts.filter(h => !isFiniteNum(h?.remainingPct));
  if (unknownHosts.length > 0) {
    reasons.push(`${unknownHosts.length} quota host(s) have unobservable pct — observe`);
    return Object.freeze({ schemaVersion: FORECAST_SCHEMA_VERSION,
      recommendation: 'observe', reasons, confidence: 'inferred', capturedAt });
  }

  // All hosts comfortable.
  const netB = forecast?.routing?.netBenefitUnits;
  if (netB !== 'unknown' && isFiniteNum(netB) && netB >= 0) {
    reasons.push(`all ${hosts.length} quota host(s) comfortable; routing net-benefit=${netB}`);
    return Object.freeze({ schemaVersion: FORECAST_SCHEMA_VERSION,
      recommendation: 'invest-now', reasons, confidence: 'derived', capturedAt });
  }

  reasons.push('quota comfortable but routing benefit unknown — observe before investing');
  return Object.freeze({ schemaVersion: FORECAST_SCHEMA_VERSION,
    recommendation: 'observe', reasons, confidence: 'inferred', capturedAt });
}

// Satisfy callers who do `import { skipped } from './investment-forecast-core.mjs'` —
// re-export the shared marker so consumers need only one import.
export { skipped };
