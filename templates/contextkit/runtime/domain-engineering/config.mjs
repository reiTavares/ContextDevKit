/**
 * Resolves the optional Domain Engineering recommendation settings.
 *
 * Domain classification is observational in ContextDevKit 4.0. It never gains
 * write or completion authority from the activation level.
 *
 * @module domain-engineering/config
 */

export const DEFAULT_DOMAIN_ENGINEERING_CONFIG = Object.freeze({
  enabled: false,
  classifyEveryRequest: false,
  codeIntent: { askMin: 30, codeMin: 50, structuralMin: 70 },
  domainApplicability: { modularMin: 25, domainDrivenMin: 45, distributedMin: 70 },
  mode: 'advisory',
  recommendations: { maxParallelAgents: 5 },
  artifacts: { proportional: true, neverGenerateDomainModelForSimple: true },
});

/**
 * Merges a partial user configuration over the advisory defaults.
 *
 * @param {object} [userConfig] Optional `domainEngineering` configuration.
 * @returns {object} A fresh, mutable configuration object.
 */
export function resolveConfig(userConfig) {
  const base = clone(DEFAULT_DOMAIN_ENGINEERING_CONFIG);
  if (!isPlainObject(userConfig)) return base;
  for (const key of Object.keys(base)) {
    if (!(key in userConfig)) continue;
    const userValue = userConfig[key];
    base[key] = isPlainObject(base[key]) && isPlainObject(userValue)
      ? { ...base[key], ...userValue }
      : userValue;
  }
  base.mode = base.enabled === true ? 'advisory' : 'shadow';
  return base;
}

/**
 * Returns the only two legal observation modes for this capability.
 *
 * @param {object} [config] Resolved Domain Engineering configuration.
 * @returns {'shadow'|'advisory'} Observation mode with no enforcement power.
 */
export function resolveObservationMode(config) {
  return config?.enabled === true ? 'advisory' : 'shadow';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
