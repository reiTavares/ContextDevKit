/**
 * Hand-rolled, zero-dependency schema + validator for the governance-contract
 * envelope (BIZ-0006 / WF-0088 / ADR-0148 position 11).
 *
 * `governance-contract.json` is the serialized ceremony-shape contract emitted per
 * work context — the stable, vendor-neutral seam a non-Claude runtime reads to
 * govern WITHOUT re-running the classifier. BIZ-0002's `GovernedExecutionEnvelope`
 * *wraps* this contract; that runtime is NOT built here (schema + validator + emit
 * hook only).
 *
 * Design invariants (see reports/gc0-report.md):
 *   - The contract is a READ-ONLY PROJECTION of (classifier axes +
 *     resolveCeremonyShape) — never a source of truth, never an enforcement point.
 *     It carries NO mutable lifecycle state (no task statuses, no journey phase);
 *     the validator rejects such fields as out-of-schema.
 *   - Every closed set is single-sourced from its producer enum (immutable rule 4):
 *     CEREMONY_SHAPES / CEREMONY_NATURES / CEREMONY_TIERS / CEREMONY_KINDS from the
 *     WF-0083 resolver, EXECUTION_MODES from the work enums. Nothing is re-coined.
 *   - The one genuine invariant is the ceremonyOverride value object: its fields
 *     co-occur (applied ⇒ all set; not applied ⇒ all null).
 *
 * Matches the kit's defensive validator style (mirrors `schema-decision.mjs`): no
 * zod on the hot path; `validateGovernanceContract()` returns `{ ok, errors[] }`
 * and NEVER throws.
 */
import { EXECUTION_MODES, isNonEmptyString } from './enums.mjs';
import {
  CEREMONY_SHAPES,
  CEREMONY_TIERS,
  CEREMONY_NATURES,
  CEREMONY_KINDS,
} from '../../methodology/resolve-ceremony-shape.mjs';

/** Schema version this validator understands. */
export const GOVERNANCE_CONTRACT_SCHEMA_VERSION = 1;

/** Canonical filename emitted + read at every context root. Defined here (the
 * schema owns the artifact's identity) so both the emit hook and the read-only
 * advisory reader single-source it without a runtime↔tools import cycle. */
export const GOVERNANCE_CONTRACT_FILENAME = 'governance-contract.json';

/** Context-ref types — the artifact-location taxonomy (3 values), distinct from
 * `resolvedAxes.nature` (2 values). */
export const CONTEXT_REF_TYPES = Object.freeze(['business', 'operation', 'workflow']);

/** Governing-decision statuses the contract may record (mirrors the ADR lifecycle
 * surface a reader needs). Exported so the emit adapter single-sources it. */
export const GOVERNING_DECISION_STATUSES = Object.freeze(['proposed', 'accepted']);

/** Id patterns per context-ref type. */
const CONTEXT_ID_PATTERNS = Object.freeze({
  business: /^BIZ-\d{4}$/,
  operation: /^OP-\d{4}$/,
  workflow: /^WF-\d{4}$/,
});

/** The exact top-level keys a v1 contract may carry. Anything else is rejected —
 * containment is what keeps the projection from silently accreting live state. */
const ALLOWED_TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'contextRef', 'ceremonyShape', 'resolvedAxes',
  'ceremonyOverride', 'governingDecision', 'stateAuthority', 'derivedFrom',
  'emittedAt', 'emittedBy',
]);

/** The exact keys the ceremonyOverride value object may carry. */
const ALLOWED_OVERRIDE_KEYS = Object.freeze([
  'applied', 'resolvedShape', 'shape', 'reason', 'authorizedBy', 'authorizedAt',
]);

/**
 * Validate `contextRef` — `{ type, id }` with the id matching its type pattern.
 *
 * @param {unknown} contextRef the field value
 * @param {string[]} errors error sink
 * @returns {void}
 */
function checkContextRef(contextRef, errors) {
  if (!contextRef || typeof contextRef !== 'object' || Array.isArray(contextRef)) {
    errors.push('contextRef: required object { type, id }');
    return;
  }
  if (!CONTEXT_REF_TYPES.includes(contextRef.type)) {
    errors.push(`contextRef.type: "${contextRef.type}" must be one of ${CONTEXT_REF_TYPES.join('|')}`);
  }
  if (!isNonEmptyString(contextRef.id)) {
    errors.push('contextRef.id: required non-empty string');
    return;
  }
  const pattern = CONTEXT_ID_PATTERNS[contextRef.type];
  if (pattern && !pattern.test(contextRef.id)) {
    errors.push(`contextRef.id: "${contextRef.id}" must match ${pattern} for type "${contextRef.type}"`);
  }
}

/**
 * Validate `resolvedAxes` — the four verbatim resolver inputs, each against its
 * producer's closed set so the contract stays round-trippable through
 * resolveCeremonyShape.
 *
 * @param {unknown} axes the field value
 * @param {string[]} errors error sink
 * @returns {void}
 */
function checkResolvedAxes(axes, errors) {
  if (!axes || typeof axes !== 'object' || Array.isArray(axes)) {
    errors.push('resolvedAxes: required object { nature, executionMode, tier, kind }');
    return;
  }
  if (!CEREMONY_NATURES.includes(axes.nature)) {
    errors.push(`resolvedAxes.nature: "${axes.nature}" must be one of ${CEREMONY_NATURES.join('|')}`);
  }
  if (!EXECUTION_MODES.includes(axes.executionMode)) {
    errors.push(`resolvedAxes.executionMode: "${axes.executionMode}" must be one of ${EXECUTION_MODES.join('|')}`);
  }
  if (!CEREMONY_TIERS.includes(axes.tier)) {
    errors.push(`resolvedAxes.tier: "${axes.tier}" must be one of ${CEREMONY_TIERS.join('|')}`);
  }
  if (!CEREMONY_KINDS.includes(axes.kind)) {
    errors.push(`resolvedAxes.kind: "${axes.kind}" must be one of ${CEREMONY_KINDS.join('|')}`);
  }
  for (const key of Object.keys(axes)) {
    if (!['nature', 'executionMode', 'tier', 'kind'].includes(key)) {
      errors.push(`resolvedAxes.${key}: unknown field (resolvedAxes carries only the four resolver inputs)`);
    }
  }
}

