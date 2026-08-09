/**
 * domain-applicability.mjs — the Domain Applicability Score (DAS) scorer
 * (ADR-0128 §7). Answers "how much domain engineering does this change require?"
 * so DDD ceremony is applied only when justified and NEVER to simple work.
 *
 * Pure: weights, bands and floor hard triggers are INJECTED (ADR-0129 §4).
 *
 * Rule:
 *   1. Weighted score — Σ(matched positive + reducer weights), clamped [0,100],
 *      resolved to a profile band.
 *   2. Floor hard triggers — confirmed domain tokens (bounded context, aggregate,
 *      invariant…) raise the profile FLOOR to domain-driven; distributed tokens
 *      (saga, outbox, versioned event…) to distributed-domain. A floor only
 *      RAISES, never lowers, the band-derived profile.
 *
 * Fail-open to a degraded receipt, never a false pass. Zero runtime dependencies.
 *
 * @module domain-engineering/domain-applicability
 */
import { hasAnyToken } from './signals.mjs';

/** Profile ranking — used to apply a floor as max(band, floor). */
const PROFILE_RANK = Object.freeze({ simple: 0, modular: 1, 'domain-driven': 2, 'distributed-domain': 3 });

/**
 * Scores domain applicability for a normalized signal object.
 *
 * @param {object} signals from buildSignals().
 * @param {object} policy the domain-applicability-weights table.
 * @param {object} [hardTriggers] the hard-triggers table (domainApplicabilityFloors).
 * @returns {{ score: number, profileFloor: string, reasonCodes: string[],
 *   matched: string[], degraded: boolean }}
 */
export function scoreDomainApplicability(signals, policy, hardTriggers) {
  const safe = signals && typeof signals === 'object' ? signals : {};
  if (!policy || !Array.isArray(policy.bands) || !policy.positiveSignals) {
    return { score: 0, profileFloor: 'simple', reasonCodes: ['ENVELOPE_DEGRADED'], matched: [], degraded: true };
  }

  const haystack = String(safe.text ?? '');
  const matched = [];
  let score = 0;
  for (const [name, signal] of Object.entries(policy.positiveSignals)) {
    if (hasAnyToken(haystack, signal.tokens)) { score += signal.weight; matched.push(name); }
  }
  for (const [name, signal] of Object.entries(policy.reducerSignals || {})) {
    if (hasAnyToken(haystack, signal.tokens)) { score += signal.weight; matched.push(name); }
  }
  score = clamp(score);

  let profile = resolveProfile(score, policy.bands);
  const reasonCodes = [profileReasonCode(profile)];

  // Apply floor hard triggers (raise-only).
  const floors = applyFloors(haystack, hardTriggers);
  for (const floor of floors) {
    if (PROFILE_RANK[floor.profile] > PROFILE_RANK[profile]) {
      profile = floor.profile;
      reasonCodes.push(floor.reasonCode);
    }
  }

  return { score, profileFloor: profile, reasonCodes, matched, degraded: false };
}

/**
 * Returns the floor profiles whose confirmed tokens appear in the text. Floors
 * require the token to be present (the §7 "confirmed in context" rule); WF-0063
 * treats token presence as the confirmation in shadow mode.
 */
function applyFloors(haystack, hardTriggers) {
  const floors = hardTriggers && hardTriggers.domainApplicabilityFloors;
  if (!floors) return [];
  const result = [];
  for (const key of ['domainDriven', 'distributedDomain']) {
    const floor = floors[key];
    if (floor && hasAnyToken(haystack, floor.tokens)) {
      result.push({ profile: floor.floorProfile, reasonCode: floor.reasonCode });
    }
  }
  return result;
}

/** Resolves the profile band for a clamped score. */
function resolveProfile(score, bands) {
  for (const band of bands) {
    if (score <= band.max) return band.profile;
  }
  return bands[bands.length - 1].profile;
}

/** Maps a profile to its stable reason code. */
function profileReasonCode(profile) {
  const map = {
    simple: 'DAS_PROFILE_SIMPLE',
    modular: 'DAS_PROFILE_MODULAR',
    'domain-driven': 'DAS_PROFILE_DOMAIN_DRIVEN',
    'distributed-domain': 'DAS_PROFILE_DISTRIBUTED_DOMAIN',
  };
  return map[profile] || 'DAS_PROFILE_SIMPLE';
}

/** Clamps a number into [0,100]; non-numbers ⇒ 0. */
function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
