#!/usr/bin/env node
/**
 * engineering-scorecard.mjs — I/O orchestration + CLI for CDK-076.
 *
 * Composes seven advisory signals from CDK-07x tools into a multi-dimension
 * engineering health scorecard. Read-only, advisory, UNREGISTERED, fail-open.
 *
 * §8 contract: every signal is gathered in its own try/catch. A thrown or absent
 * input → its field null → that dimension skipped. A skipped dimension is NEVER
 * scored as 0 and NEVER counted toward the overall mean — honest silence only.
 *
 * Signal sources:
 *   lineageGraph   — buildLineage()         (CDK-070 / lineage-graph.mjs)
 *   calibration    — lineageCalibration()   (CDK-072 / lineage-calibration.mjs)
 *   rules          — runRules()             (CDK-073 / lineage-rules.mjs)
 *   taxonomy       — evidenceTaxonomy()     (CDK-075 / evidence-taxonomy.mjs)
 *   compliance     — buildComplianceMatrix  (CDK-061 / capability-compliance.mjs)
 *   benchmark      — summarize()            (CDK-065 / benchmark-task.mjs)
 *
 * Design decisions:
 *   - Paths resolved via pathToFileURL for portability (rule 4 — no 'contextkit/' literals).
 *   - CLI `node engineering-scorecard.mjs [--json]` always exits 0.
 *   - isMain() guard prevents CLI execution on import.
 *
 * Zero runtime dependencies — node:* + sibling kit modules only.
 * ADR-0072 / CDK-076. ≤ 308 lines.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scoreDimensions } from './engineering-scorecard-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Dynamic import helpers — pathToFileURL for cross-platform portability
// ---------------------------------------------------------------------------

/**
 * Resolves a path relative to this file's directory and returns a file URL string.
 * Using pathToFileURL (not a hand-rolled regex) satisfies rule 4.
 *
 * @param {string} rel relative path from this file's directory
 * @returns {string} file URL href safe for dynamic import()
 */
function siblingUrl(rel) {
  return pathToFileURL(resolve(__dirname, rel)).href;
}

// ---------------------------------------------------------------------------
// Signal gatherers — each fail-open
// ---------------------------------------------------------------------------

/**
 * Gathers the lineage graph. Returns null on any error.
 *
 * @param {string} root project root
 * @returns {Promise<object|null>}
 */
async function gatherLineageGraph(root) {
  try {
    const { buildLineage } = await import(siblingUrl('./lineage-graph.mjs'));
    return await buildLineage(root);
  } catch {
    return null;
  }
}

/**
 * Gathers the lineage calibration report. Returns null on any error.
 *
 * @param {string} root project root
 * @returns {Promise<object|null>}
 */
async function gatherCalibration(root) {
  try {
    const { lineageCalibration } = await import(siblingUrl('./lineage-calibration.mjs'));
    return await lineageCalibration(root);
  } catch {
    return null;
  }
}

/**
 * Gathers the lineage rules report. Returns null on any error.
 *
 * @param {string} root project root
 * @returns {Promise<object|null>}
 */
async function gatherRules(root) {
  try {
    const { runRules } = await import(siblingUrl('./lineage-rules.mjs'));
    return await runRules(root);
  } catch {
    return null;
  }
}

/**
 * Gathers the evidence taxonomy report. Returns null on any error.
 *
 * @param {string} root project root
 * @returns {Promise<object|null>}
 */
async function gatherTaxonomy(root) {
  try {
    const { evidenceTaxonomy } = await import(siblingUrl('./evidence-taxonomy.mjs'));
    return await evidenceTaxonomy(root);
  } catch {
    return null;
  }
}

/**
 * Gathers the capability compliance summary. Returns null on any error.
 * Loads loadRegistry via pathToFileURL — no 'contextkit/' literal in resolve.
 *
 * @param {string} root project root
 * @returns {Promise<{total:number,parity:number,gaps:number}|null>}
 */
async function gatherCompliance(root) {
  try {
    const { buildComplianceMatrix, summarize, loadRegistry } = await import(
      siblingUrl('./capability-compliance.mjs')
    );
    const registry = loadRegistry(root);
    const matrix = buildComplianceMatrix(registry);
    return summarize(matrix);
  } catch {
    return null;
  }
}

