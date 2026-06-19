/**
 * Wave-pattern resolver for the universal wave workflow engine (ADR-0101 §5,
 * WF0035). Loads `registry/wave-patterns.json` relative to this module dir (works
 * in source and installed trees) and returns wave skeletons for a pattern.
 *
 * Pure logic — `node:*` only, zero runtime dependency (ADR-0001). Validators
 * THROW on an unknown pattern id (fail-fast, default-refuse). Output is cloned so
 * callers cannot mutate the cached registry shape.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonSafe } from './io.mjs';

const REGISTRY_PATH = join(dirname(fileURLToPath(import.meta.url)), 'registry', 'wave-patterns.json');

/**
 * Load the versioned wave-pattern registry from disk.
 * @returns {{ schemaVersion: number, patterns: Record<string, object> }}
 * @throws {Error} when the registry is missing or has no supported schemaVersion.
 */
export function loadWavePatterns() {
  const registry = readJsonSafe(REGISTRY_PATH, null);
  if (!registry || typeof registry !== 'object') {
    throw new Error(`wave-patterns.json not found or unreadable at ${REGISTRY_PATH}`);
  }
  if (registry.schemaVersion !== 1) {
    throw new Error(`wave-patterns.json: unsupported schemaVersion ${registry.schemaVersion}`);
  }
  return registry;
}

/**
 * Resolve a single wave pattern by id.
 * @param {string} patternId pattern id (e.g. "incident-hotfix")
 * @returns {object} the pattern definition (cloned to stay immutable)
 * @throws {Error} when the pattern id is unknown.
 */
export function resolvePattern(patternId) {
  const { patterns } = loadWavePatterns();
  const pattern = patterns[patternId];
  if (!pattern) {
    const known = Object.keys(patterns).sort().join(', ');
    throw new Error(`Unknown wave pattern "${patternId}". Known patterns: ${known}.`);
  }
  return structuredClone(pattern);
}

/**
 * Return the ordered wave templates (the skeleton) for a pattern. An empty array
 * for `large-program` is intentional — that pattern is a configurable skeleton.
 * @param {string} patternId pattern id
 * @returns {Array<{ id: string, title: string, dependsOn: string[], gate: (string|null) }>}
 * @throws {Error} when the pattern id is unknown.
 */
export function waveSkeleton(patternId) {
  return resolvePattern(patternId).waveTemplates ?? [];
}

/**
 * List every known pattern id, sorted for deterministic output.
 * @returns {string[]}
 */
export function listPatterns() {
  return Object.keys(loadWavePatterns().patterns).sort();
}
