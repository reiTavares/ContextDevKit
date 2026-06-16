#!/usr/bin/env node
/**
 * evidence-taxonomy.mjs — I/O orchestration + CLI for CDK-075.
 *
 * Loads the real RESULTS enumeration + capability registry, builds the canonical
 * evidence taxonomy, then measures coverage across the full lineage graph.
 * Advisory + read-only + UNREGISTERED — never writes, always exits 0.
 *
 * Design decisions:
 *   - Fail-open on registry: a missing or unparseable registry → evidenceTypes
 *     derived from RESULTS only (no throw; registry listed in sources.skipped).
 *   - Paths resolved exclusively via pathsFor() — no 'contextkit/' literals.
 *   - isMain() guard prevents CLI execution on import.
 *
 * Zero runtime deps — node:* + kit modules only.
 * ADR-0072 / CDK-075. ≤ 308 lines.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathsFor } from '../../runtime/config/paths.mjs';
import { RESULTS } from '../../runtime/execution/receipt-store.mjs';
import { loadRegistry } from '../../runtime/capabilities/resolve-capabilities.mjs';
import { buildLineage } from './lineage-graph.mjs';
import { buildTaxonomy, taxonomyCoverage } from './evidence-taxonomy-core.mjs';

const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the canonical evidence taxonomy report for `root`.
 *
 * 1. Imports RESULTS from receipt-store and registry via loadRegistry().
 *    If the registry file is absent/unparseable, loadRegistry() returns the
 *    embedded fallback — still a valid registry. Only a truly missing or empty
 *    capabilities array is treated as "skipped" (no receiptType values → no
 *    artifact kinds derived).
 * 2. Builds the taxonomy via buildTaxonomy().
 * 3. Builds the lineage graph (fail-open) via buildLineage().
 * 4. Folds coverage via taxonomyCoverage().
 *
 * Always returns a valid object — never throws.
 *
 * @param {string} [root]  project root (defaults to process.cwd())
 * @returns {Promise<{
 *   schemaVersion: number,
 *   taxonomy: { outcomeCount: number, evidenceTypeCount: number },
 *   coverage: import('./evidence-taxonomy-core.mjs').CoverageResult,
 *   sources: { present: string[], skipped: string[] }
 * }>}
 */
export async function evidenceTaxonomy(root = process.cwd()) {
  const sourcesPresent = [];
  const sourcesSkipped = [];

  // -- Load registry (fail-open: loadRegistry never throws — returns fallback)
  let registry;
  let registrySkipped = false;
  try {
    registry = loadRegistry(root);
    const capCount = Array.isArray(registry?.capabilities) ? registry.capabilities.length : 0;
    if (capCount > 0) sourcesPresent.push('registry');
    else {
      sourcesSkipped.push('registry');
      registrySkipped = true;
    }
  } catch {
    // Should never happen (loadRegistry is defensive), but guard anyway.
    registry = { version: 1, capabilities: [] };
    sourcesSkipped.push('registry');
    registrySkipped = true;
  }

  // When registry is truly empty, build taxonomy from RESULTS only (§ spec).
  const taxonomyRegistry = registrySkipped ? { version: 1, capabilities: [] } : registry;
  const taxonomy = buildTaxonomy(RESULTS, taxonomyRegistry);

  // -- Build lineage graph (fail-open; graph module is already advisory)
  let graph = { nodes: [], edges: [], stats: { sources: { present: [], skipped: [] } } };
  try {
    graph = await buildLineage(root);
    const graphPresent = graph?.stats?.sources?.present ?? [];
    const graphSkipped = graph?.stats?.sources?.skipped ?? [];
    // Merge lineage source tracking into our own lists (deduplicated).
    for (const s of graphPresent) {
      if (!sourcesPresent.includes(s)) sourcesPresent.push(s);
    }
    for (const s of graphSkipped) {
      if (!sourcesSkipped.includes(s)) sourcesSkipped.push(s);
    }
  } catch {
    sourcesSkipped.push('lineage-graph');
  }

  // -- Coverage fold
  const coverage = taxonomyCoverage(graph, taxonomy);

  return {
    schemaVersion: SCHEMA_VERSION,
    taxonomy: {
      outcomeCount: taxonomy.outcomes.length,
      evidenceTypeCount: taxonomy.evidenceTypes.length,
    },
    coverage,
    sources: { present: sourcesPresent, skipped: sourcesSkipped },
  };
}

// ---------------------------------------------------------------------------
// CLI — advisory, always exits 0
// ---------------------------------------------------------------------------

/**
 * Determines if this module is the direct entrypoint.
 * Prevents CLI execution when the file is imported as a library.
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
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const root = process.cwd();

  evidenceTaxonomy(root)
    .then((report) => {
      if (jsonFlag) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const { taxonomy, coverage, sources } = report;
        console.log('\n[evidence-taxonomy] CDK-075 — Canonical Evidence Taxonomy\n');
        console.log(`  Outcome kinds    : ${taxonomy.outcomeCount}`);
        console.log(`  Artifact types   : ${taxonomy.evidenceTypeCount}`);
        console.log(`  Receipts in graph: ${coverage.receipts}`);
        if (coverage.unknownKinds.length > 0) {
          console.log(`  ⚠ Unknown kinds  : ${coverage.unknownKinds.join(', ')}`);
        } else {
          console.log('  Unknown kinds    : none (all receipt results match taxonomy)');
        }
        console.log(`  Sources present  : ${sources.present.join(', ') || 'none'}`);
        console.log(`  Sources skipped  : ${sources.skipped.join(', ') || 'none'}`);
        console.log();
      }
      process.exit(0);
    })
    .catch((err) => {
      // Fail-open: never break real work; log to stderr only.
      process.stderr.write(`[evidence-taxonomy] unexpected error: ${err?.message ?? err}\n`);
      process.exit(0);
    });
}
