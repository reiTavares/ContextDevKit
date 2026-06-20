/**
 * Task-Compiler: recipe-runner DAG (TC-15 / WF0022 / ADR-0089).
 *
 * Single responsibility: orchestrate a recipe — an ordered, reviewable DATA
 * structure — across three DAG shapes: linear chain, fan-out-to-join, and
 * conditional edges. The runner NEVER writes source files directly; any write
 * is delegated to tc-transform.mjs (dry-run by default, per ADR-0089 §8).
 *
 * Supported shapes:
 *   - LINEAR:          step-A → step-B → step-C
 *   - FAN-OUT-TO-JOIN: one step fans to N parallel branches that converge at
 *                      a join step (sequential ordering; true parallel is deferred).
 *   - CONDITIONAL:     edge between steps gated by squad-pipeline-condition.parseAndEval.
 *
 * Resumability: checkpoint stamped into ship-state after each completed step when
 * opts.pipeDir + opts.runId are provided (skip completed steps via opts.resumeFrom).
 *
 * Design invariants (ADR-0089):
 *   - VALIDATORS THROW BEFORE ANY I/O.
 *   - DRY-RUN BY DEFAULT: pass `write: true` to execute patch-plans.
 *   - RUNNER ORCHESTRATES ONLY: all source writes go through applyPatchPlan.
 *   - ZERO HOT-PATH DEPS: node:* + relative imports only.
 *   - INERT SEED RECIPE and presenter live in tc-recipe-seed.mjs (split per §9).
 *
 * Cohesion note: validation + dispatch co-located (single DAG concern). Seed
 * data lives in tc-recipe-seed.mjs (its own consumer drives the split).
 * [task-compiler] [token-economy] [WF0022] [ADR-0089]
 */
import { parseAndEval }   from '../squad-pipeline-condition.mjs';
import { checkpoint }     from '../ship-state.mjs';
import { applyPatchPlan } from './tc-transform.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for recipe-runner results. */
export const TC_RECIPE_RUNNER_SCHEMA_VERSION = 'cdk-tc-recipe-runner/1';

// ---------------------------------------------------------------------------
// Typed errors (throw before any I/O, per constitution §8)
// ---------------------------------------------------------------------------

/** Thrown when a recipe object is structurally invalid. */
export class RecipeValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`RecipeValidationError: ${message}`);
    this.name = 'RecipeValidationError';
  }
}

/** Thrown when a step references an unknown edge target. */
export class RecipeEdgeError extends Error {
  /** @param {string} from @param {string} to */
  constructor(from, to) {
    super(`RecipeEdgeError: step "${from}" references unknown target "${to}"`);
    this.name = 'RecipeEdgeError';
  }
}

// ---------------------------------------------------------------------------
// Recipe schema types (JSDoc only)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, kind: 'patch'|'noop', label?: string,
 *             patchPlan?: object, edges?: RecipeEdge[] }} RecipeStep
 * @typedef {{ target: string, condition?: string,
 *             fanOut?: boolean, join?: boolean }} RecipeEdge
 * @typedef {{ id: string, version: string, entry: string,
 *             steps: RecipeStep[] }} Recipe
 */

// ---------------------------------------------------------------------------
// Recipe validator (throws before any I/O)
// ---------------------------------------------------------------------------

