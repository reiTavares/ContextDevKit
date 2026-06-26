/**
 * Secret-shape heuristics — does this string look like a literal secret VALUE
 * (which must NEVER appear in config) rather than a secret NAME (an env-var id)?
 *
 * Mirrors the patterns in manifest.mjs but is exported so the policy engine can
 * fail closed on a leaked value at evaluation time, independent of the writer.
 * Single-sourcing the patterns here keeps the two checks from drifting (rule 4).
 *
 * Pure. Zero dependencies (immutable rule 1).
 *
 * @module secret-shape
 */

/**
 * Patterns that resemble a secret VALUE, not a NAME. A NAME is a short ALL_CAPS
 * identifier (GITHUB_TOKEN); a VALUE is long, mixed-charset, or a known prefix.
 */
const SECRET_VALUE_PATTERNS = Object.freeze([
  /^gh[ps]_[A-Za-z0-9]{20,}$/,      // GitHub PAT (ghp_/ghs_)
  /^sk-[A-Za-z0-9]{20,}$/,           // OpenAI-style key
  /^xox[bpoa]-[0-9A-Za-z-]{24,}$/,   // Slack token
  /^[A-Za-z0-9+/]{40,}={0,2}$/,      // Base64-ish blob (heuristic)
  /\s/,                                // names never contain whitespace
]);

/** A valid secret NAME is an ALL_CAPS env-var identifier. */
const VALID_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

/**
 * True when `candidate` looks like a secret VALUE rather than a NAME. A string
 * that matches a value pattern OR fails the NAME shape is treated as a value —
 * fail closed (constitution §8): a non-conforming token must not pass as a name.
 *
 * @param {string} candidate
 * @returns {boolean}
 */
export function looksLikeSecretValue(candidate) {
  if (typeof candidate !== 'string') return true;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(candidate)) return true;
  }
  return !VALID_NAME.test(candidate);
}
