/**
 * Benchmark statistics inference layer — EACP Wave 10 / card #243 (EACP-14).
 *
 * Matched-pair deltas, Cohen's d effect size, practical-significance test,
 * Holm-Bonferroni multiple-comparison correction, and the corrected-inference
 * summary that gates the #243 evidence tier.
 *
 * Consumed by benchmark-statistics.mjs (facade). No direct consumer writes
 * conclusions here — only `unknown` or `blocked-real-data` can emerge without
 * a real powered run clearing ADR-0080.
 *
 * Zero runtime dependencies — relative imports only.
 * No Date.now(), no Math.random(), no filesystem, no network.
 *
 * @module benchmark-statistics-inference
 */

import {
  STATISTICS_SCHEMA_VERSION,
  EVIDENCE_TIERS,
  DEFAULT_PRACTICAL_THRESHOLD,
  median,
  p95,
} from './benchmark-statistics-core.mjs';

// ---------------------------------------------------------------------------
// Matched-pair analysis
// ---------------------------------------------------------------------------

/**
 * Computes matched-pair deltas between two parallel metric value arrays.
 * Delta_i = treatment_i - control_i (C - A). Returns summary of the delta
 * distribution: meanDelta, medianDelta, p95Delta, stdDevDelta.
 *
 * Returns all-null stats on empty/mismatched arrays (constitution §8:
 * undefined is reported as null, never as zero).
 *
 * @param {number[]} controlValues - Arm A (baseline) metric values per task.
 * @param {number[]} treatmentValues - Arm C (kit) metric values per task.
 * @param {string} [metricKey] - Label for the metric (reporting only).
 * @returns {Readonly<{ schemaVersion: string, metricKey: string, n: number,
 *   deltas: readonly number[], meanDelta: number|null,
 *   medianDelta: number|null, p95Delta: number|null,
 *   stdDevDelta: number|null, evidenceTier: 'none', claim: null,
 *   conclusion: 'unknown' }>}
 */
export function matchedPairDeltas(controlValues, treatmentValues, metricKey = 'metric') {
  const base = { schemaVersion: STATISTICS_SCHEMA_VERSION, metricKey,
    evidenceTier: 'none', claim: null, conclusion: 'unknown' };

  const aVals = (Array.isArray(controlValues) ? controlValues : []).filter((v) => Number.isFinite(v));
  const cVals = (Array.isArray(treatmentValues) ? treatmentValues : []).filter((v) => Number.isFinite(v));

  if (aVals.length === 0 || cVals.length === 0 || aVals.length !== cVals.length) {
    return Object.freeze({
      ...base, n: 0, deltas: Object.freeze([]),
      meanDelta: null, medianDelta: null, p95Delta: null, stdDevDelta: null,
      reason: 'empty or mismatched arrays — matched-pair comparison undefined',
    });
  }

  const deltas = aVals.map((a, i) => cVals[i] - a);
  const n = deltas.length;
  const meanDelta = deltas.reduce((s, d) => s + d, 0) / n;
  const varDelta = n > 1
    ? deltas.reduce((s, d) => s + (d - meanDelta) ** 2, 0) / (n - 1)
    : null;

  return Object.freeze({
    ...base, n, deltas: Object.freeze(deltas),
    meanDelta,
    medianDelta: median(deltas),
    p95Delta: p95(deltas),
    stdDevDelta: varDelta !== null ? Math.sqrt(varDelta) : null,
  });
}

// ---------------------------------------------------------------------------
// Effect size
// ---------------------------------------------------------------------------

/**
 * Cohen's d effect size between two independent samples.
 * Uses Bessel-corrected pooled standard deviation.
 * Returns d: null when either sample has < 2 values or pooled SD is zero.
 *
 * @param {number[]} controlValues - Arm A observations.
 * @param {number[]} treatmentValues - Arm C observations.
 * @returns {Readonly<{ d: number|null, pooledSD: number|null,
 *   meanA: number|null, meanC: number|null,
 *   evidenceTier: 'none', claim: null, conclusion: 'unknown' }>}
 */
export function cohensDEffect(controlValues, treatmentValues) {
  const base = { schemaVersion: STATISTICS_SCHEMA_VERSION,
    evidenceTier: 'none', claim: null, conclusion: 'unknown' };

  const aVals = (Array.isArray(controlValues) ? controlValues : []).filter((v) => Number.isFinite(v));
  const cVals = (Array.isArray(treatmentValues) ? treatmentValues : []).filter((v) => Number.isFinite(v));

  if (aVals.length < 2 || cVals.length < 2) {
    return Object.freeze({ ...base, d: null, pooledSD: null, meanA: null, meanC: null,
      reason: 'at least 2 values required per arm' });
  }

  const meanA = aVals.reduce((s, v) => s + v, 0) / aVals.length;
  const meanC = cVals.reduce((s, v) => s + v, 0) / cVals.length;
  const varA  = aVals.reduce((s, v) => s + (v - meanA) ** 2, 0) / (aVals.length - 1);
  const varC  = cVals.reduce((s, v) => s + (v - meanC) ** 2, 0) / (cVals.length - 1);
  const pooledSD = Math.sqrt((varA + varC) / 2);

  if (pooledSD === 0) {
    return Object.freeze({ ...base, d: null, pooledSD, meanA, meanC,
      reason: 'pooled SD is zero — effect size undefined' });
  }
  return Object.freeze({ ...base, d: (meanC - meanA) / pooledSD, pooledSD, meanA, meanC });
}

