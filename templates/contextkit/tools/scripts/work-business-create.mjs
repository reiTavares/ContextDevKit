/**
 * Business context creation adapter for the public `work business` command.
 *
 * The module keeps the dispatcher small and separates four responsibilities:
 * input validation, ceremony resolution, pure package planning, and atomic
 * publication. The package is always rendered from the neutral methodology
 * templates; an existing Business context is never used as a source.
 *
 * Mutators are dry-run by default. `applyBusinessPackage` writes the complete
 * aggregate into a sibling staging directory, validates it there, and publishes
 * it with one same-volume rename.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { validateBusiness } from '../../runtime/work/schema-business.mjs';
import { buildBusinessJson, buildBusinessPrompt } from './business-templates.mjs';
import { makeReceipt } from './work-io.mjs';
import { explainFile, requiredFilesForShape } from './workflow/files.mjs';
import { resolveCeremonyManifest } from './workflow/ceremony-manifest.mjs';
import { leakScrub } from '../../methodology/leak-scrub.mjs';
import {
  assertBusinessIdAvailable,
  resolveBusinessCreateInputs,
  resolveBusinessCeremony,
} from './work-business-create-contract.mjs';
import { applyBusinessPackage } from './work-business-create-publisher.mjs';

export {
  assertBusinessIdAvailable,
  resolveBusinessCreateInputs,
  resolveBusinessCeremony,
} from './work-business-create-contract.mjs';
export { applyBusinessPackage } from './work-business-create-publisher.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const METHODOLOGY_ROOT = resolve(MODULE_DIR, '../../methodology');
const TEMPLATE_ROOT = join(METHODOLOGY_ROOT, 'templates');

/**
 * Assert that a candidate path is a descendant of a known parent directory.
 *
 * @param {string} parentPath trusted parent directory
 * @param {string} candidatePath path to validate
 * @returns {string} native relative path from parent to candidate
 * @throws {Error} when the candidate escapes the parent or equals it
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
 * Walk a neutral methodology skeleton in deterministic relative-path order.
 * Symlinks are refused so a template cannot escape the shipped source tree.
 *
 * @param {string} directory skeleton directory
 * @returns {string[]} absolute regular-file paths
 * @throws {Error} when a symlink is encountered
 */
function listTemplateFiles(directory) {
  const filePaths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`business: template symlink refused: "${entryPath}"`);
    if (entry.isDirectory()) filePaths.push(...listTemplateFiles(entryPath));
    else if (entry.isFile()) filePaths.push(entryPath);
    else throw new Error(`business: unsupported template entry: "${entryPath}"`);
  }
  return filePaths;
}

/**
 * Render one template file by replacing every canonical token exactly once.
 *
 * @param {string} rawContent source template content
 * @param {Record<string,string>} tokens canonical token values
 * @param {string} sourcePath source path for error context
 * @returns {string} rendered content without unresolved placeholders
 * @throws {Error} when a template contains an unknown or unresolved token
 */
function renderTemplate(rawContent, tokens, sourcePath) {
  const renderedContent = rawContent.replace(/\{\{([A-Z0-9_]+)\}\}/g, (fullToken, tokenName) => {
    if (!Object.hasOwn(tokens, tokenName)) {
      throw new Error(`business: no value supplied for template token ${fullToken} in "${sourcePath}"`);
    }
    return tokens[tokenName];
  });
  if (/\{\{[^}]+\}\}/.test(renderedContent)) {
    throw new Error(`business: unresolved template token remains in "${sourcePath}"`);
  }
  return renderedContent;
}

/**
 * Build the neutral token set for a rendered ceremony pack.
 *
 * @param {{id:string,title:string,slug:string,ceremony:string,workflowId:string|null}} inputs resolved Business inputs
 * @param {{shape:string,journeyBranch:string}} ceremony resolved ceremony
 * @returns {Record<string,string>} token values
 */
