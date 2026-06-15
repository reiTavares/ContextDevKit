/**
 * Privacy Policy Foundation — EACP-02 / ADR-0081
 *
 * Single responsibility: policy resolution, redaction, access guards, and
 * provenance stamps for the economics module. Retention evaluation moved to
 * retention.mjs (same ADR; split for SRP at 280-line limit).
 *
 * Design invariants (see ADR-0081 §privacy, ADR-0077 §principles):
 *   - LOCAL-FIRST: nothing leaves the machine by default. externalSend defaults
 *     to false and only flips on explicit user consent.
 *   - METADATA-ONLY by default: aggregate reports MUST NOT read transcript
 *     content. Content-diagnostic mode is deferred to card #253 and defaults
 *     OFF here. The contentReadsAllowed() guard is the single place callers
 *     check before touching content.
 *   - SKIPPED-NOT-PASSED: when a check cannot run (missing data, disabled mode),
 *     callers MUST return the skipped() marker — never count the absence as a
 *     pass (constitution §8, false-negative trap).
 *   - DETERMINISTIC: no internal calls to Date.now() or Math.random(). Callers
 *     inject `now` (epoch ms) so results are reproducible and testable.
 *
 * Central-schema registration (runtime/config/schema.mjs) is a later wave;
 * this module reads config defensively and falls back to PRIVACY_DEFAULTS on
 * any malformed or missing input so it never throws at load time.
 *
 * Zero runtime dependencies beyond node:crypto (sha256 for path hashing).
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical default privacy configuration for the economics module.
 * All keys are the authoritative fallback used by resolvePrivacyConfig when
 * user config is absent, partial, or invalid.
 *
 * mode:           'metadata-only' — aggregate token/timing stats only; no
 *                 transcript content access. Flip to 'content-diagnostic' (card
 *                 #253) for content-level diagnostics, which requires explicit
 *                 opt-in AND contentReads: true.
 * contentReads:   false — content access is off even in content-diagnostic
 *                 mode unless this is also explicitly set true.
 * externalSend:   false — no data leaves the machine without explicit consent.
 * redactPaths:    true  — file paths in records are redacted to hash+basename.
 * retentionDays:  90    — usage records older than this are eligible for purge.
 */
export const PRIVACY_DEFAULTS = Object.freeze({
  mode: 'metadata-only',
  contentReads: false,
  externalSend: false,
  redactPaths: true,
  retentionDays: 90,
});

/** The two valid mode strings; anything else falls back to PRIVACY_DEFAULTS.mode. */
const VALID_MODES = new Set(['metadata-only', 'content-diagnostic']);

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

/**
 * Merges user-supplied economics.privacy config over PRIVACY_DEFAULTS.
 *
 * Reads defensively: a malformed, missing, or partially invalid config block
 * never throws — invalid fields are silently replaced with defaults. This
 * mirrors the loader-never-throws posture required by ADR-0001.
 *
 * @param {object|null|undefined} config - Raw project config object. Expected
 *   shape: { economics?: { privacy?: { mode?, contentReads?, externalSend?,
 *   redactPaths?, retentionDays? } } }. All fields optional.
 * @returns {Readonly<{mode: string, contentReads: boolean, externalSend: boolean,
 *   redactPaths: boolean, retentionDays: number}>} Frozen resolved config.
 */
export function resolvePrivacyConfig(config) {
  const raw = config?.economics?.privacy;

  // Safely extract each field; fall back to default on any type violation.
  const mode = VALID_MODES.has(raw?.mode) ? raw.mode : PRIVACY_DEFAULTS.mode;

  const contentReads = typeof raw?.contentReads === 'boolean'
    ? raw.contentReads
    : PRIVACY_DEFAULTS.contentReads;

  const externalSend = typeof raw?.externalSend === 'boolean'
    ? raw.externalSend
    : PRIVACY_DEFAULTS.externalSend;

  const redactPaths = typeof raw?.redactPaths === 'boolean'
    ? raw.redactPaths
    : PRIVACY_DEFAULTS.redactPaths;

  // retentionDays must be a positive integer; fractional or ≤0 values fall back.
  const rawDays = raw?.retentionDays;
  const retentionDays =
    Number.isInteger(rawDays) && rawDays > 0
      ? rawDays
      : PRIVACY_DEFAULTS.retentionDays;

  return Object.freeze({ mode, contentReads, externalSend, redactPaths, retentionDays });
}

// ---------------------------------------------------------------------------
// Access guards
// ---------------------------------------------------------------------------

/**
 * Returns true only when content reads are explicitly enabled.
 *
 * Content reads are opt-in and owned by card #253 (content-diagnostic mode).
 * The default path always returns false. Both conditions must hold: the mode
 * must be 'content-diagnostic' AND contentReads must be explicitly true —
 * neither alone is sufficient. Callers must check this before accessing any
 * transcript content field.
 *
 * @param {ReturnType<typeof resolvePrivacyConfig>} resolved - Resolved config.
 * @returns {boolean}
 */
