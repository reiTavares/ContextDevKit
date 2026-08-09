/**
 * Decision coverage gates + workflow decision references (BIZ-0001 / WF-0037, B3-T2).
 *
 * CONTRACT (frozen — tests depend on it):
 *   `evaluateDecisionCoverage(entity, registry, opts)` → `{ covered, mode, reasons }`
 *   `validateWorkflowDecisionRefs(workflowPlan, registry)` → `{ ok, missing, superseded }`
 *   `requiredDecisionGate(entity, registry, opts)` → `{ pass, reasons }`
 *
 * Coverage invariants (B0-T2-decision-domain-contract §4):
 *   COVERED_BY_ACCEPTED  — ADR status==='accepted' (governing); covered=true.
 *   LEGACY_GRANDFATHERED — ADR format==='legacy' or status==='legacy'; covered=true.
 *   SUPERSEDED_NOT_GOVERNING — status in [superseded, rejected, proposed]; covered=false.
 *   NEEDS_DECISION       — no decisionRefs, or ref not found in registry; covered=false.
 *
 * ADR acceptance is ALWAYS manual — this module NEVER auto-accepts.
 * requiredDecisionGate is recommend-not-block; callers decide whether to hard-block.
 * Fail-open: no input error ever throws to caller. Malformed input → NEEDS_DECISION.
 *
 * Zero runtime dependencies. No npm packages.
 *
 * @module decision-coverage
 */
import { DECISION_COVERAGE_MODES } from '../../runtime/work/decision-enums.mjs';

// Inline isGoverning fallback — mirrors work-decision-supersede.mjs contract exactly.
// Only status==='accepted' is governing. Proposed/superseded/rejected/legacy are not.
/** @param {unknown} adr @returns {boolean} */
function isGoverning(adr) {
  if (!adr || typeof adr !== 'object' || Array.isArray(adr)) return false;
  return typeof adr.status === 'string' && adr.status === 'accepted';
}

/**
 * Asserts that a mode string is a member of DECISION_COVERAGE_MODES.
 * Guards against typos in coverageModeForAdr — returns NEEDS_DECISION on unknown values.
 * @param {string} mode @returns {string}
 */
function assertKnownMode(mode) {
  return DECISION_COVERAGE_MODES.includes(mode) ? mode : 'NEEDS_DECISION';
}

