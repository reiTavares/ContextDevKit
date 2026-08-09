/**
 * Optional YAML loader for agent-forge (ADR-0013). The ONLY place the `yaml` dependency
 * is imported — every forge consumer goes through `parseYaml` / `stringifyYaml`. Mirrors
 * the sanctioned `zod` optional-dynamic-import pattern (ADR-0001).
 *
 * ⛔ The L1–3 hot path (runtime/hooks/**, runtime/config/load.mjs) must NEVER import this
 *    module — agent-forge is opt-in L4+ tooling. A selfcheck guard enforces that.
 */

let cachedYaml;

/**
 * Load the optional `yaml` lib, caching the module. Throws an actionable error (never a
 * raw stack trace) when the dependency is not installed.
 * @returns {Promise<object>} the `yaml` module
 * @throws {Error} when `yaml` is not installed
 */
export async function loadYaml() {
  if (cachedYaml) return cachedYaml;
  try {
    const mod = await import('yaml');
    cachedYaml = mod.default ?? mod;
    return cachedYaml;
  } catch {
    throw new Error('agent-forge needs the `yaml` package to read/write Agent Package files — run `npm i yaml`.');
  }
}

/**
 * Parse a YAML string into a JS value (BOM-safe, per immutable rule 4).
 * @param {string} text raw YAML
 * @returns {Promise<unknown>}
 */
export async function parseYaml(text) {
  const yaml = await loadYaml();
  return yaml.parse(String(text).replace(/^﻿/, ''));
}

/**
 * Serialize a JS value to a YAML string.
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function stringifyYaml(value) {
  const yaml = await loadYaml();
  return yaml.stringify(value);
}
