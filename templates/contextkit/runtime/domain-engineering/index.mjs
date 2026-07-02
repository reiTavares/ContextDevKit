/**
 * index.mjs — public surface of the Domain Engineering classification capability
 * (ADR-0128 / ADR-0129, WF-0063). This is the single entry point every later
 * workflow (WF-0064 agents, WF-0066 artifacts, WF-0067 enforcement) imports — it
 * defines the contract and keeps the internals private (best-practices S2).
 *
 * The capability is deterministic, host-neutral and SHADOW-ONLY at this stage:
 * it classifies and records, but grants zero blocking power.
 *
 * @module domain-engineering
 */
export { loadPolicyBundle, loadPolicyTable, POLICY_TABLES } from './policy-load.mjs';
export { buildSignals, hasAnyToken } from './signals.mjs';
export { scoreCodeMutationIntent } from './code-intent.mjs';
export { scoreDomainApplicability } from './domain-applicability.mjs';
export { resolveImplementationProfile } from './profile.mjs';
export { classifyPath } from './path-classify.mjs';
export { buildImplementationBlock, IMPLEMENTATION_BLOCK_VERSION } from './envelope-block.mjs';
export {
  getRule, isClassA, maximumAutomaticLevel, validateRuleClasses, listRulesByClass, CLASS_B_CEILING,
} from './rule-classes.mjs';
export {
  buildLabel, promotionAuthorizedLabels, provenanceCounts, buildConfusionMatrix,
  PROVENANCE_TIERS, EVIDENCE_TIERS,
} from './ground-truth.mjs';
export {
  calibrationKey, buildSample, appendSample, telemetryPathFor, TELEMETRY_SCHEMA_VERSION,
} from './telemetry.mjs';
export {
  resolveConfig, modeForLevel, DEFAULT_DOMAIN_ENGINEERING_CONFIG,
} from './config.mjs';
