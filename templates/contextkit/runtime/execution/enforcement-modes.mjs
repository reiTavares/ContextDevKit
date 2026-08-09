/**
 * Canonical ContextDevKit 4 governance modes.
 *
 * This module is intentionally pure. Runtime policy never reads legacy
 * receipts, bypass stores, or v3 config aliases. Upgrade-time alias handling
 * belongs to the explicit migration path.
 */

export const ENFORCEMENT_MODES = Object.freeze(['off', 'shadow', 'canary', 'guarded']);

const VALID_MODES = new Set(ENFORCEMENT_MODES);

/**
 * Normalizes a canonical governance mode without throwing.
 * Missing, deprecated, or invalid input becomes fail-open canary.
 *
 * @param {unknown} value configured mode
 * @returns {{mode:'off'|'shadow'|'canary'|'guarded',source:'canonical'|'fallback',warning:string|null}}
 */
export function normalizeEnforcementMode(value) {
  if (typeof value === 'string' && VALID_MODES.has(value)) {
    return { mode: value, source: 'canonical', warning: null };
  }
  return {
    mode: 'canary',
    source: 'fallback',
    warning: 'mode missing, deprecated, or invalid; using canary',
  };
}

/**
 * Resolves only the canonical v4 governance key.
 * Property access failures also degrade to canary.
 *
 * @param {object|null|undefined} config project config
 * @param {{onWarning?:(message:string)=>void}} [options] optional warning sink
 * @returns {'off'|'shadow'|'canary'|'guarded'} canonical mode
 */
export function resolveEnforcementMode(config, options = {}) {
  try {
    const normalized = normalizeEnforcementMode(config?.governance?.defaultMode);
    if (normalized.warning && typeof options.onWarning === 'function') {
      options.onWarning(normalized.warning);
    }
    return normalized.mode;
  } catch (error) {
    if (typeof options.onWarning === 'function') {
      options.onWarning(`mode resolver failed; using canary: ${error?.message ?? error}`);
    }
    return 'canary';
  }
}
