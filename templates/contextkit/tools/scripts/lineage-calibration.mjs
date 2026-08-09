#!/usr/bin/env node
/**
 * lineage-calibration.mjs — I/O layer + CLI for CDK-072.
 *
 * Reads prediction files from the predictions store, builds the lineage graph,
 * and calls aggregateCalibration to produce per-workflow + overall accuracy.
 *
 * Design principles:
 *   - Fail-open: missing predictions dir → predictions in sources.skipped,
 *     overall.accuracy === null, no throw (§8).
 *   - Advisory + read-only: never writes to prediction files or any store.
 *   - Paths exclusively via pathsFor() — no 'contextkit/' literals in
 *     resolve()/join() (immutable rule 4).
 *   - CLI always exits 0.
 *   - UNREGISTERED: no gate wires this tool.
 *
 * Zero runtime dependencies — node:* + existing kit readers only.
 * ADR-0072 / CDK-072. ≤ 308 lines.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { buildLineage } from './lineage-graph.mjs';
import { aggregateCalibration } from './lineage-calibration-core.mjs';

// ---------------------------------------------------------------------------
// Prediction file parser
// ---------------------------------------------------------------------------

/**
 * Parses the markdown body for a list of backtick-quoted path items.
 * Matches entries like `src/foo.mjs` in a comma/space separated list.
 *
 * @param {string} line raw markdown line
 * @returns {string[]}
 */
