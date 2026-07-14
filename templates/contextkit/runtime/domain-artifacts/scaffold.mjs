/**
 * scaffold.mjs — `scaffold(kind, contract) -> typedPlaceholders` (ADR-0128 §22,
 * WF-0066).
 *
 * Governed scaffold generator: releases a scaffold ONLY when its declared
 * `requiresContract` artifact already exists and validates (constitution §8 —
 * default to refuse). A released scaffold carries typed placeholder fields
 * only — never an invented business rule (constitution §9). The contract's
 * real values are never read into the placeholder (that would be inventing
 * content); the scaffold only names the slot the implementer must fill.
 *
 * Pure — no I/O; the caller injects the loaded scaffoldContracts table and the
 * already-validated contract artifact (or its validation result).
 *
 * @module domain-artifacts/scaffold
 */

/**
 * Releases (or refuses) a governed scaffold.
 *
 * @param {string} kind one of scaffold-contracts.json's `scaffolds` keys.
 * @param {{ artifactKind: string, exists: boolean, valid: boolean }} contract
 *   the caller's evidence that the required contract artifact exists and
 *   validates — produced by the caller via validateArtifact() beforehand.
 * @param {object} scaffoldContractsTable the loaded scaffold-contracts.json table.
 * @returns {{ released: boolean, kind: string, placeholderFields: string[],
 *   typedPlaceholders: Record<string,string>, reasonCode: string }}
 */
export function scaffold(kind, contract, scaffoldContractsTable) {
  const table = scaffoldContractsTable && typeof scaffoldContractsTable === 'object' ? scaffoldContractsTable.scaffolds : null;
  if (!table || typeof table !== 'object') {
    return refused(kind, [], 'ARTIFACTS_POLICY_DEGRADED');
  }
  const entry = table[kind];
  if (!entry) {
    return refused(kind, [], 'SCAFFOLD_UNKNOWN_KIND');
  }
  const placeholderFields = Array.isArray(entry.placeholderFields) ? [...entry.placeholderFields] : [];
  const evidence = contract && typeof contract === 'object' ? contract : {};
  const contractKindMatches = evidence.artifactKind === entry.requiresContract;

  if (!contractKindMatches || evidence.exists !== true) {
    return refused(kind, placeholderFields, 'SCAFFOLD_REFUSED_NO_CONTRACT');
  }
  if (evidence.valid !== true) {
    return refused(kind, placeholderFields, 'SCAFFOLD_REFUSED_INVALID_CONTRACT');
  }

  return {
    released: true,
    kind,
    placeholderFields,
    typedPlaceholders: buildTypedPlaceholders(placeholderFields),
    reasonCode: 'SCAFFOLD_PLACEHOLDER_EMITTED',
  };
}

/** Builds the refused-scaffold shape (never a false pass, §8). */
function refused(kind, placeholderFields, reasonCode) {
  return { released: false, kind, placeholderFields, typedPlaceholders: {}, reasonCode };
}

/**
 * Builds one typed `TODO:<field>` placeholder per declared field — a
 * structural slot name, never a guessed value (constitution §9).
 *
 * @param {string[]} fields
 * @returns {Record<string,string>}
 */
function buildTypedPlaceholders(fields) {
  const placeholders = {};
  for (const field of fields) {
    if (typeof field === 'string' && field) placeholders[field] = `TODO:${field}`;
  }
  return placeholders;
}
