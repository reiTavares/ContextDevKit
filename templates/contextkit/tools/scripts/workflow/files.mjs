/**
 * Public catalog facade for Workflow v2 artifacts (ADR-0158 / WF-0111 W05).
 *
 * Profiles no longer redefine storage authority. They may influence execution
 * guidance elsewhere, but every workflow package has the same canonical files.
 */
import {
  loadWorkflowCatalog,
  requiredWorkflowArtifacts,
  workflowArtifact,
} from './catalog.mjs';

/** @returns {{schemaVersion:number,artifacts:Record<string,object>}} */
export function loadFileCatalog() {
  return loadWorkflowCatalog();
}

/**
 * Explain why a Workflow v2 artifact exists and which document is authoritative.
 * @param {string} artifactId canonical artifact id
 * @returns {object}
 */
export function explainFile(artifactId) {
  return workflowArtifact(artifactId);
}

/**
 * Return the canonical required artifact ids. The accepted selection argument
 * keeps the CLI call shape stable while making storage independent of profiles.
 * @param {{profile?:string,addons?:string[]}} [selection]
 * @returns {string[]}
 */
export function requiredFiles(selection = {}) {
  void selection;
  return requiredWorkflowArtifacts().map((artifact) => artifact.id).sort();
}

/**
 * Ceremony shapes do not alter authority in v2; they share one complete pack.
 * @param {string} shape caller-provided shape label
 * @returns {string[]}
 */
export function requiredFilesForShape(shape) {
  if (typeof shape !== 'string' || shape.length === 0) {
    throw new Error('requiredFilesForShape: a non-empty shape is required.');
  }
  return requiredFiles();
}