function extractBacktickPaths(line) {
  const matches = line.match(/`([^`]+)`/g);
  if (!matches) return [];
  return matches
    .map((m) => m.slice(1, -1).trim())
    .filter((s) => s.length > 0 && s !== '— none');
}

/**
 * Extracts the 8-char session prefix from a prediction file's body.
 * The line `- **Session**: <prefix>` is written by mark-simulation.mjs.
 *
 * @param {string} content raw file content
 * @returns {string|null}
 */
function extractSessionPrefix(content) {
  const match = content.match(/^- \*\*Session\*\*:\s*([a-z0-9]+)/m);
  return match ? match[1].trim() : null;
}

/**
 * Parses a single prediction markdown file into a PredictionRecord.
 *
 * The "Actual" section (written by predictions-review.mjs) is the source of
 * truth for reviewed status and the predictedMiss / unforeseen arrays.
 *
 * Shape produced (mirrors what predictions-review.mjs writes):
 * ```
 * ## Actual (reviewed <date>)
 * - **Paths actually changed this session**: `a`, `b`
 * - **Predicted ✓ and changed**: `a`
 * - **Predicted ✗ but NOT changed**: `b`      ← predictedMiss
 * - **Changed but NOT predicted**: `c`          ← unforeseen
 * ```
 *
 * @param {string} content raw file content
 * @param {string} _filename file basename (reserved for future use)
 * @returns {{ cardId: null, sessionPrefix: string|null, paths: string[], predictedMiss: string[], unforeseen: string[], reviewed: boolean }}
 */
function parsePredictionFile(content, _filename) {
  const record = {
    cardId: null,
    sessionPrefix: extractSessionPrefix(content),
    paths: [],
    predictedMiss: [],
    unforeseen: [],
    reviewed: false,
  };

  const hasActualSection = /^## Actual/m.test(content);
  // "## Actual — fill on review" is the unreviewed stub; reviewed has a date
  const isReviewed = /^## Actual \(reviewed/m.test(content);
  if (!hasActualSection || !isReviewed) return record;

  record.reviewed = true;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('- **Covered paths**:')) {
      record.paths = extractBacktickPaths(line);
    } else if (line.startsWith('- **Predicted ✗ but NOT changed**:')) {
      record.predictedMiss = extractBacktickPaths(line);
    } else if (line.startsWith('- **Changed but NOT predicted**:')) {
      record.unforeseen = extractBacktickPaths(line);
    }
  }

  return record;
}

// ---------------------------------------------------------------------------
// Prediction store reader (fail-open)
// ---------------------------------------------------------------------------

/**
 * Reads all prediction markdown files from the predictions directory.
 * Returns { records, skipped:bool } — skipped is true when the dir is absent
 * or unreadable (§8: skipped ≠ pass).
 *
 * @param {string} predictionsDir absolute path
 * @returns {{ records: object[], skipped: boolean }}
 */
function readPredictionFiles(predictionsDir) {
  if (!existsSync(predictionsDir)) return { records: [], skipped: true };

  let filenames = [];
  try {
    filenames = readdirSync(predictionsDir).filter((f) => f.endsWith('.md'));
  } catch {
    return { records: [], skipped: true };
  }

  if (filenames.length === 0) return { records: [], skipped: true };

  const records = [];
  for (const filename of filenames) {
    try {
      const content = readFileSync(resolve(predictionsDir, filename), 'utf-8');
      records.push(parsePredictionFile(content, filename));
    } catch {
      // Skip unreadable files — fail-open, never count as pass
    }
  }

  return { records, skipped: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main entry point for CDK-072 lineage calibration.
 *
 * Reads prediction files, builds the lineage graph, and returns an aggregated
 * calibration report. Never throws — all errors produce degraded output.
 *
 * @param {string} root absolute project root
 * @returns {Promise<{
 *   schemaVersion: 1,
 *   perWorkflow: import('./lineage-calibration-core.mjs').WorkflowCalibration[],
 *   overall: import('./lineage-calibration-core.mjs').OverallCalibration,
 *   sources: { present: string[], skipped: string[] }
 * }>}
 */
export async function lineageCalibration(root) {
  const paths = pathsFor(root);
  const sourcesPresent = [];
  const sourcesSkipped = [];

  // Read prediction files (fail-open)
  const { records: predictionRecords, skipped: predSkipped } = readPredictionFiles(paths.predictions);
  if (predSkipped) {
    sourcesSkipped.push('predictions');
  } else {
    sourcesPresent.push('predictions');
  }

  // Build lineage graph (fail-open — buildLineage never throws)
  let graph = { nodes: [], edges: [], stats: { sources: { present: [], skipped: [] } } };
  try {
    graph = await buildLineage(root);
    for (const src of (graph.stats?.sources?.present ?? [])) {
      if (!sourcesPresent.includes(src)) sourcesPresent.push(src);
    }
    for (const src of (graph.stats?.sources?.skipped ?? [])) {
      if (!sourcesSkipped.includes(src)) sourcesSkipped.push(src);
    }
  } catch {
    // Complete graph failure — proceed with empty graph
    sourcesSkipped.push('lineage-graph');
  }

  // When no predictions dir → accuracy null, perWorkflow empty (§8)
  if (predSkipped) {
    return {
      schemaVersion: 1,
      perWorkflow: [],
      overall: { predictions: 0, hits: 0, misses: 0, accuracy: null, confidence: 'derived' },
      sources: { present: sourcesPresent, skipped: sourcesSkipped },
    };
  }

  const { perWorkflow, overall } = aggregateCalibration(predictionRecords, graph);

  return {
    schemaVersion: 1,
    perWorkflow,
    overall,
    sources: { present: sourcesPresent, skipped: sourcesSkipped },
  };
}

// ---------------------------------------------------------------------------
// isMain guard
// ---------------------------------------------------------------------------

/**
 * Determines if this module is the direct CLI entrypoint.
 * @returns {boolean}
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isMain()) {
  const jsonFlag = process.argv.includes('--json');
  const root = process.cwd();

  lineageCalibration(root)
    .then((report) => {
      if (jsonFlag) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const { overall, perWorkflow, sources } = report;
        const acc = overall.accuracy === null ? 'n/a (no reviewed predictions)'
          : `${(overall.accuracy * 100).toFixed(1)}%`;
        console.log(`Lineage calibration — overall accuracy: ${acc}`);
        console.log(`  predictions: ${overall.predictions}  hits: ${overall.hits}  misses: ${overall.misses}`);
        if (perWorkflow.length > 0) {
          console.log('\nPer-workflow:');
          for (const wf of perWorkflow) {
            const wfAcc = wf.accuracy === null ? 'n/a' : `${(wf.accuracy * 100).toFixed(1)}%`;
            console.log(`  ${wf.slug}: accuracy=${wfAcc} predictions=${wf.predictions} hits=${wf.hits} misses=${wf.misses}`);
          }
        }
        console.log(`\nSources present: ${sources.present.join(', ') || 'none'}`);
        console.log(`Sources skipped: ${sources.skipped.join(', ') || 'none'}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      // Fail-open: log to stderr, exit 0 (advisory tool, never breaks real work)
      process.stderr.write(`[lineage-calibration] unexpected error: ${err?.message ?? err}\n`);
      process.exit(0);
    });
}
