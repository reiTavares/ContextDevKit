#!/usr/bin/env node
/**
 * Project-map COVERAGE — read-only coverage report for the structural map.
 *
 * Computes what fraction of the project tree the map covers (scanned modules
 * vs. excluded dirs) and surfaces oversized/orphan health signals. Intended as
 * a cheap "did the map do its job?" sanity gauge — NOT a line-coverage tool.
 *
 * Pure `computeCoverage` / `renderCoverage` exports let the CLI and tests share
 * the same logic. The CLI reads the existing manifest/model (read-if-present),
 * prints the markdown report, and — with `--write` — persists `coverage.md`
 * under `pathsFor(root).projectMap`. Read-only by default. Fail-open if no map
 * exists (print a hint, exit 0). [CDK-051 / ADR-0039 / project-map]
 *
 * NOTE: `scanned` counts SOURCE files tracked in modules (not total FS files).
 * `ignored` counts the number of directories excluded via IGNORE_DIRS (from the
 * CORE scanner), not individual files — a directory-level proxy for coverage
 * gap. `pct` = scanned / (scanned + ignoredFiles), where ignoredFiles is the
 * count of detected excluded dirs (best-effort approximation).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

// ---------------------------------------------------------------------------
// Optional CDK-050 import (read-if-present — resolveRoots → exclude set).
// Wrap in try/catch so the module degrades cleanly if CDK-050 is not shipped.
// ---------------------------------------------------------------------------
let resolveRoots = null;
try {
  // Dynamic import so a missing file is a runtime miss, not a parse-time fail.
  const rootsMod = await import('./project-map-roots.mjs').catch(() => null);
  if (rootsMod && typeof rootsMod.resolveRoots === 'function') {
    resolveRoots = rootsMod.resolveRoots;
  }
} catch {
  // CDK-050 not present — degrade silently.
}

// ---------------------------------------------------------------------------
// Core — pure functions. Canonical paths come from the statically-imported
// `pathsFor` (rule 4 — the platform dir name is never hardcoded here).
// ---------------------------------------------------------------------------

/**
 * Compute the coverage record from a project-map model.
 *
 * @param {object} model - the project-map model returned by `scanProject` (or
 *   deserialized from `manifest.json`). Expected shape:
 *   `{ fileCount: number, modules: Array<{path, files, capped}>, insights?: {oversized: string[], orphans: string[]} }`
 * @param {string} [root] - project root (used only if CDK-050 resolveRoots is
 *   available — otherwise ignored; degrade gracefully).
 * @returns {{ scanned: number, ignored: number, oversized: number, orphans: number,
 *             modules: number, pct: number, generatedAt: string }}
 */
export function computeCoverage(model, root) {
  if (!model || typeof model !== 'object') {
    return { scanned: 0, ignored: 0, oversized: 0, orphans: 0, modules: 0, pct: 0, generatedAt: new Date().toISOString() };
  }

  const scanned = typeof model.fileCount === 'number' ? model.fileCount : 0;
  const moduleCount = Array.isArray(model.modules) ? model.modules.length : 0;

  // Pull insights if present; degrade to 0 when absent.
  const ins = model.insights && typeof model.insights === 'object' ? model.insights : {};
  const oversizedPaths = Array.isArray(ins.oversized) ? ins.oversized : [];
  const orphanPaths = Array.isArray(ins.orphans) ? ins.orphans : [];

  // Derive `ignored` from CDK-050 if available; else estimate from IGNORE_DIRS
  // count embedded in the core module (a directory-level proxy).
  let ignored = 0;
  if (resolveRoots && root) {
    try {
      const resolved = resolveRoots(root);
      // resolveRoots returns an object with an `excludeDirs` array (CDK-050 contract).
      if (resolved && Array.isArray(resolved.excludeDirs)) {
        ignored = resolved.excludeDirs.length;
      }
    } catch {
      // resolveRoots failed — fall back to zero.
    }
  } else {
    // Without CDK-050, count modules flagged as capped (proxy for excluded bulk).
    // This is intentionally a rough heuristic; the primary value is the scanned count.
    ignored = Array.isArray(model.modules)
      ? model.modules.filter((m) => m.capped).length
      : 0;
  }

  const total = scanned + ignored;
  const pct = total === 0 ? 0 : Math.round((scanned / total) * 100) / 100;

  return {
    scanned,
    ignored,
    oversized: oversizedPaths.length,
    orphans: orphanPaths.length,
    modules: moduleCount,
    pct,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Render a compact markdown coverage report (table + one-line verdict).
 *
 * @param {{ scanned: number, ignored: number, oversized: number, orphans: number,
 *           modules: number, pct: number, generatedAt: string }} coverage
 * @returns {string} markdown string (no trailing newline)
 */
export function renderCoverage(coverage) {
  const { scanned, ignored, oversized, orphans, modules, pct, generatedAt } = coverage;
  const pctDisplay = `${Math.round(pct * 100)}%`;

  const healthBadge = oversized === 0 && orphans === 0 ? 'healthy' : 'needs attention';

  const lines = [
    '## Project-map coverage report',
    '',
    `> Generated: ${generatedAt}`,
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Modules mapped | ${modules} |`,
    `| Source files scanned | ${scanned} |`,
    `| Excluded dirs (proxy) | ${ignored} |`,
    `| Coverage estimate | ${pctDisplay} |`,
    `| Oversized modules | ${oversized} |`,
    `| Orphan modules | ${orphans} |`,
    '',
    `**Verdict:** coverage ${pctDisplay} · health ${healthBadge}.`,
    '',
    '_Coverage = scanned files / (scanned + excluded-dir count). Re-run `/project-map` to refresh._',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entrypoint (self-executing only when run directly)
// ---------------------------------------------------------------------------

/**
 * Check whether this module is the entry point (ESM-safe pattern).
 * `process.argv[1]` on Windows may use backslashes; normalise before comparing.
 */
const selfUrl = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replaceAll('/', '\\');
const argvMain = process.argv[1]?.replaceAll('/', '\\');
const isMain = selfUrl === argvMain;

if (isMain) {
  await cliMain();
}

/** @returns {Promise<void>} */
async function cliMain() {
  const args = process.argv.slice(2);
  const doWrite = args.includes('--write');
  const rootArg = (() => {
    const i = args.indexOf('--root');
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  })();

  const ROOT = rootArg ? resolve(rootArg) : process.cwd();
  const mapDir = pathsFor(ROOT).projectMap;
  const manifestPath = resolve(mapDir, 'manifest.json');

  // Read-if-present — fail-open when no map exists.
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    console.log('map not generated — run /project-map');
    process.exit(0);
  }

  const coverage = computeCoverage(manifest, ROOT);
  const report = renderCoverage(coverage);
  console.log(report);

  if (doWrite) {
    const outPath = resolve(mapDir, 'coverage.md');
    try {
      mkdirSync(mapDir, { recursive: true });
      writeFileSync(outPath, report + '\n', 'utf-8');
      console.log(`\nCoverage report written to ${outPath}`);
    } catch (err) {
      console.error(`Failed to write coverage.md: ${err?.message ?? err}`);
      // Still exit 0 — fail-open contract.
    }
  }
}