function ceremonyTokens(inputs, ceremony) {
  const workflowId = inputs.workflowId ?? 'NOT_APPLICABLE';
  return {
    DECISION_TITLE: inputs.title,
    OWNER: inputs.id,
    DECISION_STATUS: 'proposed',
    DECISION: 'TO_BE_CONFIRMED',
    RATIONALE: 'TO_BE_CONFIRMED_BY_OWNER',
    REVISIT_CONDITION: 'REVISIT_WHEN_OWNER_PROVIDES_EVIDENCE',
    WORKFLOW_ID: workflowId,
    WORKFLOW_SLUG: inputs.slug,
    CURRENT_PHASE: 'intake',
    PRECONDITIONS: `${inputs.id}/business.json exists and passes the Business schema validator.`,
    BINDING_ACCEPTANCE_CRITERIA: '- The owner confirms the intended business outcome.\n- The workflow keeps the persisted Business.kind unchanged.',
    FIRST_READ: `Read ${inputs.id}/business.json and the workflow plan before implementation.`,
    EXECUTION_RULES: `Use ${inputs.id} as the governing Business context and record evidence in this workflow.`,
    CUSTOM_RULES: 'Do not map classifier functional kinds into the persisted Business.kind enum.',
    PROBLEM: `The owner must define the problem for "${inputs.title}".`,
    GOALS: '- Define the desired business outcome.\n- Record evidence for the owner decision.',
    NON_GOALS: '- No implementation is authorized by this scaffold.',
    SUMMARY: `This workflow provides the governed scaffold for "${inputs.title}".`,
    CONTRACTS: 'The Business envelope owns identity and kind; this workflow owns execution artifacts.',
    DATA_FLOW: `${inputs.id}/business.json -> ${ceremony.shape} -> ${ceremony.journeyBranch}.`,
    TEST_PLAN: '- Validate the Business schema.\n- Validate the ceremony structure.\n- Record QA evidence before promotion.',
    TASKS: '- Author the executable task plan through the workflow engine.',
    MEMORY: 'No durable workflow memory has been established yet.',
    DECISIONS: 'No decision has been accepted yet.',
    CRITERION: 'Owner-approved ceremony acceptance',
    EVIDENCE: 'To be recorded by the workflow owner',
    STATUS: 'pending',
    RISK: 'Business assumptions are unconfirmed',
    LIKELIHOOD: 'unknown',
    IMPACT: 'unknown',
    MITIGATION: 'Record evidence before activation',
    ACTIVATION: 'NOT_AUTHORIZED_UNTIL_OWNER_REVIEW',
    ROLLBACK: 'Remove this Business package before activation if validation fails.',
  };
}

/**
 * Verify that a rendered file set contains every manifest-owned required file.
 * Directory artifacts are satisfied by at least one file below that directory.
 *
 * @param {string} shape canonical shape id
 * @param {string[]} relativePaths rendered paths relative to ceremony root
 * @returns {void}
 * @throws {Error} when the source skeleton is incomplete
 */
function assertTemplateShape(shape, relativePaths) {
  const normalizedPaths = new Set(relativePaths.map((filePath) => filePath.replaceAll('\\', '/')));
  for (const artifactId of requiredFilesForShape(shape)) {
    const filename = explainFile(artifactId).filename.replaceAll('\\', '/');
    if (filename.endsWith('/')) {
      const directoryPrefix = filename;
      if (![...normalizedPaths].some((filePath) => filePath.startsWith(directoryPrefix))) {
        throw new Error(`business: template shape "${shape}" is missing required directory "${filename}"`);
      }
    } else if (!normalizedPaths.has(filename)) {
      throw new Error(`business: template shape "${shape}" is missing required file "${filename}"`);
    }
  }
}

/**
 * Render a ceremony skeleton to planned final paths.
 *
 * @param {{shape:string}} ceremony resolved ceremony
 * @param {{id:string,title:string,slug:string,workflowId:string|null}} inputs resolved inputs
 * @param {string} ceremonyDirectory final ceremony directory
 * @param {string} [methodologyRoot] methodology source root (test seam)
 * @returns {Array<{path:string,relativePath:string,content:string}>} planned files
 * @throws {Error} when the methodology source is missing or malformed
 */
function renderCeremonyFiles(ceremony, inputs, ceremonyDirectory, methodologyRoot = METHODOLOGY_ROOT) {
  const manifestRow = resolveCeremonyManifest(ceremony.shape);
  const skeletonDirectory = join(methodologyRoot, manifestRow.skeleton);
  if (!existsSync(skeletonDirectory) || !statSync(skeletonDirectory).isDirectory()) {
    throw new Error(`business: ceremony skeleton is unavailable at "${skeletonDirectory}"`);
  }
  const tokens = ceremonyTokens(inputs, ceremony);
  const templateFiles = listTemplateFiles(skeletonDirectory);
  const sourceLeakVerdict = leakScrub(skeletonDirectory);
  const sourceDogfoodLeaks = sourceLeakVerdict.violations.filter((violation) => violation.kind === 'dogfood-identifier');
  if (sourceDogfoodLeaks.length) {
    throw new Error(`business: methodology source contains dogfood identifiers - ${JSON.stringify(sourceDogfoodLeaks)}`);
  }
  const relativePaths = templateFiles.map((sourcePath) => relative(skeletonDirectory, sourcePath));
  assertTemplateShape(ceremony.shape, relativePaths);
  return templateFiles.map((sourcePath, index) => {
    const relativePath = relativePaths[index];
    assertDescendant(skeletonDirectory, sourcePath);
    const targetPath = join(ceremonyDirectory, relativePath);
    return {
      path: targetPath,
      relativePath: relativePath.replaceAll('\\', '/'),
      content: renderTemplate(readFileSync(sourcePath, 'utf-8'), tokens, sourcePath),
    };
  });
}

