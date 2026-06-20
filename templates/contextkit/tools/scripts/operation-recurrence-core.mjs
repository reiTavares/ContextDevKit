/**
 * Operation recurrence detection — BIZ-0001 / WF-0036 Wave A5 (A5-T2).
 *
 * Pure computation layer: detects when an Operation (same context + kind pair)
 * recurs beyond a configurable threshold and emits a deterministic Business-
 * promotion recommendation. Also provides three-way expected/forecast/actual
 * outcome comparison.
 *
 * DETERMINISTIC: no Date.now(), no Math.random(), no new Date() anywhere.
 * Constitution §8: actual is 'unknown' when no evidence provided — never invented.
 * Zero runtime dependencies — pure ES module, node:* only.
 *
 * @module operation-recurrence-core
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Schema version for recurrence/outcome result objects. */
export const RECURRENCE_SCHEMA_VERSION = 'cdk-operation-recurrence/1';

/** Default recurrence threshold: minimum count to trigger a promotion recommendation. */
export const DEFAULT_RECURRENCE_THRESHOLD = 3;

/**
 * Valid promotion recommendation values.
 * @type {Readonly<string[]>}
 */
export const PROMOTION_RECOMMENDATIONS = Object.freeze([
  'promote-to-business',   // recurrence >= threshold → recommend a Business
  'monitor-for-promotion', // approaching threshold but not yet there
  'no-action',             // recurrence below threshold
  'unknown',               // insufficient data to evaluate
]);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns 'unknown' for any absent, null, NaN, or empty string value; otherwise
 * returns the value unchanged. Enforces explicit unknowns (constitution §8).
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
 * Builds a canonical recurrence key from (contextId × kind). Lowercased + trimmed.
 * Returns null when either field is absent.
 *
 * @param {string|null|undefined} contextId
 * @param {string|null|undefined} kind
 * @returns {string|null}
 */
function recurrenceKey(contextId, kind) {
  const ctx = typeof contextId === 'string' ? contextId.trim().toLowerCase() : null;
  const knd = typeof kind === 'string' ? kind.trim().toLowerCase() : null;
  if (!ctx || !knd) return null;
  return `${ctx}::${knd}`;
}

// ---------------------------------------------------------------------------
// detectRecurrence
// ---------------------------------------------------------------------------

/**
 * Detects recurring Operations from an array of operation summaries.
 * Groups by (contextId × kind) and counts occurrences. Same inputs → same output.
 *
 * Operation summary shape: `{ id: string, contextId: string, kind: string }`.
 *
 * @param {object[]} operations - Operation summaries to analyse.
 * @param {{ threshold?: number }} [opts] - min count for promotion recommendation.
 * @returns {Readonly<{ schemaVersion: string, groups: Readonly<object[]>, promotionCandidates: Readonly<object[]> }>}
 */
export function detectRecurrence(operations = [], opts = {}) {
  const threshold = (typeof opts.threshold === 'number' && opts.threshold > 0)
    ? opts.threshold
    : DEFAULT_RECURRENCE_THRESHOLD;

  if (!Array.isArray(operations)) {
    return Object.freeze({
      schemaVersion: RECURRENCE_SCHEMA_VERSION,
      groups: [],
      promotionCandidates: [],
    });
  }

  // Group operations by (contextId × kind) key.
  const buckets = new Map(); // key → { contextId, kind, ids: string[] }
  for (const op of operations) {
    if (!op || typeof op !== 'object') continue;
    const key = recurrenceKey(op.contextId, op.kind);
    if (!key) continue;
    if (!buckets.has(key)) {
      buckets.set(key, {
        contextId: String(op.contextId).trim(),
        kind:      String(op.kind).trim(),
        ids:       [],
      });
    }
    const bucket = buckets.get(key);
    if (typeof op.id === 'string' && op.id.trim()) {
      bucket.ids.push(op.id.trim());
    }
  }

  // Sort keys for deterministic output.
  const sortedKeys = [...buckets.keys()].sort();

  const groups = sortedKeys.map((key) => {
    const { contextId, kind, ids } = buckets.get(key);
    const count = ids.length;
    let recommendation;
    let recommendationReason;

    if (count >= threshold) {
      recommendation = 'promote-to-business';
      recommendationReason =
        `Operation (context=${contextId}, kind=${kind}) recurred ${count} times ` +
        `(threshold=${threshold}) — recommend promoting to a Business for lifecycle governance.`;
    } else if (count >= Math.max(1, threshold - 1)) {
      recommendation = 'monitor-for-promotion';
      recommendationReason =
        `Operation (context=${contextId}, kind=${kind}) recurred ${count} times ` +
        `(threshold=${threshold}) — approaching threshold; monitor.`;
    } else {
      recommendation = 'no-action';
      recommendationReason =
        `Operation (context=${contextId}, kind=${kind}) recurred ${count} times ` +
        `(threshold=${threshold}) — below threshold; no action.`;
    }

    return Object.freeze({ key, contextId, kind, count, ids: [...ids].sort(), recommendation, recommendationReason });
  });

  const promotionCandidates = groups
    .filter((g) => g.recommendation === 'promote-to-business')
    .map((g) => Object.freeze({ key: g.key, contextId: g.contextId, kind: g.kind, count: g.count }));

  return Object.freeze({
    schemaVersion: RECURRENCE_SCHEMA_VERSION,
    groups: Object.freeze(groups),
    promotionCandidates: Object.freeze(promotionCandidates),
  });
}

