/**
 * ADR Anti-Redundancy Checker — orchestrator + CLI (BIZ-0001 / WF-0037, B4-T1).
 *
 * Flags duplicate or overlapping decisions across the full ADR corpus (legacy
 * NNNN-slug.md + new-format ADR-#### front-matter files). Reports findings;
 * NEVER auto-deletes or modifies any file (constitution §8: report, don't act).
 *
 * Detection passes live in `adr-redundancy-core.mjs` (SRP split):
 *   1. Exact id duplicates across both legacy and new rows.
 *   2. Slug similarity (same normalised slug or prefix match).
 *   3. Title token overlap — Jaccard similarity ≥ threshold (default 0.6).
 *   4. ValueIntent + context + kind triple overlap (new-format only).
 *
 * Reuses:
 *   - `indexLegacyAdrsDirs` (adr-index.mjs) for legacy discovery.
 *   - `buildDecisionRegistry` (registry/decision.mjs) for new-format rows.
 *
 * Zero runtime dependencies — `node:*` only. Pure: no writes, no side effects.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { indexLegacyAdrsDirs } from './adr-index.mjs';
import {
  detectIdDuplicates,
  detectSlugSimilarity,
  detectTitleOverlap,
  detectValueIntentOverlap,
} from './adr-redundancy-core.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(SCRIPT_DIR, 'registry/decision.mjs');

// ---------------------------------------------------------------------------
// Fail-open registry import
// ---------------------------------------------------------------------------

/** Attempt to build the decision registry; returns null on any error. */
async function tryBuildRegistry(root) {
  try {
    const mod = await import(REGISTRY_PATH);
    if (typeof mod.buildDecisionRegistry === 'function') {
      return mod.buildDecisionRegistry(root);
    }
  } catch {
    // fail-open
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of a redundancy check.
 *
 * @typedef {object} RedundancyReport
 * @property {number}   totalRows       - combined legacy + new row count.
 * @property {number}   legacyCount     - legacy ADR row count.
 * @property {number}   newCount        - new-format ADR row count.
 * @property {object[]} findings        - flagged redundancy issues.
 * @property {number}   findingCount    - total findings.
 * @property {boolean}  hasRedundancies - true when any finding exists.
 */

/**
 * Checks for duplicate/overlapping decisions across the full ADR corpus under
 * `root`. Pure read path: no file is ever modified.
 *
 * @param {string}  root         - absolute project root.
 * @param {object} [opts]
 * @param {number} [opts.titleThreshold=0.6] - Jaccard threshold for title overlap.
 * @returns {Promise<RedundancyReport>}
 */
export async function checkAdrRedundancy(root, opts = {}) {
  const resolvedRoot = resolve(String(root));
  const titleThreshold = opts.titleThreshold ?? 0.6;

  // Discover legacy entries
  const decisionsRoot = resolve(resolvedRoot, 'contextkit', 'memory', 'decisions');
  const legacyDir = resolve(decisionsRoot, 'legacy');
  const dirs = [decisionsRoot, legacyDir].filter(existsSync);
  const legacyEntries = indexLegacyAdrsDirs(dirs, { recursive: false });

  // Discover new-format rows (fail-open)
  const registry = await tryBuildRegistry(resolvedRoot);
  const newRows = registry
    ? registry.decisions.filter((r) => r.format === 'new')
    : [];

  // Unify into one list for cross-format checks
  const allRows = [
    ...legacyEntries.map((e) => ({ ...e, path: e.absolutePath })),
    ...newRows,
  ];

  const findings = [
    ...detectIdDuplicates(allRows),
    ...detectSlugSimilarity(allRows),
    ...detectTitleOverlap(allRows, titleThreshold),
    ...detectValueIntentOverlap(newRows),
  ];

  return {
    totalRows: allRows.length,
    legacyCount: legacyEntries.length,
    newCount: newRows.length,
    findings,
    findingCount: findings.length,
    hasRedundancies: findings.length > 0,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point — node adr-redundancy.mjs [--root=] [--json] [--threshold=]
// ---------------------------------------------------------------------------

function parseCliFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--json') flags.json = true;
    else if (t === '--root' && argv[i + 1]) { flags.root = argv[i + 1]; i += 1; }
    else if (t.startsWith('--root=')) flags.root = t.slice(7);
    else if (t.startsWith('--threshold=')) flags.threshold = parseFloat(t.slice(12));
  }
  return flags;
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2));
  const report = await checkAdrRedundancy(flags.root ?? process.cwd(), {
    titleThreshold: flags.threshold,
  });
  if (flags.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return; }
  console.log(`adr-redundancy: ${report.totalRows} rows (${report.legacyCount} legacy, ${report.newCount} new-format)`);
  if (!report.hasRedundancies) {
    console.log('  no redundancies detected.');
    return;
  }
  console.log(`  ${report.findingCount} finding(s):`);
  for (const f of report.findings) {
    console.log(`  [${f.kind}] ${f.message}`);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