/**
 * Validate the `ceremonyOverride` value object and its co-occurrence invariant:
 * `applied===true` ⇒ shape/resolvedShape/reason/authorizedBy/authorizedAt all set;
 * `applied===false` ⇒ all five null. `shape`/`resolvedShape` ∈ CEREMONY_SHAPES.
 *
 * @param {unknown} override the field value
 * @param {string[]} errors error sink
 * @returns {void}
 */
function checkCeremonyOverride(override, errors) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    errors.push('ceremonyOverride: required object { applied, resolvedShape, shape, reason, authorizedBy, authorizedAt }');
    return;
  }
  for (const key of Object.keys(override)) {
    if (!ALLOWED_OVERRIDE_KEYS.includes(key)) {
      errors.push(`ceremonyOverride.${key}: unknown field`);
    }
  }
  if (typeof override.applied !== 'boolean') {
    errors.push('ceremonyOverride.applied: required boolean');
    return;
  }
  const coupled = ['resolvedShape', 'shape', 'reason', 'authorizedBy', 'authorizedAt'];
  if (override.applied === true) {
    for (const field of coupled) {
      if (override[field] === null || override[field] === undefined || override[field] === '') {
        errors.push(`ceremonyOverride.${field}: required (non-null) when applied is true`);
      }
    }
    for (const shapeField of ['resolvedShape', 'shape']) {
      if (isNonEmptyString(override[shapeField]) && !CEREMONY_SHAPES.includes(override[shapeField])) {
        errors.push(`ceremonyOverride.${shapeField}: "${override[shapeField]}" is not a canonical ceremony shape`);
      }
    }
  } else {
    for (const field of coupled) {
      if (override[field] !== null) {
        errors.push(`ceremonyOverride.${field}: must be null when applied is false`);
      }
    }
  }
}

/**
 * Validate the `governingDecision` block — `{ ref, status }`.
 *
 * @param {unknown} decision the field value
 * @param {string[]} errors error sink
 * @returns {void}
 */
function checkGoverningDecision(decision, errors) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    errors.push('governingDecision: required object { ref, status }');
    return;
  }
  const hasRef = isNonEmptyString(decision.ref);
  // A context may be UNCOVERED (created before its governing ADR exists): ref/status
  // are both null. Otherwise ref is a decision id and status is proposed|accepted.
  // Co-occurrence: ref set ⟺ status set.
  if (hasRef) {
    if (!GOVERNING_DECISION_STATUSES.includes(decision.status)) {
      errors.push(`governingDecision.status: "${decision.status}" must be one of ${GOVERNING_DECISION_STATUSES.join('|')} when ref is set`);
    }
  } else if (decision.ref !== null) {
    errors.push('governingDecision.ref: must be a non-empty string (e.g. ADR-0148) or null when uncovered');
  } else if (decision.status !== null) {
    errors.push('governingDecision.status: must be null when ref is null (uncovered)');
  }
}

/**
 * Validate a parsed governance-contract object. Defensive — NEVER throws;
 * returns `{ ok, errors[] }`. `ok` is true only when there are zero errors.
 *
 * @param {unknown} contract parsed contract object (NOT a file path/string)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateGovernanceContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { ok: false, errors: ['governance-contract: must be a non-array object'] };
  }

  if (contract.schemaVersion !== GOVERNANCE_CONTRACT_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${GOVERNANCE_CONTRACT_SCHEMA_VERSION}, got ${JSON.stringify(contract.schemaVersion)}`);
  }

  // Containment: reject any field outside the closed top-level set. This is what
  // structurally prevents the projection from accreting mutable lifecycle state.
  for (const key of Object.keys(contract)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.includes(key)) {
      errors.push(`${key}: unknown top-level field (the contract is a closed projection, not a state store)`);
    }
  }

  checkContextRef(contract.contextRef, errors);

  if (!CEREMONY_SHAPES.includes(contract.ceremonyShape)) {
    errors.push(`ceremonyShape: "${contract.ceremonyShape}" is not one of the canonical shapes ${CEREMONY_SHAPES.join('|')}`);
  }

  checkResolvedAxes(contract.resolvedAxes, errors);
  checkCeremonyOverride(contract.ceremonyOverride, errors);
  checkGoverningDecision(contract.governingDecision, errors);

  if (!isNonEmptyString(contract.stateAuthority)) {
    errors.push('stateAuthority: required non-empty string (names where truth lives — this contract is not it)');
  }
  if (!contract.derivedFrom || typeof contract.derivedFrom !== 'object' || Array.isArray(contract.derivedFrom)) {
    errors.push('derivedFrom: required object naming the producers (e.g. { resolver, classifier })');
  }
  if (!isNonEmptyString(contract.emittedAt)) errors.push('emittedAt: required non-empty ISO string');
  if (contract.emittedBy !== 'create' && contract.emittedBy !== 'transition') {
    errors.push(`emittedBy: "${contract.emittedBy}" must be "create" or "transition"`);
  }

  return { ok: errors.length === 0, errors };
}
