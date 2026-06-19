/**
 * Hand-rolled, zero-dependency validator for `business.json` (BIZ-0001 / WF-0036).
 *
 * Matches the kit's existing defensive validator style (no zod on the hot path).
 * Validates REQUIRED fields, the `BIZ-####` id format, and the closed enums that
 * are authoritatively defined (value intents, lifecycle status). It deliberately
 * does NOT over-validate optional shapes (growth levers, investment, kind,
 * strategicFacet) — those have no closed authoritative list yet and forcing one
 * would reject valid future content. See `architecture/schema-plan.md` and
 * `shared-entity-contracts.md`.
 *
 * The real BIZ-0001 `business.json` MUST validate as `{ ok: true }`.
 */
import { VALUE_INTENTS, isNonEmptyString } from './enums.mjs';

/** Schema version this validator understands. */
export const BUSINESS_SCHEMA_VERSION = 1;

/** Canonical id pattern for a Business work context. */
export const BUSINESS_ID_PATTERN = /^BIZ-\d{4}$/;

/**
 * Validates the shared `valueIntents` shape: exactly one `primary` from the
 * value-intent enum, plus a `secondary` array whose entries are all in the enum.
 *
 * @param {unknown} valueIntents - the `valueIntents` field of the entity.
 * @param {string[]} errors - sink to which human-readable errors are pushed.
 * @returns {void}
 */
export function checkValueIntents(valueIntents, errors) {
  if (!valueIntents || typeof valueIntents !== 'object') {
    errors.push('valueIntents: missing or not an object');
    return;
  }
  const { primary, secondary } = valueIntents;
  if (!VALUE_INTENTS.includes(primary)) {
    errors.push(`valueIntents.primary: "${primary}" is not a known value intent`);
  }
  if (secondary !== undefined) {
    if (!Array.isArray(secondary)) {
      errors.push('valueIntents.secondary: must be an array when present');
    } else {
      for (const intent of secondary) {
        if (!VALUE_INTENTS.includes(intent)) {
          errors.push(`valueIntents.secondary: "${intent}" is not a known value intent`);
        }
      }
    }
  }
}

/**
 * Validates the `relations` field shape (array of `{ type, ref }`). Relation
 * `type` is checked for presence only — NOT against the recommended enum — so
 * already-conforming files using historical verbs stay valid.
 *
 * @param {unknown} relations - the `relations` field of the entity.
 * @param {string[]} errors - sink for human-readable errors.
 * @returns {void}
 */
export function checkRelations(relations, errors) {
  if (relations === undefined) return; // optional
  if (!Array.isArray(relations)) {
    errors.push('relations: must be an array when present');
    return;
  }
  relations.forEach((relation, index) => {
    if (!relation || typeof relation !== 'object') {
      errors.push(`relations[${index}]: must be an object`);
      return;
    }
    if (!isNonEmptyString(relation.type)) errors.push(`relations[${index}].type: required non-empty string`);
    if (!isNonEmptyString(relation.ref)) errors.push(`relations[${index}].ref: required non-empty string`);
  });
}

/**
 * Validates a parsed `business.json` object. Defensive: never throws on bad
 * input; returns a structured verdict instead.
 *
 * @param {unknown} entity - a parsed business object (NOT a file path).
 * @returns {{ ok: boolean, errors: string[] }} `ok` true only when no errors.
 */
export function validateBusiness(entity) {
  const errors = [];
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    return { ok: false, errors: ['business: root must be a non-array object'] };
  }

  if (entity.schemaVersion !== BUSINESS_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${BUSINESS_SCHEMA_VERSION}, got ${JSON.stringify(entity.schemaVersion)}`);
  }
  if (!('uid' in entity)) errors.push('uid: required (may be null)');
  if (!BUSINESS_ID_PATTERN.test(entity.id ?? '')) errors.push('id: must match ^BIZ-\\d{4}$');

  for (const field of ['title', 'slug', 'status', 'kind', 'strategicFacet']) {
    if (!isNonEmptyString(entity[field])) errors.push(`${field}: required non-empty string`);
  }

  // status must be a member of the entity's own declared lifecycle when present.
  if (Array.isArray(entity.lifecycle) && isNonEmptyString(entity.status) && !entity.lifecycle.includes(entity.status)) {
    errors.push(`status: "${entity.status}" is not in the declared lifecycle`);
  }

  checkValueIntents(entity.valueIntents, errors);

  if (!entity.growth || typeof entity.growth !== 'object') errors.push('growth: required object');
  if (!entity.investment || typeof entity.investment !== 'object') errors.push('investment: required object');

  if (!entity.approval || typeof entity.approval !== 'object') {
    errors.push('approval: required object');
  } else {
    for (const field of ['actor', 'revision', 'approvedAt', 'decision']) {
      if (entity.approval[field] === undefined) errors.push(`approval.${field}: required`);
    }
  }

  if (!entity.decisions || typeof entity.decisions !== 'object') {
    errors.push('decisions: required object');
  } else if (!isNonEmptyString(entity.decisions.status)) {
    errors.push('decisions.status: required non-empty string');
  }

  if (!entity.workflows || typeof entity.workflows !== 'object') errors.push('workflows: required object');

  checkRelations(entity.relations, errors);

  return { ok: errors.length === 0, errors };
}
