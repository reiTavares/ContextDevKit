/**
 * Validate the required directory shape after a ceremony skeleton is rendered.
 *
 * This check is intentionally stronger than JSON validation: it verifies the
 * filesystem contract and refuses a proportionality violation such as a
 * quick-fix carrying a workflow pack.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { explainFile, requiredFilesForShape } from '../tools/scripts/workflow/files.mjs';
import { resolveCeremonyManifest } from '../tools/scripts/workflow/ceremony-manifest.mjs';

const FORBIDDEN_BY_SHAPE = Object.freeze({
  'quick-fix': ['reports', 'workflow-plan', 'workflow-state', 'continuation'],
  'batch-operation': ['workflow-plan', 'workflow-state', 'continuation'],
  'decision-only': ['workflow-plan', 'workflow-state', 'continuation', 'reports'],
});

/**
 * Validate the required and forbidden paths for one rendered shape.
 *
 * @param {string} contextDir rendered context root
 * @param {string} shape canonical shape id
 * @returns {{ok:boolean,shape:string,expected:string[],errors:string[]}}
 */
export function validateStructure(contextDir, shape) {
  const errors = [];
  let row;
  let artifactIds;
  try {
    row = resolveCeremonyManifest(shape);
    artifactIds = requiredFilesForShape(shape);
  } catch (error) {
    return { ok: false, shape, expected: [], errors: [error?.message || String(error)] };
  }
  if (typeof contextDir !== 'string' || contextDir.trim() === '') {
    return { ok: false, shape, expected: [], errors: ['contextDir must be a non-empty string'] };
  }

  const expected = artifactIds.map((artifactId) => explainFile(artifactId).filename).sort();
  if (!existsSync(contextDir) || !statSync(contextDir).isDirectory()) {
    errors.push('context directory is missing: ' + contextDir);
  } else {
    for (const relativePath of expected) {
      const fullPath = join(contextDir, relativePath);
      if (!existsSync(fullPath)) errors.push('required path is missing: ' + relativePath);
    }
    for (const artifactId of FORBIDDEN_BY_SHAPE[shape] || []) {
      const relativePath = explainFile(artifactId).filename;
      if (existsSync(join(contextDir, relativePath))) {
        errors.push('path is forbidden for ' + shape + ': ' + relativePath);
      }
    }
    if (row.workflowBearing && !expected.includes('CONTINUATION-PROMPT.md')) {
      errors.push('workflow-bearing shape must require CONTINUATION-PROMPT.md');
    }
  }
  return { ok: errors.length === 0, shape, expected, errors };
}

/**
 * Throwing boundary wrapper for structure validation.
 *
 * @param {string} contextDir rendered context root
 * @param {string} shape canonical shape id
 * @returns {{ok:true,shape:string,expected:string[],errors:[]}}
 * @throws {Error} when the rendered tree diverges from the manifest
 */
export function assertStructure(contextDir, shape) {
  const verdict = validateStructure(contextDir, shape);
  if (!verdict.ok) throw new Error('structure validation failed: ' + verdict.errors.join('; '));
  return verdict;
}
