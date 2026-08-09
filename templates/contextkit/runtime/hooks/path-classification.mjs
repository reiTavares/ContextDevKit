/**
 * Pure path-risk classification for v4 governance and project-map rules.
 * Zero third-party dependencies so it runs in a fresh project.
 */
function normalize(relPath) {
  return relPath.replaceAll('\\', '/');
}

/**
 * Returns the `l5.highRiskPaths` entry matching the target (or null). Directory
 * entries (trailing `/`) match by prefix and file entries match exactly.
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
 * the concrete secret-risk classifier used for acknowledgement metadata and
 * platform safety. Deliberately narrower than
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