// ---------------------------------------------------------------------------
// Practical significance
// ---------------------------------------------------------------------------

/**
 * Tests whether an observed ratio meets the declared practical-significance
 * threshold. Never forces a positive result; conclusion stays 'unknown' because
 * a real powered run is required to clear ADR-0080.
 *
 * @param {{ ratio: number|null, n: number, threshold?: number }} params
 * @returns {Readonly<{ practicallySignificant: boolean|null, threshold: number,
 *   evidenceTier: 'none', claim: null, conclusion: 'unknown' }>}
 */
export function practicalSignificance(params) {
  const threshold = (typeof params?.threshold === 'number' && Number.isFinite(params.threshold))
    ? params.threshold
    : DEFAULT_PRACTICAL_THRESHOLD;
  const base = { schemaVersion: STATISTICS_SCHEMA_VERSION, threshold,
    evidenceTier: 'none', claim: null };

  const { ratio, n } = params ?? {};
  if (!Number.isFinite(ratio) || !Number.isFinite(n) || n < 1) {
    return Object.freeze({ ...base, practicallySignificant: null, conclusion: 'unknown' });
  }

  return Object.freeze({
    ...base,
    practicallySignificant: ratio >= threshold,
    // Conclusion stays 'unknown' even when threshold is exceeded — only a
    // powered run + human gate can elevate to 'supported' / 'proven'.
    conclusion: 'unknown',
    note: 'conclusion remains unknown until powered run clears ADR-0080 evidence tier',
  });
}

// ---------------------------------------------------------------------------
// Multiple-comparison correction (Holm-Bonferroni)
// ---------------------------------------------------------------------------

/**
 * Applies Holm-Bonferroni step-down correction to a list of raw p-values.
 * Returns corrected p-values in input order, each with a `reject` flag.
 *
 * Monotonicity enforced: each corrected p-value is ≥ its predecessor in
 * sorted order. Returns an empty frozen array on empty input.
 *
 * @param {number[]} pValues - Raw p-values (finite, in [0, 1]).
 * @param {{ alpha?: number }} [opts]
 * @returns {Readonly<Array<Readonly<{ rawP: number, correctedP: number, reject: boolean }>>>}
 */
export function holmBonferroni(pValues, opts = {}) {
  const alpha = (typeof opts?.alpha === 'number' && Number.isFinite(opts.alpha)) ? opts.alpha : 0.05;
  const raw = (Array.isArray(pValues) ? pValues : []).filter((p) => Number.isFinite(p));
  if (raw.length === 0) return Object.freeze([]);

  const m = raw.length;
  const indexed = raw.map((p, i) => ({ rawP: p, originalIndex: i }));
  indexed.sort((a, b) => a.rawP - b.rawP);

  const corrected = new Array(m);
  let maxCorrected = 0;

  for (let k = 0; k < m; k++) {
    const holmP = Math.min(indexed[k].rawP * (m - k), 1.0);
    // Enforce monotonicity: corrected p can only increase across steps.
    const cp = Math.max(holmP, maxCorrected);
    maxCorrected = cp;
    corrected[indexed[k].originalIndex] = Object.freeze({ rawP: indexed[k].rawP, correctedP: cp, reject: cp < alpha });
  }

  return Object.freeze(corrected);
}

// ---------------------------------------------------------------------------
// Corrected inference summary
// ---------------------------------------------------------------------------

/**
 * Aggregates matched-pair deltas, practical-significance result, effect size,
 * and Holm-corrected p-values into an audit-ready corrected-inference record.
 *
 * Conclusions are conservative:
 *   - evidenceTier < 'powered' → 'blocked-real-data' (we know WHY it's blocked)
 *   - evidenceTier === 'powered' → 'unknown' (human gate required)
 * This module NEVER emits 'proven', 'supported', 'measured', or 'refuted' on its
 * own — those require a human gate reviewing a real powered run (ADR-0080).
 *
 * @param {{ deltas?: object, practical?: object, effectSize?: object,
 *   correctedPs?: readonly object[], evidenceTier?: string }} inputs
 * @returns {Readonly<{ schemaVersion: string, evidenceTier: string,
 *   claim: null, conclusion: 'unknown'|'blocked-real-data',
 *   corrected: true, note: string, inputs: object }>}
 */
export function correctedInference(inputs) {
  const tier = (typeof inputs?.evidenceTier === 'string' && EVIDENCE_TIERS.includes(inputs.evidenceTier))
    ? inputs.evidenceTier
    : 'none';

  // Any tier below 'powered' → 'blocked-real-data'; we know exactly why.
  const conclusion = tier === 'powered' ? 'unknown' : 'blocked-real-data';

  return Object.freeze({
    schemaVersion: STATISTICS_SCHEMA_VERSION,
    evidenceTier: tier,
    claim: null,
    conclusion,
    corrected: true,
    note: conclusion === 'blocked-real-data'
      ? 'No real powered run executed or authorized. Statistics module + pre-registration delivered. #243 NOT complete.'
      : 'Powered evidence present but inference not yet reviewed by a human gate.',
    inputs: Object.freeze({
      deltasN: inputs?.deltas?.n ?? null,
      practicallySignificant: inputs?.practical?.practicallySignificant ?? null,
      effectSizeD: inputs?.effectSize?.d ?? null,
      correctedPsCount: Array.isArray(inputs?.correctedPs) ? inputs.correctedPs.length : 0,
    }),
  });
}
