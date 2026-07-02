/**
 * playbook.mjs — accessors for the devteam 8-step implementation journey
 * (ADR-0128 §12, WF-0064): Classify → Model → Decide → Compile → Implement →
 * Verify → Review → Receipt.
 *
 * The steps live in playbook.json (single source); this module only reads,
 * filters by profile and validates order. Pure — the caller injects the table.
 * Shadow-only: steps are DECLARED here; orchestration is WF-0065, blocking is
 * WF-0067.
 *
 * @module devteam/playbook
 */

/** Canonical step order (§12) — the table must match this exactly. */
export const PLAYBOOK_STEP_ORDER = Object.freeze([
  'classify', 'model', 'decide', 'compile', 'implement', 'verify', 'review', 'receipt',
]);

/**
 * Returns the ordered playbook steps from an injected playbook.json table.
 *
 * @param {object} playbookTable playbook.json table.
 * @returns {object[]} steps sorted by `order` (empty on a malformed table).
 */
export function playbookSteps(playbookTable) {
  const steps = Array.isArray(playbookTable?.steps) ? playbookTable.steps : [];
  return steps
    .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Returns the steps that APPLY for one resolved profile: `always` and
 * `conditional` steps always appear (conditional resolution happens at run
 * time); `profile`-gated steps only when the profile is in their `profileIn`.
 *
 * @param {string} profileName resolved profile (e.g. 'simple', 'domain-driven').
 * @param {object} playbookTable playbook.json table.
 * @returns {{ steps: object[], reasonCodes: string[] }}
 */
export function stepsForProfile(profileName, playbookTable) {
  const all = playbookSteps(playbookTable);
  const reasonCodes = [];
  const steps = all.filter((step) => {
    if (step.requiredWhen !== 'profile') return true;
    const applies = Array.isArray(step.profileIn) && step.profileIn.includes(profileName);
    if (!applies) reasonCodes.push('PLAYBOOK_STEP_PROFILE_GATED');
    return applies;
  });
  return { steps, reasonCodes: [...new Set(reasonCodes)] };
}

/**
 * Validates that the injected table carries exactly the canonical §12 journey:
 * same ids, same order, contiguous `order` values starting at 1.
 *
 * @param {object} playbookTable playbook.json table.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlaybookOrder(playbookTable) {
  const steps = playbookSteps(playbookTable);
  const errors = [];
  if (steps.length !== PLAYBOOK_STEP_ORDER.length) {
    errors.push(`expected ${PLAYBOOK_STEP_ORDER.length} steps, found ${steps.length}`);
  }
  steps.forEach((step, index) => {
    if (step.id !== PLAYBOOK_STEP_ORDER[index]) {
      errors.push(`step ${index + 1} is '${step.id}', expected '${PLAYBOOK_STEP_ORDER[index]}'`);
    }
    if (step.order !== index + 1) {
      errors.push(`step '${step.id}' has order ${step.order}, expected ${index + 1}`);
    }
  });
  return { valid: errors.length === 0, errors };
}
