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

/**
 * Secret-bearing path class (ADR-0041 floor, task 103). Built-ins are frozen —
 * config may EXTEND the class (extra patterns), never remove from it: this is
 * the grade-invariant denylist the autonomy resolver (ADR-0042) consults, so no
 * consent grade can auto-touch credential material. Deliberately narrower than
 * a bare `*key*` glob (a `keyboard.mjs` must not match): exact basenames,
 * credential extensions, a `secrets/` dir segment, and CI workflow files.
 *
 * @param {string} targetPath repo-relative, forward-slashed
 * @param {string[]} [extraPatterns] additive basename/prefix entries from config
 * @returns {string|null} the matched pattern label, or null
 */
/** SSH private-key basenames (frozen floor — config extends via extraPatterns). */
const SSH_PRIVATE_KEYS = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);
/** Credential-bearing extensions (keys, keystores, certs, PGP) — credential-adjacent ⇒ floored. */
const SECRET_EXTENSIONS = ['.pem', '.key', '.keystore', '.p12', '.pfx', '.jks', '.crt', '.cer', '.cert', '.der', '.asc', '.gpg'];

export function matchSecret(targetPath, extraPatterns = []) {
  const norm = normalize(targetPath || '');
  if (!norm) return null;
  const base = norm.slice(norm.lastIndexOf('/') + 1).toLowerCase();
  if (base === '.env' || base.startsWith('.env.')) return '.env*';
  if (base === '.npmrc' || base === '.netrc' || base === '.git-credentials' || base === '.dockercfg') return base;
  if (base.startsWith('credentials') || base.startsWith('secrets.')) return 'credentials*';
  // SSH private keys — exact basenames only (`id_rsa.pub` has a different basename, so it won't match).
  if (SSH_PRIVATE_KEYS.has(base)) return 'ssh-private-key';
  const matchedExtension = SECRET_EXTENSIONS.find((ext) => base.endsWith(ext));
  if (matchedExtension) return `*${matchedExtension}`;
  if (norm.includes('/secrets/') || norm.startsWith('secrets/')) return 'secrets/';
  if (norm.startsWith('.github/workflows/')) return '.github/workflows/';
  for (const extra of extraPatterns) {
    if (typeof extra !== 'string' || extra.length === 0) continue;
    if (extra.endsWith('/') ? norm.startsWith(extra) : base === extra.toLowerCase()) return extra;
  }
  return null;
}
