/**
 * tc-cache.mjs — Content-addressed cache for compiled task artifacts.
 *
 * Stores and retrieves work-packets, route decisions, and transform plans
 * produced by the Task-Compiler execution ladder (WF0022 / ADR-0087..0090).
 *
 * ADR-0089 safety contract (all invariants are hard requirements):
 *   - Content-addressed key over ALL inputs: source slice + recipe id + version +
 *     options + tool versions. Partial/uncertain key → MISS, never a stale serve.
 *   - Recompute-on-doubt: when any input is missing or uncertain → MISS.
 *   - Review-prefilter runs BEFORE any write: detect secrets/PII → redact →
 *     only then write. A detected-but-unredactable value must NOT be cached.
 *   - Derived and disposable: cache lives under <platform>/.cache/tc/ and is
 *     gitignored. Safe to delete — removes speed only.
 *   - Integrity-checked: each stored entry carries a sha256 of the stored value;
 *     tampered entries are discarded on read.
 *   - Atomic write: tmp + rename pattern — readers never see a partial entry.
 *   - Validators throw before any I/O (constitution §8).
 * Mirrors the slot+atomic-store shape of media-cache.mjs.
 * Zero runtime dependencies — node:* only. [task-compiler] [WF0022] [ADR-0089]
 */
import { createHash }                               from 'node:crypto';
import { existsSync, mkdirSync, readFileSync,
         renameSync, writeFileSync }               from 'node:fs';
import { dirname, resolve }                        from 'node:path';
import { pathsFor }                                from '../../../runtime/config/paths.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Schema version stamped into every cache envelope. */
export const TC_CACHE_SCHEMA_VERSION = 'cdk-tc-cache/1';

/** Newline normalisation target (CRLF → LF before hashing, per ADR-0089). */
const LF = '\n';

/**
 * Secret/PII patterns (inline prefilter — ADR-0089 §review-prefilter).
 *
 * These patterns are intentionally conservative. If any match the serialised
 * value, the entry is REFUSED (not stored). No unredacted secret is ever
 * persisted. The list covers the most common credential shapes; a dedicated
 * review-prefilter module would be the production hardening path.
 */