/** Statuses that are definitively non-governing (SUPERSEDED_NOT_GOVERNING). */
const NON_GOVERNING_STATUSES = Object.freeze(['superseded', 'rejected', 'proposed']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Looks up an ADR by id. Supports map (registry[id]) and array ({ decisions[] }).
 * @param {object} registry @param {string} adrId @returns {object|null}
 */
function lookupAdr(registry, adrId) {
  if (!registry || typeof registry !== 'object' || typeof adrId !== 'string') return null;
  if (Array.isArray(registry.decisions)) {
    return registry.decisions.find((d) => d && d.id === adrId) || null;
  }
  const rec = registry[adrId];
  return (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec : null;
}

/**
 * Extracts governing ADR id strings from an entity.
 * Handles: decisionRefs.governing[], decisionRefs.primary (workflow-plan shape),
 * plain string[] decisionRefs, and decisions.primary (business entity shape).
 * @param {object} entity @returns {string[]}
 */
function extractDecisionRefIds(entity) {
  if (!entity || typeof entity !== 'object') return [];
  const refs = entity.decisionRefs;
  if (refs && typeof refs === 'object' && !Array.isArray(refs)) {
    const governing = Array.isArray(refs.governing) ? refs.governing : [];
    const primary = typeof refs.primary === 'string' ? [refs.primary] : [];
    return [...new Set([...primary, ...governing])].filter((id) => typeof id === 'string');
  }
  if (Array.isArray(refs)) return refs.filter((id) => typeof id === 'string');
  const decisions = entity.decisions;
  if (decisions && typeof decisions === 'object' && typeof decisions.primary === 'string') {
    return [decisions.primary];
  }
  return [];
}

/**
 * Maps one ADR record to a DECISION_COVERAGE_MODES value.
 * @param {object|null} adrRecord @returns {string}
 */
function coverageModeForAdr(adrRecord) {
  if (!adrRecord) return 'NEEDS_DECISION';
  const status = typeof adrRecord.status === 'string' ? adrRecord.status : '';
  if (NON_GOVERNING_STATUSES.includes(status)) return assertKnownMode('SUPERSEDED_NOT_GOVERNING');
  // Legacy ADRs (format or status) are grandfathered — covered per B0-T2 §4.
  if (status === 'legacy' || adrRecord.format === 'legacy') return assertKnownMode('LEGACY_GRANDFATHERED');
  if (isGoverning(adrRecord)) return assertKnownMode('COVERED_BY_ACCEPTED');
  return 'NEEDS_DECISION';
}

/** @param {string} mode @returns {boolean} */
function isCoveredMode(mode) {
  return mode === 'COVERED_BY_ACCEPTED' || mode === 'LEGACY_GRANDFATHERED';
}

/** Degradation order: SUPERSEDED > NEEDS_DECISION > LEGACY > COVERED. */
function degrade(current, next) {
  const rank = { SUPERSEDED_NOT_GOVERNING: 0, NEEDS_DECISION: 1, LEGACY_GRANDFATHERED: 2, COVERED_BY_ACCEPTED: 3 };
  return (rank[next] ?? 3) < (rank[current] ?? 3) ? next : current;
}

// ---------------------------------------------------------------------------
// Public API — frozen interface contract (B3-T2)
// ---------------------------------------------------------------------------

/**
 * Evaluates decision coverage for an entity against an ADR registry.
 *
 * @param {object} entity - entity with decisionRefs (workflow plan, business, etc.).
 * @param {object} registry - ADR registry (map of id → ADR or `{ decisions: [] }`).
 * @param {object} [opts={}]
 * @returns {{ covered: boolean, mode: string, reasons: string[] }}
 */
export function evaluateDecisionCoverage(entity, registry, opts = {}) {
  const reasons = [];
  try {
    if (!entity || typeof entity !== 'object') {
      reasons.push('Entity is missing or not an object.');
      return { covered: false, mode: 'NEEDS_DECISION', reasons };
    }
    const refIds = extractDecisionRefIds(entity);
    if (refIds.length === 0) {
      reasons.push('No decisionRefs present on entity — decision coverage required.');
      return { covered: false, mode: 'NEEDS_DECISION', reasons };
    }
    let worstMode = 'COVERED_BY_ACCEPTED'; // start optimistic; degrade on evidence
    for (const refId of refIds) {
      const adrRecord = lookupAdr(registry, refId);
      if (!adrRecord) {
        reasons.push(`decisionRef "${refId}" not found in registry.`);
        worstMode = degrade(worstMode, 'NEEDS_DECISION');
        continue;
      }
      const mode = coverageModeForAdr(adrRecord);
      reasons.push(`decisionRef "${refId}" → ${mode} (status: ${adrRecord.status || '(unset)'}).`);
      worstMode = degrade(worstMode, mode);
    }
    return { covered: isCoveredMode(worstMode), mode: worstMode, reasons };
  } catch (_err) {
    reasons.push('Unexpected error during coverage evaluation — defaulting to NEEDS_DECISION.');
    return { covered: false, mode: 'NEEDS_DECISION', reasons };
  }
}

/**
 * Validates that all decisionRefs in a workflow plan exist in the registry
 * and are not superseded or rejected.
 *
 * @param {object} workflowPlan - workflow plan object with decisionRefs.
 * @param {object} registry - ADR registry.
 * @returns {{ ok: boolean, missing: string[], superseded: string[] }}
 */
export function validateWorkflowDecisionRefs(workflowPlan, registry) {
  try {
    if (!workflowPlan || typeof workflowPlan !== 'object') {
      return { ok: false, missing: ['(workflowPlan missing)'], superseded: [] };
    }
    const refIds = extractDecisionRefIds(workflowPlan);
    if (refIds.length === 0) return { ok: true, missing: [], superseded: [] };
    const missing = [];
    const superseded = [];
    for (const refId of refIds) {
      const adrRecord = lookupAdr(registry, refId);
      if (!adrRecord) { missing.push(refId); continue; }
      if (coverageModeForAdr(adrRecord) === 'SUPERSEDED_NOT_GOVERNING') superseded.push(refId);
    }
    return { ok: missing.length === 0 && superseded.length === 0, missing, superseded };
  } catch (_err) {
    return { ok: false, missing: ['(evaluation error)'], superseded: [] };
  }
}

/**
 * Required-decision gate — explicit gate for material work.
 *
 * Returns pass:false when the entity lacks governing accepted-ADR coverage.
 * MATERIAL entities (isMaterial===true or type==='MATERIAL') without accepted
 * coverage always fail with an explicit MATERIAL reason. This function NEVER
 * auto-accepts an ADR; it only reads and reports. Recommend-not-block at the
 * hook advisory surface — callers decide whether to hard-block.
 *
 * @param {object} entity
 * @param {object} registry
 * @param {object} [opts={}]
 * @returns {{ pass: boolean, reasons: string[] }}
 */
export function requiredDecisionGate(entity, registry, opts = {}) {
  const reasons = [];
  try {
    const { covered, mode, reasons: coverageReasons } = evaluateDecisionCoverage(
      entity, registry, opts,
    );
    reasons.push(...coverageReasons);
    if (covered) return { pass: true, reasons };
    const isMaterial = entity && (
      entity.isMaterial === true ||
      (typeof entity.type === 'string' && entity.type.toUpperCase() === 'MATERIAL')
    );
    reasons.push(
      isMaterial
        ? `MATERIAL entity blocked: coverage mode is "${mode}" — accepted ADR required before material work proceeds.`
        : `Coverage mode is "${mode}" — an accepted (governing) ADR is required. Human must accept an ADR before this work may proceed.`,
    );
    return { pass: false, reasons };
  } catch (_err) {
    reasons.push('Gate evaluation error — defaulting to fail-safe (pass: false).');
    return { pass: false, reasons };
  }
}