/**
 * Validates a recipe object structurally.
 * Throws RecipeValidationError or RecipeEdgeError on any violation.
 *
 * @param {unknown} recipe
 * @throws {RecipeValidationError}
 * @throws {RecipeEdgeError}
 */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new RecipeValidationError('recipe must be a non-null object');
  }
  if (typeof recipe.id !== 'string' || !recipe.id.trim()) {
    throw new RecipeValidationError('recipe.id must be a non-empty string');
  }
  if (typeof recipe.version !== 'string' || !recipe.version.trim()) {
    throw new RecipeValidationError('recipe.version must be a non-empty string');
  }
  if (typeof recipe.entry !== 'string' || !recipe.entry.trim()) {
    throw new RecipeValidationError('recipe.entry must be a non-empty string');
  }
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    throw new RecipeValidationError('recipe.steps must be a non-empty array');
  }

  const ids = new Set();
  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i];
    if (!step || typeof step !== 'object') {
      throw new RecipeValidationError(`recipe.steps[${i}] must be an object`);
    }
    if (typeof step.id !== 'string' || !step.id.trim()) {
      throw new RecipeValidationError(`recipe.steps[${i}].id must be a non-empty string`);
    }
    if (step.kind !== 'patch' && step.kind !== 'noop') {
      throw new RecipeValidationError(
        `recipe.steps[${i}].kind must be "patch" or "noop", got "${step.kind}"`
      );
    }
    if (step.kind === 'patch' && (!step.patchPlan || typeof step.patchPlan !== 'object')) {
      throw new RecipeValidationError(
        `recipe.steps[${i}] (kind=patch) must have a patchPlan object`
      );
    }
    ids.add(step.id);
  }

  if (!ids.has(recipe.entry)) {
    throw new RecipeValidationError(`recipe.entry "${recipe.entry}" is not a known step id`);
  }
  for (const step of recipe.steps) {
    for (const edge of (step.edges ?? [])) {
      if (!edge || typeof edge !== 'object') {
        throw new RecipeValidationError(`edge in step "${step.id}" must be an object`);
      }
      if (!ids.has(edge.target)) throw new RecipeEdgeError(step.id, edge.target);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves outgoing edges from a step: separates fan-out targets from the
 * linear successor. Conditional edges are evaluated against `ctx`.
 *
 * @param {RecipeStep} step
 * @param {Record<string, unknown>} ctx
 * @returns {{ linearNext: string|null, fanTargets: string[] }}
 */
function resolveEdges(step, ctx) {
  const fanTargets = [];
  let linearNext   = null;
  for (const edge of (step.edges ?? [])) {
    if (typeof edge.condition === 'string' && edge.condition.trim()) {
      let passes = false;
      try { passes = parseAndEval(edge.condition, ctx); } catch { passes = false; }
      if (!passes) continue;
    }
    if (edge.fanOut === true) { fanTargets.push(edge.target); }
    else { linearNext = edge.target; }
  }
  return { linearNext, fanTargets };
}

/**
 * Dispatches one step. Returns a step-result object.
 * All writes go through applyPatchPlan (never writes directly).
 *
 * @param {RecipeStep} step
 * @param {{ write: boolean, root: string }} opts
 * @returns {{ stepId: string, status: 'ok'|'error', detail: string }}
 */
function dispatchStep(step, opts) {
  if (step.kind === 'noop') return { stepId: step.id, status: 'ok', detail: 'noop' };
  try {
    const result = applyPatchPlan(step.patchPlan, { write: opts.write, root: opts.root });
    const detail = result.preview.join(' | ') || (result.dryRun ? 'dry-run' : 'applied');
    return { stepId: step.id, status: 'ok', detail };
  } catch (err) {
    return { stepId: step.id, status: 'error', detail: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Main export: runRecipe
// ---------------------------------------------------------------------------

/**
 * Runs a recipe DAG over linear, fan-out-to-join, and conditional-edge shapes.
 * All source writes are delegated to tc-transform.mjs.
 *
 * Steps in `opts.resumeFrom` are skipped (resume support via ship-state.checkpoint).
 *
 * @param {Recipe} recipe
 * @param {{
 *   write?:      boolean,
 *   root?:       string,
 *   ctx?:        Record<string, unknown>,
 *   resumeFrom?: Set<string>,
 *   pipeDir?:    string,
 *   runId?:      string,
 * }} [opts={}]
 * @returns {Readonly<{
 *   schemaVersion: string, recipeId: string, recipeVersion: string,
 *   dryRun: boolean, steps: Array<object>, skipped: string[], errors: string[]
 * }>}
 * @throws {RecipeValidationError} on malformed recipe (before any I/O)
 * @throws {RecipeEdgeError}       on unknown edge targets (before any I/O)
 */
export function runRecipe(recipe, opts = {}) {
  // Validate BEFORE any I/O (ADR-0089 §8)
  validateRecipe(recipe);

  const writeMode  = opts?.write === true;
  const root       = (typeof opts?.root === 'string' && opts.root) ? opts.root : process.cwd();
  const ctx        = (opts?.ctx && typeof opts.ctx === 'object') ? opts.ctx : {};
  const resumeFrom = (opts?.resumeFrom instanceof Set) ? opts.resumeFrom : new Set();
  const pipeDir    = (typeof opts?.pipeDir === 'string') ? opts.pipeDir : null;
  const runId      = (typeof opts?.runId   === 'string') ? opts.runId   : null;

  const stepIndex  = new Map(recipe.steps.map((s) => [s.id, s]));
  const stepResults = [];
  const skipped     = [];
  const errors      = [];
  const visited     = new Set();
  const queue       = [recipe.entry];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const step = stepIndex.get(currentId);
    if (!step) { errors.push(`unknown step "${currentId}"`); break; }

    // Resume: skip already-completed steps
    if (resumeFrom.has(currentId)) {
      skipped.push(currentId);
      const { linearNext, fanTargets } = resolveEdges(step, ctx);
      if (fanTargets.length > 0) queue.push(...fanTargets);
      if (linearNext) queue.push(linearNext);
      continue;
    }

    const result = dispatchStep(step, { write: writeMode, root });
    stepResults.push(result);

    if (result.status === 'error') {
      errors.push(`${currentId}: ${result.detail}`);
      break; // stop on first error — caller decides retry/escalation
    }

    if (pipeDir && runId) {
      checkpoint(pipeDir, runId, {
        objective:   `recipe ${recipe.id}@${recipe.version}`,
        currentStep: currentId,
        decisions:   [],
        touchSet:    [],
        openThreads: [`next: ${(step.edges ?? []).map((e) => e.target).join(', ') || 'terminal'}`],
        pointers:    {},
      });
    }

    const { linearNext, fanTargets } = resolveEdges(step, ctx);
    if (fanTargets.length > 0) queue.push(...fanTargets);
    if (linearNext) queue.push(linearNext);
  }

  return Object.freeze({
    schemaVersion: TC_RECIPE_RUNNER_SCHEMA_VERSION,
    recipeId:      recipe.id,
    recipeVersion: recipe.version,
    dryRun:        !writeMode,
    steps:         stepResults,
    skipped,
    errors,
  });
}

// ---------------------------------------------------------------------------
// Human-readable presenter
// ---------------------------------------------------------------------------

/**
 * Renders a runRecipe result as a human-readable multi-line string.
 *
 * @param {ReturnType<typeof runRecipe>} result
 * @returns {string}
 */
export function presentRecipeRun(result) {
  if (!result || typeof result !== 'object') {
    return `tc-recipe-runner [${TC_RECIPE_RUNNER_SCHEMA_VERSION}]: invalid result`;
  }
  const mode  = result.dryRun ? 'DRY-RUN' : 'APPLIED';
  const lines = [
    `tc-recipe-runner [${result.schemaVersion}]: ${mode}`,
    `  recipe : ${result.recipeId}@${result.recipeVersion}`,
    `  steps  : ${result.steps.length} executed, ${result.skipped.length} skipped`,
  ];
  for (const sr of (result.steps ?? [])) {
    lines.push(`    [${sr.status}] ${sr.stepId}: ${sr.detail}`);
  }
  if (result.skipped.length > 0) lines.push(`  resumed-from: ${result.skipped.join(', ')}`);
  if (result.errors.length  > 0) lines.push(`  errors: ${result.errors.join('; ')}`);
  return lines.join('\n');
}
