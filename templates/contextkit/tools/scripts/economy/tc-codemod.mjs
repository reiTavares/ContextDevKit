/**
 * Task-Compiler: codemod runner — recipe-driven source transforms (WF0022 / ADR-0089).
 *
 * Single responsibility: load a codemod recipe from the embedded registry,
 * build a PatchPlan from the recipe's transform rules applied to the target
 * files, and delegate application to applyPatchPlan (tc-transform.mjs).
 *
 * Design invariants (ADR-0089 §Decision):
 *   - VALIDATORS THROW BEFORE ANY I/O: recipe lookup + file validation runs first.
 *   - DRY-RUN BY DEFAULT: passes through to applyPatchPlan without --write.
 *   - RECIPES ARE ADR-GATED REVIEWABLE DATA: the registry is a plain data
 *     object loaded here; no generated or inferred recipe content. Exactly ONE
 *     inert seed recipe is shipped (marked SEED-ONLY) so the runner is
 *     exercised. Recipe expansion requires an ADR.
 *   - SCOPE-FENCED: allowedPaths from the recipe are passed to applyPatchPlan
 *     unchanged; the scope fence lives there.
 *   - ZERO HOT-PATH DEPS: node:* + relative imports only.
 *
 * // consumes: economy/tc-transform
 * [task-compiler] [token-economy] [WF0022] [ADR-0089]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyPatchPlan,
  presentTransform,
  TC_TRANSFORM_SCHEMA_VERSION,
  TransformValidationError,
  TransformScopeError,
} from './tc-transform.mjs';

// Re-export error types so callers get them from one import.
export { TransformValidationError, TransformScopeError };

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for codemod run results. */
export const TC_CODEMOD_SCHEMA_VERSION = 'cdk-tc-codemod/1';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Thrown when the requested recipe is not found in the registry. */
export class CodemodRecipeNotFoundError extends Error {
  /** @param {string} recipeId */
  constructor(recipeId) {
    super(
      `CodemodRecipeNotFoundError: recipe "${recipeId}" not found in the codemod registry. ` +
      'Registering a new recipe requires an ADR (ADR-0089 §Decision).'
    );
    this.name = 'CodemodRecipeNotFoundError';
  }
}

/** Thrown when one or more target files are missing and the recipe requires them. */
export class CodemodTargetMissingError extends Error {
  /**
   * @param {string} recipeId
   * @param {string[]} missingPaths
   */
  constructor(recipeId, missingPaths) {
    super(
      `CodemodTargetMissingError: recipe "${recipeId}" requires target files that are missing: ` +
      missingPaths.join(', ')
    );
    this.name = 'CodemodTargetMissingError';
  }
}

// ---------------------------------------------------------------------------
// Recipe registry — ADR-GATED REVIEWABLE DATA (constitution §9)
//
// IMPORTANT: do NOT add recipes here without a governing accepted ADR.
// Each recipe object declares:
//   id           — stable identifier (string, kebab-case)
//   version      — recipe schema version (semver string)
//   description  — human summary (required)
//   allowedPaths — scope allowlist passed to applyPatchPlan (string[])
//   seed         — true when this is the inert seed recipe (MUST NOT write real code)
//   rules        — array of transform rule objects (see applyRuleToContent)
//
// The seed recipe exercises the runner machinery without making real edits.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CodemodRule
 * @property {string} kind    - Rule type: currently only 'text-replace' is supported.
 * @property {string} target  - Relative path of the file to transform.
 * @property {string} [find]  - Text to find (required for text-replace).
 * @property {string} [replace] - Replacement text (required for text-replace).
 */

/**
 * @typedef {Object} CodemodRecipe
 * @property {string}        id           - Stable recipe identifier.
 * @property {string}        version      - Recipe version string.
 * @property {string}        description  - Human-readable description.
 * @property {string[]}      allowedPaths - Scope allowlist for this recipe.
 * @property {boolean}       [seed]       - True for the inert seed recipe.
 * @property {CodemodRule[]} rules        - Transform rules.
 */

