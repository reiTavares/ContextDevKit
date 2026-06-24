/**
 * child-envelope.mjs — Flat-delegation child envelope factory (WF0038, A9-T1, ADR-0112).
 *
 * A child envelope is a delegation unit spawned FROM an existing parent Intent
 * Envelope (request-envelope §5). Children INHERIT the parent's governing identity
 * (business root, work nature, ceremony, context, decisions, acceptance) and ADD
 * child-specific identity (childId, role, parentRequestId, delegationDepth).
 *
 * FLAT delegation rule (ADR-0112 §flat-delegation):
 *   A child CANNOT spawn grandchildren. `canDelegate` is always `false` here.
 *   `delegationDepth` is capped at parent+1 to make nesting violations detectable.
 *
 * Both exports are pure functions. Zero runtime dependencies — node:* only.
 * Inputs are never mutated. Results are Object.frozen (deeply for nested objects).
 *
 * @module child-envelope
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed child role values. Extensible — enforcement is the caller's concern. */
const VALID_ROLES = new Set(['lead', 'reviewer', 'scout', 'council', 'synthesizer']);

/** Violation codes produced by assertChildScope — the governance enforcement floor. */
const VIOLATION = Object.freeze({
  MISSING_PARENT: 'MISSING_PARENT',
  RECLASSIFY_PRIMARY_TYPE: 'RECLASSIFY_PRIMARY_TYPE',
  RECLASSIFY_COMPLEXITY: 'RECLASSIFY_COMPLEXITY',
  AUTONOMY_CHANGE: 'AUTONOMY_CHANGE',
  SCOPE_EXPANSION: 'SCOPE_EXPANSION',
  CREATES_WORKFLOW: 'CREATES_WORKFLOW',
  ACCEPTS_ADR: 'ACCEPTS_ADR',
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-freezes a plain object tree. Arrays and nested objects are frozen
 * recursively; primitives and non-objects are left unchanged.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

/**
 * Returns a shallow copy of `source` limited to `keys`. Missing keys become
 * `undefined` in the copy, preserving the auditable snapshot even for absent
 * optional fields.
 *
 * @param {object} source
 * @param {string[]} keys
 * @returns {object}
 */
function pick(source, keys) {
  const result = {};
  keys.forEach((k) => { result[k] = source[k]; });
  return result;
}

/**
 * Safely reads the `primaryType` from a parent envelope's classification block.
 * Falls back to `null` when the envelope is malformed.
 *
 * @param {object|null|undefined} parentEnvelope
 * @returns {string|null}
 */
function parentPrimaryType(parentEnvelope) {
  return parentEnvelope?.classification?.primaryType ?? null;
}

/**
 * Safely reads the `complexity` from a parent envelope's classification block.
 *
 * @param {object|null|undefined} parentEnvelope
 * @returns {string|null}
 */
function parentComplexity(parentEnvelope) {
  return parentEnvelope?.classification?.complexity ?? null;
}

/**
 * Safely reads the `effectiveGrade` from a parent envelope's autonomy block.
 *
 * @param {object|null|undefined} parentEnvelope
 * @returns {number|null}
 */
function parentEffectiveGrade(parentEnvelope) {
  return parentEnvelope?.autonomy?.effectiveGrade ?? null;
}

/**
 * Returns true when `childPaths` is a strict superset of `parentPaths` — i.e.,
 * the child attempts to operate on paths the parent never touched.
 * An absent or empty parent paths list is treated as unrestricted (no violation).
 * An absent or empty child paths list is never an expansion.
 *
 * @param {string[]|null|undefined} parentPaths
 * @param {string[]|null|undefined} childPaths
 * @returns {boolean}
 */
function isScopeExpansion(parentPaths, childPaths) {
  if (!Array.isArray(childPaths) || childPaths.length === 0) return false;
  if (!Array.isArray(parentPaths) || parentPaths.length === 0) return false;
  const parentSet = new Set(parentPaths);
  return childPaths.some((p) => !parentSet.has(p));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derives a frozen child envelope from a parent intent envelope.
 *
 * The child INHERITS (read-only) from the parent:
 *   - Business root id (`context.businessId`)
 *   - Work nature (`classification.primaryType`)
 *   - Ceremony level (`classification.ceremony`)
 *   - Execution context (`context`)
 *   - Governing decisions (`decisions`)
 *   - Acceptance criteria (`acceptance`)
 *
 * The child ADDS:
 *   - `childId` — from `childSpec.childId`
 *   - `role` — from `childSpec.role` (lead|reviewer|scout|council|synthesizer)
 *   - `parentRequestId` — from `parentEnvelope.requestId`
 *   - `delegationDepth` — `(parent.delegationDepth ?? 0) + 1`
 *   - `canDelegate: false` (flat-delegation governance floor, ADR-0112)
 *   - `inherited` — auditable snapshot of every field carried from the parent
 *
 * @param {object} parentEnvelope - A fully assembled intent envelope (§5).
 * @param {object} childSpec - Child-specific descriptor.
 * @param {string} childSpec.childId - Unique id for this child execution unit.
 * @param {string} childSpec.role - Child role (lead|reviewer|scout|council|synthesizer).
 * @param {object} [opts] - Optional overrides (reserved for future use).
 * @returns {object} Frozen child envelope.
 */
export function deriveChildEnvelope(parentEnvelope, childSpec, opts = {}) {
  const parent = (parentEnvelope && typeof parentEnvelope === 'object') ? parentEnvelope : {};
  const spec = (childSpec && typeof childSpec === 'object') ? childSpec : {};

  const parentClassification = (parent.classification && typeof parent.classification === 'object')
    ? parent.classification : {};
  const parentContext = (parent.context && typeof parent.context === 'object')
    ? parent.context : {};
  const parentAutonomy = (parent.autonomy && typeof parent.autonomy === 'object')
    ? parent.autonomy : {};

  // Inherited block — auditable snapshot of exactly what was carried from the parent.
  const inherited = deepFreeze({
    businessId: parentContext.businessId ?? null,
    primaryType: parentClassification.primaryType ?? null,
    ceremony: parentClassification.ceremony ?? null,
    context: { ...parentContext },
    decisions: Array.isArray(parent.decisions) ? [...parent.decisions] : undefined,
    acceptance: parent.acceptance !== undefined ? parent.acceptance : undefined,
  });

  const childEnvelope = {
    // Child identity
    childId: String(spec.childId ?? 'child-unknown'),
    role: VALID_ROLES.has(spec.role) ? spec.role : String(spec.role ?? 'unknown'),
    parentRequestId: String(parent.requestId ?? 'req-unknown'),
    delegationDepth: (typeof parent.delegationDepth === 'number' ? parent.delegationDepth : 0) + 1,
    canDelegate: false,

    // Inherited work identity (copies, read-only by contract)
    classification: deepFreeze({
      primaryType: parentClassification.primaryType ?? null,
      complexity: parentClassification.complexity ?? null,
      ceremony: parentClassification.ceremony ?? null,
    }),
    autonomy: deepFreeze({ ...parentAutonomy }),
    context: deepFreeze({ ...parentContext }),

    // Optional inherited governance fields (only include when present on parent)
    ...(Array.isArray(parent.decisions) ? { decisions: deepFreeze([...parent.decisions]) } : {}),
    ...(parent.acceptance !== undefined ? { acceptance: parent.acceptance } : {}),

    // Auditable provenance
    inherited,
  };

  return deepFreeze(childEnvelope);
}

/**
 * Asserts that a proposed child execution attempt stays within the scope the
 * parent envelope grants. This is the enforcement of the flat-delegation
 * governance floor — it REFUSES by default when any forbidden mutation is present.
 *
 * Checked violations:
 *   - MISSING_PARENT — malformed or absent parent (conservative: treat as violation).
 *   - RECLASSIFY_PRIMARY_TYPE — child changes `primaryType` vs parent.
 *   - RECLASSIFY_COMPLEXITY — child changes `complexity` vs parent.
 *   - AUTONOMY_CHANGE — child changes `effectiveGrade` vs parent.
 *   - SCOPE_EXPANSION — child paths extend beyond the parent's paths.
 *   - CREATES_WORKFLOW — child sets `createsWorkflow: true`.
 *   - ACCEPTS_ADR — child sets `acceptsADR: true`.
 *
 * Deterministic: same inputs always produce the same output. Never mutates inputs.
 * Fail-safe: missing or malformed parent → at minimum MISSING_PARENT violation.
 *
 * @param {object|null|undefined} parentEnvelope - The authoritative parent envelope.
 * @param {object} childAttempt - The child's proposed execution descriptor.
 * @param {string} [childAttempt.primaryType] - Claimed classification type.
 * @param {string} [childAttempt.complexity] - Claimed complexity tier.
 * @param {number} [childAttempt.effectiveGrade] - Claimed autonomy grade.
 * @param {string[]} [childAttempt.scope] - File/path scope the child will touch.
 * @param {boolean} [childAttempt.createsWorkflow] - Whether child spawns a workflow.
 * @param {boolean} [childAttempt.acceptsADR] - Whether child accepts an ADR.
 * @returns {{ valid: boolean, violations: string[] }} Frozen result.
 */
export function assertChildScope(parentEnvelope, childAttempt) {
  const violations = [];

  // Fail-safe: treat absent or non-object parent as a hard violation.
  if (!parentEnvelope || typeof parentEnvelope !== 'object') {
    violations.push(VIOLATION.MISSING_PARENT);
    return deepFreeze({ valid: false, violations });
  }

  const attempt = (childAttempt && typeof childAttempt === 'object') ? childAttempt : {};

  // Reclassification checks — child must not redefine work nature or complexity.
  const pType = parentPrimaryType(parentEnvelope);
  if (attempt.primaryType !== undefined && attempt.primaryType !== pType) {
    violations.push(VIOLATION.RECLASSIFY_PRIMARY_TYPE);
  }

  const pComplexity = parentComplexity(parentEnvelope);
  if (attempt.complexity !== undefined && attempt.complexity !== pComplexity) {
    violations.push(VIOLATION.RECLASSIFY_COMPLEXITY);
  }

  // Autonomy check — child must not escalate or alter the effective grade.
  const pGrade = parentEffectiveGrade(parentEnvelope);
  if (attempt.effectiveGrade !== undefined && attempt.effectiveGrade !== pGrade) {
    violations.push(VIOLATION.AUTONOMY_CHANGE);
  }

  // Scope expansion check — child may not touch paths the parent never declared.
  const parentPaths = parentEnvelope?.context?.paths;
  if (isScopeExpansion(parentPaths, attempt.scope)) {
    violations.push(VIOLATION.SCOPE_EXPANSION);
  }

  // Governance action checks — these are strictly forbidden in child executions.
  if (attempt.createsWorkflow === true) {
    violations.push(VIOLATION.CREATES_WORKFLOW);
  }

  if (attempt.acceptsADR === true) {
    violations.push(VIOLATION.ACCEPTS_ADR);
  }

  return deepFreeze({ valid: violations.length === 0, violations: Object.freeze(violations) });
}
