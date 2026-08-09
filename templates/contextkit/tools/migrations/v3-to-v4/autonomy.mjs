/** Legacy autonomy configuration parser for the explicit v3-to-v4 migrator. */

/**
 * Convert useful legacy secret-path configuration and diagnose discarded grade
 * authority. Normal runtime modules must never import this file.
 * @param {object} legacyConfig parsed v3 config
 * @returns {{warnings:string[],patch:object}}
 */
export function planLegacyAutonomyMigration(legacyConfig = {}) {
  const legacy = legacyConfig?.autonomy;
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    return { warnings: [], patch: {} };
  }
  const warnings = [];
  if (Object.hasOwn(legacy, 'grade') || Object.hasOwn(legacy, 'level')) {
    warnings.push('Legacy autonomy grade is discarded; it does not authorize ContextDevKit 4 work.');
  }
  const extraSecretPaths = Array.isArray(legacy.extraSecretPaths)
    ? legacy.extraSecretPaths.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
  const patch = extraSecretPaths.length > 0
    ? { riskAcknowledgement: { extraSecretPaths: [...new Set(extraSecretPaths)].sort() } }
    : {};
  return { warnings, patch };
}
