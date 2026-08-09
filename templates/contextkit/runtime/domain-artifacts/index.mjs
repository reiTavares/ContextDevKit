/**
 * index.mjs — public surface of the Domain Artifacts & Task Compiler
 * capability (ADR-0128 §13/§21/§22, WF-0066). This is the single entry point
 * downstream workflows (WF-0065 lifecycle, WF-0067 enforcement) import — it
 * defines the contract and keeps the internals private (best-practices S2).
 *
 * The capability is deterministic, host-neutral and SHADOW-ONLY at this
 * stage: it validates, compiles and resolves; it writes no source and grants
 * zero blocking power.
 *
 * @module domain-artifacts
 */
export {
  loadDomainArtifactsPolicyBundle, loadDomainArtifactsPolicyTable, DOMAIN_ARTIFACTS_POLICY_TABLES,
} from './policy-load.mjs';
export { validateArtifact, checkProportionality } from './schema-validate.mjs';
export { resolveRecipeForProfile, buildLinearRecipe } from './recipe-resolve.mjs';
export { scaffold } from './scaffold.mjs';
