/**
 * economy/registry.mjs — canonical registry of token-economy resources (ADR-0117).
 *
 * Single source of truth for the telemetry seam (telemetry-emit.mjs) and the
 * completeness meta-test. Each resource carries a honesty `category`:
 *   - 'lever'     — has an observable token delta → may write the savings ledger
 *                   (the 4 observable levers only).
 *   - 'advisory'  — produces a recommendation the agent may apply; reported as
 *                   adoption/lifecycle, never an invented saving.
 *   - 'lifecycle' — fires / is active but has no measurable token delta.
 *
 * Zero deps. @module economy/registry
 */

/** The 4 observable levers — the savings-ledger vocabulary (do NOT widen). */
export const ECONOMY_LEVERS = Object.freeze(['boot-delta', 'run-compact', 'project-map', 'routing']);

/** Valid honesty categories. */
export const ECONOMY_CATEGORIES = Object.freeze(['lever', 'advisory', 'lifecycle']);

/** Every economy resource + its honesty category. */
export const ECONOMY_RESOURCES = Object.freeze([
  { resource: 'boot-delta', category: 'lever' },
  { resource: 'run-compact', category: 'lever' },
  { resource: 'project-map', category: 'lever' },
  { resource: 'routing', category: 'lever' },
  { resource: 'runner-first', category: 'lifecycle' },
  { resource: 'dev-start', category: 'lifecycle' },
  { resource: 'resume-pack', category: 'lifecycle' },
  { resource: 'subagent-profile', category: 'lifecycle' },
  { resource: 'tc-packet', category: 'advisory' },
  { resource: 'tc-route', category: 'advisory' },
  { resource: 'tc-dispatch', category: 'advisory' },
  { resource: 'tc-accept', category: 'advisory' },
  { resource: 'context-pack', category: 'advisory' },
  { resource: 'context-profiles', category: 'advisory' },
  { resource: 'lean-loop', category: 'advisory' },
  { resource: 'loop-breaker', category: 'advisory' },
  { resource: 'patch-economy', category: 'advisory' },
  { resource: 'output-contract', category: 'advisory' },
  { resource: 'findings', category: 'advisory' },
  { resource: 'agent-contract', category: 'advisory' },
]);

/** Frozen list of resource ids (used by the events ledger + meta-test). */
export const ECONOMY_RESOURCE_IDS = Object.freeze(ECONOMY_RESOURCES.map((entry) => entry.resource));

const CATEGORY_BY_ID = new Map(ECONOMY_RESOURCES.map((entry) => [entry.resource, entry.category]));

/**
 * The honesty category for a resource, or null when unknown.
 * @param {string} resource @returns {string|null}
 */
export function resourceCategory(resource) {
  return CATEGORY_BY_ID.get(resource) ?? null;
}

/**
 * True when `resource` is a registered economy resource.
 * @param {string} resource @returns {boolean}
 */
export function isKnownResource(resource) {
  return CATEGORY_BY_ID.has(resource);
}
