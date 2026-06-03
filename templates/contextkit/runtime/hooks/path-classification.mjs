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
