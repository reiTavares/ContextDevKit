/**
 * envelope-block.mjs — builds the Request Intent Envelope `implementation` block
 * (ADR-0128 §15). This is the integration layer: it loads the policy bundle from
 * disk once, then runs the PURE scorer chain (CMIS → DAS → profile) and shapes
 * the block every downstream consumer (lifecycle, enforcement, completion) reads.
 *
 * WF-0063 is SHADOW-ONLY: the block is additive and carries `shadow: true`; it
 * grants zero blocking power. A degraded policy/signal load yields a block with
 * the ENVELOPE_DEGRADED reason code — a recorded receipt, never a false pass.
 *
 * Zero runtime dependencies beyond the sibling pure modules + policy-load.
 *
 * @module domain-engineering/envelope-block
 */
import { loadPolicyBundle } from './policy-load.mjs';
import { buildSignals } from './signals.mjs';
import { scoreCodeMutationIntent } from './code-intent.mjs';
import { scoreDomainApplicability } from './domain-applicability.mjs';
import { resolveImplementationProfile } from './profile.mjs';
// Devteam leaf modules (WF-0064). Direction note: envelope-block is the §15
// COMPOSITION layer, so it may read the devteam skill table; the devteam leaf
// modules import nothing from domain-engineering (no cycle).
import { loadDevteamPolicyTable } from '../devteam/policy-load.mjs';
import { resolveRequiredSkills } from '../devteam/required-skills.mjs';

/** Block schema version — bump on any breaking shape change (§15). */
export const IMPLEMENTATION_BLOCK_VERSION = '1.0.0';

/**
 * Builds the `implementation` block for one request. Pure given an injected
 * `policy` bundle; otherwise loads it from `root` (the integration path).
 *
 * @param {object} params
 * @param {string} params.root absolute project root (to load policy).
 * @param {string} [params.requestText]
 * @param {object} [params.intakeSignals] from task-intake.intake().
 * @param {object} [params.classification] from classifyRequest().
 * @param {boolean} [params.writeAttempt] true on a real write tool (WF-0067).
 * @param {string|null} [params.tool] write tool name.
 * @param {object} [params.projectMap] optional project map for path awareness.
 * @param {object} [params.policy] pre-loaded bundle (tests inject this).
 * @param {object} [params.devteamTriggers] pre-loaded skill-triggers table
 *   (tests inject this; otherwise loaded from `root` — WF-0064).
 * @returns {object} the §15 implementation block.
 */
export function buildImplementationBlock(params) {
  const p = params && typeof params === 'object' ? params : {};
  const bundle = p.policy || loadPolicyBundle(p.root);
  const signals = buildSignals(p);

  if (!bundle || bundle.degraded) {
    return degradedBlock(bundle ? bundle.missing : ['all']);
  }

  const codeIntentPolicy = { ...bundle.codeIntent, hardTrigger: bundle.hardTriggers?.codeMutationIntent?.writeAttempt };
  const cmis = scoreCodeMutationIntent(signals, codeIntentPolicy);
  const das = scoreDomainApplicability(signals, bundle.domainApplicability, bundle.hardTriggers);
  const profile = resolveImplementationProfile(
    cmis,
    das,
    { risk: signals.risk, blastRadius: signals.blastRadius, materialityScore: signals.materialityScore },
    bundle.profiles,
  );

  const squadRequired = profile.profile !== 'no-code';
  // WF-0064: skills resolve from the §11 trigger truth-table (devteam policy).
  // A missing table degrades to the conservative baseline with a reason code.
  const triggers = p.devteamTriggers ?? loadDevteamPolicyTable(p.root, 'skillTriggers').table;
  const skills = resolveRequiredSkills(cmis, das, profile, skillContext(signals, das), triggers);

  return {
    schemaVersion: IMPLEMENTATION_BLOCK_VERSION,
    shadow: true,
    codeMutationIntentScore: cmis.score,
    codeMutationVerdict: cmis.verdict,
    domainApplicabilityScore: das.score,
    profile: profile.profile,
    squadRequired,
    requiredAgents: profile.minimumSquad,
    requiredSkills: skills.skills,
    // additive honesty flag: skill resolution fell back to the baseline (the
    // block-level `degraded` stays false — classification itself succeeded).
    skillsDegraded: skills.degraded,
    requiredArtifacts: profile.artifacts,
    simulateImpactRequired: profile.simulateImpactRequired,
    reasonCodes: dedupe([...cmis.reasonCodes, ...das.reasonCodes, ...profile.reasonCodes, ...skills.reasonCodes]),
    degraded: false,
  };
}

/**
 * Shapes the declared skill-trigger context from the normalized signals: only
 * evidence the envelope actually carries — absent flags stay false, a trigger
 * never fires on inference (§11).
 *
 * @param {object} signals from buildSignals().
 * @param {object} das DAS result (its DAS_FLOOR_* codes mark a hard trigger).
 * @returns {object} ctx for resolveRequiredSkills().
 */
function skillContext(signals, das) {
  return {
    risk: signals.risk,
    blastRadius: signals.blastRadius,
    complexity: signals.complexity,
    flags: {
      writeAttempt: signals.writeAttempt === true,
      domainHardTrigger: (das.reasonCodes ?? []).some((code) => typeof code === 'string' && code.startsWith('DAS_FLOOR_')),
    },
  };
}

/** Builds the honest degraded block (shadow, zero authority, recorded reason). */
function degradedBlock(missing) {
  return {
    schemaVersion: IMPLEMENTATION_BLOCK_VERSION,
    shadow: true,
    codeMutationIntentScore: 0,
    codeMutationVerdict: 'UNCERTAIN',
    domainApplicabilityScore: 0,
    profile: 'no-code',
    squadRequired: false,
    requiredAgents: [],
    requiredSkills: [],
    skillsDegraded: true,
    requiredArtifacts: [],
    simulateImpactRequired: false,
    reasonCodes: ['ENVELOPE_DEGRADED'],
    degraded: true,
    missing: Array.isArray(missing) ? missing : [],
  };
}

/** Removes duplicate reason codes, preserving first-seen order. */
function dedupe(list) {
  return [...new Set(list.filter((x) => typeof x === 'string'))];
}
