/**
 * Benchmark statistics core — EACP Wave 10 / card #243 (EACP-14).
 *
 * Pure, deterministic summary-statistics, power-calculation, and bootstrap-CI
 * functions. No Date.now(), no Math.random(), no filesystem, no network.
 * Caller injects any seed for reproducible bootstrap.
 *
 * This module is consumed by benchmark-statistics.mjs (facade) and by
 * benchmark-statistics-inference.mjs (effect-size / correction layer).
 *
 * Evidence-gate contract (ADR-0080 / constitution §8):
 *   - Every result carries `claim: null` and `evidenceTier` from the inputs.
 *   - Positive conclusions are never manufactured here; `unknown` is the floor.
 *   - Permitted conclusions: proven|supported|measured|refuted|unknown|budget_aborted
 *
 * Zero runtime dependencies — no node:* imports; relative imports only.
 * @module benchmark-statistics-core
 */

import { withinCellVariance } from './benchmark-report.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Schema version stamped on every result object from this module family. */
export const STATISTICS_SCHEMA_VERSION = 'eacp-benchmark-statistics/1';

/**
 * Permitted conclusion strings (ADR-0080 / constitution §8).
 * A positive conclusion is never mandatory; 'refuted' is as valid as 'proven'.
 * @type {Readonly<string[]>}
 */
export const PERMITTED_CONCLUSIONS = Object.freeze([
  'proven', 'supported', 'measured', 'refuted', 'unknown', 'budget_aborted',
]);

/**
 * Evidence tiers (ADR-0080). Results below 'powered' carry claim: null.
 * @type {Readonly<string[]>}
 */
export const EVIDENCE_TIERS = Object.freeze(['none', 'mock', 'unpowered', 'powered']);

/**
 * Default practical-significance threshold for the primary metric ratio.
 * Pre-registered; callers may override via opts.threshold.
 * @type {number}
 */
export const DEFAULT_PRACTICAL_THRESHOLD = 1.30;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives evidence tier from run records: none < mock < unpowered < powered.
 * @param {object[]} records
 * @returns {'none'|'mock'|'unpowered'}
 */
function deriveEvidenceTier(records) {
  if (!Array.isArray(records) || records.length === 0) return 'none';
  if (records.some((r) => r?.confidence === 'mock' || r?.provider === 'mock')) return 'mock';
  return 'unpowered';
}

/**
 * Extracts a finite metric value from a run record's metrics object.
 * @param {object} record
 * @param {string} metricKey
 * @returns {number|null}
 */
function extractMetric(record, metricKey) {
  const val = record?.metrics?.[metricKey];
  return (typeof val === 'number' && Number.isFinite(val)) ? val : null;
}

/**
 * Seeded linear congruential generator for deterministic bootstrap.
 * Knuth multiplicative constants (a=1664525, c=1013904223, m=2^32).
 * Mutates the seed box in place.
 * @param {{ state: number }} box
 * @returns {number} float in [0, 1)
 */
function lcgNext(box) {
  box.state = ((box.state * 1664525) + 1013904223) >>> 0;
  return box.state / 0x100000000;
}

/**
 * Rational approximation of the standard-normal quantile (Abramowitz & Stegun
 * 26.2.17). Accurate to ~4 decimal places for design-purpose power calculations.
 * @param {number} p - probability in (0.5, 1)
 * @returns {number}
 */
function normalQuantile(p) {
  const c = [2.515517, 0.802853, 0.010328];
  const d = [1.432788, 0.189269, 0.001308];
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - (c[0] + c[1] * t + c[2] * t * t) / (1 + d[0] * t + d[1] * t * t + d[2] * t * t * t);
}

// ---------------------------------------------------------------------------
// Core summary statistics
// ---------------------------------------------------------------------------

/**
 * Computes the median of an array of finite numbers.
 * Returns null for empty input (undefined, not zero — constitution §8).
 * @param {number[]} values
 * @returns {number|null}
 */
export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Computes the 95th percentile of an array of finite numbers (nearest-rank).
 * Returns null for empty input.
 * @param {number[]} values
 * @returns {number|null}
 */