/** @type {ReadonlyArray<CodemodRecipe>} */
const RECIPE_REGISTRY = Object.freeze([
  // ── SEED-ONLY recipe — DO NOT expand without an ADR ─────────────────────
  // Purpose: exercises the runner machinery in tests. The rule target is a
  // non-existent path so it can never accidentally write real files. The
  // content it would produce is syntactically inert (a no-op comment update).
  // Expansion of real codemods is ADR-gated (ADR-0089 constitution §9).
  {
    id:           'seed-noop-comment',
    version:      '0.0.1',
    description:  'SEED-ONLY: replaces the @generated marker in a synthetic scratch file. Not for production use.',
    allowedPaths: ['contextkit/pipeline/scratch/'],
    seed:         true,
    rules: [
      {
        kind:    'text-replace',
        target:  'contextkit/pipeline/scratch/seed-target.txt',
        find:    '@generated PLACEHOLDER',
        replace: '@generated SEED-NOOP',
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Recipe lookup
// ---------------------------------------------------------------------------

/**
 * Returns the recipe with the given id from the registry, or throws
 * CodemodRecipeNotFoundError. Lookup is by exact id match.
 *
 * @param {string} recipeId
 * @returns {CodemodRecipe}
 * @throws {CodemodRecipeNotFoundError}
 */
export function findRecipe(recipeId) {
  if (typeof recipeId !== 'string' || !recipeId.trim()) {
    throw new TransformValidationError('recipeId must be a non-empty string');
  }
  const recipe = RECIPE_REGISTRY.find((r) => r.id === recipeId);
  if (!recipe) throw new CodemodRecipeNotFoundError(recipeId);
  return recipe;
}

// ---------------------------------------------------------------------------
// Rule application
// ---------------------------------------------------------------------------

/**
 * Applies a single codemod rule to the given file content.
 * Currently supports 'text-replace' only; unknown kinds throw.
 *
 * @param {CodemodRule} rule
 * @param {string} content - Current file content.
 * @returns {string} Transformed content.
 * @throws {TransformValidationError} on unknown rule kind or missing fields.
 */
function applyRuleToContent(rule, content) {
  if (rule.kind === 'text-replace') {
    if (typeof rule.find !== 'string') {
      throw new TransformValidationError(`rule.kind='text-replace' requires a 'find' string (target: ${rule.target})`);
    }
    if (typeof rule.replace !== 'string') {
      throw new TransformValidationError(`rule.kind='text-replace' requires a 'replace' string (target: ${rule.target})`);
    }
    return content.split(rule.find).join(rule.replace);
  }
  throw new TransformValidationError(
    `unsupported rule kind "${rule.kind}" in target "${rule.target}". ` +
    'Supported: text-replace. Adding new kinds requires an ADR.'
  );
}

// ---------------------------------------------------------------------------
// runCodemod — main export
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CodemodResult
 * @property {string}  recipeId        - Recipe that was run.
 * @property {string}  recipeVersion   - Recipe version.
 * @property {boolean} dryRun          - True when no writes performed.
 * @property {object}  applyResult     - Full ApplyResult from applyPatchPlan.
 * @property {string}  schemaVersion   - TC_CODEMOD_SCHEMA_VERSION.
 */

/**
 * Runs a named codemod recipe against a project root.
 *
 * Sequence:
 *   1. Look up recipe (throws CodemodRecipeNotFoundError if absent).
 *   2. Validate that all rule targets exist on disk (unless seed mode).
 *   3. Read current file content for each target.
 *   4. Apply the recipe's rules to each target content.
 *   5. Assemble a PatchPlan and delegate to applyPatchPlan.
 *
 * Dry-run is the default. Pass `write: true` to apply.
 *
 * @param {string} recipeId  - Identifier of the recipe to run.
 * @param {{
 *   write?:  boolean,  - Default false (dry-run).
 *   root?:   string,   - Project root for path resolution (default cwd).
 *   allowMissingTargets?: boolean - Skip missing-target check (used by tests).
 * }} [opts={}]
 * @returns {CodemodResult}
 * @throws {CodemodRecipeNotFoundError}  when recipe is unknown.
 * @throws {CodemodTargetMissingError}   when required target files are absent.
 * @throws {TransformValidationError}    on rule/plan structural errors.
 * @throws {TransformScopeError}         on out-of-scope paths.
 */
export function runCodemod(recipeId, opts = {}) {
  const recipe = findRecipe(recipeId);
  const root   = (typeof opts?.root === 'string' && opts.root) ? opts.root : process.cwd();
  const writeMode = opts?.write === true;
  const skipMissingCheck = opts?.allowMissingTargets === true || recipe.seed === true;

  // ── Validate target existence BEFORE any I/O (ADR-0089) ──────────────────
  if (!skipMissingCheck) {
    const missing = recipe.rules
      .map((r) => r.target)
      .filter((t) => !existsSync(resolve(root, t)));
    if (missing.length > 0) throw new CodemodTargetMissingError(recipeId, missing);
  }

  // ── Build patches from rules ──────────────────────────────────────────────
  const patches = recipe.rules.map((rule) => {
    const absPath = resolve(root, rule.target);
    const existingContent = existsSync(absPath)
      ? (() => { try { return readFileSync(absPath, 'utf-8'); } catch { return ''; } })()
      : '';
    const newContent = applyRuleToContent(rule, existingContent);
    return { path: rule.target, newContent };
  });

  // ── Delegate to applyPatchPlan (scope fence + atomic writes live there) ───
  const applyResult = applyPatchPlan(
    {
      recipeId:     recipe.id,
      version:      recipe.version,
      allowedPaths: recipe.allowedPaths,
      patches,
    },
    { write: writeMode, root }
  );

  return {
    schemaVersion: TC_CODEMOD_SCHEMA_VERSION,
    recipeId:      recipe.id,
    recipeVersion: recipe.version,
    dryRun:        !writeMode,
    applyResult,
  };
}

// ---------------------------------------------------------------------------
// presentCodemod — human-readable summary
// ---------------------------------------------------------------------------

/**
 * Renders a CodemodResult as a terse, human-readable string.
 *
 * @param {CodemodResult} result
 * @returns {string}
 */
export function presentCodemod(result) {
  if (!result || typeof result !== 'object') {
    return `tc-codemod [${TC_CODEMOD_SCHEMA_VERSION}]: invalid result`;
  }
  const lines = [
    `tc-codemod [${TC_CODEMOD_SCHEMA_VERSION}]: recipe=${result.recipeId}@${result.recipeVersion}`,
    presentTransform(result.applyResult),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Expose registry length for selfcheck assertions (no data leakage)
// ---------------------------------------------------------------------------

/** Number of recipes in the registry. @returns {number} */
export const RECIPE_COUNT = RECIPE_REGISTRY.length;

/** Schema version of tc-transform consumed by this module. */
export const CONSUMED_TRANSFORM_SCHEMA = TC_TRANSFORM_SCHEMA_VERSION;