export function contentReadsAllowed(resolved) {
  return resolved.mode === 'content-diagnostic' && resolved.contentReads === true;
}

/**
 * Returns true only when the user has given explicit consent for external sends.
 *
 * Any network egress of economics data requires this guard. The default
 * (externalSend: false) keeps all data strictly local. No external send is
 * permitted without a deliberate user opt-in recorded in config.
 *
 * @param {ReturnType<typeof resolvePrivacyConfig>} resolved - Resolved config.
 * @returns {boolean}
 */
export function externalSendAllowed(resolved) {
  return resolved.externalSend === true;
}

// ---------------------------------------------------------------------------
// Path redaction
// ---------------------------------------------------------------------------

/**
 * Redacts a filesystem path to protect potentially sensitive directory names.
 *
 * When redaction is enabled (resolved.redactPaths === true), the leading path
 * components are replaced with the first 8 hex characters of the SHA-256 hash
 * of the full original path, and only the final segment (basename) is kept
 * in clear text. This provides:
 *   - Determinism: the same input always yields the same hash prefix.
 *   - Traceability: the basename remains human-readable for diagnostics.
 *   - Privacy: parent directories (which may encode user names, project names,
 *     or org structure) are not stored in aggregate reports.
 *
 * When redaction is disabled, the path is returned unchanged.
 *
 * @param {string} pathStr - The path to redact.
 * @param {ReturnType<typeof resolvePrivacyConfig>} resolved - Resolved config.
 * @returns {string} The redacted or unchanged path.
 * @throws {TypeError} If pathStr is not a string.
 */
export function redactPath(pathStr, resolved) {
  if (typeof pathStr !== 'string') {
    throw new TypeError(`redactPath: expected a string path, got ${typeof pathStr}`);
  }
  if (!resolved.redactPaths) {
    return pathStr;
  }
  // Forward-slash normalisation for cross-platform determinism in the hash.
  const normalised = pathStr.replace(/\\/g, '/');
  const hash = createHash('sha256').update(normalised).digest('hex').slice(0, 8);
  // Extract basename: the segment after the last slash (or the whole string
  // if there is no slash — a bare filename is already safe to store in full).
  const slashIndex = normalised.lastIndexOf('/');
  const basename = slashIndex === -1 ? normalised : normalised.slice(slashIndex + 1);
  return `[${hash}]/${basename}`;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Stamps a usage record with provenance metadata.
 *
 * Returns a shallow copy of `record` with a `provenance` field added. The
 * function is kept pure by accepting an optional `nowMs` parameter rather than
 * calling Date.now() internally. When `nowMs` is omitted, `stampedAt` is left
 * undefined so callers can choose to inject the clock only when they need the
 * timestamp (e.g., in tests that assert deterministic output).
 *
 * @param {object} record - The usage record to stamp. Must be a non-null object.
 * @param {string} source - Human-readable identifier for the stamping agent or
 *   script (e.g. 'token-report', 'eacp-collector').
 * @param {number} [nowMs] - Optional epoch ms for stampedAt. Omit to leave
 *   stampedAt undefined (keeps the function fully deterministic/testable).
 * @returns {object} Shallow copy of record with provenance field.
 * @throws {TypeError} If record is not a non-null object.
 * @throws {TypeError} If source is not a non-empty string.
 */
export function provenanceStamp(record, source, nowMs) {
  // Arrays are excluded: a usage record is a plain key-value object, not a
  // sequence. Accepting arrays silently would mask caller mistakes.
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(
      `provenanceStamp: record must be a plain non-null object, got ${
        record === null ? 'null' : Array.isArray(record) ? 'array' : typeof record
      }`
    );
  }
  if (typeof source !== 'string' || source.trim() === '') {
    throw new TypeError('provenanceStamp: source must be a non-empty string');
  }

  const provenance = nowMs !== undefined
    ? { source, stampedAt: nowMs }
    : { source };

  return { ...record, provenance };
}

// ---------------------------------------------------------------------------
// Skipped marker
// ---------------------------------------------------------------------------

/**
 * Returns a frozen "skipped" marker object.
 *
 * Callers MUST use this (rather than null, false, or omitting a field) whenever
 * a privacy check cannot run — e.g., because the required data is absent, the
 * mode is disabled, or a dependency is missing. This marker is explicitly
 * DISTINCT from a pass: downstream consumers must branch on status === 'skipped'
 * and never count it as a positive result. This enforces constitution §8's
 * false-negative prohibition: "when a check can't run, report 'skipped' —
 * never count it as pass."
 *
 * @param {string} reason - Human-readable explanation of why the check was
 *   skipped (e.g., 'content-reads disabled', 'ts field missing').
 * @returns {Readonly<{status: 'skipped', reason: string}>}
 */
export function skipped(reason) {
  return Object.freeze({ status: 'skipped', reason });
}
