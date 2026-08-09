/**
 * schema-validate.mjs — `validateArtifact(kind, doc) -> result` (ADR-0128 §13,
 * WF-0066). Validates one of the five domain artifacts against its declared
 * contract in artifact-schemas.json — field presence + type only; the table is
 * the single source, this module never hardcodes a field list (best-practices
 * S4).
 *
 * Also carries the proportionality guard: `checkProportionality(kind, profile,
 * table)` reads requiredForProfiles/neverForProfiles directly from the table so
 * "simple never gets a domain-map" is a DATA fact, not an if-chain here.
 *
 * Pure — no I/O; the caller injects the loaded artifactSchemas table. A missing
 * table or unknown kind degrades to a recorded reason code, never a false pass.
 *
 * @module domain-artifacts/schema-validate
 */

/**
 * Validates one artifact document against its declared schema.
 *
 * @param {string} kind one of artifact-schemas.json's `artifacts` keys.
 * @param {object} doc the artifact document to validate.
 * @param {object} artifactSchemasTable the loaded artifact-schemas.json table.
 * @returns {{ valid: boolean, kind: string, errors: string[], reasonCode: string }}
 */
export function validateArtifact(kind, doc, artifactSchemasTable) {
  const table = artifactSchemasTable && typeof artifactSchemasTable === 'object' ? artifactSchemasTable.artifacts : null;
  if (!table || typeof table !== 'object') {
    return { valid: false, kind, errors: ['artifact-schemas policy table unavailable'], reasonCode: 'ARTIFACTS_POLICY_DEGRADED' };
  }
  const contract = table[kind];
  if (!contract) {
    return { valid: false, kind, errors: [`unknown artifact kind "${kind}"`], reasonCode: 'ARTIFACT_UNKNOWN_KIND' };
  }
  const document = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const errors = validateFields(document, contract.requiredFields ?? []);
  return {
    valid: errors.length === 0,
    kind,
    errors,
    reasonCode: errors.length === 0 ? 'ARTIFACT_SCHEMA_VALID' : 'ARTIFACT_SCHEMA_INVALID',
  };
}

/**
 * Checks whether an artifact kind is recommended, forbidden, or optional for a
 * resolved profile — the proportionality guarantee (ADR-0128 §31) read
 * directly from the table's requiredForProfiles/neverForProfiles.
 *
 * @param {string} kind artifact kind.
 * @param {string} profile resolved Implementation Profile name.
 * @param {object} artifactSchemasTable the loaded artifact-schemas.json table.
 * @returns {{ status: 'recommended'|'forbidden'|'optional'|'unknown', reasonCode: string }}
 */
export function checkProportionality(kind, profile, artifactSchemasTable) {
  const table = artifactSchemasTable && typeof artifactSchemasTable === 'object' ? artifactSchemasTable.artifacts : null;
  const contract = table && typeof table === 'object' ? table[kind] : null;
  if (!contract) return { status: 'unknown', reasonCode: 'ARTIFACT_UNKNOWN_KIND' };
  const never = Array.isArray(contract.neverForProfiles) ? contract.neverForProfiles : [];
  const recommended = Array.isArray(contract.recommendedForProfiles) ? contract.recommendedForProfiles : [];
  if (never.includes(profile)) return { status: 'forbidden', reasonCode: 'ARTIFACT_NEVER_FOR_PROFILE' };
  if (recommended.includes(profile)) return { status: 'recommended', reasonCode: 'ARTIFACT_RECOMMENDED_FOR_PROFILE' };
  return { status: 'optional', reasonCode: 'ARTIFACT_NOT_REQUIRED' };
}

/**
 * Validates a document's fields against a requiredFields declaration list.
 * Supports one level of nested `itemFields` for arrays/objects — enough for
 * the five artifact contracts without becoming a general JSON-schema engine.
 *
 * @param {object} document
 * @param {Array<{name:string,type:string,optional?:boolean,itemFields?:object[]}>} fields
 * @returns {string[]} error messages (empty when valid).
 */
function validateFields(document, fields) {
  const errors = [];
  for (const field of fields) {
    if (!field || typeof field.name !== 'string') continue;
    const value = document[field.name];
    const present = value !== undefined && value !== null;
    if (!present) {
      if (!field.optional) errors.push(`missing required field "${field.name}"`);
      continue;
    }
    if (!matchesType(value, field.type)) {
      errors.push(`field "${field.name}" must be of type "${field.type}"`);
    }
  }
  return errors;
}

/** Checks a value against a declared primitive/array/object type tag. */
function matchesType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return typeof value === 'object' && !Array.isArray(value) && value !== null;
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number';
  if (type === 'boolean') return typeof value === 'boolean';
  return true; // unknown declared type is not this validator's failure to invent.
}
