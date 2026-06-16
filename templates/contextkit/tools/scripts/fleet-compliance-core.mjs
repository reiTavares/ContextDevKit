#!/usr/bin/env node
/**
 * fleet-compliance-core.mjs — Pure aggregation math for CDK-080 (PKG-08).
 *
 * Receives an array of per-repo compliance results (already gathered by
 * fleet-compliance.mjs) and computes cross-fleet totals + rankings.
 *
 * §8 contract: null values propagate; missing data produces null (never 0).
 * No I/O, no imports beyond node:path. Safe for unit-testing in isolation.
 *
 * Zero runtime dependencies. ADR-0072 / CDK-080.
 */
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types (JSDoc only — no runtime overhead)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PerRepoResult
 * @property {string} path          absolute path to the repo
 * @property {boolean} ok           true if at least one signal was gathered
 * @property {{ total: number, parity: number, gaps: number }|null} compliance
 * @property {{ score: number|null, band: string|null }|null} scorecard
 * @property {{ ready: boolean, confidence: string }|null} readiness
 */

/**
 * @typedef {object} FleetTotals
 * @property {number}      repos                 total registered repos
 * @property {number}      scanned               repos with at least one successful signal
 * @property {number|null} avgComplianceParityPct mean parity% over repos with valid compliance
 * @property {string|null} weakest                path with lowest parity ratio (null if none)
 * @property {string|null} leastReady             first repo path where readiness.ready===false
 */

/**
 * @typedef {object} FleetSources
 * @property {string[]} present paths of repos with at least one successful signal
 * @property {string[]} skipped paths of repos where all signals failed/missing
 */

/**
 * @typedef {object} AggregateResult
 * @property {FleetTotals}  totals
 * @property {FleetSources} sources
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes the parity ratio [0..1] for one repo's compliance entry.
 * Returns null when the entry is absent or total is zero (§8 — honest null).
 *
 * @param {{ total: number, parity: number, gaps: number }|null} compliance
 * @returns {number|null}
 */
function parityRatio(compliance) {
  if (compliance === null || compliance === undefined) return null;
  if (typeof compliance.total !== 'number' || compliance.total <= 0) return null;
  return compliance.parity / compliance.total;
}

/**
 * Computes the mean parity percentage across repos that have a valid ratio.
 * Returns null when no repo has a computable ratio (§8 — never a false 0).
 *
 * @param {PerRepoResult[]} perRepo
 * @returns {number|null}
 */
function computeAvgParityPct(perRepo) {
  const ratios = perRepo
    .map((r) => parityRatio(r.compliance))
    .filter((v) => v !== null);
  if (ratios.length === 0) return null;
  const mean = ratios.reduce((sum, v) => sum + v, 0) / ratios.length;
  return +( mean * 100).toFixed(2);
}

/**
 * Finds the path of the repo with the lowest compliance parity ratio.
 * Returns null when no repo has valid compliance (§8).
 *
 * @param {PerRepoResult[]} perRepo
 * @returns {string|null}
 */
function findWeakest(perRepo) {
  let weakestPath = null;
  let lowestRatio = Infinity;

  for (const repo of perRepo) {
    const ratio = parityRatio(repo.compliance);
    if (ratio === null) continue;
    if (ratio < lowestRatio) {
      lowestRatio = ratio;
      weakestPath = repo.path;
    }
  }
  return weakestPath;
}

/**
 * Finds the first repo path where readiness.ready === false.
 * Returns null if all repos are ready or none have readiness data (§8).
 *
 * @param {PerRepoResult[]} perRepo
 * @returns {string|null}
 */
function findLeastReady(perRepo) {
  for (const repo of perRepo) {
    if (repo.readiness !== null && repo.readiness !== undefined) {
      if (repo.readiness.ready === false) return repo.path;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Aggregates an array of per-repo results into cross-fleet totals and source lists.
 *
 * The math here is pure: no I/O, no registry read, no module imports. Each
 * ranking and average follows §8 (missing → null, never false-0).
 *
 * @param {PerRepoResult[]} perRepo array produced by the I/O layer in fleet-compliance.mjs
 * @returns {AggregateResult}
 */
export function aggregateFleet(perRepo) {
  if (!Array.isArray(perRepo) || perRepo.length === 0) {
    return {
      totals: {
        repos: 0,
        scanned: 0,
        avgComplianceParityPct: null,
        weakest: null,
        leastReady: null,
      },
      sources: { present: [], skipped: [] },
    };
  }

  const present = perRepo.filter((r) => r.ok).map((r) => r.path);
  const skipped = perRepo.filter((r) => !r.ok).map((r) => r.path);

  const totals = {
    repos: perRepo.length,
    scanned: present.length,
    avgComplianceParityPct: computeAvgParityPct(perRepo),
    weakest: findWeakest(perRepo),
    leastReady: findLeastReady(perRepo),
  };

  return { totals, sources: { present, skipped } };
}

// ---------------------------------------------------------------------------
// Module self-check when run directly (not a CLI — just verifies it loads)
// ---------------------------------------------------------------------------

// Simple guard: when executed directly, confirm load succeeded and exit cleanly.
// Uses the same isMain() pattern as sibling modules (engineering-scorecard.mjs, etc.).
if (process.argv[1]) {
  try {
    if (resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
      console.log('[fleet-compliance-core] loaded OK — CDK-080 pure aggregation module.');
      process.exit(0);
    }
  } catch { /* defensive — do not throw on import */ }
}
