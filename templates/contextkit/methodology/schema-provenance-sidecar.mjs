/**
 * Zero-dependency validator for the field-provenance sidecar (`provenance.json`,
 * WF-0089 SA2, BIZ-0006, ADR-0148 §9). Mirrors the kit's defensive validator
 * style (`schema-business.mjs` / `schema-decision.mjs`): never throws, returns
 * `{ ok, errors[] }`.
 *
 * The sidecar is a FIELD-authority record only (never a state store — no task
 * status, no journeyPhase, no overallStatus lives here). This validator enforces
 * the closed top-level shape AND the co-occurrence invariant that makes it
 * exactly-one-authority-per-field:
 *   - `state:"authored"` carries ONLY `{ state }`.
 *   - `state:"derived"` carries all four of `{ state, source, inputHash, contentHash }`.
 * A field entry mixing the two shapes (e.g. `authored` with a leftover `source`,
 * or `derived` missing a hash) is rejected — that rejection IS the single-
 * authority invariant this schema exists to guard.
 */
import { isNonEmptyString } from '../runtime/work/enums.mjs';

/** Schema version this validator understands. */
export const PROVENANCE_SIDECAR_SCHEMA_VERSION = 1;

/** The only two field-authority states (constitution §8: default is human-owned). */
export const PROVENANCE_FIELD_STATES = Object.freeze(['authored', 'derived']);

/** Keys a `derived` entry MUST carry (co-occurrence invariant). */
const DERIVED_REQUIRED_KEYS = Object.freeze(['source', 'inputHash', 'contentHash']);

/** Closed top-level key set — `provenance.json` has exactly these three. */
const ALLOWED_TOP_LEVEL_KEYS = Object.freeze(['schemaVersion', 'contextRef', 'fields']);

/** Closed key set for an `authored` entry. */
const ALLOWED_AUTHORED_KEYS = Object.freeze(['state']);

/** Closed key set for a `derived` entry. */
const ALLOWED_DERIVED_KEYS = Object.freeze(['state', 'source', 'inputHash', 'contentHash']);

/**
 * Validates one `fields.<key>` entry against the co-occurrence invariant.
 *
 * @param {string} fieldKey - the `<fileAlias>.<leaf>` (or bare) field key, for error context.
 * @param {unknown} entry - the candidate entry.
 * @param {string[]} errors - sink for human-readable errors.
 * @returns {void}
 */
function checkFieldEntry(fieldKey, entry, errors) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`fields.${fieldKey}: must be an object`);
    return;
  }
  if (!PROVENANCE_FIELD_STATES.includes(entry.state)) {
    errors.push(`fields.${fieldKey}.state: must be "authored" or "derived", got ${JSON.stringify(entry.state)}`);
    return;
  }
  const keys = Object.keys(entry);
  if (entry.state === 'authored') {
    const extra = keys.filter((key) => !ALLOWED_AUTHORED_KEYS.includes(key));
    if (extra.length) {
      errors.push(`fields.${fieldKey}: an "authored" entry must carry ONLY {state} (extra key(s): ${extra.join(', ')})`);
    }
    return;
  }
  // state === 'derived'
  const extra = keys.filter((key) => !ALLOWED_DERIVED_KEYS.includes(key));
  if (extra.length) errors.push(`fields.${fieldKey}: unknown key(s) on a "derived" entry: ${extra.join(', ')}`);
  for (const requiredKey of DERIVED_REQUIRED_KEYS) {
    if (!isNonEmptyString(entry[requiredKey])) {
      errors.push(`fields.${fieldKey}.${requiredKey}: required non-empty string on a "derived" entry`);
    }
  }
}

/**
 * Validates a parsed `provenance.json` sidecar. Defensive: never throws on bad
 * input; returns a structured verdict instead.
 *
 * @param {unknown} sidecar - a parsed provenance sidecar object (NOT a file path).
 * @returns {{ ok: boolean, errors: string[] }} `ok` true only when no errors.
 */
export function validateProvenanceSidecar(sidecar) {
  const errors = [];
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) {
    return { ok: false, errors: ['provenance: root must be a non-array object'] };
  }

  const extraTop = Object.keys(sidecar).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.includes(key));
  if (extraTop.length) errors.push(`provenance: unknown top-level key(s) ${extraTop.join(', ')}`);

  if (sidecar.schemaVersion !== PROVENANCE_SIDECAR_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${PROVENANCE_SIDECAR_SCHEMA_VERSION}, got ${JSON.stringify(sidecar.schemaVersion)}`);
  }
  if (!('contextRef' in sidecar)) errors.push('contextRef: required (may be null)');

  if (!sidecar.fields || typeof sidecar.fields !== 'object' || Array.isArray(sidecar.fields)) {
    errors.push('fields: required object');
  } else {
    for (const [fieldKey, entry] of Object.entries(sidecar.fields)) {
      checkFieldEntry(fieldKey, entry, errors);
    }
  }

  return { ok: errors.length === 0, errors };
}
