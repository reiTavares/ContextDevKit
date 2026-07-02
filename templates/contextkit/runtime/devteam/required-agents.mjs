/**
 * required-agents.mjs — resolves the required devteam agents for a resolved
 * Implementation Profile (ADR-0128 §9/§10, WF-0064).
 *
 * The profile's `minimumSquad` (profile-thresholds.json, WF-0063) is the SINGLE
 * SOURCE of squad composition — this resolver reuses it verbatim and never
 * declares a second authority (best-practices S4). Squad activation is
 * mandatory for code; the fan-out is proportional to the profile.
 *
 * Pure — no I/O; callers inject the resolved profile (and optionally the
 * profiles table when only a profile name is known). Shadow-only: this
 * DECLARES the composition; runtime dispatch is WF-0065.
 *
 * @module devteam/required-agents
 */

/**
 * Resolves the required agent list for one resolved profile.
 *
 * Accepts either the full profile result from `resolveImplementationProfile`
 * (WF-0063 — carries `minimumSquad`) or a bare profile name plus an injected
 * `profilesTable` (profile-thresholds.json shape) to look the squad up.
 *
 * @param {object|string} profile resolved profile result or profile name.
 * @param {object} [profilesTable] profile-thresholds.json table (only needed
 *   when `profile` is a bare name).
 * @returns {{ agents: string[], reasonCodes: string[], degraded: boolean }}
 */
export function resolveRequiredAgents(profile, profilesTable) {
  const resolved = normalizeProfile(profile, profilesTable);
  if (resolved.degraded) {
    return { agents: [], reasonCodes: ['DEVTEAM_POLICY_DEGRADED'], degraded: true };
  }
  if (resolved.name === 'no-code' || resolved.minimumSquad.length === 0) {
    return { agents: [], reasonCodes: ['AGENTS_EMPTY_NO_CODE'], degraded: false };
  }
  return { agents: [...resolved.minimumSquad], reasonCodes: ['AGENTS_FROM_PROFILE'], degraded: false };
}

/**
 * Normalizes the two accepted inputs into `{ name, minimumSquad }`.
 *
 * @param {object|string} profile
 * @param {object} [profilesTable]
 * @returns {{ name: string|null, minimumSquad: string[], degraded: boolean }}
 */
function normalizeProfile(profile, profilesTable) {
  if (profile && typeof profile === 'object' && Array.isArray(profile.minimumSquad)) {
    return {
      name: typeof profile.profile === 'string' ? profile.profile : null,
      minimumSquad: profile.minimumSquad.filter((a) => typeof a === 'string'),
      degraded: false,
    };
  }
  if (typeof profile === 'string' && profilesTable && typeof profilesTable === 'object') {
    const entry = profilesTable.profiles?.[profile];
    if (entry && Array.isArray(entry.minimumSquad)) {
      return { name: profile, minimumSquad: entry.minimumSquad.filter((a) => typeof a === 'string'), degraded: false };
    }
  }
  return { name: null, minimumSquad: [], degraded: true };
}
