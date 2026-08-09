/**
 * Public surface for optional Domain Engineering classification.
 *
 * ContextDevKit 4.0 keeps this capability observational: it may classify,
 * recommend a profile, compare a declared map with the Project Map, and collect
 * optional calibration samples. It cannot deny writes, require agents, or gate
 * completion.
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
  buildLabel, promotionAuthorizedLabels, provenanceCounts, buildConfusionMatrix, precisionRecall,
  PROVENANCE_TIERS, EVIDENCE_TIERS,
} from './ground-truth.mjs';
export {
  calibrationKey, buildSample, appendSample, telemetryPathFor, TELEMETRY_SCHEMA_VERSION,
} from './telemetry.mjs';
export {
  resolveConfig, resolveObservationMode, DEFAULT_DOMAIN_ENGINEERING_CONFIG,
} from './config.mjs';
export {
  compareDomainToProjectMap, PROJECT_MAP_COMPARE_VERSION,
} from './project-map-compare.mjs';
