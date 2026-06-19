/**
 * Shared enumerations for the Business-driven methodology (BIZ-0001 / WF-0036).
 *
 * SINGLE SOURCE OF TRUTH for the cross-entity enums. Workflow A (WF-0036) OWNS
 * these per `shared-entity-contracts.md` §"Enum ownership"; Workflow B (WF-0037)
 * and downstream tasks (A2 Operations, B1 decision registry) MUST import from
 * here and never redefine them. Zero runtime dependencies — plain frozen arrays.
 *
 * Importers: `import { VALUE_INTENTS, RELATION_TYPES } from '../work/enums.mjs'`.
 */

/**
 * Value intents — WHY work has value, orthogonal to entity kind. Exactly one
 * primary + zero-or-more secondary on every Business and Operation
 * (shared-entity-contracts §"Value intents").
 * @type {readonly string[]}
 */
export const VALUE_INTENTS = Object.freeze([
  'CREATE',
  'PROTECT',
  'RECOVER',
  'ENABLE',
  'IMPROVE',
  'LEARN',
  'COMPLY',
  'SERVE_MISSION',
]);

/**
 * Canonical relation types between work contexts / decisions
 * (shared-entity-contracts §"Owner / origin / relations"). NOTE: historical
 * artifacts may carry extra verbs (e.g. `refines`); validators therefore treat
 * this list as the RECOMMENDED vocabulary, not a hard rejection set, to keep
 * already-conforming files (BIZ-0001) valid.
 * @type {readonly string[]}
 */
export const RELATION_TYPES = Object.freeze([
  'supports',
  'contributes-to',
  'triggered-by',
  'derived-from',
  'blocks',
  'blocked-by',
  'protects',
  'replaces',
  'supersedes',
  'related-to',
]);

/**
 * Operation execution modes (shared-entity-contracts §"Enum ownership").
 * Closed set — an Operation MUST declare exactly one.
 * @type {readonly string[]}
 */
export const EXECUTION_MODES = Object.freeze(['direct', 'batch', 'workflow']);

/**
 * Tests whether a value is a non-empty string after trimming.
 *
 * @param {unknown} candidate - value to test.
 * @returns {boolean} true when `candidate` is a string with visible content.
 */
export function isNonEmptyString(candidate) {
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

/**
 * Strips a leading UTF-8 BOM from a string so `JSON.parse` never chokes on it
 * (immutable rule 4). Safe on any input — returns non-strings unchanged.
 *
 * @param {unknown} raw - candidate string (typically file contents).
 * @returns {unknown} the string without a leading BOM, or `raw` untouched.
 */
export function stripBom(raw) {
  if (typeof raw !== 'string') return raw;
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}
