/**
 * Hand-rolled, zero-dependency validator for `operation.json` (BIZ-0001 / WF-0036).
 *
 * Mirrors `schema-business.mjs` in posture: defensive (never throws), validates
 * REQUIRED fields, the `OP-####` id format, the closed `executionMode` enum, and
 * the shared `valueIntents` shape (reusing the single-sourced checkers). Optional
 * shapes (urgency/severity vocabularies, scoring) are NOT over-validated.
 *
 * No real `operation.json` exists yet (OP-#### allocator starts at OP-0001, A1-T3);
 * this validator defines the contract A1-T2's Operations CLI will produce.
 * See `architecture/schema-plan.md` and `shared-entity-contracts.md`.
 */
import { EXECUTION_MODES, isNonEmptyString } from './enums.mjs';
import { checkRelations, checkValueIntents } from './schema-business.mjs';

/** Schema version this validator understands. */
export const OPERATION_SCHEMA_VERSION = 1;

/** Canonical id pattern for an Operation work context. */
export const OPERATION_ID_PATTERN = /^OP-\d{4}$/;

/**
 * Validates a parsed `operation.json` object. Defensive: never throws on bad
 * input; returns a structured verdict instead.
 *
 * @param {unknown} entity - a parsed operation object (NOT a file path).
 * @returns {{ ok: boolean, errors: string[] }} `ok` true only when no errors.
 */
export function validateOperation(entity) {
  const errors = [];
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    return { ok: false, errors: ['operation: root must be a non-array object'] };
  }

  if (entity.schemaVersion !== OPERATION_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${OPERATION_SCHEMA_VERSION}, got ${JSON.stringify(entity.schemaVersion)}`);
  }
  if (!('uid' in entity)) errors.push('uid: required (may be null)');
  if (!OPERATION_ID_PATTERN.test(entity.id ?? '')) errors.push('id: must match ^OP-\\d{4}$');

  for (const field of ['title', 'slug', 'kind']) {
    if (!isNonEmptyString(entity[field])) errors.push(`${field}: required non-empty string`);
  }

  if (!EXECUTION_MODES.includes(entity.executionMode)) {
    errors.push(`executionMode: "${entity.executionMode}" must be one of ${EXECUTION_MODES.join('|')}`);
  }

  checkValueIntents(entity.valueIntents, errors);

  if (!entity.business || typeof entity.business !== 'object') {
    errors.push('business: required object (Business linkage)');
  } else if (!isNonEmptyString(entity.business.status)) {
    errors.push('business.status: required non-empty string');
  }

  if (!entity.decisions || typeof entity.decisions !== 'object') {
    errors.push('decisions: required object');
  } else if (!isNonEmptyString(entity.decisions.coverage)) {
    errors.push('decisions.coverage: required non-empty string');
  }

  checkRelations(entity.relations, errors);

  return { ok: errors.length === 0, errors };
}