/**
 * Build a complete Business package plan without mutating the filesystem.
 *
 * @param {{inputs:object,root:string,methodologyRoot?:string}} args resolved inputs, project root, and optional source root
 * @returns {{inputs:object,business:object,businessRoot:string,targetDir:string,ceremonyDir:string,ceremonyRelativePath:string,ceremony:object,files:Array<{path:string,relativePath:string,content:string}>}}
 * @throws {Error} when identity, schema, template, or containment validation fails
 */
export function planBusinessPackage({ inputs, root = process.cwd(), methodologyRoot = METHODOLOGY_ROOT }) {
  const ceremony = resolveBusinessCeremony(inputs.ceremony);
  const paths = pathsFor(root);
  const businessRoot = paths.business;
  const targetDir = resolve(businessRoot, `${inputs.id}-${inputs.slug}`);
  assertDescendant(businessRoot, targetDir);
  assertBusinessIdAvailable(root, inputs.id);
  if (existsSync(targetDir)) throw new Error(`business: target already exists at "${targetDir}"`);

  const business = buildBusinessJson({
    id: inputs.id,
    title: inputs.title,
    slug: inputs.slug,
    kind: inputs.kind,
    strategicFacet: inputs.strategicFacet,
    valueIntents: { primary: inputs.intent, secondary: [] },
  });
  const businessVerdict = validateBusiness(business);
  if (!businessVerdict.ok) {
    throw new Error(`business: built business.json is invalid - ${businessVerdict.errors.join('; ')}`);
  }

  const ceremonyRelativePath = inputs.ceremony === 'decision'
    ? join('ceremony', 'decision-only')
    : join('workflows', `${inputs.workflowId}-${inputs.slug}`);
  const ceremonyDir = join(targetDir, ceremonyRelativePath);
  assertDescendant(targetDir, ceremonyDir);

  const envelopeFiles = [
    { relativePath: 'business.json', content: `${JSON.stringify(business, null, 2)}\n` },
    { relativePath: 'business-case.md', content: buildBusinessPrompt('business-case') },
    { relativePath: 'growth.md', content: buildBusinessPrompt('growth') },
    { relativePath: 'investment-decision.md', content: buildBusinessPrompt('investment-decision') },
    { relativePath: join('architecture', '.gitkeep'), content: '' },
    { relativePath: join('reports', '.gitkeep'), content: '' },
    { relativePath: join('workflows', '.gitkeep'), content: '' },
  ];
  const ceremonyFiles = renderCeremonyFiles(ceremony, inputs, ceremonyDir, methodologyRoot);
  const files = [
    ...envelopeFiles.map((file) => ({ ...file, path: join(targetDir, file.relativePath) })),
    ...ceremonyFiles,
  ].sort((left, right) => left.path.localeCompare(right.path));

  return {
    inputs,
    business,
    businessRoot,
    targetDir,
    ceremonyDir,
    ceremonyRelativePath,
    ceremony,
    files,
  };
}

/**
 * Handle the public `work business` command and return its audit receipt.
 *
 * @param {{positionals?:string[],flags?:Record<string,unknown>,apply:boolean,root?:string}} context command context
 * @returns {ReturnType<typeof makeReceipt>} dry-run or apply receipt
 * @throws {Error} when input or package validation refuses the request
 */
export function handleBusinessCreate({ positionals = [], flags = {}, apply, root = process.cwd() }) {
  const inputs = resolveBusinessCreateInputs({ positionals, flags, root });
  const plan = planBusinessPackage({ inputs, root });
  const publication = apply
    ? applyBusinessPackage(plan)
    : { committedWrites: [], stagingMode: 'not-applied' };
  return makeReceipt({
    command: 'business',
    applied: Boolean(apply),
    writes: plan.files.map((file) => file.path),
    detail: {
      id: inputs.id,
      title: inputs.title,
      slug: inputs.slug,
      businessKind: inputs.kind,
      ceremony: inputs.ceremony,
      shape: plan.ceremony.shape,
      journeyBranch: plan.ceremony.journeyBranch,
      classifierFunctionalKind: plan.ceremony.classifierFunctionalKind,
      target: plan.targetDir,
      ceremonyPath: plan.ceremonyDir,
      plannedWrites: plan.files.map((file) => file.path),
      committedWrites: publication.committedWrites,
      atomicity: publication.stagingMode,
      validation: { business: 'pass', structure: apply ? 'pass' : 'planned' },
    },
  });
}
