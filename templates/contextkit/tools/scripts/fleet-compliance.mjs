#!/usr/bin/env node
/**
 * fleet-compliance.mjs — Cross-fleet capability compliance + health rollup (CDK-080, PKG-08).
 *
 * Advisory, fail-open, UNREGISTERED. Reads the ContextDevKit fleet registry and
 * calls the three per-repo scanners (capability-compliance, engineering-scorecard,
 * autonomy-readiness-v2) for every registered repo. Composes their outputs via
 * fleet-compliance-core.mjs. A missing/broken repo lands in sources.skipped,
 * its fields are null, and it is NEVER counted as 0 (§8 honesty contract).
 *
 * Usage:
 *   node fleet-compliance.mjs          # human digest
 *   node fleet-compliance.mjs --json   # JSON summary to stdout
 *
 * Zero runtime dependencies — node:* + sibling kit modules only. ADR-0072 / CDK-080.
 */
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readJsonSafe } from '../../runtime/hooks/safe-io.mjs';
import { readHomeFile } from './home.mjs';
import { aggregateFleet } from './fleet-compliance-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 'cdk-fleet-compliance/1';
const FLEET_NAME = 'fleet.json';

// ---------------------------------------------------------------------------
// Registry loader — mirrors fleet.mjs exactly (read-only)
// ---------------------------------------------------------------------------

/**
 * Loads the fleet registry from the override path (env `CONTEXT_FLEET_FILE`)
 * or from `~/.contextdevkit/fleet.json` via the home helper.
 * Returns `{ repos: [] }` on any failure (§8 — never throws).
 *
 * @returns {{ repos: string[] }}
 */
function loadFleetRegistry() {
  try {
    const override = process.env.CONTEXT_FLEET_FILE || null;
    if (override) {
      const parsed = readJsonSafe(override);
      return parsed && Array.isArray(parsed.repos) ? parsed : { repos: [] };
    }
    const parsed = readHomeFile(FLEET_NAME);
    return parsed && Array.isArray(parsed.repos) ? parsed : { repos: [] };
  } catch {
    return { repos: [] };
  }
}

// ---------------------------------------------------------------------------
// Dynamic import helper
// ---------------------------------------------------------------------------

/**
 * Resolves a sibling path relative to this file and returns a file URL href
 * safe for dynamic import(). Never hard-codes `contextkit/` (rule 4).
 *
 * @param {string} rel relative path from this file's directory
 * @returns {string} file URL href
 */
function siblingUrl(rel) {
  return pathToFileURL(resolve(__dirname, rel)).href;
}

// ---------------------------------------------------------------------------
// Per-repo signal gatherers — each fail-open, returns null on any error
// ---------------------------------------------------------------------------

/**
 * Gathers the capability compliance summary for one repo.
 * Calls loadRegistry + buildComplianceMatrix + summarize from CDK-061.
 *
 * @param {string} repoPath absolute path to the repo
 * @returns {Promise<{ total: number, parity: number, gaps: number }|null>}
 */
async function gatherCompliance(repoPath) {
  try {
    const { loadRegistry, buildComplianceMatrix, summarize } = await import(
      siblingUrl('./capability-compliance.mjs')
    );
    const registry = await loadRegistry(repoPath);
    const matrix = buildComplianceMatrix(registry);
    return summarize(matrix);
  } catch {
    return null;
  }
}

/**
 * Gathers the engineering scorecard for one repo.
 * Returns the overall score/band slice only (full scorecard is not persisted).
 *
 * @param {string} repoPath absolute path to the repo
 * @returns {Promise<{ score: number|null, band: string|null }|null>}
 */
async function gatherScorecard(repoPath) {
  try {
    const { engineeringScorecard } = await import(
      siblingUrl('./engineering-scorecard.mjs')
    );
    const full = await engineeringScorecard(repoPath);
    if (!full || !full.overall) return null;
    return { score: full.overall.score ?? null, band: full.overall.band ?? null };
  } catch {
    return null;
  }
}

/**
 * Gathers the autonomy readiness report for one repo.
 * Returns the ready flag and confidence string only.
 *
 * @param {string} repoPath absolute path to the repo
 * @returns {Promise<{ ready: boolean, confidence: string }|null>}
 */
