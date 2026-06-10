/**
 * Path classification for the L2 session ledger — CONFIG-DRIVEN.
 *
 * Three predicates power drift detection:
 *   - `isTrackable(path)` — record this edit in the ledger at all?
 *     Excludes build output, caches and the ledger's own runtime state.
 *   - `isImportant(path)` — does an edit here trigger the Stop drift nudge?
 *     Captures source, platform and top-level config.
 *   - `isRegistrationFile(path)` — does an edit here count AS registering
 *     the session (suppressing the nudge)?
 *
 * Prefix lists come from `contextkit/config.json` (`ledger.*`), falling back to
 * the stack-agnostic defaults. This is the seam that makes the kit portable:
 * a Python project sets `important: ["app/", "tests/"]`, a Go project sets
 * `["cmd/", "internal/"]`, etc. — no code edits required.
 *
 * Zero third-party deps so it runs on a fresh project.
 */
import { loadConfigSync } from '../config/load.mjs';

const config = loadConfigSync();
const IMPORTANT_PREFIXES = config.ledger.important;
const IRRELEVANT_PREFIXES = config.ledger.irrelevant;
const REGISTRATION_PATHS = config.ledger.registration;

function normalize(relPath) {
  return relPath.replaceAll('\\', '/');
}

/**
 * Returns true if the given repo-relative path should be persisted in the
 * session ledger.
 *
 * @param {string} relPath
 */
export function isTrackable(relPath) {
  if (!relPath) return false;
  const norm = normalize(relPath);
  return !IRRELEVANT_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

/**
 * Returns true if a modification at the given path should count toward the
 * Stop-hook drift nudge.
 *
 * @param {string} relPath
 */
export function isImportant(relPath) {
  const norm = normalize(relPath);
  return IMPORTANT_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

/**
 * Returns true if a modification at the given path counts AS the session
 * registration step (suppresses the nudge).
 *
 * @param {string} relPath
 */
export function isRegistrationFile(relPath) {
  const norm = normalize(relPath);
  return REGISTRATION_PATHS.includes(norm);
}

/**
 * Returns the `l5.highRiskPaths` entry matching the target (or null). Directory
 * entries (trailing `/`) match by prefix, file entries match exactly. Shared by
 * the PreToolUse simulate-gate (Claude Code) and the explicit `guard` checkpoint
 * (Antigravity) so both hosts enforce the same gate (ticket 095).
 *
 * @param {string} targetPath repo-relative, forward-slashed
 * @param {string[]} highRiskPaths from config.l5.highRiskPaths
 */
export function matchHighRisk(targetPath, highRiskPaths) {
  if (!Array.isArray(highRiskPaths)) return null;
  for (const entry of highRiskPaths) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (entry.endsWith('/')) {
      if (targetPath.startsWith(entry)) return entry;
    } else if (targetPath === entry) {
      return entry;
    }
  }
  return null;
}
