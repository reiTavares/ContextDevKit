/**
 * Business aggregate creation for ContextDevKit 4.
 *
 * Business identity is independent from execution shape. Direct creation emits
 * only the Business envelope; an explicit `--ceremony workflow` composes one
 * complete Workflow v2 package below the new Business in the same atomic publish.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { validateBusiness } from '../../runtime/work/schema-business.mjs';
import { buildBusinessJson, buildBusinessPrompt } from './business-templates.mjs';
import { makeReceipt } from './work-io.mjs';
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

/**
 * Assert a strict path descendant before any staged publication.
 * @param {string} parentPath trusted parent
 * @param {string} candidatePath proposed descendant
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
 * Build a complete Business package plan without filesystem mutation.
 * @param {{inputs:object,root?:string}} args resolved command inputs
 * @returns {object} immutable publication plan
 */
export function planBusinessPackage({ inputs, root = process.cwd() }) {
  const ceremony = resolveBusinessCeremony(inputs.ceremony);
  const businessRoot = pathsFor(root).business;
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
  const verdict = validateBusiness(business);
  if (!verdict.ok) throw new Error(`business: built business.json is invalid - ${verdict.errors.join('; ')}`);

  const files = [
    { relativePath: 'business.json', content: `${JSON.stringify(business, null, 2)}\n` },
    { relativePath: 'business-case.md', content: buildBusinessPrompt('business-case') },
    { relativePath: 'growth.md', content: buildBusinessPrompt('growth') },
    { relativePath: 'investment-decision.md', content: buildBusinessPrompt('investment-decision') },
  ].map((file) => ({ ...file, path: join(targetDir, file.relativePath) }));

  const workflowSpec = inputs.ceremony === 'workflow'
    ? {
        id: inputs.workflowId,
        slug: inputs.slug,
        title: inputs.title,
        objective: `Deliver the governed outcome for ${inputs.id}.`,
        owner: { kind: 'business', id: inputs.id },
        now: inputs.now,
        continuation: true,
      }
    : null;
  const workflowRelativePath = workflowSpec
    ? join('workflows', `${workflowSpec.id}-${workflowSpec.slug}`)
    : null;
  const workflowDirectory = workflowRelativePath ? join(targetDir, workflowRelativePath) : null;
  if (workflowDirectory) assertDescendant(targetDir, workflowDirectory);

  return {
    inputs,
    business,
    businessRoot,
    targetDir,
    directories: ['reports', 'workflows'],
    ceremony,
    ceremonyDir: workflowDirectory,
    ceremonyRelativePath: workflowRelativePath,
    workflowSpec,
    files,
  };
}

/**
 * Handle the public `work business` command.
 * @param {{positionals?:string[],flags?:Record<string,unknown>,apply:boolean,root?:string}} context
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleBusinessCreate({ positionals = [], flags = {}, apply, root = process.cwd() }) {
  const now = typeof flags.now === 'string' ? flags.now : new Date().toISOString();
  const inputs = { ...resolveBusinessCreateInputs({ positionals, flags, root }), now };
  const plan = planBusinessPackage({ inputs, root });
  const publication = apply
    ? applyBusinessPackage(plan)
    : { committedWrites: [], stagingMode: 'not-applied' };

  const plannedWrites = [
    ...plan.files.map((file) => file.path),
    ...(plan.workflowSpec ? [join(plan.ceremonyDir, 'workflow.json'), join(plan.ceremonyDir, 'workflow-state.json'), join(plan.ceremonyDir, 'pipeline', 'tasks.json')] : []),
  ];
  return makeReceipt({
    command: 'business',
    applied: Boolean(apply),
    writes: plannedWrites,
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
      plannedWrites,
      committedWrites: publication.committedWrites,
      atomicity: publication.stagingMode,
      validation: { business: 'pass', workflow: plan.workflowSpec ? (apply ? 'pass' : 'planned') : 'not-requested' },
    },
  });
}
