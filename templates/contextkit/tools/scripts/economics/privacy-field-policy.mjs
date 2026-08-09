/**
 * Field-classification policy for EACP economics records (ADR-0081 §fields).
 *
 * Single responsibility: defines how each known field in a persisted or exported
 * economics record is treated. Split from privacy.mjs at the 308-line constitution
 * limit (cohesion reason: field-policy is a distinct lookup concern from config
 * resolution, redaction math, and access guards).
 *
 * Classification tiers:
 *   safe      — field may appear verbatim in any persisted or exported record.
 *   redact    — field must be removed or replaced with a sentinel before persist.
 *   hash      — field must be SHA-256-hashed (optionally salted) before persist.
 *   forbidden — field MUST NOT appear in any persisted or exported record; its
 *               presence is a hard error (assertNotForbidden throws).
 *
 * Policy invariants (ADR-0081):
 *   - Any field NOT in this table defaults to 'forbidden' (fail-closed).
 *   - `raw_ref` is permanently forbidden in persisted/exported records.
 *   - No transcript content field may ever be classified below 'forbidden'.
 *
 * Zero runtime dependencies — node:* only (no imports at all).
 */

// ---------------------------------------------------------------------------
// Classification table
// ---------------------------------------------------------------------------

/**
 * Field classification for economics record fields.
 * Keys are field names; values are one of: 'safe' | 'redact' | 'hash' | 'forbidden'.
 *
 * @type {Readonly<Record<string, 'safe'|'redact'|'hash'|'forbidden'>>}
 */
export const FIELD_CLASSIFICATION = Object.freeze({
  // --- safe: metric/structural fields ---
  schemaVersion: 'safe',
  ts: 'safe',
  sessionId: 'safe',
  agentScope: 'safe',
  modelEffective: 'safe',
  buckets: 'safe',
  total: 'safe',
  bucketMode: 'safe',
  skill: 'safe',
  taskId: 'safe',
  runId: 'safe',
  workflowId: 'safe',
  confidence: 'safe',
  provenance: 'safe',
  status: 'safe',
  reason: 'safe',

  // --- hash: fields that carry path or identifier information ---
  path: 'hash',
  filePath: 'hash',

  // --- redact: fields with user-visible strings that may encode PII ---
  summary: 'redact',
  label: 'redact',

  // --- forbidden: fields that must never appear in persisted/exported records ---
  raw_ref: 'forbidden',
  content: 'forbidden',
  transcriptContent: 'forbidden',
  promptContent: 'forbidden',
  systemPrompt: 'forbidden',
  userMessage: 'forbidden',
  assistantMessage: 'forbidden',
  secret: 'forbidden',
  token: 'forbidden',
  apiKey: 'forbidden',
  password: 'forbidden',
  credential: 'forbidden',
});

/** Valid classification tier names. */
export const CLASSIFICATION_TIERS = Object.freeze(['safe', 'redact', 'hash', 'forbidden']);

// ---------------------------------------------------------------------------
// Field classification lookup
// ---------------------------------------------------------------------------

/**
 * Returns the classification tier for a given field name.
 *
 * Unregistered fields are classified as 'forbidden' (fail-closed, ADR-0081
 * §fields: "new fields default to forbidden").
 *
 * @param {string} fieldName - The record field name to look up.
 * @returns {'safe'|'redact'|'hash'|'forbidden'}
 */
export function classifyField(fieldName) {
  return FIELD_CLASSIFICATION[fieldName] ?? 'forbidden';
}

// ---------------------------------------------------------------------------
// Validators (throw, never warn — constitution §8)
// ---------------------------------------------------------------------------

/**
 * Throws a TypeError if fieldName is classified 'forbidden'.
 *
 * Callers MUST invoke this at the boundary before persisting or exporting any
 * record field. An unknown (unregistered) field is also forbidden (fail-closed).
 * This is a validator that throws — it never silently warns.
 *
 * @param {string} fieldName - The field name to check.
 * @throws {TypeError} If the field is classified 'forbidden' or unregistered.
 */
export function assertNotForbidden(fieldName) {
  const tier = classifyField(fieldName);
  if (tier === 'forbidden') {
    throw new TypeError(
      `Privacy violation: field "${fieldName}" is forbidden in persisted/exported records (ADR-0081). ` +
      `Register it in FIELD_CLASSIFICATION with an explicit tier, or remove it from the record.`
    );
  }
}

/**
 * Throws a TypeError if the record contains any field classified as 'forbidden'.
 *
 * Intended as a final barrier before any persistence or export operation. Checks
 * the top-level keys of the record object (shallow scan — nested objects must be
 * validated separately at the point of construction).
 *
 * @param {object} record - The economics record to validate.
 * @throws {TypeError} If record is not a plain non-null object.
 * @throws {TypeError} If any top-level field is classified 'forbidden'.
 */
export function assertNoForbiddenFields(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(
      `assertNoForbiddenFields: expected a plain non-null object, got ${
        record === null ? 'null' : Array.isArray(record) ? 'array' : typeof record
      }`
    );
  }
  for (const key of Object.keys(record)) {
    assertNotForbidden(key);
  }
}

/**
 * Throws a TypeError if the record contains any transcript-content field.
 *
 * Transcript-content fields (content, transcriptContent, promptContent,
 * systemPrompt, userMessage, assistantMessage) must never be stored in aggregate
 * economics records (ADR-0081 §metadata-only). This guard is the single place
 * all aggregate report builders must call before writing a record.
 *
 * Unlike assertNoForbiddenFields (which checks all forbidden fields), this guard
 * focuses specifically on content-class fields for a clearer error message.
 *
 * @param {object} record - The economics record to check.
 * @throws {TypeError} If record is not a plain non-null object.
 * @throws {TypeError} If any transcript-content field is present.
 */
export function assertNoTranscriptContent(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(
      `assertNoTranscriptContent: expected a plain non-null object, got ${
        record === null ? 'null' : Array.isArray(record) ? 'array' : typeof record
      }`
    );
  }
  const contentFields = [
    'content', 'transcriptContent', 'promptContent',
    'systemPrompt', 'userMessage', 'assistantMessage',
  ];
  for (const key of contentFields) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TypeError(
        `Privacy violation: transcript-content field "${key}" found in aggregate record. ` +
        `Aggregate economics records must be metadata-only (ADR-0081 §metadata-only).`
      );
    }
  }
}