/**
 * Gathers the benchmark summary from the advisory ledger.
 * Treats a missing ledger (count === 0 from an empty readLedger) as skipped.
 * Returns null on any error so the dimension is correctly marked skipped.
 *
 * @param {string} root project root
 * @returns {Promise<{count:number,completedCount:number,totalTokens:number,tokensPerCompletedTask:number}|null>}
 */
async function gatherBenchmark(root) {
  try {
    const { summarize } = await import(siblingUrl('./benchmark-task.mjs'));
    // summarize() reads the ledger via defaultLedgerPath() which uses process.cwd();
    // pass undefined records so it reads from disk.
    const summary = summarize(undefined, {});
    // count === 0 → no ledger or empty → caller's scorer will mark as skipped
    return summary;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the engineering scorecard for the given project root.
 *
 * Each signal source is gathered fail-open in its own try/catch. A failed or
 * missing source → null field → the corresponding dimension is skipped (§8).
 * The returned object is always structurally valid — never throws.
 *
 * @param {string} [root] project root (defaults to process.cwd())
 * @returns {Promise<{
 *   schemaVersion: number,
 *   dimensions: import('./engineering-scorecard-core.mjs').Dimension[],
 *   overall: import('./engineering-scorecard-core.mjs').OverallScore,
 *   sources: { present: string[], skipped: string[] }
 * }>}
 */
export async function engineeringScorecard(root = process.cwd()) {
  const sourcesPresent = [];
  const sourcesSkipped = [];

  /**
   * Wraps a gatherer in consistent source tracking.
   * If the gatherer returns a meaningful result → present; else → skipped.
   *
   * @template T
   * @param {string} name signal source name
   * @param {() => Promise<T|null>} gatherer
   * @returns {Promise<T|null>}
   */
  async function gather(name, gatherer) {
    try {
      const gathered = await gatherer();
      if (gathered !== null && gathered !== undefined) {
        sourcesPresent.push(name);
        return gathered;
      }
      sourcesSkipped.push(name);
      return null;
    } catch {
      sourcesSkipped.push(name);
      return null;
    }
  }

  // Gather all signals concurrently — each is independent and fail-open.
  const [lineageGraph, calibration, rules, taxonomy, compliance, benchmark] =
    await Promise.all([
      gather('lineage-graph', () => gatherLineageGraph(root)),
      gather('calibration', () => gatherCalibration(root)),
      gather('rules', () => gatherRules(root)),
      gather('taxonomy', () => gatherTaxonomy(root)),
      gather('compliance', () => gatherCompliance(root)),
      gather('benchmark', () => gatherBenchmark(root)),
    ]);

  const { dimensions, overall } = scoreDimensions({
    lineageGraph,
    calibration,
    rules,
    taxonomy,
    compliance,
    benchmark,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    dimensions,
    overall,
    sources: { present: sourcesPresent, skipped: sourcesSkipped },
  };
}

// ---------------------------------------------------------------------------
// CLI — advisory, always exits 0
// ---------------------------------------------------------------------------

/**
 * Determines if this module is the direct CLI entrypoint.
 * Prevents CLI execution when imported as a library.
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
  const root = process.cwd();

  engineeringScorecard(root)
    .then((report) => {
      if (jsonFlag) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const { dimensions, overall, sources } = report;
        console.log('\n[engineering-scorecard] CDK-076 — Engineering Health Scorecard\n');
        for (const dim of dimensions) {
          const scoreStr = dim.score !== null ? `${dim.score.toFixed(1).padStart(5)}  ${dim.band}` : '    —  skipped';
          console.log(`  ${dim.key.padEnd(26)} ${scoreStr}  ${dim.detail}`);
        }
        console.log('');
        const overallStr = overall.score !== null
          ? `${overall.score.toFixed(1)} (${overall.band}) — ${overall.confidence} confidence`
          : 'n/a (no dimensions scored)';
        console.log(`  Overall: ${overallStr}`);
        console.log(`  Scored ${overall.scoredCount}/${overall.totalCount} dimensions`);
        console.log(`  Sources present : ${sources.present.join(', ') || 'none'}`);
        console.log(`  Sources skipped : ${sources.skipped.join(', ') || 'none'}`);
        console.log();
      }
      process.exit(0);
    })
    .catch((err) => {
      // Fail-open: log to stderr, exit 0 (advisory tool, never breaks real work).
      process.stderr.write(`[engineering-scorecard] unexpected error: ${err?.message ?? err}\n`);
      process.exit(0);
    });
}
