/**
 * Auto-baseline generator for `npx contextdevkit --update` (PMB-01, ADR-0098).
 *
 * When a project gains project-map support via `--update`, the pre-commit
 * auto-refresh hook and the boot staleness nudge stay inert because no
 * `manifest.json` exists. This module generates the first baseline ONLY when
 * the target has source files AND the manifest is missing.
 *
 * Design:
 *   - Decision-before-action: reads the filesystem first, generates only on miss.
 *   - Skip greenfield (no source files) — the map would be empty anyway.
 *   - Skip when a map already exists — never overwrite a developer's baseline.
 *   - Fail-open: any error returns a skip-with-reason note, never throws.
 *   - Runner is injectable (opts.runGenerator) for unit testability.
 *   - Zero runtime dependencies: only node:* builtins.
 *
 * @module project-map-baseline
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Source-file extensions that indicate a non-greenfield project.
// Matches the EXT_LANG set in project-map-core.mjs (single source of truth
// cannot be imported here — installer has no dependency on installed scripts).
// ---------------------------------------------------------------------------
const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte',
  '.py', '.go', '.rs', '.java', '.kt',
  '.rb', '.php', '.cs', '.sql',
]);

// Dirs that should never count as evidence of source files.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', 'out', '.next', '.nuxt',
  '.turbo', '.expo', '.svelte-kit', 'coverage',
  '__pycache__', '.pytest_cache',
  'target', 'vendor', '.venv', 'venv',
  'bin', 'obj', '.cache', '.idea', '.vscode',
  'contextkit', '.claude', '.agents', '.antigravity', '.tmp',
]);

/**
 * Scans one level of `dir` (plus immediate children) looking for any file
 * whose extension is in SOURCE_EXTS. Returns as soon as one is found (cheap).
 *
 * Intentionally shallow — we only need to DETECT presence, not count. A deeper
 * scan would be wasteful; the generator does the full walk.
 *
 * @param {string} dir - absolute path to the project root
 * @returns {boolean} true if at least one source file exists
 */
function hasSourceFiles(dir) {
  let topEntries;
  try {
    topEntries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false; // unreadable root → treat as no source
  }

  for (const entry of topEntries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    if (entry.isDirectory()) {
      // One level deep — look for source files inside top-level dirs.
      let childEntries;
      try {
        childEntries = readdirSync(join(dir, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of childEntries) {
        if (!child.isFile()) continue;
        const dotIdx = child.name.lastIndexOf('.');
        if (dotIdx < 0) continue;
        const ext = child.name.slice(dotIdx).toLowerCase();
        if (SOURCE_EXTS.has(ext)) return true;
      }
    } else if (entry.isFile()) {
      // Root-level file (e.g. index.js at the repo root).
      const dotIdx = entry.name.lastIndexOf('.');
      if (dotIdx < 0) continue;
      const ext = entry.name.slice(dotIdx).toLowerCase();
      if (SOURCE_EXTS.has(ext)) return true;
    }
  }

  return false;
}

/**
 * Default runner: invokes the project's installed project-map generator via
 * `execFileSync`. The generator is called with cwd = target so it scans the
 * right tree and writes to the correct `contextkit/memory/project-map/` path.
 *
 * @param {string} generatorPath - absolute path to project-map.mjs inside target
 * @param {string} cwd           - the project root (= target)
 * @returns {void}
 * @throws on a non-zero exit or I/O error (caught by maybeGenerateBaseline)
 */
function defaultRunGenerator(generatorPath, cwd) {
  execFileSync(process.execPath, [generatorPath], { cwd, stdio: 'ignore' });
}

/**
 * Conditionally generates the project-map baseline for a target project.
 *
 * Called during `npx contextdevkit --update` AFTER the engine has written its
 * assets. Skips silently when generation would be pointless or redundant:
 *   - Greenfield target (no source files) → skip.
 *   - `manifest.json` already exists → skip (existing baseline stays).
 * On any error the function returns a skip-with-reason note; it never throws.
 *
 * @param {string}   target              - absolute path to the target project
 * @param {object}   [opts]              - optional overrides (for testing)
 * @param {Function} [opts.runGenerator] - injectable runner fn(generatorPath, cwd)
 * @returns {Promise<string>} short human-readable report line
 */
export async function maybeGenerateBaseline(target, opts = {}) {
  const runGenerator = opts.runGenerator ?? defaultRunGenerator;

  const manifestPath = join(target, 'contextkit', 'memory', 'project-map', 'manifest.json');
  const generatorPath = join(target, 'contextkit', 'tools', 'scripts', 'project-map.mjs');

  // Guard 1: manifest already exists → nothing to do.
  if (existsSync(manifestPath)) {
    return 'project-map baseline: already exists — skipped';
  }

  // Guard 2: greenfield target → generator would produce an empty map.
  if (!hasSourceFiles(target)) {
    return 'project-map baseline: no source files found (greenfield) — skipped';
  }

  // Guard 3: generator script not installed (should never happen after installEngine,
  // but be defensive — the update may have targeted a partial install).
  if (!existsSync(generatorPath)) {
    return 'project-map baseline: generator not found — skipped';
  }

  try {
    runGenerator(generatorPath, target);
    return '✓ project-map baseline generated';
  } catch (err) {
    const reason = err?.message ?? String(err);
    return `project-map baseline: generator failed (${reason}) — skipped`;
  }
}
