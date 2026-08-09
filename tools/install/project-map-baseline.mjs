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
 *   - Defer when active sessions are present or self-update risk detected.
 *   - Fail-open: any error returns a structured skip result, never throws.
 *   - Runner is injectable (opts.runGenerator) for unit testability.
 *   - Zero runtime dependencies: only node:* builtins.
 *
 * RETURN TYPE CHANGE (v3.1.2):
 *   Now returns `{ status, note }` instead of a bare string.
 *   install.mjs callers that do `const baselineNote = await maybeGenerateBaseline(...)`
 *   must update to: `const { note: baselineNote } = await maybeGenerateBaseline(...)`.
 *
 * @module project-map-baseline
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Status constants — exhaustive discriminant for the structured result.
// ---------------------------------------------------------------------------

/** @typedef {'generated'|'already_exists'|'greenfield'|'deferred_active_sessions'|'deferred_self_update'|'failed'} BaselineStatus */

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
 * Returns true when the preflight object or explicit opts signal a self-update
 * risk (installer target overlaps its own source tree).
 *
 * Accepts either:
 *   - `opts.preflight.status === 'DEFERRED_SELF_UPDATE'` (preflight object)
 *   - `opts.selfHost === true` (explicit boolean)
 *
 * @param {object} opts
 * @returns {boolean}
 */
function isSelfUpdateRisk(opts) {
  if (opts.selfHost === true) return true;
  if (opts.preflight?.status === 'DEFERRED_SELF_UPDATE') return true;
  return false;
}

/**
 * Returns true when the preflight object or explicit opts signal active sessions
 * that would be interrupted by baseline generation.
 *
 * Accepts either:
 *   - `opts.preflight.status === 'DEFERRED_ACTIVE_SESSIONS'` (preflight object)
 *   - `opts.activeSessions` is an array/iterable with length/size > 0, or a count > 0
 *
 * @param {object} opts
 * @returns {boolean}
 */
function hasActiveSessions(opts) {
  if (opts.preflight?.status === 'DEFERRED_ACTIVE_SESSIONS') return true;
  const sessions = opts.activeSessions;
  if (sessions == null) return false;
  // Array or array-like (length property)
  if (typeof sessions.length === 'number') return sessions.length > 0;
  // Set/Map (size property)
  if (typeof sessions.size === 'number') return sessions.size > 0;
  // Plain count
  if (typeof sessions === 'number') return sessions > 0;
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
 * assets. Skips or defers silently when generation would be pointless, risky,
 * or redundant.
 *
 * Guard order (cheapest / safest first):
 *   1. Manifest already exists → already_exists (no overwrite, ever).
 *   2. Greenfield (no source files) → greenfield (empty map is useless).
 *   3. Self-update risk detected → deferred_self_update (avoid mid-run mutation).
 *   4. Active sessions detected → deferred_active_sessions (protect in-flight work).
 *   5. Generator script not installed → skip with note (partial install defense).
 *   6. Run generator → generated or failed (fail-open, never throws).
 *
 * RETURN TYPE (v3.1.2): returns `{ status, note }` — NOT a bare string.
 *   Callers must read `.note` for the human string. Example migration for install.mjs:
 *     BEFORE: const baselineNote = await maybeGenerateBaseline(target);
 *     AFTER:  const { note: baselineNote } = await maybeGenerateBaseline(target, opts);
 *
 * @param {string}   target                   - absolute path to the target project
 * @param {object}   [opts]                   - optional overrides (for testing + deferral)
 * @param {Function} [opts.runGenerator]      - injectable runner fn(generatorPath, cwd)
 * @param {object}   [opts.preflight]         - runPreflight() result; .status drives deferral
 * @param {boolean}  [opts.selfHost]          - true = self-update risk; skip generation
 * @param {Array|number} [opts.activeSessions]- active sessions list or count; skip if > 0
 * @returns {Promise<{status: BaselineStatus, note: string}>}
 */
export async function maybeGenerateBaseline(target, opts = {}) {
  const runGenerator = opts.runGenerator ?? defaultRunGenerator;

  const manifestPath = join(target, 'contextkit', 'memory', 'project-map', 'manifest.json');
  const generatorPath = join(target, 'contextkit', 'tools', 'scripts', 'project-map.mjs');

  // Guard 1: manifest already exists → nothing to do (cheapest check, highest priority).
  if (existsSync(manifestPath)) {
    return { status: 'already_exists', note: 'project-map baseline: already exists — skipped' };
  }

  // Guard 2: greenfield target → generator would produce an empty map.
  if (!hasSourceFiles(target)) {
    return { status: 'greenfield', note: 'project-map baseline: no source files found (greenfield) — skipped' };
  }

  // Guard 3: self-update risk — installer's own files may change mid-run.
  if (isSelfUpdateRisk(opts)) {
    return { status: 'deferred_self_update', note: 'project-map baseline: deferred (self-update risk)' };
  }

  // Guard 4: active sessions — do not interrupt in-flight work.
  if (hasActiveSessions(opts)) {
    return { status: 'deferred_active_sessions', note: 'project-map baseline: deferred (active sessions)' };
  }

  // Guard 5: generator script not installed (defensive — update may target a partial install).
  if (!existsSync(generatorPath)) {
    return { status: 'failed', note: 'project-map baseline: generator not found — skipped' };
  }

  // Guard 6: run the generator; catch all errors to stay fail-open.
  try {
    runGenerator(generatorPath, target);
    return { status: 'generated', note: '✓ project-map baseline generated' };
  } catch (err) {
    const reason = err?.message ?? String(err);
    return { status: 'failed', note: `project-map baseline: generator failed (${reason}) — skipped` };
  }
}
