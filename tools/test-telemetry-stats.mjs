#!/usr/bin/env node
/**
 * Statistical helpers for test-telemetry.mjs (TEA-006, SPEC §5).
 *
 * WHY: extracted to keep test-telemetry.mjs within the ≤280-line budget while
 * providing reusable, well-named math over duration history arrays.
 *
 * All functions are PURE — no I/O, no side-effects, no deps beyond node:*.
 * Every returned number is tagged OBSERVED or DERIVED in its JSDoc so callers
 * can faithfully propagate the classification per ADR-0080.
 *
 * @module test-telemetry-stats
 */

// ── percentile ───────────────────────────────────────────────────────────────

/**
 * Compute the p-th percentile of a non-empty sorted array of numbers using
 * the "nearest rank" method. Returns null when the array is empty.
 * DERIVED (computed from OBSERVED durations).
 * @param {number[]} sorted - ascending-sorted numbers.
 * @param {number} p - percentile in [0,100].
 * @returns {number|null}
 */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ── per-suite history aggregation ────────────────────────────────────────────

/**
 * @typedef {Object} SuiteStats
 * @property {string}    id          - suite identifier.
 * @property {number}    sampleCount - OBSERVED: number of completed runs.
 * @property {number|null} p50Ms     - DERIVED p50 duration (ms); null < MIN_SAMPLES.
 * @property {number|null} p95Ms     - DERIVED p95 duration (ms); null < MIN_SAMPLES.
 * @property {number}    passCount   - OBSERVED: runs with exitCode 0.
 * @property {number}    failCount   - OBSERVED: runs with exitCode != 0.
 * @property {number|null} firstFailMs - OBSERVED first-failure duration this run.
 */

/** Minimum sample count before reporting p-stats (avoids misleading 1-run p95). */
export const MIN_SAMPLES = 3;

/**
 * Aggregate per-suite statistics from raw history entries. Entries without an
 * `ms` field (malformed lines) are silently skipped.
 *
 * @param {Array<{id:string,ms:number,exitCode:number}>} entries
 * @returns {Map<string, SuiteStats>}
 */
export function aggregateSuiteStats(entries) {
  /** @type {Map<string, {id:string,durations:number[],passCount:number,failCount:number}>} */
  const byId = new Map();

  for (const e of entries) {
    if (typeof e.id !== 'string' || typeof e.ms !== 'number') continue;
    const bucket = byId.get(e.id) ?? { id: e.id, durations: [], passCount: 0, failCount: 0 };
    bucket.durations.push(e.ms);
    if (e.exitCode === 0) bucket.passCount += 1;
    else bucket.failCount += 1;
    byId.set(e.id, bucket);
  }

  /** @type {Map<string, SuiteStats>} */
  const result = new Map();
  for (const [id, b] of byId) {
    const sorted = [...b.durations].sort((x, y) => x - y);
    const enough = sorted.length >= MIN_SAMPLES;
    result.set(id, {
      id,
      sampleCount: sorted.length,           // OBSERVED
      p50Ms: enough ? percentile(sorted, 50) : null,  // DERIVED
      p95Ms: enough ? percentile(sorted, 95) : null,  // DERIVED
      passCount: b.passCount,                // OBSERVED
      failCount: b.failCount,                // OBSERVED
      firstFailMs: null,                     // filled in by the caller per-run
    });
  }
  return result;
}

// ── run-level metrics ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} RunSummary
 * @property {string}      runId       - ISO timestamp string used as id.
 * @property {string}      mode        - tier/list/impact/legacy.
 * @property {number}      totalMs     - OBSERVED total run duration.
 * @property {number}      exitCode    - OBSERVED.
 * @property {number}      suiteCount  - OBSERVED.
 * @property {number}      passCount   - OBSERVED.
 * @property {number}      failCount   - OBSERVED.
 * @property {number|null} firstFailMs - OBSERVED ms at which the first suite failed.
 * @property {number|null} timeToGreenMs - OBSERVED ms to full-green (or null if red).
 */

/**
 * Compute run-level OBSERVED metrics from a last-run payload.
 * @param {{startedAt:string,mode:string,totalMs:number,exitCode:number,suites:Array<{id:string,tier:string,ms:number,exitCode:number,logBytes:number}>}} run
 * @returns {RunSummary}
 */
export function computeRunSummary(run) {
  let cumulativeMs = 0;
  let firstFailMs = null;
  let passCount = 0;
  let failCount = 0;

  for (const s of run.suites ?? []) {
    cumulativeMs += s.ms;
    if (s.exitCode !== 0 && firstFailMs === null) {
      firstFailMs = cumulativeMs; // OBSERVED: time elapsed when first suite failed
    }
    if (s.exitCode === 0) passCount += 1;
    else failCount += 1;
  }

  return {
    runId: run.startedAt ?? new Date().toISOString(),
    mode: run.mode ?? 'unknown',
    totalMs: run.totalMs ?? 0,       // OBSERVED
    exitCode: run.exitCode ?? 1,     // OBSERVED
    suiteCount: run.suiteCount ?? 0, // OBSERVED
    passCount,                        // OBSERVED
    failCount,                        // OBSERVED
    firstFailMs,                      // OBSERVED
    timeToGreenMs: run.exitCode === 0 ? (run.totalMs ?? 0) : null, // OBSERVED
  };
}

// ── inner-loop vs full delta ──────────────────────────────────────────────────

/**
 * @typedef {Object} DeltaResult
 * @property {number|null} smokeMs   - OBSERVED median smoke-tier duration.
 * @property {number|null} fullMs    - OBSERVED median full-run duration.
 * @property {number|null} savedMs   - DERIVED: fullMs - smokeMs (null if either absent).
 * @property {string}      classification - 'DERIVED' always (ratio is computed).
 */

/**
 * Compute the DERIVED inner-loop vs full-run duration delta from history.
 * Returns null fields if fewer than MIN_SAMPLES of a given mode exist.
 *
 * @param {Array<{mode:string,totalMs:number}>} historyEntries
 * @returns {DeltaResult}
 */
export function computeInnerLoopDelta(historyEntries) {
  const smokeRuns = historyEntries
    .filter((e) => typeof e.mode === 'string' && e.mode.includes('smoke') && typeof e.totalMs === 'number')
    .map((e) => e.totalMs)
    .sort((a, b) => a - b);

  const fullRuns = historyEntries
    .filter((e) => typeof e.mode === 'string' && e.mode === 'tier:all' && typeof e.totalMs === 'number')
    .map((e) => e.totalMs)
    .sort((a, b) => a - b);

  const smokeMs = smokeRuns.length >= MIN_SAMPLES ? percentile(smokeRuns, 50) : null;
  const fullMs = fullRuns.length >= MIN_SAMPLES ? percentile(fullRuns, 50) : null;
  const savedMs = smokeMs !== null && fullMs !== null ? fullMs - smokeMs : null;

  return { smokeMs, fullMs, savedMs, classification: 'DERIVED' };
}
