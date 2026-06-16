#!/usr/bin/env node
/**
 * lineage-public.mjs — I/O + CLI for CDK-071: public ADR/lineage projection.
 *
 * Reads the full lineage graph via buildLineage() and projects it to a
 * public-safe view via redactGraph() (strips all internal fields).
 *
 * Design decisions:
 *   - Read-only: no writes to any store.
 *   - Fail-open: on any error, writes to stderr and exits 0 (advisory).
 *   - Advisory + unregistered: never wires into any gate.
 *   - Paths resolved via the graph API only — no 'contextkit/' literals.
 *
 * CDK-071 / ADR-0072. Zero runtime dependencies. ≤ 308 lines.
 *
 * @module lineage-public
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLineage } from './lineage-graph.mjs';
import { redactGraph } from './lineage-public-core.mjs';

/** Schema version for the public projection output shape. */
const SCHEMA_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Projects the lineage graph to a public-safe ADR catalog view.
 * Never throws — fail-open on any I/O or parse error.
 *
 * @param {string} root  absolute project root
 * @param {{ cardId?: string, adr?: string }} [opts]  passed through to buildLineage
 * @returns {Promise<{
 *   schemaVersion: string,
 *   adrs: Array<{ number: string, title: string, status: string, decision: string }>,
 *   edges: Array<{ from: string, to: string, rel: string }>,
 *   stats: { adrCount: number, edgeCount: number },
 *   redacted: string[],
 *   sources: { present: string[], skipped: string[] },
 * }>}
 */
export async function projectPublicLineage(root, opts) {
  let graph;
  try {
    graph = await buildLineage(root, opts);
  } catch (buildErr) {
    // Fail-open: return an empty public view with error context in sources
    process.stderr.write(
      `[lineage-public] buildLineage failed: ${buildErr?.message ?? buildErr}\n`,
    );
    graph = { nodes: [], edges: [], stats: { byType: {}, edgeCount: 0, sources: { present: [], skipped: ['adrs', 'workflows', 'cards', 'receipts', 'sessions', 'telemetry'] } } };
  }

  const publicView = redactGraph(graph);
  const sourcesRaw = graph.stats?.sources;
  const sources = {
    present: Array.isArray(sourcesRaw?.present) ? sourcesRaw.present : [],
    skipped: Array.isArray(sourcesRaw?.skipped) ? sourcesRaw.skipped : [],
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    adrs:          publicView.adrs,
    edges:         publicView.edges,
    stats: {
      adrCount:  publicView.adrs.length,
      edgeCount: publicView.edges.length,
    },
    redacted: publicView.redacted,
    sources,
  };
}

// ---------------------------------------------------------------------------
// Digest renderer (human-readable summary for non-JSON CLI output)
// ---------------------------------------------------------------------------

/**
 * Renders a compact human-readable summary of the public lineage view.
 *
 * @param {object} publicLineage  result of projectPublicLineage()
 * @returns {string}
 */
function renderPublicDigest(publicLineage) {
  const { adrs, edges, stats, sources, redacted } = publicLineage;
  const lines = [
    `Public lineage: ${stats.adrCount} ADRs, ${stats.edgeCount} public edges`,
  ];

  for (const adr of (adrs ?? [])) {
    const decision = adr.decision ? ` — ${adr.decision.slice(0, 80)}` : '';
    lines.push(`  ADR-${adr.number} [${adr.status || '?'}] ${adr.title}${decision}`);
  }

  if (sources.present.length > 0) lines.push(`  sources present: ${sources.present.join(', ')}`);
  if (sources.skipped.length > 0) lines.push(`  sources skipped: ${sources.skipped.join(', ')}`);

  if (redacted && redacted.length > 0) {
    lines.push(`  redacted fields: ${redacted.join(', ')}`);
  }

  if (edges.length > 0) {
    lines.push('', 'Public edges (adr-to-adr only):');
    for (const edge of edges.slice(0, 20)) {
      lines.push(`  ${edge.from} --${edge.rel}--> ${edge.to}`);
    }
    if (edges.length > 20) lines.push(`  … and ${edges.length - 20} more`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI guard
// ---------------------------------------------------------------------------

/**
 * Returns true when this module is the direct Node.js entrypoint.
 * Guards CLI code so imports don't trigger side-effects.
 *
 * @returns {boolean}
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// CLI — advisory, always exits 0
// ---------------------------------------------------------------------------

if (isMain()) {
  const args     = process.argv.slice(2);
  const jsonFlag = args.includes('--json');

  const root = process.cwd();
  projectPublicLineage(root)
    .then((publicLineage) => {
      if (jsonFlag) {
        console.log(JSON.stringify(publicLineage, null, 2));
      } else {
        console.log(renderPublicDigest(publicLineage));
      }
      process.exit(0);
    })
    .catch((unexpectedErr) => {
      // Fail-open: log to stderr, exit 0 (advisory tool, never breaks real work)
      process.stderr.write(
        `[lineage-public] unexpected error: ${unexpectedErr?.message ?? unexpectedErr}\n`,
      );
      process.exit(0);
    });
}
