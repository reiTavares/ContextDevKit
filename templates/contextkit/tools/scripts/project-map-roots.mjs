#!/usr/bin/env node
/**
 * project-map-roots — configurable roots and exclude resolution for the
 * project-map scanner (CDK-050, PKG-05).
 *
 * WHY this module exists: `project-map-core.mjs` used a flat `IGNORE_DIRS` Set
 * that matched directory ENTRIES by bare basename at EVERY depth. That caused a
 * correctness bug in the ContextDevKit dogfood self-map: scanning
 * `templates/contextkit/…` was skipped because the entry named `contextkit`
 * matched the exclude set, even though the developer only wanted to skip the
 * INSTALLED top-level `./contextkit/` platform folder. The fix is a two-tier
 * exclude model: "deep" excludes match any depth (node_modules, .git, …),
 * while "root-relative" excludes are anchored to the project root so that
 * `contextkit` only excludes `<root>/contextkit/`, never a deeper path whose
 * final segment happens to share the name.
 *
 * Public API (three pure exports + CLI):
 *   defaultExcludes()    — the canonical hardcoded exclude catalogue
 *   resolveRoots(config, root) — merges defaults + config overrides; fail-open
 *   isExcluded(relPath, name) — predicate consumed by the walker
 */

import { resolve, relative, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Canonical exclude catalogue (exact copy of IGNORE_DIRS from core, CDK-050)
// ---------------------------------------------------------------------------

/**
 * Dirs matched at ANY depth — build output, VCS, runtime caches, package
 * stores. These should never appear anywhere useful in a source tree.
 *
 * @returns {{ deep: Set<string>, rootRelative: Set<string> }}
 */
export function defaultExcludes() {
  return {
    /**
     * Bare-name excludes that apply at every depth in the tree.
     * Kept in sync with IGNORE_DIRS in project-map-core.mjs.
     */
    deep: new Set([
      'node_modules', '.git', '.hg', '.svn',
      'dist', 'build', 'out', '.next', '.nuxt',
      '.turbo', '.expo', '.svelte-kit', 'coverage',
      '__pycache__', '.pytest_cache',
      'target', 'vendor', '.venv', 'venv',
      'bin', 'obj',
      '.cache', '.idea', '.vscode',
      '.claude', '.agents', '.antigravity', '.tmp',
    ]),
    /**
     * Bare-name excludes anchored to the SCAN ROOT — only a top-level entry
     * whose name appears here is excluded.  Nested directories sharing the same
     * name are NOT excluded.
     *
     * `contextkit` lives here so that `./contextkit/` (the installed platform
     * folder) is skipped while `templates/contextkit/` (the source tree) is
     * still mapped in the dogfood self-scan.
     */
    rootRelative: new Set([
      'contextkit',
    ]),
  };
}

// ---------------------------------------------------------------------------
// Config-merging (CDK-050 core deliverable)
// ---------------------------------------------------------------------------

/**
 * Merge hardcoded defaults with optional `config.projectMap` overrides.
 *
 * Config shape (all keys optional, additive, not replacive):
 *   config.projectMap.roots    — string[] of root-relative dir paths to scan
 *                                (default: ['.'] → the whole project root)
 *   config.projectMap.excludes — string[] of additional bare-name excludes.
 *                                A bare name (no slash) → added to `deep`.
 *                                A root-anchored path ending in '/' → rootRelative.
 *
 * Malformed config (any unexpected shape) is silently ignored — the call
 * degrades to pure defaults (fail-open, constitution rule 2).
 *
 * @param {object|null|undefined} config - loaded contextkit config object
 * @param {string} root - absolute project root (needed for CLI preview)
 * @returns {{
 *   roots: string[],
 *   excludes: { deep: Set<string>, rootRelative: Set<string> },
 *   isExcluded(relPath: string, entryName: string): boolean
 * }}
 */
export function resolveRoots(config, root) {
  const defaults = defaultExcludes();

  // --- roots ----------------------------------------------------------------
  let roots = ['.'];
  try {
    const cfgRoots = config?.projectMap?.roots;
    if (Array.isArray(cfgRoots) && cfgRoots.length > 0 && cfgRoots.every((r) => typeof r === 'string')) {
      roots = cfgRoots;
    }
  } catch {
    /* malformed config — keep defaults */
  }

  // --- extra excludes -------------------------------------------------------
  const deep = new Set(defaults.deep);
  const rootRelative = new Set(defaults.rootRelative);
  try {
    const cfgExcludes = config?.projectMap?.excludes;
    if (Array.isArray(cfgExcludes)) {
      for (const entry of cfgExcludes) {
        if (typeof entry !== 'string' || !entry) continue;
        // A path that ends with '/' is treated as root-relative.
        // A bare name (no path separator) is deep.
        // Anything else is normalised to bare name and added as deep.
        if (entry.endsWith('/')) {
          // Strip trailing slash; if it still contains separators only take
          // the last segment (belt-and-suspenders: config should be simple names).
          const trimmed = entry.replace(/\/+$/, '');
          const segments = trimmed.split('/').filter(Boolean);
          if (segments.length === 1) {
            // e.g. "contextkit/" → rootRelative "contextkit"
            rootRelative.add(segments[0]);
          } else {
            // Multi-segment root-relative path; store the whole normalised string
            // so isExcluded can match it against the relative path.
            rootRelative.add(trimmed);
          }
        } else {
          // Bare name or relative path without trailing slash → deep exclude.
          const bare = entry.split('/').filter(Boolean).pop() ?? entry;
          deep.add(bare);
        }
      }
    }
  } catch {
    /* malformed config — keep defaults */
  }

  const excludes = { deep, rootRelative };

  /**
   * Predicate for the walker — returns true when this directory entry should
   * be skipped.
   *
   * @param {string} relPath - path of the entry relative to the SCAN root
   *   (e.g. 'templates/contextkit' or 'contextkit'). Forward-slash normalised.
   * @param {string} entryName - bare directory entry name (e.g. 'contextkit')
   * @returns {boolean}
   */
  function isExcluded(relPath, entryName) {
    // Deep excludes: match the bare entry name at any depth.
    if (deep.has(entryName)) return true;

    // Root-relative excludes: only match when the entry sits at depth-1
    // (i.e. relPath has no path separator — it IS the entry name).
    const normalised = relPath.replaceAll('\\', '/');
    if (rootRelative.has(normalised)) return true;

    // Multi-segment root-relative excludes (full relPath comparison).
    for (const rr of rootRelative) {
      if (rr.includes('/') && normalised === rr) return true;
    }

    return false;
  }

  return { roots, excludes, isExcluded };
}

// ---------------------------------------------------------------------------
// CLI (self-diagnostic: node project-map-roots.mjs)
// ---------------------------------------------------------------------------

if (import.meta.url === new URL(import.meta.url).href &&
    process.argv[1] &&
    import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const cwd = process.cwd();
  let config = null;
  try {
    const { readFileSync } = await import('node:fs');
    const { resolve: res } = await import('node:path');
    const raw = readFileSync(res(cwd, 'contextkit/config.json'), 'utf-8');
    config = JSON.parse(raw);
  } catch {
    /* no config — use defaults */
  }
  const { roots, excludes } = resolveRoots(config, cwd);
  console.log('Resolved roots:', roots);
  console.log('Deep excludes (%d):', excludes.deep.size, [...excludes.deep].sort().join(', '));
  console.log('Root-relative excludes (%d):', excludes.rootRelative.size, [...excludes.rootRelative].sort().join(', '));
}
