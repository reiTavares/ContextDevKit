#!/usr/bin/env node
/**
 * lineage-rules.mjs — I/O orchestration + CLI for CDK-073 business rules.
 *
 * Composes buildLineage (CDK-070) with evaluateRules (CDK-073) to produce
 * machine-checkable assertions over the lineage graph.
 *
 * Design decisions:
 *   - Advisory: CLI always exits 0, even when rules fail.
 *   - Read-only: no writes anywhere.
 *   - UNREGISTERED: no gate wires this tool.
 *   - Fail-open: buildLineage errors are caught; rules always get a valid graph.
 *   - Paths resolved via buildLineage — no 'contextkit/' literals here (rule 4).
 *
 * Zero runtime dependencies — node:* + kit internals only.
 * ADR-0072 / CDK-073.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLineage } from './lineage-graph.mjs';
import { DEFAULT_RULES, evaluateRules } from './lineage-rules-core.mjs';

/** Schema version for output envelope — increment on breaking structural changes. */
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the lineage graph then evaluates all business rules against it.
 *
 * @param {string} root  absolute project root
 * @param {{ rules?: import('./lineage-rules-core.mjs').Rule[] }} [opts]
 * @returns {Promise<{ schemaVersion: number, results: object[], summary: object, sources: { present: string[], skipped: string[] } }>}
 */
export async function runRules(root, opts) {
  const rules = opts?.rules ?? DEFAULT_RULES;
  let graph;
  try {
    graph = await buildLineage(root);
  } catch {
    // Fail-open: return a skipped verdict for every rule when the graph cannot be built
    graph = { nodes: [], edges: [], stats: { byType: {}, edgeCount: 0, sources: { present: [], skipped: ['graph-build-failed'] } } };
  }

  const { results, summary } = evaluateRules(graph, rules);
  const sourcesRaw = graph.stats?.sources ?? {};
  const sources = {
    present: Array.isArray(sourcesRaw.present) ? sourcesRaw.present : [],
    skipped: Array.isArray(sourcesRaw.skipped) ? sourcesRaw.skipped : [],
  };

  return { schemaVersion: SCHEMA_VERSION, results, summary, sources };
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/**
 * Renders a human-readable rules report to stdout.
 * @param {{ results: object[], summary: object, sources: object }} report
 */
function renderReport(report) {
  const { results, summary, sources } = report;
  const lines = ['', 'Lineage Business Rules — advisory verdict'];
  lines.push(`  pass: ${summary.pass}  fail: ${summary.fail}  skipped: ${summary.skipped}`);

  if (sources.present.length > 0) lines.push(`  sources present: ${sources.present.join(', ')}`);
  if (sources.skipped.length > 0) lines.push(`  sources skipped: ${sources.skipped.join(', ')}`);

  lines.push('');
  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–';
    lines.push(`  ${icon} [${r.id}] ${r.description} — ${r.status}`);
    if (r.detail) lines.push(`      ${r.detail}`);
    if (r.offenders.length > 0) lines.push(`      offenders: ${r.offenders.join(', ')}`);
  }
  lines.push('');
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// isMain guard
// ---------------------------------------------------------------------------

/**
 * Returns true when this module is the direct CLI entrypoint.
 * Prevents CLI side-effects when imported as a library.
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// CLI entrypoint — advisory, always exits 0
// ---------------------------------------------------------------------------

if (isMain()) {
  const jsonFlag = process.argv.slice(2).includes('--json');
  const root = process.cwd();

  runRules(root)
    .then((report) => {
      if (jsonFlag) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        renderReport(report);
      }
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`[lineage-rules] unexpected error: ${err?.message ?? err}\n`);
      process.exit(0);
    });
}