async function gatherReadiness(repoPath) {
  try {
    const { autonomyReadinessV2 } = await import(
      siblingUrl('./autonomy-readiness-v2.mjs')
    );
    const full = await autonomyReadinessV2(repoPath);
    if (!full || typeof full.ready !== 'boolean') return null;
    return { ready: full.ready, confidence: full.confidence ?? 'unknown' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-repo scanner
// ---------------------------------------------------------------------------

/**
 * Scans one repo: calls all three signal gatherers concurrently (fail-open).
 * If all three fail → ok:false, all fields null. If any succeed → ok:true.
 *
 * @param {string} repoPath absolute path to the registered repo
 * @returns {Promise<{
 *   path: string,
 *   name: string,
 *   ok: boolean,
 *   compliance: { total: number, parity: number, gaps: number }|null,
 *   scorecard: { score: number|null, band: string|null }|null,
 *   readiness: { ready: boolean, confidence: string }|null
 * }>}
 */
async function scanRepo(repoPath) {
  const [compliance, scorecard, readiness] = await Promise.all([
    gatherCompliance(repoPath),
    gatherScorecard(repoPath),
    gatherReadiness(repoPath),
  ]);

  const atLeastOneSucceeded =
    compliance !== null || scorecard !== null || readiness !== null;

  return {
    path: repoPath,
    name: basename(repoPath),
    ok: atLeastOneSucceeded,
    compliance,
    scorecard,
    readiness,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the cross-fleet compliance summary.
 *
 * Reads the fleet registry, scans every registered repo fail-open, then
 * delegates aggregation to the pure core (fleet-compliance-core.mjs).
 * Never throws; always resolves to a structurally valid summary.
 *
 * @param {object} [opts] reserved for future use
 * @returns {Promise<{
 *   schemaVersion: string,
 *   repos: Array<{
 *     path: string,
 *     name: string,
 *     ok: boolean,
 *     compliance: { total: number, parity: number, gaps: number }|null,
 *     scorecard: { score: number|null, band: string|null }|null,
 *     readiness: { ready: boolean, confidence: string }|null
 *   }>,
 *   totals: {
 *     repos: number,
 *     scanned: number,
 *     avgComplianceParityPct: number|null,
 *     weakest: string|null,
 *     leastReady: string|null
 *   },
 *   sources: { present: string[], skipped: string[] }
 * }>}
 */
export async function buildFleetCompliance(_opts) {
  const { repos } = loadFleetRegistry();

  if (!repos.length) {
    return {
      schemaVersion: SCHEMA_VERSION,
      repos: [],
      totals: { repos: 0, scanned: 0, avgComplianceParityPct: null, weakest: null, leastReady: null },
      sources: { present: [], skipped: [] },
    };
  }

  // Scan all repos concurrently — each is fail-open.
  const perRepo = await Promise.all(repos.map(scanRepo));
  const { totals, sources } = aggregateFleet(perRepo);

  return { schemaVersion: SCHEMA_VERSION, repos: perRepo, totals, sources };
}

// ---------------------------------------------------------------------------
// CLI — advisory, always exits 0
// ---------------------------------------------------------------------------

/**
 * Determines whether this module is the direct CLI entrypoint.
 * Prevents CLI execution on import.
 *
 * @returns {boolean}
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isMain()) {
  const jsonFlag = process.argv.slice(2).includes('--json');

  buildFleetCompliance()
    .then((summary) => {
      if (jsonFlag) {
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      } else {
        const { totals, repos, sources } = summary;
        console.log('\n[fleet-compliance] CDK-080 — Cross-Fleet Compliance Rollup\n');
        console.log(
          `  Repos: ${totals.repos}  Scanned: ${totals.scanned}` +
          `  Avg parity: ${totals.avgComplianceParityPct !== null ? totals.avgComplianceParityPct + '%' : 'n/a'}`,
        );
        if (totals.weakest) console.log(`  Weakest compliance : ${totals.weakest}`);
        if (totals.leastReady) console.log(`  Least ready        : ${totals.leastReady}`);
        console.log('');
        for (const r of repos) {
          const compStr = r.compliance
            ? `parity ${r.compliance.parity}/${r.compliance.total}`
            : 'compliance n/a';
          const scoreStr = r.scorecard && r.scorecard.score !== null
            ? `score ${r.scorecard.score} (${r.scorecard.band})`
            : 'scorecard n/a';
          const readyStr = r.readiness !== null
            ? (r.readiness.ready ? 'READY' : 'NOT READY')
            : 'readiness n/a';
          console.log(`  ${r.name.padEnd(30)} ${compStr.padEnd(22)} ${scoreStr.padEnd(22)} ${readyStr}`);
        }
        if (!repos.length) console.log('  No repos registered. Add one with: fleet.mjs add <path>');
        console.log(`\n  Sources present : ${sources.present.join(', ') || 'none'}`);
        console.log(`  Sources skipped : ${sources.skipped.join(', ') || 'none'}`);
        console.log('');
      }
      process.exit(0);
    })
    .catch((err) => {
      // Fail-open: print friendly message, always exit 0.
      process.stderr.write(`[fleet-compliance] unexpected error: ${err?.message ?? err}\n`);
      process.exit(0);
    });
}
