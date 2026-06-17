/**
 * File-catalog resolver for the universal wave workflow engine (ADR-0100 §3/§5,
 * WF0035). Loads `registry/file-catalog.json` relative to this module dir (works
 * in source and installed trees) and answers "why does this file exist / is it
 * required / what must it not duplicate?" deterministically.
 *
 * Pure logic — `node:*` only, zero runtime dependency (ADR-0001). Required-file
 * membership is computed from the catalog's declarative `profiles[]` / `addons[]`
 * lists (the human-readable `required` string is documentation, not parsed), so
 * the result is deterministic and never depends on expression evaluation.
 * Validators THROW on unknown artifact ids (fail-fast, default-refuse).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonSafe } from './io.mjs';

const REGISTRY_PATH = join(dirname(fileURLToPath(import.meta.url)), 'registry', 'file-catalog.json');

/**
 * Load the versioned file catalog from disk.
 * @returns {{ schemaVersion: number, artifacts: Record<string, object> }}
 * @throws {Error} when the catalog is missing or has no supported schemaVersion.
 */
export function loadFileCatalog() {
  const catalog = readJsonSafe(REGISTRY_PATH, null);
  if (!catalog || typeof catalog !== 'object') {
    throw new Error(`file-catalog.json not found or unreadable at ${REGISTRY_PATH}`);
  }
  if (catalog.schemaVersion !== 1) {
    throw new Error(`file-catalog.json: unsupported schemaVersion ${catalog.schemaVersion}`);
  }
  return catalog;
}

/**
 * Resolve a single artifact definition by id.
 * @param {string} artifactId artifact id (e.g. "risk-register")
 * @returns {object} the artifact definition (cloned to stay immutable)
 * @throws {Error} when the artifact id is unknown.
 */
function resolveArtifact(artifactId) {
  const { artifacts } = loadFileCatalog();
  const artifact = artifacts[artifactId];
  if (!artifact) {
    const known = Object.keys(artifacts).sort().join(', ');
    throw new Error(`Unknown workflow artifact "${artifactId}". Known artifacts: ${known}.`);
  }
  return structuredClone(artifact);
}

/**
 * Explain a workflow artifact: why it exists, whether/when to read it, and what
 * it must not duplicate. The deterministic answer to "what is this file for?".
 * @param {string} artifactId artifact id
 * @returns {{ id: string, filename: string, purpose: string, authorship: string,
 *   sourceOfTruth: string, required: (boolean|string), whenToRead: string,
 *   mustNotDuplicate: string[] }}
 * @throws {Error} when the artifact id is unknown.
 */
export function explainFile(artifactId) {
  const artifact = resolveArtifact(artifactId);
  return {
    id: artifact.id,
    filename: artifact.filename,
    purpose: artifact.purpose,
    authorship: artifact.authorship,
    sourceOfTruth: artifact.sourceOfTruth,
    required: artifact.required,
    whenToRead: artifact.whenToRead,
    mustNotDuplicate: [...(artifact.mustNotDuplicate ?? [])].sort(),
  };
}

/**
 * Compute the required artifact ids for a profile, optionally widened by the
 * files that the requested add-ons make required. An artifact is required for a
 * profile when (a) it lists that profile AND its `required` is not the literal
 * `false`, or (b) it lists one of the requested add-ons.
 * @param {{ profile: string, addons?: string[] }} selection
 * @returns {string[]} sorted, de-duplicated artifact ids
 * @throws {Error} when the profile is missing from the selection.
 */
export function requiredFiles(selection) {
  if (!selection || typeof selection.profile !== 'string' || selection.profile.length === 0) {
    throw new Error('requiredFiles: a non-empty "profile" is required.');
  }
  const { profile } = selection;
  const addons = Array.isArray(selection.addons) ? selection.addons : [];
  const { artifacts } = loadFileCatalog();
  const required = new Set();
  for (const artifact of Object.values(artifacts)) {
    const byProfile = (artifact.profiles ?? []).includes(profile) && artifact.required !== false;
    const byAddon = (artifact.addons ?? []).some((addon) => addons.includes(addon));
    if (byProfile || byAddon) required.add(artifact.id);
  }
  return [...required].sort();
}
