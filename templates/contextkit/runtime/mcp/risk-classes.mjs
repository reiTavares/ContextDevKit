/**
 * MCP Risk Taxonomy — the R0..R5 canonical defaults (ADR-0042 lineage).
 *
 * A small, frozen lookup table: the SINGLE source of truth for what each risk
 * class means and its default activation posture. Kept separate from policy.mjs
 * so the taxonomy can be referenced by docs/commands without pulling the engine.
 *
 * Pure data + trivial accessors. Zero dependencies (immutable rule 1).
 *
 * @module risk-classes
 */

/** @typedef {'R0'|'R1'|'R2'|'R3'|'R4'|'R5'} RiskClass */

/** Ordered, frozen list of valid risk classes (lowest → highest blast radius). */
export const RISK_CLASSES = Object.freeze(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);

/**
 * Canonical default posture per class. `mode` is the maximum tool exposure a new
 * server of this class gets without an explicit, tighter override; everything
 * defaults read-only except where the class inherently implies write. `requiresApproval`
 * marks the human-gate floor (R4/R5). `label` is the one-line policy summary.
 *
 * @type {Readonly<Record<RiskClass, {label: string, mode: 'read-only'|'write', requiresApproval: boolean, blocked: boolean}>>}
 */
export const CLASS_DEFAULTS = Object.freeze({
  R0: Object.freeze({ label: 'simple-activate',          mode: 'read-only', requiresApproval: false, blocked: false }),
  R1: Object.freeze({ label: 'allow-in-workspace',       mode: 'read-only', requiresApproval: false, blocked: false }),
  R2: Object.freeze({ label: 'approval+secrets-by-ref',  mode: 'read-only', requiresApproval: false, blocked: false }),
  R3: Object.freeze({ label: 'guarded',                  mode: 'read-only', requiresApproval: false, blocked: false }),
  R4: Object.freeze({ label: 'human-approval',           mode: 'read-only', requiresApproval: true,  blocked: false }),
  R5: Object.freeze({ label: 'blocked-by-default',       mode: 'read-only', requiresApproval: true,  blocked: true }),
});

/**
 * Returns the canonical default posture for a risk class. Unknown classes resolve
 * to R5 (blocked-by-default) — fail closed (constitution §8).
 *
 * @param {string} riskClass
 * @returns {{label: string, mode: 'read-only'|'write', requiresApproval: boolean, blocked: boolean}}
 */
export function classDefault(riskClass) {
  return CLASS_DEFAULTS[riskClass] ?? CLASS_DEFAULTS.R5;
}

/**
 * True when the class sits at or above the human-approval floor (R4, R5).
 *
 * @param {string} riskClass
 * @returns {boolean}
 */
export function isHumanApprovalClass(riskClass) {
  return classDefault(riskClass).requiresApproval === true;
}
