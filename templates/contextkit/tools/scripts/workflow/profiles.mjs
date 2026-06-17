/**
 * Profile resolver for the universal wave workflow engine (ADR-0100 §5, WF0035).
 *
 * Loads `registry/profile-registry.json` relative to this module dir (so it
 * resolves in both the source tree and an installed `contextkit/` tree) and
 * answers profile queries deterministically. Pure logic — `node:*` only, no
 * runtime dependency (ADR-0001). Validators THROW on unknown input (fail-fast,
 * default-refuse): an unknown profile is never silently treated as a default.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonSafe } from './io.mjs';
import { requiredFiles as catalogRequiredFiles } from './files.mjs';

const REGISTRY_PATH = join(dirname(fileURLToPath(import.meta.url)), 'registry', 'profile-registry.json');

/**
 * Load the versioned profile registry from disk.
 * @returns {{ schemaVersion: number, profiles: Record<string, object> }}
 * @throws {Error} when the registry is missing or has no `schemaVersion`.
 */
export function loadProfileRegistry() {
  const registry = readJsonSafe(REGISTRY_PATH, null);
  if (!registry || typeof registry !== 'object') {
    throw new Error(`profile-registry.json not found or unreadable at ${REGISTRY_PATH}`);
  }
  if (registry.schemaVersion !== 1) {
    throw new Error(`profile-registry.json: unsupported schemaVersion ${registry.schemaVersion}`);
  }
  return registry;
}

/**
 * Resolve a single profile definition by name.
 * @param {string} name profile id (e.g. "program")
 * @returns {object} the profile definition (cloned to stay immutable)
 * @throws {Error} when the profile name is unknown.
 */
export function resolveProfile(name) {
  const { profiles } = loadProfileRegistry();
  const profile = profiles[name];
  if (!profile) {
    const known = Object.keys(profiles).sort().join(', ');
    throw new Error(`Unknown workflow profile "${name}". Known profiles: ${known}.`);
  }
  return structuredClone(profile);
}

/**
 * List every known profile id, sorted for deterministic output.
 * @returns {string[]}
 */
export function listProfiles() {
  return Object.keys(loadProfileRegistry().profiles).sort();
}

/**
 * Compute the required files for a profile, merged with any files the requested
 * add-ons make required (via the file catalog). Output is de-duplicated and
 * sorted so two calls with the same inputs are byte-identical.
 * @param {string} profileName profile id
 * @param {{ addons?: string[] }} [options] add-on ids to fold in
 * @returns {string[]} sorted, de-duplicated artifact ids
 * @throws {Error} when the profile (or, downstream, an add-on/file) is unknown.
 */
export function requiredFilesFor(profileName, options = {}) {
  resolveProfile(profileName);
  const addons = Array.isArray(options.addons) ? options.addons : [];
  return catalogRequiredFiles({ profile: profileName, addons });
}
