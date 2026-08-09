/**
 * PRD/SPEC document completeness checks for workflow spec packs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

function workflowDir(root, slug) {
  return resolve(pathsFor(root).memory, 'workflows', slug);
}

/**
 * Throws when the PRD or SPEC document for a workflow phase is missing or still
 * carries empty required sections.
 *
 * @param {string} root project root
 * @param {string} slug workflow slug
 * @param {string} phase workflow phase
 * @returns {void}
 * @throws {Error} when the required document is missing or incomplete
 */
export function checkWorkflowDocument(root, slug, phase) {
  if (phase !== 'prd' && phase !== 'spec') return;
  const dir = workflowDir(root, slug);
  if (phase === 'prd') {
    const prdPath = resolve(dir, 'prd.md');
    if (!existsSync(prdPath)) throw new Error(`PRD file not found at ${prdPath}`);
    const content = readFileSync(prdPath, 'utf-8');
    if (/## Problem\s*(?=\n##|\n#|\s*$)/i.test(content) || /## Goals\s*(?=\n##|\n#|\s*$)/i.test(content)) {
      throw new Error(`PRD document is incomplete. Please fill the "## Problem" and "## Goals" sections first.`);
    }
    return;
  }
  const specPath = resolve(dir, 'spec.md');
  if (!existsSync(specPath)) throw new Error(`SPEC file not found at ${specPath}`);
  const content = readFileSync(specPath, 'utf-8');
  if (/## Proposed design\s*(?=\n##|\n#|\s*$)/i.test(content) || /## Test plan\s*(?=\n##|\n#|\s*$)/i.test(content)) {
    throw new Error(`SPEC document is incomplete. Please fill the "## Proposed design" and "## Test plan" sections first.`);
  }
}
