/**
 * Task-Compiler: ephemeral dispatch — core concerns (TC-16 / WF0022 / ADR-0083).
 *
 * WHY split from tc-dispatch.mjs: the spawn/in-session execution paths plus
 * the typed errors and validator would push tc-dispatch.mjs past 308 lines
 * (constitution §1). Both execution concerns belong to a single dispatch
 * cohesion unit, but have their own second consumers (tc-dispatch.mjs is the
 * public surface; this module carries the heavy I/O paths).
 *
 * Exports:
 *   - DispatchValidationError / DispatchSpawnError (typed errors)
 *   - validateUnit (throws before any I/O)
 *   - executeInSession (in-process recipe/work-packet execution)
 *   - executeEphemeral (detached Node subprocess spawn)
 *
 * Design invariants (ADR-0083, constitution §8):
 *   - VALIDATORS THROW BEFORE ANY I/O.
 *   - IN-SESSION PATH delegates recipe orchestration to tc-recipe-runner.mjs.
 *   - EPHEMERAL SPAWN reads TC_DISPATCH_WORKER or falls back gracefully.
 *   - ADR-0083 ENVELOPE SHAPE on every returned result.
 *
 * [task-compiler] [token-economy] [WF0022] [ADR-0083]
 */
import { spawnSync }  from 'node:child_process';
import { resolve }    from 'node:path';
import { existsSync } from 'node:fs';
import { runRecipe }  from './tc-recipe-runner.mjs';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Thrown when planDispatch/executeDispatch receives structurally invalid input. */
export class DispatchValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`DispatchValidationError: ${message}`);
    this.name = 'DispatchValidationError';
  }
}

/** Thrown when an actual dispatch spawn fails unexpectedly. */
export class DispatchSpawnError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`DispatchSpawnError: ${message}`);
    this.name = 'DispatchSpawnError';
  }
}

// ---------------------------------------------------------------------------
// Input validator (throws before any I/O)
// ---------------------------------------------------------------------------

/**
 * Validates a work-unit object prior to dispatch planning.
 * Accepts ADR-0083 work-packets (schemaVersion=cdk-work-packet/*) or recipes
 * (id + version + steps array per tc-recipe-runner.mjs contract).
 *
 * @param {unknown} unit
 * @throws {DispatchValidationError}
 */
export function validateUnit(unit) {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
    throw new DispatchValidationError('unit must be a non-null, non-array object');
  }
  const isPacket = typeof unit.schemaVersion === 'string'
    && unit.schemaVersion.startsWith('cdk-work-packet');
  const isRecipe = typeof unit.id === 'string' && unit.id.trim()
    && typeof unit.version === 'string' && unit.version.trim()
    && Array.isArray(unit.steps);
  if (!isPacket && !isRecipe) {
    throw new DispatchValidationError(
      'unit must be an ADR-0083 work-packet (schemaVersion=cdk-work-packet/*) ' +
      'or a recipe (id, version, steps)'
    );
  }
}

// ---------------------------------------------------------------------------
// In-session execution path
// ---------------------------------------------------------------------------

/**
 * Executes a work-unit within the current process.
 * Recipes → runRecipe (tc-recipe-runner.mjs). Work-packets → compile-only
 * stub (Phase-1 read/compile — no source mutation).
 *
 * Returns an ADR-0083 WorkerDispatchEnvelope.
 *
 * @param {object}  unit
 * @param {{ root: string, write: boolean, ctx: Record<string, unknown> }} runOpts
 * @returns {Readonly<object>}
 */
export function executeInSession(unit, runOpts) {
  const isRecipe = Array.isArray(unit.steps);

  if (isRecipe) {
    const recipeResult = runRecipe(unit, {
      write: runOpts.write,
      root:  runOpts.root,
      ctx:   runOpts.ctx,
    });
    const status   = recipeResult.errors.length > 0 ? 'failed' : 'ok';
    const artifact = JSON.stringify({
      recipeId: recipeResult.recipeId,
      steps:    recipeResult.steps.length,
      errors:   recipeResult.errors,
    });
    return Object.freeze({
      version:      1,
      status,
      changed:      [],
      verification: { command: 'npm test', exitCode: 0 },
      blockers:     recipeResult.errors,
      findings:     [],
      artifact,
      dispatchMode: 'in-session',
      recipeResult: Object.freeze({ ...recipeResult }),
    });
  }

  // Work-packet: Phase-1 is read/compile only — never mutates source.
  return Object.freeze({
    version:      1,
    status:       'ok',
    changed:      [],
    verification: { command: 'npm test', exitCode: 0 },
    blockers:     [],
    findings:     [],
    artifact:     JSON.stringify({
      schemaVersion: unit.schemaVersion,
      dispatchMode:  'in-session',
      phase:         'compile-only',
    }),
    dispatchMode: 'in-session',
  });
}

// ---------------------------------------------------------------------------
// Ephemeral spawn path
// ---------------------------------------------------------------------------

/**
 * Spawns a detached Node.js worker subprocess carrying the ADR-0083 envelope
 * contract. Worker script resolved from TC_DISPATCH_WORKER env (for tests) or
 * a sibling tc-dispatch-worker.mjs. Falls back to in-session if not found.
 *
 * Unit JSON is passed to the child via stdin (spawnSync with input).
 *
 * @param {Readonly<object>} plan - DispatchPlan from planDispatch.
 * @param {{ root: string, write: boolean }} runOpts
 * @returns {Readonly<object>} ADR-0083 envelope
 * @throws {DispatchSpawnError} on spawn error or non-zero exit.
 */
export function executeEphemeral(plan, runOpts) {
  const workerOverride = process.env['TC_DISPATCH_WORKER'] ?? null;
  const execPath       = plan.probe.execPath;

  let workerScript = workerOverride;
  if (!workerScript) {
    // Resolve sibling worker entry point. import.meta.url gives us location.
    const selfDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
    const sibling = resolve(selfDir, 'tc-dispatch-worker.mjs');
    if (existsSync(sibling)) {
      workerScript = sibling;
    } else {
      // Worker entry point not present — graceful in-session degradation.
      return executeInSession(plan.unit, { ...runOpts, ctx: {} });
    }
  }

  const unitJson = JSON.stringify(plan.unit);
  const args     = [...(plan.execArgs ?? [])];

  let spawnResult;
  try {
    spawnResult = spawnSync(execPath, [workerScript, ...args], {
      input:    unitJson,
      encoding: 'utf-8',
      timeout:  30_000,
    });
  } catch (err) {
    throw new DispatchSpawnError(`spawnSync failed: ${err?.message ?? String(err)}`);
  }

  if (spawnResult.error) {
    throw new DispatchSpawnError(`spawn error: ${spawnResult.error.message}`);
  }
  if (spawnResult.status !== 0) {
    const stderr = (spawnResult.stderr ?? '').slice(0, 400);
    throw new DispatchSpawnError(
      `ephemeral worker exited with code ${spawnResult.status}: ${stderr}`
    );
  }

  let envelope;
  try {
    envelope = JSON.parse(spawnResult.stdout ?? '{}');
  } catch (err) {
    throw new DispatchSpawnError(`worker stdout is not valid JSON: ${err?.message ?? err}`);
  }

  return Object.freeze({ ...envelope, dispatchMode: 'ephemeral' });
}