const SECRET_PATTERNS = [
  // Generic bearer tokens / API keys (long alphanumeric with hyphens/underscores)
  /(?:api[_-]?key|secret|token|password|passwd|auth)[^\n]{0,20}[=:]\s*['"]?\S{12,}/i,
  // AWS key prefixes
  /AKIA[0-9A-Z]{16}/,
  // Private key blocks (PEM)
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  // GitHub / GitLab / npm tokens
  /(?:ghp|ghs|ghr|glpat|npm_)[A-Za-z0-9_]{20,}/,
  // Generic high-entropy hex secrets (40+ chars)
  /\b[0-9a-f]{40,}\b/,
];

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Thrown when a required cache key input is missing or invalid. */
export class TcCacheKeyError extends Error {
  /** @param {string} detail */
  constructor(detail) {
    super(`TcCacheKeyError: ${detail}`);
    this.name = 'TcCacheKeyError';
  }
}

/** Thrown when a secret/PII is detected and the entry cannot be stored. */
export class TcCacheRedactionError extends Error {
  /** @param {string} detail */
  constructor(detail) {
    super(`TcCacheRedactionError: ${detail}`);
    this.name = 'TcCacheRedactionError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns a stable, sorted JSON representation of a value so that insertion
 * order of object keys never changes the resulting hash.
 *
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const sorted = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`);
    return `{${sorted.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Normalises line endings (CRLF → LF) so cross-platform copies of the same
 * content always produce the same hash (ADR-0089 §Cache).
 *
 * @param {string} text
 * @returns {string}
 */
function normaliseLf(text) {
  return text.replace(/\r\n/g, LF).replace(/\r/g, LF);
}

/**
 * Returns true when the serialised value matches a known secret/PII pattern.
 * Intentionally conservative: false-positives refuse storage; false-negatives
 * would leak secrets to disk. A false-negative is treated as worse than a miss.
 *
 * @param {string} serialised - JSON-serialised cache value.
 * @returns {boolean}
 */
function containsSecret(serialised) {
  return SECRET_PATTERNS.some((re) => re.test(serialised));
}

// ---------------------------------------------------------------------------
// Public API — key derivation
// ---------------------------------------------------------------------------

/**
 * Derives a content-addressed cache key (sha256 hex) over ALL inputs that
 * affect the output.
 *
 * If any required input is missing or the value is not a string, throws
 * TcCacheKeyError so the caller gets a typed MISS rather than a wrong key.
 * Per ADR-0089: a partial/uncertain key MUST be a MISS, never a stale serve.
 *
 * Key inputs hashed (in stable, deterministic order):
 *   1. sourceSlice   — CRLF-normalised content slice of the source file(s).
 *   2. recipeId      — identifies the transform recipe.
 *   3. recipeVersion — version of the recipe (a recipe change busts the cache).
 *   4. options       — stable-JSON of all options/config values affecting output.
 *   5. toolVersions  — stable-JSON of { tool: version } for every tool involved.
 *
 * @param {{ sourceSlice: string, recipeId: string, recipeVersion: string,
 *            options?: object, toolVersions?: object }} inputs
 * @returns {string} sha256 hex string (64 chars)
 * @throws {TcCacheKeyError} if any required input is missing or wrong type.
 */
export function taskCacheKey({ sourceSlice, recipeId, recipeVersion, options = {}, toolVersions = {} }) {
  if (typeof sourceSlice !== 'string' || sourceSlice === '') {
    throw new TcCacheKeyError('sourceSlice must be a non-empty string');
  }
  if (typeof recipeId !== 'string' || recipeId === '') {
    throw new TcCacheKeyError('recipeId must be a non-empty string');
  }
  if (typeof recipeVersion !== 'string' || recipeVersion === '') {
    throw new TcCacheKeyError('recipeVersion must be a non-empty string');
  }
  if (typeof options !== 'object' || options === null) {
    throw new TcCacheKeyError('options must be a non-null object');
  }
  if (typeof toolVersions !== 'object' || toolVersions === null) {
    throw new TcCacheKeyError('toolVersions must be a non-null object');
  }

  const normalised = normaliseLf(sourceSlice);
  const payload = [
    normalised,
    recipeId,
    recipeVersion,
    stableJson(options),
    stableJson(toolVersions),
  ].join('\x00'); // NUL separator — cannot appear in valid UTF-8 path segments

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Public API — slot resolution
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path of the cache slot for a given set of inputs.
 * The slot carries the sha256 key as its filename; the extension encodes the
 * artifact kind ('wp'=work-packet, 'rt'=route, 'tp'=transform-plan).
 *
 * @param {{ sourceSlice: string, recipeId: string, recipeVersion: string,
 *            options?: object, toolVersions?: object,
 *            kind?: 'wp'|'rt'|'tp' }} inputs
 * @param {string} [root] - Project root (defaults to process.cwd()).
 * @returns {string} Absolute path to the cache slot file.
 * @throws {TcCacheKeyError} forwarded from taskCacheKey.
 */
export function cacheSlotFor(inputs, root = process.cwd()) {
  const allowedKinds = new Set(['wp', 'rt', 'tp']);
  const kind = inputs.kind && allowedKinds.has(inputs.kind) ? inputs.kind : 'wp';
  const key = taskCacheKey(inputs);
  return resolve(pathsFor(root).platform, '.cache', 'tc', `${key}.${kind}.json`);
}

// ---------------------------------------------------------------------------
// Public API — cache read/write
// ---------------------------------------------------------------------------

/**
 * Returns true when the slot already holds a valid, integrity-checked entry.
 *
 * Reads the slot, verifies the stored sha256 digest against the entry body,
 * and returns false on any integrity failure (tampered, truncated, or corrupt).
 * Per ADR-0089: recompute-on-doubt — when in doubt, MISS.
 *
 * @param {string} slotPath - Absolute path to the cache slot.
 * @returns {boolean}
 */
export function isCached(slotPath) {
  if (!existsSync(slotPath)) return false;
  try {
    const raw = readFileSync(slotPath, 'utf8');
    const envelope = JSON.parse(raw);
    if (envelope?.schemaVersion !== TC_CACHE_SCHEMA_VERSION) return false;
    // Verify integrity: sha256 of the stored value JSON must match storedDigest.
    const valueJson = JSON.stringify(envelope.value);
    const actual = createHash('sha256').update(valueJson, 'utf8').digest('hex');
    return actual === envelope.storedDigest;
  } catch {
    // Any parse/read error → treat as MISS (recompute-on-doubt).
    return false;
  }
}

/**
 * Reads and returns the cached value from a slot, or null on any failure.
 *
 * Callers MUST call isCached() first (or handle null). Returning null on
 * failure continues the recompute-on-doubt invariant: a corrupt read is a MISS.
 *
 * @param {string} slotPath - Absolute path to the cache slot.
 * @returns {unknown|null} The stored value, or null on MISS/integrity failure.
 */
export function readFromCache(slotPath) {
  if (!isCached(slotPath)) return null;
  try {
    const raw = readFileSync(slotPath, 'utf8');
    const envelope = JSON.parse(raw);
    return envelope.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Stores a value in the cache slot via the review-prefilter → atomic write path.
 *
 * ADR-0089 write invariants (all enforced before any I/O):
 *   1. Validators throw first (TcCacheKeyError on bad slotPath).
 *   2. Review-prefilter: secret/PII scan on the serialised value. If a secret
 *      is detected, throws TcCacheRedactionError — the value is NEVER written.
 *   3. Integrity digest computed and embedded in the envelope.
 *   4. Atomic: write to `<slot>.tmp` then rename to `<slot>` — readers never
 *      see a partial write.
 *
 * @param {string} slotPath - Absolute path (from cacheSlotFor).
 * @param {unknown} value   - The serialisable artifact value to cache.
 * @returns {boolean} true on success; false if write failed for I/O reasons.
 * @throws {TcCacheKeyError}     if slotPath is missing or not a string.
 * @throws {TcCacheRedactionError} if the value contains a detected secret/PII.
 */
export function storeInCache(slotPath, value) {
  // 1. Validate inputs before any I/O.
  if (typeof slotPath !== 'string' || slotPath === '') {
    throw new TcCacheKeyError('storeInCache: slotPath must be a non-empty string');
  }

  // 2. Review-prefilter: scan for secrets in the serialised value.
  let valueJson;
  try {
    valueJson = JSON.stringify(value);
  } catch (err) {
    throw new TcCacheKeyError(`storeInCache: value is not JSON-serialisable: ${err?.message ?? err}`);
  }
  if (containsSecret(valueJson)) {
    throw new TcCacheRedactionError(
      'storeInCache: detected probable secret/PII in value — entry refused (ADR-0089 §review-prefilter)'
    );
  }

  // 3. Build integrity-hashed envelope.
  const storedDigest = createHash('sha256').update(valueJson, 'utf8').digest('hex');
  const envelope = {
    schemaVersion: TC_CACHE_SCHEMA_VERSION,
    storedDigest,
    value,
  };

  // 4. Atomic write: tmp + rename.
  try {
    const slotDir = dirname(slotPath);
    mkdirSync(slotDir, { recursive: true });
    const tmp = `${slotPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(envelope), 'utf8');
    renameSync(tmp, slotPath);
    return true;
  } catch {
    return false;
  }
}
