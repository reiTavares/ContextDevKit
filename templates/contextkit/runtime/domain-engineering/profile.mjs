/**
 * profile.mjs — the Implementation Profile resolver (ADR-0128 §8).
 *
 * Combines the CMIS verdict (is this code?), the DAS profile floor (how much
 * domain?) and the INHERITED signals (risk, blast radius, materiality) into one
 * of: no-code / simple / modular / domain-driven / distributed-domain. Each
 * profile declares its minimum squad and proportional artifacts.
 *
 * Two invariants (constitution §9, ADR-0128 classification ruling):
 *   - NO_CODE short-circuits to `no-code` (no squad, no artifacts).
 *   - inherited signals only RAISE the rank, never fabricate domain ceremony for
 *     work below the DAS floor — simple never gets a domain model.
 *
 * Pure: thresholds + profile definitions are INJECTED. Zero runtime deps.
 *
 * @module domain-engineering/profile
 */

/** Profile order by rank — index is the rank. */
const PROFILE_ORDER = Object.freeze(['no-code', 'simple', 'modular', 'domain-driven', 'distributed-domain']);

/**
 * Resolves the Implementation Profile.
 *
 * @param {object} cmis result of scoreCodeMutationIntent().
 * @param {object} das result of scoreDomainApplicability().
 * @param {object} context inherited { risk, blastRadius, materialityScore }.
 * @param {object} policy the profile-thresholds table.
 * @returns {{ profile: string, minimumSquad: string[], artifacts: string[],
 *   simulateImpactRequired: boolean, reasonCodes: string[] }}
 */
export function resolveImplementationProfile(cmis, das, context, policy) {
  const ctx = context && typeof context === 'object' ? context : {};
  const profiles = (policy && policy.profiles) || {};
  const reasonCodes = [];

  // 1. NO_CODE short-circuit.
  if (cmis && cmis.verdict === 'NO_CODE') {
    reasonCodes.push('PROFILE_NO_CODE');
    return shape('no-code', profiles, reasonCodes);
  }

  // 2. Base profile from the DAS floor (defaults to simple for real code work).
  let profile = das && das.profileFloor ? das.profileFloor : 'simple';
  if (PROFILE_ORDER.indexOf(profile) < 1) profile = 'simple';
  reasonCodes.push('PROFILE_FROM_DAS');

  // 3. Inherited escalation — raise-only.
  profile = escalate(profile, ctx, policy && policy.escalation, reasonCodes);

  return shape(profile, profiles, reasonCodes);
}

/**
 * Raises the profile rank from inherited risk / blast radius / materiality.
 * Never lowers. Records the reason for each applied escalation.
 */
function escalate(profile, ctx, escalation, reasonCodes) {
  if (!escalation) return profile;
  let current = profile;
  const lift = (target, reason) => {
    if (target && rank(target) > rank(current)) { current = target; reasonCodes.push(reason); }
  };
  if (ctx.risk === 'high') lift(escalation.riskHighRaisesTo, 'PROFILE_ESCALATED_BY_RISK');
  if (ctx.risk === 'critical') lift(escalation.riskCriticalRaisesTo, 'PROFILE_ESCALATED_BY_RISK');
  if (ctx.blastRadius === 'cross-cutting') lift(escalation.blastRadiusCrossCuttingRaisesTo, 'PROFILE_ESCALATED_BY_BLAST');
  const materiality = Number(ctx.materialityScore);
  if (Number.isFinite(materiality) && materiality >= (escalation.materialityHighThreshold ?? 0.7)) {
    lift(escalation.materialityHighRaisesTo, 'PROFILE_ESCALATED_BY_MATERIALITY');
  }
  return current;
}

/** Builds the public profile shape from its policy definition. */
function shape(profile, profiles, reasonCodes) {
  const def = profiles[profile] || {};
  return {
    profile,
    minimumSquad: Array.isArray(def.minimumSquad) ? [...def.minimumSquad] : [],
    artifacts: Array.isArray(def.artifacts) ? [...def.artifacts] : [],
    simulateImpactRequired: Boolean(def.simulateImpactRequired),
    reasonCodes,
  };
}

/** Rank index of a profile name (−1 when unknown). */
function rank(profile) {
  return PROFILE_ORDER.indexOf(profile);
}
