/**
 * config.mjs — the `domainEngineering` configuration schema + defaults
 * (ADR-0128 plan §26). Default-OFF and level-aware: the capability does nothing
 * until a project opts in. Thresholds default to the policy tables but may be
 * overridden per project. Enforcement defaults encode the level→mode ladder
 * (L4 advisory, L5/L6 guarded, L7 strict) — WF-0063 ships shadow-only, so the
 * mode here is declarative only until WF-0067 wires enforcement.
 *
 * Pure + zero runtime dependencies. `resolveConfig` merges a user block over the
 * defaults defensively (a malformed user block degrades to defaults, never throws).
 *
 * @module domain-engineering/config
 */

/** Canonical default `domainEngineering` config block (§26). */
export const DEFAULT_DOMAIN_ENGINEERING_CONFIG = Object.freeze({
  enabled: false,
  classifyEveryRequest: false,
  sessionStartReadiness: false,
  requireDevteamForCode: false,
  requireImplementationPacket: false,
  persistImplementationReceipt: false,
  codeIntent: { askMin: 30, codeMin: 50, structuralMin: 70 },
  domainApplicability: { modularMin: 25, domainDrivenMin: 45, distributedMin: 70 },
  enforcement: {
    level4: 'advisory',
    level5: 'guarded',
    level6: 'guarded',
    level7: 'strict',
    failMode: 'allow-with-degraded-receipt',
  },
  squad: {
    minimumCodeLead: 'implementation-engineer',
    maxParallelAgents: 5,
    requireActualSpawnRecords: true,
  },
  artifacts: { proportional: true, neverGenerateDomainModelForSimple: true },
});

/**
 * Resolves the effective config by merging a user-supplied block over the
 * defaults. Shallow-merges nested objects (codeIntent, domainApplicability,
 * enforcement, squad, artifacts) so a partial override keeps the other defaults.
 * Never throws — a non-object user block degrades to the defaults.
 *
 * @param {object} [userConfig] the `domainEngineering` block from contextkit/config.json.
 * @returns {object} effective config (a fresh, mutable copy).
 */
export function resolveConfig(userConfig) {
  const base = clone(DEFAULT_DOMAIN_ENGINEERING_CONFIG);
  if (!userConfig || typeof userConfig !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (!(key in userConfig)) continue;
    const userValue = userConfig[key];
    base[key] = isPlainObject(base[key]) && isPlainObject(userValue)
      ? { ...base[key], ...userValue }
      : userValue;
  }
  return base;
}

/**
 * Maps a ContextDevKit level to the configured enforcement mode. WF-0063 is
 * shadow-only, so this is declarative until WF-0067 consumes it.
 *
 * @param {number} level ContextDevKit level (1-7).
 * @param {object} [config] effective config from resolveConfig().
 * @returns {string} 'shadow' | 'advisory' | 'guarded' | 'strict'.
 */
export function modeForLevel(level, config) {
  const enforcement = (config && config.enforcement) || DEFAULT_DOMAIN_ENGINEERING_CONFIG.enforcement;
  if (level >= 7) return enforcement.level7;
  if (level === 6) return enforcement.level6;
  if (level === 5) return enforcement.level5;
  if (level === 4) return enforcement.level4;
  return 'shadow';
}

/** Returns true for a non-null, non-array object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep-clones a JSON-safe config object. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
