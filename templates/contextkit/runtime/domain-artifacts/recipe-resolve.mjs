/**
 * recipe-resolve.mjs — resolves the Task Compiler domain-implementation recipe
 * for a profile (ADR-0128 §21, WF-0066).
 *
 * Reuses the EXISTING Task Compiler recipe infrastructure
 * (economy/tc-recipe-runner.mjs DAG shapes) over forking a second compiler
 * (ADR-0128 architecture read, spec "Proposed components"). This module only
 * resolves WHICH recipe + WHICH playbook step sequence applies to a resolved
 * profile — it declares data, it does not execute a DAG. `tc-recipe-runner.mjs`
 * remains the sole runner; a caller that needs to EXECUTE the resolved step
 * sequence builds a `Recipe` (linear chain) from `resolveRecipeForProfile`'s
 * output and hands it to `runRecipe`.
 *
 * Deterministic and versioned: identical profile input always yields the
 * identical step sequence (recipe determinism, spec Test plan).
 *
 * Pure — no I/O; the caller injects the loaded recipeContracts table.
 *
 * @module domain-artifacts/recipe-resolve
 */

/** Profile name -> recipe id in recipe-contracts.json's `recipes` map. */
const PROFILE_RECIPE_ID = Object.freeze({
  simple: 'implementation-simple',
  modular: 'implementation-modular',
  'domain-driven': 'implementation-domain-driven',
  'distributed-domain': 'implementation-distributed-domain',
});

/**
 * Resolves the domain-implementation recipe for a resolved Implementation
 * Profile. `no-code` has no recipe (zero ceremony, ADR-0128 classification
 * ruling) — resolution reports `applicable: false`, never a fabricated recipe.
 *
 * @param {string} profile resolved Implementation Profile name.
 * @param {object} recipeContractsTable the loaded recipe-contracts.json table.
 * @returns {{ applicable: boolean, recipeId: string|null, version: string|null,
 *   playbookSteps: string[], reasonCode: string, degraded: boolean }}
 */
export function resolveRecipeForProfile(profile, recipeContractsTable) {
  const table = recipeContractsTable && typeof recipeContractsTable === 'object' ? recipeContractsTable.recipes : null;
  if (!table || typeof table !== 'object') {
    return { applicable: false, recipeId: null, version: null, playbookSteps: [], reasonCode: 'ARTIFACTS_POLICY_DEGRADED', degraded: true };
  }
  if (profile === 'no-code') {
    return { applicable: false, recipeId: null, version: null, playbookSteps: [], reasonCode: 'RECIPE_UNKNOWN_PROFILE', degraded: false };
  }
  const recipeId = PROFILE_RECIPE_ID[profile];
  const entry = recipeId ? table[recipeId] : null;
  if (!entry) {
    return { applicable: false, recipeId: null, version: null, playbookSteps: [], reasonCode: 'RECIPE_UNKNOWN_PROFILE', degraded: false };
  }
  return {
    applicable: true,
    recipeId,
    version: typeof entry.version === 'string' ? entry.version : null,
    playbookSteps: Array.isArray(entry.playbookSteps) ? [...entry.playbookSteps] : [],
    reasonCode: 'RECIPE_RESOLVED',
    degraded: false,
  };
}

/**
 * Builds a linear `Recipe` (tc-recipe-runner.mjs shape) from a resolved
 * profile's playbook step sequence — one `noop`-kind step per playbook step,
 * chained in order. The caller may replace individual steps' `kind`/
 * `patchPlan` before execution; this only produces the deterministic skeleton
 * (best-practices S1 — assembly here, no writes).
 *
 * @param {string} profile resolved Implementation Profile name.
 * @param {object} recipeContractsTable the loaded recipe-contracts.json table.
 * @returns {import('../../tools/scripts/economy/tc-recipe-runner.mjs').Recipe|null}
 *   null when the profile has no applicable recipe.
 */
export function buildLinearRecipe(profile, recipeContractsTable) {
  const resolved = resolveRecipeForProfile(profile, recipeContractsTable);
  if (!resolved.applicable || resolved.playbookSteps.length === 0) return null;

  const steps = resolved.playbookSteps.map((stepId, index) => {
    const next = resolved.playbookSteps[index + 1];
    return {
      id: stepId,
      kind: 'noop',
      label: `domain-implementation playbook step: ${stepId}`,
      ...(next ? { edges: [{ target: next }] } : {}),
    };
  });

  return {
    id: resolved.recipeId,
    version: resolved.version ?? '1.0.0',
    entry: steps[0].id,
    steps,
  };
}
