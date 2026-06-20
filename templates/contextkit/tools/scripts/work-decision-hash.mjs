/**
 * Decision-hash computation for the Business Gate (BIZ-0001 / WF-0036, A3-T2).
 *
 * A deterministic SHA-256 fingerprint over the canonical ADR fields that the
 * Business Gate cares about. Changing any of those fields (id, primaryContext,
 * decisionKind, status, supersedes) invalidates the stored hash — the Gate then
 * blocks until a human re-approves. This makes approval tamper-evident.
 *
 * Field set chosen to cover:
 *   - Identity      : id (the ADR-#### pointer)
 *   - Ownership     : primaryContext (which Business/Operation/Platform owns it)
 *   - Classification: decisionKind (BUSINESS_AUTHORIZATION etc.)
 *   - Lifecycle     : status (proposed → accepted → superseded …)
 *   - Lineage       : supersedes (the chain of previous decisions)
 *
 * Immutable rule 1 — zero runtime deps: uses `node:crypto` (Node built-in).
 *
 * @module work-decision-hash
 */
import { createHash } from 'node:crypto';

/**
 * Fields extracted from an ADR front-matter record when building the canonical
 * hash payload. Order is fixed here so the JSON serialisation is deterministic
 * regardless of the insertion order of keys in the caller's object.
 *
 * IMPORTANT: this list is the contract between A3-T2 and the Business Gate. Any
 * change to it constitutes a breaking change and invalidates stored hashes —
 * gated behind an ADR (immutable rule 1 + constitution §10).
 */
const CANONICAL_FIELDS = Object.freeze(['id', 'primaryContext', 'decisionKind', 'status', 'supersedes']);

/**
 * Normalises `primaryContext` to a stable scalar so null, undefined, or an
 * object all produce a byte-deterministic contribution to the hash. Object keys
 * are sorted before serialisation.
 *
 * @param {unknown} value - raw `primaryContext` from the ADR record.
 * @returns {unknown} a canonical, JSON-safe representation.
 */
function normaliseContext(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  // Sort keys so `{ type, id }` and `{ id, type }` hash identically.
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return sorted;
}

/**
 * Normalises `supersedes` to a stable array (null / undefined → empty []).
 *
 * @param {unknown} value - raw `supersedes` from the ADR record.
 * @returns {unknown[]} sorted, deduplicated array of strings.
 */
function normaliseSupersedes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)].sort();
}

/**
 * Builds the canonical payload object from the given ADR fields. All fields are
 * reduced to deterministic forms so the resulting JSON is byte-identical on
 * repeated calls with equivalent inputs.
 *
 * @param {object} fields - any object containing the canonical ADR fields.
 * @returns {object} stable payload object suitable for JSON.stringify.
 */
function buildCanonicalPayload(fields) {
  return {
    id: typeof fields.id === 'string' ? fields.id : null,
    primaryContext: normaliseContext(fields.primaryContext),
    decisionKind: typeof fields.decisionKind === 'string' ? fields.decisionKind : null,
    status: typeof fields.status === 'string' ? fields.status : null,
    supersedes: normaliseSupersedes(fields.supersedes),
  };
}

/**
 * Computes a deterministic SHA-256 fingerprint of an ADR's canonical fields.
 *
 * The hash is computed over a sorted-key JSON representation of exactly five
 * fields (`id`, `primaryContext`, `decisionKind`, `status`, `supersedes`).
 * The `CANONICAL_FIELDS` constant is the public contract; every consumer of
 * this hash MUST derive it through this function — never rolling their own.
 *
 * @param {object} canonicalFields - object containing at minimum the five
 *   canonical fields from the ADR front matter.
 * @returns {string} lowercase hex SHA-256 digest (64 characters).
 * @throws {TypeError} when `canonicalFields` is not a non-null object.
 */
export function computeDecisionHash(canonicalFields) {
  if (!canonicalFields || typeof canonicalFields !== 'object' || Array.isArray(canonicalFields)) {
    throw new TypeError('computeDecisionHash: canonicalFields must be a non-null, non-array object');
  }
  const payload = buildCanonicalPayload(canonicalFields);
  const json = JSON.stringify(payload, null, 0);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Extracts the canonical field subset from a full ADR front-matter record.
 * A convenience wrapper so callers do not have to remember `CANONICAL_FIELDS`.
 *
 * @param {object} adrRecord - parsed ADR front-matter object.
 * @returns {{ id, primaryContext, decisionKind, status, supersedes }}
 */
export function extractCanonicalFields(adrRecord) {
  const out = {};
  for (const field of CANONICAL_FIELDS) out[field] = adrRecord[field];
  return out;
}