// ---------------------------------------------------------------------------
// compareOutcome
// ---------------------------------------------------------------------------

/**
 * Three-way comparison: expected vs forecast vs actual for one outcome dimension.
 * Constitution §8: `actual` is 'unknown' when absent — never invented.
 *
 * @param {{ label: string, expected: unknown, forecast: unknown, actual?: unknown, evidence?: string|null, now?: number }} params
 * @returns {Readonly<{ schemaVersion: string, label: string, expected: unknown, forecast: unknown, actual: unknown, delta: string, evidence: string|null, capturedAt: number|null }>}
 */
export function compareOutcome({ label, expected, forecast, actual, evidence, now } = {}) {
  const safeLabel    = typeof label === 'string' && label.trim() ? label.trim() : 'unlabelled';
  const safeExpected = orUnknown(expected);
  const safeForecast = orUnknown(forecast);
  // Constitution §8: never invent actual. Only present when explicitly provided.
  const safeActual   = (actual === undefined || actual === null || actual === '')
    ? 'unknown'
    : orUnknown(actual);

  const safeEvidence = (typeof evidence === 'string' && evidence.trim())
    ? evidence.trim()
    : null;

  const capturedAt = (typeof now === 'number' && Number.isFinite(now)) ? now : null;

  // Delta: can only be derived when we have a real expected AND a real actual.
  let delta;
  if (safeActual === 'unknown' || safeExpected === 'unknown') {
    delta = 'unknown';
  } else if (typeof safeExpected === 'number' && typeof safeActual === 'number') {
    if (safeActual >= safeExpected) {
      delta = safeActual > safeExpected ? 'exceeded' : 'met';
    } else {
      delta = 'missed';
    }
  } else {
    // Non-numeric comparison: 'met' when string-equal, else 'not-applicable'.
    delta = String(safeActual) === String(safeExpected) ? 'met' : 'not-applicable';
  }

  return Object.freeze({
    schemaVersion: RECURRENCE_SCHEMA_VERSION,
    label:      safeLabel,
    expected:   safeExpected,
    forecast:   safeForecast,
    actual:     safeActual,
    delta,
    evidence:   safeEvidence,
    capturedAt,
  });
}

// ---------------------------------------------------------------------------
// buildOutcomeReport
// ---------------------------------------------------------------------------

/**
 * Builds a complete three-way outcome report for a Business (or Operation),
 * mapping each declared expected outcome through compareOutcome.
 * forecastObj.confidence is used as the fallback forecast when per-outcome
 * forecast is absent. Actual = 'unknown' by default (constitution §8).
 *
 * @param {{ businessId: string, expectedOutcomes: Array<{ outcome: string, forecast?: unknown, actual?: unknown, evidence?: string, target?: unknown }>, forecastObj?: object|null, now?: number }} params
 * @returns {Readonly<{ schemaVersion: string, businessId: string, capturedAt: number|null, outcomes: Readonly<object[]>, summary: Readonly<object> }>}
 */
export function buildOutcomeReport({ businessId, expectedOutcomes = [], forecastObj = null, now } = {}) {
  const capturedAt = (typeof now === 'number' && Number.isFinite(now)) ? now : null;
  const safeId = (typeof businessId === 'string' && businessId.trim()) ? businessId.trim() : 'unknown';

  const forecastConfidence = orUnknown(forecastObj?.confidence);

  const outcomes = (Array.isArray(expectedOutcomes) ? expectedOutcomes : []).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    // Forecast: prefer explicit per-outcome value; fallback to top-level forecast confidence.
    const forecastValue = (entry.forecast !== undefined && entry.forecast !== null)
      ? entry.forecast
      : forecastConfidence;

    return compareOutcome({
      label:    entry.outcome,
      expected: entry.target ?? entry.outcome,
      forecast: forecastValue,
      actual:   entry.actual,
      evidence: entry.evidence,
      now,
    });
  }).filter(Boolean);

  const summary = {
    total:    outcomes.length,
    met:      outcomes.filter((o) => o.delta === 'met').length,
    missed:   outcomes.filter((o) => o.delta === 'missed').length,
    exceeded: outcomes.filter((o) => o.delta === 'exceeded').length,
    unknown:  outcomes.filter((o) => o.delta === 'unknown').length,
  };

  return Object.freeze({
    schemaVersion: RECURRENCE_SCHEMA_VERSION,
    businessId:    safeId,
    capturedAt,
    outcomes:      Object.freeze(outcomes),
    summary:       Object.freeze(summary),
  });
}
