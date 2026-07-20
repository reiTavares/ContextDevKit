/**
 * Pure contract and ceremony resolution for the public `work business` verb.
 *
 * This module owns the input boundary and the fixed public ceremony mapping.
 * It never writes the filesystem and never maps classifier functional kinds into
 * the persisted Business.kind enum.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUSINESS_KINDS, VALUE_INTENTS, isBusinessKind, isNonEmptyString } from '../../runtime/work/enums.mjs';
import { BUSINESS_ID_PATTERN } from '../../runtime/work/schema-business.mjs';
import { allocateWorkflowId, nextBusinessId } from './registry/ids.mjs';
import { fleetMemoryRoots } from './registry/fleet.mjs';
import { resolveCeremonyManifest } from './workflow/ceremony-manifest.mjs';
import { resolveCeremonyShape } from '../../methodology/resolve-ceremony-shape.mjs';
import { slugify } from './work-io.mjs';

const WORKFLOW_ID_PATTERN = /^WF-\d{4}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,60}$/;
const FUNCTIONAL_CLASSIFIER_KIND = 'initiative';

const CEREMONY_DEFINITIONS = Object.freeze({
  decision: Object.freeze({ executionMode: 'direct', tier: 'feature', shape: 'decision-only' }),
  workflow: Object.freeze({ executionMode: 'workflow', tier: 'architectural', shape: 'multi-workflow-program' }),
});

/**
 * Validate the lower-kebab folder token at the create boundary.
 *
 * @param {unknown} candidate requested slug
 * @returns {string} validated slug
 * @throws {Error} when the slug is not lower-kebab or is empty
 */
function resolveSlug(candidate) {
  if (!isNonEmptyString(candidate) || !SLUG_PATTERN.test(String(candidate))) {
    throw new Error(`business: --slug must match ${SLUG_PATTERN}`);
  }
  return String(candidate);
}

/**
 * Ensure an explicit Business id is not already occupied in the local or fleet
 * memory roots. Automatic ids already use the same fleet-aware allocator.
 *
 * @param {string} root project root
 * @param {string} businessId canonical Business id
 * @returns {void}
 * @throws {Error} when any fleet root already contains the id
 */
export function assertBusinessIdAvailable(root, businessId) {
  for (const memoryRoot of fleetMemoryRoots(root)) {
    const businessRoot = join(memoryRoot, 'business');
    if (!existsSync(businessRoot)) continue;
    const occupied = readdirSync(businessRoot, { withFileTypes: true }).some((entry) => (
      entry.isDirectory() && (entry.name === businessId || entry.name.startsWith(`${businessId}-`))
    ));
    if (occupied) {
      throw new Error(`business: id "${businessId}" is already occupied in the worktree fleet`);
    }
  }
}

/**
 * Resolve and validate the public create inputs.
 *
 * @param {{positionals?: string[], flags?: Record<string, unknown>, root?: string}} args parsed command arguments
 * @returns {{id:string,title:string,slug:string,kind:string,strategicFacet:string,intent:string,ceremony:'decision'|'workflow',workflowId:string|null}}
 * @throws {Error} when an input is missing or outside its closed set
 */
export function resolveBusinessCreateInputs({ positionals = [], flags = {}, root = process.cwd() }) {
  const titleTokens = [...positionals];
  if (titleTokens[0] === 'create') titleTokens.shift();
  const title = isNonEmptyString(flags.title)
    ? String(flags.title).trim()
    : titleTokens.join(' ').trim();
  if (!isNonEmptyString(title)) throw new Error('business: a title is required (positional or --title)');

  const kind = String(flags.kind ?? flags['business-kind'] ?? '');
  if (!isBusinessKind(kind)) {
    throw new Error(`business: --kind is required and must be one of ${BUSINESS_KINDS.join('|')}`);
  }

  const ceremony = String(flags.ceremony ?? 'decision');
  if (ceremony === 'direct-business') {
    throw new Error('business: ceremony "direct-business" is not public; use --ceremony decision or workflow');
  }
  if (!Object.hasOwn(CEREMONY_DEFINITIONS, ceremony)) {
    throw new Error('business: --ceremony must be one of decision|workflow');
  }

  const intent = String(flags.intent ?? 'CREATE');
  if (!VALUE_INTENTS.includes(intent)) {
    throw new Error(`business: --intent "${intent}" must be one of ${VALUE_INTENTS.join('|')}`);
  }

  const id = String(flags.id ?? nextBusinessId(root));
  if (!BUSINESS_ID_PATTERN.test(id)) throw new Error('business: --id must match BIZ-####');
  assertBusinessIdAvailable(root, id);

  const slug = resolveSlug(flags.slug ?? slugify(title));
  const strategicFacet = String(flags['strategic-facet'] ?? 'TO_BE_CONFIRMED');
  if (!isNonEmptyString(strategicFacet)) throw new Error('business: --strategic-facet must be non-empty');

  const workflowId = ceremony === 'workflow' ? allocateWorkflowId(root) : null;
  if (workflowId !== null && !WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new Error(`business: workflow allocator returned an invalid id "${workflowId}"`);
  }

  return { id, title, slug, kind, strategicFacet, intent, ceremony, workflowId };
}

/**
 * Resolve the public ceremony to one WF-0083 shape and journey branch.
 *
 * @param {'decision'|'workflow'|'direct-business'} ceremony public ceremony token
 * @returns {{ceremony:string,shape:string,journeyBranch:string,validators:string[],executionMode:string,tier:string,classifierFunctionalKind:string}}
 * @throws {Error} when the public ceremony is unsupported or resolves differently than its contract
 */
export function resolveBusinessCeremony(ceremony) {
  if (ceremony === 'direct-business') {
    throw new Error('business: ceremony "direct-business" is not public; use --ceremony decision or workflow');
  }
  const definition = CEREMONY_DEFINITIONS[ceremony];
  if (!definition) throw new Error('business: ceremony must be one of decision|workflow');

  const verifiedShape = resolveCeremonyShape(
    'business',
    definition.executionMode,
    definition.tier,
    FUNCTIONAL_CLASSIFIER_KIND,
  );
  if (verifiedShape !== definition.shape) {
    throw new Error(`business: ceremony "${ceremony}" failed resolver verification (got "${verifiedShape}")`);
  }
  const manifestRow = resolveCeremonyManifest(definition.shape);
  return {
    ceremony,
    shape: definition.shape,
    journeyBranch: manifestRow.journeyBranch,
    validators: manifestRow.validators,
    executionMode: definition.executionMode,
    tier: definition.tier,
    classifierFunctionalKind: FUNCTIONAL_CLASSIFIER_KIND,
  };
}
