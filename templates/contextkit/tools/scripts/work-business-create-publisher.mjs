/** Atomic transaction boundary for a Business and its optional Workflow v2. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validateBusiness } from '../../runtime/work/schema-business.mjs';
import { writeFileEnsured } from './work-io.mjs';
import { materializeWorkflowPack } from './workflow/create.mjs';
import { validatePack } from './workflow/validate.mjs';

/**
 * Assert that a candidate path is a strict descendant of a trusted parent.
 * @param {string} parentPath trusted parent
 * @param {string} candidatePath candidate child
 * @returns {string} relative descendant path
 * @throws {Error} when the candidate escapes or equals the parent
 */
function assertDescendant(parentPath, candidatePath) {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const descendant = relative(parent, candidate);
  if (
    descendant.length === 0
    || isAbsolute(descendant)
    || descendant === '..'
    || descendant.startsWith(`..${sep}`)
  ) {
    throw new Error(`business: path escapes its owner directory: "${candidate}"`);
  }
  return descendant;
}

/**
 * Validate the complete staged aggregate before publication.
 * @param {object} plan Business publication plan
 * @param {string} stagingDirectory same-volume staging directory
 * @returns {void}
 * @throws {Error} on an invalid Business or Workflow package
 */
function validateStagedPackage(plan, stagingDirectory) {
  const business = JSON.parse(readFileSync(join(stagingDirectory, 'business.json'), 'utf8').replace(/^\uFEFF/, ''));
  const businessVerdict = validateBusiness(business);
  if (!businessVerdict.ok) {
    throw new Error(`business: staged business.json is invalid - ${businessVerdict.errors.join('; ')}`);
  }
  if (!plan.workflowSpec) return;
  const workflowDirectory = join(stagingDirectory, plan.ceremonyRelativePath);
  assertDescendant(stagingDirectory, workflowDirectory);
  const workflowVerdict = validatePack(workflowDirectory);
  if (!workflowVerdict.valid) {
    throw new Error(`business: staged Workflow v2 is invalid - ${workflowVerdict.errors.map((error) => error.message).join('; ')}`);
  }
}

/**
 * Publish a complete Business aggregate through one sibling staging rename.
 * @param {object} plan validated pure package plan
 * @param {{writeFile?:Function,materializeWorkflow?:Function}} [options]
 * @returns {{committedWrites:string[],stagingMode:string}}
 * @throws {Error} on staging, validation, collision, or rename failure
 */
export function applyBusinessPackage(plan, options = {}) {
  const writeFile = options.writeFile ?? writeFileEnsured;
  const createWorkflow = options.materializeWorkflow ?? materializeWorkflowPack;
  if (typeof writeFile !== 'function') throw new TypeError('business: writeFile must be a function');
  if (typeof createWorkflow !== 'function') throw new TypeError('business: materializeWorkflow must be a function');
  const { businessRoot, targetDir } = plan;
  assertDescendant(businessRoot, targetDir);
  if (existsSync(targetDir)) throw new Error(`business: target already exists at "${targetDir}"`);

  const businessRootExisted = existsSync(businessRoot);
  mkdirSync(businessRoot, { recursive: true });
  let stagingDirectory = null;
  try {
    stagingDirectory = mkdtempSync(join(businessRoot, `.${plan.inputs.id}-staging-`));
    assertDescendant(businessRoot, stagingDirectory);
    for (const directory of plan.directories ?? []) {
      const directoryPath = join(stagingDirectory, directory);
      assertDescendant(stagingDirectory, directoryPath);
      mkdirSync(directoryPath, { recursive: true });
    }
    for (const file of plan.files) {
      const relativePath = assertDescendant(targetDir, file.path);
      writeFile(join(stagingDirectory, relativePath), file.content);
    }
    if (plan.workflowSpec) {
      const workflowDirectory = join(stagingDirectory, plan.ceremonyRelativePath);
      assertDescendant(stagingDirectory, workflowDirectory);
      createWorkflow(workflowDirectory, plan.workflowSpec);
    }
    validateStagedPackage(plan, stagingDirectory);
    if (existsSync(targetDir)) throw new Error(`business: target appeared during apply at "${targetDir}"`);
    renameSync(stagingDirectory, targetDir);
    stagingDirectory = null;
    const workflowWrites = plan.workflowSpec
      ? ['workflow.json', 'workflow-state.json', 'context-manifest.json', 'pipeline/tasks.json', 'pipeline/tasks.md', 'index.md', 'prd.md', 'spec.md', 'decisions.md']
        .map((path) => join(plan.ceremonyDir, path))
      : [];
    return {
      committedWrites: [...plan.files.map((file) => file.path), ...workflowWrites],
      stagingMode: 'sibling-staging-rename',
    };
  } catch (error) {
    if (stagingDirectory && existsSync(stagingDirectory)) {
      assertDescendant(businessRoot, stagingDirectory);
      rmSync(stagingDirectory, { recursive: true, force: true });
    }
    if (!businessRootExisted && existsSync(businessRoot) && readdirSync(businessRoot).length === 0) {
      rmdirSync(businessRoot);
    }
    throw error;
  }
}
