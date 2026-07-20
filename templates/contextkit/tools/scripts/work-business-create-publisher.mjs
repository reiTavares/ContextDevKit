/**
 * Transaction boundary for the public `work business` verb.
 *
 * The publisher validates the staged aggregate and performs exactly one
 * same-volume rename. It owns filesystem mutation and never resolves user
 * input or ceremony vocabulary.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validateBusiness } from '../../runtime/work/schema-business.mjs';
import { writeFileEnsured } from './work-io.mjs';
import { validatePlan } from './workflow/validate.mjs';
import { readCanonicalContinuationTemplate } from './workflow/ceremony-manifest.mjs';
import { assertStructure } from '../../methodology/validate-structure.mjs';
import { leakScrub } from '../../methodology/leak-scrub.mjs';

/**
 * Assert that a candidate path is a strict descendant of a trusted parent.
 *
 * @param {string} parentPath trusted parent directory
 * @param {string} candidatePath candidate child path
 * @returns {string} native relative path
 * @throws {Error} when the candidate escapes or equals the parent
 */
function assertDescendant(parentPath, candidatePath) {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const childRelativePath = relative(parent, candidate);
  if (
    childRelativePath.length === 0
    || isAbsolute(childRelativePath)
    || childRelativePath === '..'
    || childRelativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`business: path escapes its owner directory: "${candidate}"`);
  }
  return childRelativePath;
}

/**
 * Validate the sections required by the canonical continuation template.
 *
 * @param {string} ceremonyDirectory rendered ceremony directory
 * @returns {void}
 * @throws {Error} when the continuation is missing a canonical heading
 */
function assertContinuationSections(ceremonyDirectory) {
  const continuationPath = join(ceremonyDirectory, 'CONTINUATION-PROMPT.md');
  if (!existsSync(continuationPath)) throw new Error('continuation-sections validation failed: CONTINUATION-PROMPT.md is missing');
  const requiredHeadings = [...readCanonicalContinuationTemplate().matchAll(/^#{1,6}\s+.+$/gm)]
    .map((match) => match[0].trim());
  const content = readFileSync(continuationPath, 'utf-8');
  const missing = requiredHeadings.filter((heading) => !content.includes(heading));
  if (missing.length) {
    throw new Error(`continuation-sections validation failed: missing ${missing.join(', ')}`);
  }
}

/**
 * Execute every validator declared by the ceremony manifest.
 *
 * @param {string} ceremonyDirectory rendered ceremony directory
 * @param {{shape:string,validators?:string[]}} ceremony resolved ceremony metadata
 * @param {string} businessId current generated Business id allowed in rendered content
 * @returns {void}
 * @throws {Error} when a validator is unknown or a declared check fails
 */
function assertDeclaredValidators(ceremonyDirectory, ceremony, businessId) {
  const validators = Array.isArray(ceremony.validators) ? ceremony.validators : [];
  if (validators.length === 0) throw new Error(`business: ceremony manifest declares no validators for "${ceremony.shape}"`);
  for (const validator of validators) {
    switch (validator) {
      case 'structure':
        assertStructure(ceremonyDirectory, ceremony.shape);
        break;
      case 'continuation-sections':
        assertContinuationSections(ceremonyDirectory);
        break;
      case 'leak-scrub': {
        const verdict = leakScrub(ceremonyDirectory);
        const unexpected = verdict.violations.filter((violation) => (
          violation.kind === 'unresolved-token'
          || (violation.kind === 'dogfood-identifier' && violation.matches.some((match) => match !== businessId))
        ));
        if (unexpected.length) throw new Error(`leak-scrub validation failed: ${JSON.stringify(unexpected)}`);
        break;
      }
      default:
        throw new Error(`business: unknown ceremony validator "${validator}"`);
    }
  }
}

/**
 * Validate the staged aggregate before it becomes visible as a Business.
 *
 * @param {{business:object,ceremonyRelativePath:string,ceremony:object}} plan package plan
 * @param {string} stagingDirectory sibling staging directory
 * @returns {void}
 * @throws {Error} when the staged Business or ceremony is invalid
 */
function validateStagedPackage(plan, stagingDirectory) {
  const businessPath = join(stagingDirectory, 'business.json');
  const business = JSON.parse(readFileSync(businessPath, 'utf-8').replace(/^\uFEFF/, ''));
  const businessVerdict = validateBusiness(business);
  if (!businessVerdict.ok) throw new Error(`business: staged business.json is invalid - ${businessVerdict.errors.join('; ')}`);

  const stagedCeremonyDirectory = join(stagingDirectory, plan.ceremonyRelativePath);
  assertDescendant(stagingDirectory, stagedCeremonyDirectory);
  assertDeclaredValidators(stagedCeremonyDirectory, plan.ceremony, plan.business.id);
  const renderedLeakVerdict = leakScrub(stagingDirectory);
  const unresolvedRenderedTokens = renderedLeakVerdict.violations
    .filter((violation) => violation.kind === 'unresolved-token');
  if (unresolvedRenderedTokens.length) {
    throw new Error(`business: staged package contains unresolved template tokens - ${JSON.stringify(unresolvedRenderedTokens)}`);
  }

  if (plan.ceremony.shape === 'multi-workflow-program') {
    const planPath = join(stagedCeremonyDirectory, 'workflow-plan.json');
    const workflowPlan = JSON.parse(readFileSync(planPath, 'utf-8').replace(/^\uFEFF/, ''));
    const planVerdict = validatePlan(workflowPlan);
    if (!planVerdict.valid) {
      throw new Error(`business: staged workflow-plan.json is invalid - ${planVerdict.errors.map((entry) => entry.message).join('; ')}`);
    }
  }
}

/**
 * Publish a package plan through sibling staging and one atomic rename.
 *
 * @param {{businessRoot:string,targetDir:string,inputs:object,files:Array<{path:string,content:string}>} & object} plan package plan
 * @param {{writeFile?:Function}} [options] injectable writer for failure testing
 * @returns {{committedWrites:string[],stagingMode:string}}
 * @throws {Error} when staging, validation, collision, or rename fails
 */
export function applyBusinessPackage(plan, options = {}) {
  const writeFile = options.writeFile ?? writeFileEnsured;
  if (typeof writeFile !== 'function') throw new TypeError('business: writeFile must be a function');
  const { businessRoot, targetDir } = plan;
  assertDescendant(businessRoot, targetDir);
  if (existsSync(targetDir)) throw new Error(`business: target already exists at "${targetDir}"`);

  const businessRootExisted = existsSync(businessRoot);
  mkdirSync(businessRoot, { recursive: true });
  let stagingDirectory = null;
  try {
    stagingDirectory = mkdtempSync(join(businessRoot, `.${plan.inputs.id}-staging-`));
    assertDescendant(businessRoot, stagingDirectory);
    for (const file of plan.files) {
      const relativePath = assertDescendant(targetDir, file.path);
      writeFile(join(stagingDirectory, relativePath), file.content);
    }
    validateStagedPackage(plan, stagingDirectory);
    if (existsSync(targetDir)) throw new Error(`business: target appeared during apply at "${targetDir}"`);
    renameSync(stagingDirectory, targetDir);
    stagingDirectory = null;
    return { committedWrites: plan.files.map((file) => file.path), stagingMode: 'sibling-staging-rename' };
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
