/**
 * Resolves advisory devteam suggestions for a classified implementation shape.
 *
 * `recommendedAgents` in profile-thresholds.json is the single source of these
 * suggestions. The result has no dispatch or blocking authority.
 *
 * Pure — no I/O; callers inject the resolved profile (and optionally the
 * profiles table when only a profile name is known). Pure and read-only.
 *
 * @module devteam/recommended-agents
 */

/**
 * Resolves recommended agents for one advisory profile.
 *
 * Accepts either the full profile result from `resolveImplementationProfile`
 * or a bare profile name plus an injected
 * `profilesTable` (profile-thresholds.json shape) to look the squad up.
 *
 * @param {object|string} profile resolved profile result or profile name.
 * @param {object} [profilesTable] profile-thresholds.json table (only needed
 *   when `profile` is a bare name).
 * @returns {{ agents: string[], reasonCodes: string[], degraded: boolean }}
 */
export function resolveRecommendedAgents(profile, profilesTable) {
  const resolved = normalizeProfile(profile, profilesTable);
  if (resolved.degraded) {
    return { agents: [], reasonCodes: ['AGENT_RECOMMENDATIONS_UNAVAILABLE'], degraded: true };
  }
  if (resolved.name === 'no-code' || resolved.recommendedAgents.length === 0) {
    return { agents: [], reasonCodes: ['NO_AGENT_RECOMMENDATION'], degraded: false };
  }
  return { agents: [...resolved.recommendedAgents], reasonCodes: ['AGENTS_RECOMMENDED_BY_PROFILE'], degraded: false };
}

/**
 * Normalizes the two accepted inputs into `{ name, recommendedAgents }`.
 *
 * @param {object|string} profile
 * @param {object} [profilesTable]
 * @returns {{ name: string|null, recommendedAgents: string[], degraded: boolean }}
 */
function normalizeProfile(profile, profilesTable) {
  if (profile && typeof profile === 'object' && Array.isArray(profile.recommendedAgents)) {
    return {
      name: typeof profile.profile === 'string' ? profile.profile : null,
      recommendedAgents: profile.recommendedAgents.filter((agent) => typeof agent === 'string'),
      degraded: false,
    };
  }
  if (typeof profile === 'string' && profilesTable && typeof profilesTable === 'object') {
    const entry = profilesTable.profiles?.[profile];
    if (entry && Array.isArray(entry.recommendedAgents)) {
      return { name: profile, recommendedAgents: entry.recommendedAgents.filter((agent) => typeof agent === 'string'), degraded: false };
    }
  }
  return { name: null, recommendedAgents: [], degraded: true };
}
