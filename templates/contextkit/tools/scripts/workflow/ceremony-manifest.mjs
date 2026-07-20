/**
 * Loader for the canonical ceremony-shape manifest.
 *
 * The JSON lives under contextkit/methodology so it is one source of truth.
 * This small loader is distributed with the workflow engine and refuses a
 * missing or malformed manifest only when a caller explicitly requests a shape;
 * legacy callers that do not use shapes remain compatible until distribution
 * of the methodology templates is enabled.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonSafe } from './io.mjs';

const WORKFLOW_DIR = dirname(fileURLToPath(import.meta.url));
const METHODOLOGY_DIR = join(WORKFLOW_DIR, '../../../methodology');
const MANIFEST_PATH = join(METHODOLOGY_DIR, 'templates', 'manifest.json');
const CONTINUATION_PATH = join(METHODOLOGY_DIR, 'templates', 'shared', 'CONTINUATION-PROMPT.md');

/**
 * Load and validate the canonical shape manifest.
 *
 * @returns {{schemaVersion:number, shapes:Record<string, object>}} cloned manifest
 * @throws {Error} when the manifest is missing or structurally invalid
 */
export function loadCeremonyManifest() {
  const manifest = readJsonSafe(MANIFEST_PATH, null);
  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) {
    throw new Error('ceremony manifest is missing or has an unsupported schemaVersion');
  }
  if (!manifest.shapes || typeof manifest.shapes !== 'object' || Array.isArray(manifest.shapes)) {
    throw new Error('ceremony manifest must contain a shapes object');
  }
  for (const [shape, row] of Object.entries(manifest.shapes)) {
    if (!row || typeof row !== 'object') throw new Error('ceremony manifest row is invalid for ' + shape);
    if (row.skeleton !== 'templates/' + shape) throw new Error('ceremony manifest skeleton mismatch for ' + shape);
    if (!Array.isArray(row.requiredFiles) || row.requiredFiles.length === 0) {
      throw new Error('ceremony manifest requiredFiles is empty for ' + shape);
    }
    if (!Array.isArray(row.validators) || row.validators.length === 0) {
      throw new Error('ceremony manifest validators are empty for ' + shape);
    }
  }
  return structuredClone(manifest);
}

/**
 * Resolve one shape row from the manifest.
 *
 * @param {string} shape canonical shape id
 * @returns {object} cloned manifest row with its shape id
 * @throws {TypeError|Error} when shape is missing or unknown
 */
export function resolveCeremonyManifest(shape) {
  if (typeof shape !== 'string' || shape.trim() === '') {
    throw new TypeError('resolveCeremonyManifest: shape must be a non-empty string');
  }
  const manifest = loadCeremonyManifest();
  const row = manifest.shapes[shape];
  if (!row) throw new Error('unknown ceremony shape "' + shape + '"');
  return { shape, ...structuredClone(row) };
}

/**
 * Read the canonical continuation-prompt source template.
 *
 * @returns {string} six-section prompt template
 * @throws {Error} when the canonical template is absent
 */
export function readCanonicalContinuationTemplate() {
  try {
    return readFileSync(CONTINUATION_PATH, 'utf-8');
  } catch (error) {
    throw new Error('canonical continuation-prompt template is unavailable: ' + (error?.message || error));
  }
}
