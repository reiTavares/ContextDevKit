/**
 * Add-on resolver for the universal wave workflow engine (ADR-0101 §5, WF0035).
 * Loads `registry/addon-registry.json` relative to this module dir (works in
 * source and installed trees) and answers what extra files/validations/gates an
 * add-on (or a set of add-ons) requires.
 *
 * Pure logic — `node:*` only, zero runtime dependency (ADR-0001). Validators
 * THROW on an unknown add-on id (fail-fast, default-refuse). Aggregated output is
 * de-duplicated and sorted so repeated calls are byte-identical.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonSafe } from './io.mjs';

const REGISTRY_PATH = join(dirname(fileURLToPath(import.meta.url)), 'registry', 'addon-registry.json');

/**
 * Load the versioned add-on registry from disk.
 * @returns {{ schemaVersion: number, addons: Record<string, object> }}
 * @throws {Error} when the registry is missing or has no supported schemaVersion.
 */
export function loadAddonRegistry() {
  const registry = readJsonSafe(REGISTRY_PATH, null);
  if (!registry || typeof registry !== 'object') {
    throw new Error(`addon-registry.json not found or unreadable at ${REGISTRY_PATH}`);
  }
  if (registry.schemaVersion !== 1) {
    throw new Error(`addon-registry.json: unsupported schemaVersion ${registry.schemaVersion}`);
  }
  return registry;
}

/**
 * Resolve a single add-on definition by id.
 * @param {string} addonId add-on id (e.g. "security")
 * @returns {object} the add-on definition (cloned to stay immutable)
 * @throws {Error} when the add-on id is unknown.
 */
export function resolveAddon(addonId) {
  const { addons } = loadAddonRegistry();
  const addon = addons[addonId];
  if (!addon) {
    const known = Object.keys(addons).sort().join(', ');
    throw new Error(`Unknown workflow add-on "${addonId}". Known add-ons: ${known}.`);
  }
  return structuredClone(addon);
}

/**
 * List every known add-on id, sorted for deterministic output.
 * @returns {string[]}
 */
export function listAddons() {
  return Object.keys(loadAddonRegistry().addons).sort();
}

/**
 * Aggregate the requirements of a set of add-ons into a single, de-duplicated,
 * sorted bundle. Detects declared incompatibilities and throws on a conflict.
 * @param {string[]} addonIds add-on ids to combine
 * @returns {{ additionalFiles: string[], additionalValidations: string[],
 *   additionalGates: string[], recommendedPatterns: string[] }}
 * @throws {Error} when an add-on id is unknown or two requested add-ons conflict.
 */
export function addonRequirements(addonIds) {
  const ids = Array.isArray(addonIds) ? addonIds : [];
  const resolved = ids.map((id) => resolveAddon(id));
  for (const addon of resolved) {
    for (const conflict of addon.incompatibilities ?? []) {
      if (ids.includes(conflict)) {
        throw new Error(`Add-on "${addon.id ?? ''}" is incompatible with "${conflict}".`);
      }
    }
  }
  const collect = (key) => {
    const out = new Set();
    for (const addon of resolved) for (const value of addon[key] ?? []) out.add(value);
    return [...out].sort();
  };
  return {
    additionalFiles: collect('additionalFiles'),
    additionalValidations: collect('additionalValidations'),
    additionalGates: collect('additionalGates'),
    recommendedPatterns: collect('recommendedPatterns'),
  };
}