export function p95(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

/**
 * Computes summary statistics (n, mean, median, p95, stdDev) for a metric
 * extracted from run records. Carries claim: null and evidenceTier from records.
 *
 * @param {object[]} records - Run records from benchmark-run.runArm / runCell.
 * @param {string} metricKey - Key in each record's `metrics` object.
 * @returns {Readonly<{ schemaVersion: string, metricKey: string, n: number,
 *   mean: number|null, median: number|null, p95: number|null,
 *   stdDev: number|null, evidenceTier: string, claim: null,
 *   conclusion: 'unknown' }>}
 */
export function summarizeMetric(records, metricKey) {
  const tier = deriveEvidenceTier(records);
  const base = { schemaVersion: STATISTICS_SCHEMA_VERSION, metricKey, evidenceTier: tier, claim: null, conclusion: 'unknown' };
  const values = (Array.isArray(records) ? records : [])
    .map((r) => extractMetric(r, metricKey))
    .filter((v) => v !== null);

  if (values.length === 0) {
    return Object.freeze({ ...base, n: 0, mean: null, median: null, p95: null, stdDev: null });
  }
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : null;
  return Object.freeze({ ...base, n, mean, median: median(values), p95: p95(values),
    stdDev: variance !== null ? Math.sqrt(variance) : null });
}

// ---------------------------------------------------------------------------
// Sample size / power calculation
// ---------------------------------------------------------------------------

/**
 * Estimates per-arm sample size for a matched-pair two-tailed t-test.
 * Formula: n = 2 * ((z_alpha/2 + z_beta) / cohensD)^2.
 * Returns n: null when inputs are invalid or pooledStdDev is zero.
 * All conclusions are 'unknown' — only a powered run clears ADR-0080.
 *
 * @param {{ pooledStdDev: number, minEffectSize: number,
 *   alpha?: number, power?: number }} params
 * @returns {Readonly<{ n: number|null, evidenceTier: 'none', claim: null,
 *   conclusion: 'unknown', cohensD?: number, inputs: object }>}
 */
export function sampleSizeEstimate(params) {
  const { pooledStdDev, minEffectSize, alpha = 0.05, power = 0.80 } = params ?? {};
  const base = { schemaVersion: STATISTICS_SCHEMA_VERSION, evidenceTier: 'none', claim: null, conclusion: 'unknown',
    inputs: { pooledStdDev: pooledStdDev ?? null, minEffectSize: minEffectSize ?? null, alpha, power } };

  if (!Number.isFinite(pooledStdDev) || pooledStdDev <= 0) {
    return Object.freeze({ ...base, n: null, reason: 'pooledStdDev must be a positive finite number' });
  }
  if (!Number.isFinite(minEffectSize) || minEffectSize <= 0) {
    return Object.freeze({ ...base, n: null, reason: 'minEffectSize must be a positive finite number' });
  }
  const cohensD = minEffectSize / pooledStdDev;
  if (cohensD <= 0) {
    return Object.freeze({ ...base, n: null, reason: 'effect size / stdDev ratio non-positive' });
  }
  const n = Math.ceil(2 * ((normalQuantile(1 - alpha / 2) + normalQuantile(power)) / cohensD) ** 2);
  return Object.freeze({ ...base, n, cohensD });
}

// ---------------------------------------------------------------------------
// Bootstrap confidence interval
// ---------------------------------------------------------------------------

/**
 * Bootstrap percentile CI for the median. Deterministic: caller supplies seed.
 * Returns lower/upper null on invalid seed or fewer than 2 values.
 *
 * @param {number[]} values - Finite numeric observations.
 * @param {{ seed: number, iterations?: number, level?: number }} opts
 * @returns {Readonly<{ lower: number|null, upper: number|null, level: number,
 *   iterations: number, evidenceTier: 'none', claim: null, conclusion: 'unknown' }>}
 */
export function bootstrapCI(values, opts) {
  const level = (typeof opts?.level === 'number' && opts.level > 0 && opts.level < 1) ? opts.level : 0.95;
  const iterations = (typeof opts?.iterations === 'number' && opts.iterations > 0)
    ? Math.floor(opts.iterations) : 999;
  const base = { schemaVersion: STATISTICS_SCHEMA_VERSION, level, iterations,
    evidenceTier: 'none', claim: null, conclusion: 'unknown' };

  if (!Number.isFinite(opts?.seed) || !Number.isInteger(opts?.seed)) {
    return Object.freeze({ ...base, lower: null, upper: null, reason: 'seed must be a finite integer' });
  }
  const finite = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (finite.length < 2) {
    return Object.freeze({ ...base, lower: null, upper: null, reason: 'fewer than 2 finite values' });
  }
  const n = finite.length;
  const box = { state: opts.seed >>> 0 };
  const bootMedians = Array.from({ length: iterations }, () => {
    const resample = Array.from({ length: n }, () => finite[Math.floor(lcgNext(box) * n)]);
    return median(resample);
  }).sort((a, b) => a - b);

  const alpha = 1 - level;
  return Object.freeze({
    ...base,
    lower: bootMedians[Math.floor((alpha / 2) * iterations)] ?? null,
    upper: bootMedians[Math.ceil((1 - alpha / 2) * iterations) - 1] ?? null,
  });
}

// Re-export withinCellVariance so consumers need only one import.
export { withinCellVariance };
