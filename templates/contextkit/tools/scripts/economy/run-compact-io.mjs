/**
 * run-compact-io.mjs — ECON-04 I/O + kind-detection helpers.
 *
 * Filesystem helpers (run-id, runs-dir resolution, ring-prune) and command
 * kind-detection, split out of run-compact.mjs to keep each file under the
 * 308-line budget (constitution §1). Pure transforms (fingerprint / delta /
 * match) live in run-compact-core.mjs; orchestration in run-compact.mjs.
 *
 * Zero runtime dependencies — node:* only. Advisory / fail-open.
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MAX_RUNS = 20;

/**
 * Generates a short unique run id: `<timestamp>-<4 random hex chars>`.
 * @returns {string}
 */
export function makeRunId() {
  return `${Date.now()}-${randomBytes(2).toString('hex')}`;
}

/**
 * Resolves the `runs/` directory relative to a given root.
 * Falls back to the script's own directory when root is absent.
 *
 * @param {string | undefined} root
 * @returns {string}
 */
export function resolveRunsDir(root) {
  return resolve(root ?? SCRIPT_DIR, 'runs');
}

/**
 * Prunes the runs directory to at most MAX_RUNS entries (newest preserved).
 * Best-effort — errors are silently swallowed (advisory system).
 *
 * @param {string} runsDir
 */
export function pruneRuns(runsDir) {
  try {
    const entries = readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        try {
          return { name: e.name, mtime: statSync(resolve(runsDir, e.name)).mtime.getTime() };
        } catch {
          return { name: e.name, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const entry of entries.slice(MAX_RUNS)) {
      try { rmSync(resolve(runsDir, entry.name), { recursive: true, force: true }); } catch { /* skip */ }
    }
  } catch { /* runsDir may not exist yet — that's fine */ }
}

/**
 * Detects the run kind from the command string when kind is 'auto'.
 *
 * @param {string[]} cmdParts
 * @returns {'test'|'lint'|'build'|'auto'}
 */
export function detectKind(cmdParts) {
  const joined = cmdParts.join(' ').toLowerCase();
  if (/\b(test|jest|vitest|pytest|go test|tap)\b/.test(joined)) return 'test';
  if (/\b(lint|eslint|tslint|pylint|golint|flake8)\b/.test(joined)) return 'lint';
  if (/\b(build|compile|tsc|webpack|vite build)\b/.test(joined)) return 'build';
  return 'auto';
}
