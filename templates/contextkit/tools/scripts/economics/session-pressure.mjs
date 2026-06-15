/**
 * Session-pressure scorer — EACP-07 / ADR-0077 (session-pressure policy).
 *
 * Advisory-only: estimates how much "pressure" a session is under from token
 * metadata emitted by token-report. High pressure signals the session should
 * be split for latency, context coherence, and cost predictability. Never
 * blocks execution; surface band + recommendations in a dashboard or hook only.
 *
 * Signals come from the token-report per-session row:
 *   { sid, input, output, cacheRead, cacheCreate, turns, total, at, week }
 * cacheCreate = cache-write tokens added to the prompt cache this session.
 *
 * Degradation contract (constitution §8): when the minimum signals are absent,
 * pressureScore() returns skipped(). Never return a 'healthy' band for "unknown"
 * — that is the false-negative trap.
 *
 * DETERMINISTIC: no Date.now() or Math.random() calls anywhere in this file.
 * All exported functions are pure and reproducible given the same inputs.
 *
 * Thresholds are reviewable policy data ratified under ADR-0077. Any cutoff
 * change requires a new ADR entry — do not edit in place.
 *
 * Zero runtime dependencies — node:* or relative imports only.
 */

import { skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Monotonic schema identifier — bump when the result shape changes in a breaking way. */
export const PRESSURE_SCHEMA_VERSION = 'eacp-pressure/1';

/**
 * Canonical ordered band labels, ascending severity.
 * @type {Readonly<['healthy', 'elevated', 'hot', 'critical']>}
 */
export const PRESSURE_BANDS = Object.freeze(['healthy', 'elevated', 'hot', 'critical']);

// ---------------------------------------------------------------------------
// Internal scoring tables (policy data — ADR-0077 ratified)
// ---------------------------------------------------------------------------

/**
 * Per-signal scoring config. A single frozen table makes the policy auditable
 * and the scoring loop generic (no per-signal if/else branches). band cutoffs:
 * value maps to the HIGHEST band whose lower cutoff it meets; below elevated → healthy.
 * @type {ReadonlyArray<{key:string, weight:number, elevated:number, hot:number, critical:number}>}
 */
const SCORED_SIGNAL_CONFIG = Object.freeze([
  { key: 'turns',             weight: 0.35, elevated:      40, hot:       80, critical:      150 },
  { key: 'meanTokensPerTurn', weight: 0.30, elevated:  150000, hot:   300000, critical:   600000 },
  { key: 'cacheWriteRatio',   weight: 0.20, elevated:    0.15, hot:     0.30, critical:     0.50 },
  { key: 'totalTokens',       weight: 0.15, elevated: 5000000, hot: 20000000, critical: 60000000 },
]);

/** O(1) lookup: scored signal key → config row. */
const SCORED_SIGNAL_MAP = Object.freeze(
  Object.fromEntries(SCORED_SIGNAL_CONFIG.map(cfg => [cfg.key, cfg]))
);

/** Contribution midpoint per band, used in the weighted scoring sum. */
const BAND_MIDPOINT = Object.freeze({ healthy: 0.1, elevated: 0.4, hot: 0.7, critical: 0.95 });

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Maps a raw signal value to its pressure band via the cutoff table.
 * Walks critical→hot→elevated; falls through to 'healthy'.
 * @param {number} value
 * @param {{elevated:number, hot:number, critical:number}} cfg
 * @returns {'healthy'|'elevated'|'hot'|'critical'}
 */
function signalBand(value, cfg) {
  if (value >= cfg.critical) return 'critical';
  if (value >= cfg.hot)      return 'hot';
  if (value >= cfg.elevated) return 'elevated';
  return 'healthy';
}

/**
 * Maps a 0-100 composite score to the overall pressure band.
 * Boundaries: <25→healthy, <50→elevated, <75→hot, ≥75→critical.
 * @param {number} score - Integer 0-100.
 * @returns {'healthy'|'elevated'|'hot'|'critical'}
 */
function scoreToBand(score) {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'hot';
  if (score >= 25) return 'elevated';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Derives observable signals from a token-report per-session row.
 *
 * Each signal is computed only when all required inputs are finite numbers.
 * `cacheReadPerTurn` is an OBSERVED fact only — it is excluded from `present`
 * to prevent accidental scoring, but is still returned for dashboards.
 *
 * @param {{ sid?:string, input?:number, output?:number, cacheRead?:number,
 *   cacheCreate?:number, turns?:number, total?:number,
 *   at?:string, week?:string }|null|undefined} sessionRow
 * @returns {{ present:string[], totalTokens?:number, turns?:number,
 *   meanTokensPerTurn?:number, cacheReadPerTurn?:number, cacheWriteRatio?:number }}
 *   Only defined signal keys appear in the object; `present` excludes cacheReadPerTurn.
 */
export function deriveSignals(sessionRow) {
  if (sessionRow === null || sessionRow === undefined || typeof sessionRow !== 'object') {
    return { present: [] };
  }

  const derived = {};
  const present = [];

  if (Number.isFinite(sessionRow.total) && sessionRow.total >= 0) {
    derived.totalTokens = sessionRow.total;
    present.push('totalTokens');
  }

  // turns must be ≥1 to serve as a denominator for per-turn signals.
  if (Number.isFinite(sessionRow.turns) && sessionRow.turns >= 1) {
    derived.turns = sessionRow.turns;
    present.push('turns');
  }

  if (derived.totalTokens !== undefined && derived.turns !== undefined) {
    derived.meanTokensPerTurn = derived.totalTokens / derived.turns;
    present.push('meanTokensPerTurn');
  }

  // cacheReadPerTurn: observed fact, not scored — NOT pushed to `present`.
  if (
    Number.isFinite(sessionRow.cacheRead) &&
    sessionRow.cacheRead >= 0 &&
    derived.turns !== undefined
  ) {
    derived.cacheReadPerTurn = sessionRow.cacheRead / derived.turns;
  }

  // cacheWriteRatio: high write fraction means the session is exploring new
  // contexts instead of reusing cached ones — a pressure indicator.
  const totalCacheActivity =
    (Number.isFinite(sessionRow.cacheRead)   ? sessionRow.cacheRead   : NaN) +
    (Number.isFinite(sessionRow.cacheCreate) ? sessionRow.cacheCreate : NaN);

  if (
    Number.isFinite(totalCacheActivity) &&
    totalCacheActivity > 0 &&
    Number.isFinite(sessionRow.cacheCreate) &&
    sessionRow.cacheCreate >= 0
  ) {
    derived.cacheWriteRatio = sessionRow.cacheCreate / totalCacheActivity;
    present.push('cacheWriteRatio');
  }

  return { present, ...derived };
}

/**
 * Computes a composite session-pressure score and maps it to a band with
 * actionable split recommendations.
 *
 * Scoring: weighted average over present scored signals only. Each signal maps
 * to a band, then to a midpoint contribution (healthy→0.1 … critical→0.95).
 * WHY normalise over present-only weights: absent signals must not dilute the
 * score to healthy — a single turns=200 should yield 'hot', not 'elevated'.
 *
 * Constitution §8 (refuse-by-default): if neither totalTokens nor turns is
 * present we cannot produce a meaningful estimate → return skipped().
 *
 * @param {{ present:string[], totalTokens?:number, turns?:number,
 *   meanTokensPerTurn?:number, cacheReadPerTurn?:number,
 *   cacheWriteRatio?:number }} signals - Output of deriveSignals().
 * @param {object} [opts] - Reserved for future band threshold overrides.
 *   Unknown keys are silently ignored; do not rely on opts in this version.
 * @returns {Readonly<{schemaVersion:string, score:number, band:string,
 *   confidence:'derived'|'inferred', signals:object, missing:string[],
 *   splitRecommended:boolean, triggers:string[], recommendations:string[],
 *   note:string}>|Readonly<{status:'skipped', reason:string}>}
 */
export function pressureScore(signals, opts) {   // eslint-disable-line no-unused-vars
  if (signals?.totalTokens === undefined && signals?.turns === undefined) {
    return skipped('insufficient pressure signals: need at least totalTokens or turns');
  }

  // cacheReadPerTurn is absent from SCORED_SIGNAL_CONFIG → never scored here.
  const presentScoredKeys = SCORED_SIGNAL_CONFIG
    .map(cfg => cfg.key)
    .filter(key => typeof signals[key] === 'number' && Number.isFinite(signals[key]));

  let weightedContributionSum = 0;
  let weightSum = 0;
  const triggers = [];

  for (const key of presentScoredKeys) {
    const cfg = SCORED_SIGNAL_MAP[key];
    weightedContributionSum += cfg.weight * BAND_MIDPOINT[signalBand(signals[key], cfg)];
    weightSum += cfg.weight;
  }

  const score = Math.round((weightSum > 0 ? weightedContributionSum / weightSum : 0) * 100);
  const band  = scoreToBand(score);

  // Confidence: derived (≥2 signals) or inferred (single dimension only).
  const confidence = presentScoredKeys.length >= 2 ? 'derived' : 'inferred';

  if (band === 'critical' || band === 'hot') triggers.push(`band=${band}`);
  if (signals.turns !== undefined && signals.turns >= 80) {
    triggers.push(`turns=${signals.turns} ≥ 80`);
  }
  if (signals.meanTokensPerTurn !== undefined && signals.meanTokensPerTurn >= 600000) {
    triggers.push(`meanTokensPerTurn=${signals.meanTokensPerTurn} ≥ 600000`);
  }

  const splitRecommended =
    band === 'hot' ||
    band === 'critical' ||
    (signals.turns !== undefined && signals.turns >= 80) ||
    (signals.meanTokensPerTurn !== undefined && signals.meanTokensPerTurn >= 600000);

  const recommendations = splitRecommended
    ? [
        'Run /log-session to checkpoint this session',
        'Finish or pause the active card',
        'Create a resume pack (objective + open files)',
        'Start a fresh session for the next objective',
      ]
    : [];

  const presentScoredSet = new Set(presentScoredKeys);
  const missing = SCORED_SIGNAL_CONFIG.map(cfg => cfg.key).filter(k => !presentScoredSet.has(k));

  // signals copy: all present numeric values including the observed-only cacheReadPerTurn.
  const signalsCopy = {};
  for (const key of signals.present ?? []) {
    if (typeof signals[key] === 'number') signalsCopy[key] = signals[key];
  }
  if (typeof signals.cacheReadPerTurn === 'number') {
    signalsCopy.cacheReadPerTurn = signals.cacheReadPerTurn;
  }

  return Object.freeze({
    schemaVersion: PRESSURE_SCHEMA_VERSION,
    score,
    band,
    confidence,
    signals: signalsCopy,
    missing,
    splitRecommended,
    triggers,
    recommendations,
    note: 'Advisory session-pressure estimate from token metadata; not billed.',
  });
}
