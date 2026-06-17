/**
 * Benchmark experimental design — EACP Wave 6/9 / card #242 (EACP-13).
 *
 * The frozen, pre-registered A/B/C design that the pilot harness runs against:
 * arms, controls held equal, task strata, phases, the run-spec builder, and
 * deterministic cell shuffling. Wave 9 adds:
 *   - cacheWarmth (cold/warm separation — §13.3 item 9)
 *   - minReps / repetitions field in spec (§13.3 item 10: ≥3 reps per cell)
 *   - maxBudgetUsd ceiling (§13.3 item 12)
 *   - shuffleCells() — deterministic ordering, no Math.random() (§13.3 item 11)
 * This module is DESIGN ONLY — it executes nothing and reads no telemetry.
 *
 * Honesty (ADR-0080 / benchmark-plan §H):
 *   - Targets (1.30×/1.50×/1.70×) are DESIGN TARGETS, never measured claims.
 *   - The pilot is A-vs-C only; Compozy/arm B is deferred (panel M6).
 *   - Missing required controls → skipped(); a spec never half-forms.
 * DETERMINISTIC: no Date.now() / Math.random() / new Date(). Zero runtime deps.
 */

import { skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants — the frozen design
// ---------------------------------------------------------------------------

/** Canonical schema identifier for benchmark design + run-spec objects. */
export const BENCHMARK_SCHEMA_VERSION = 'eacp-benchmark/1';

/**
 * The three benchmark arms. A = pure host (no kit), B = Compozy (competitor
 * snapshot), C = ContextDevKit. Each arm key maps to a human label.
 * @type {Readonly<{[arm: string]: string}>}
 */
export const ARMS = Object.freeze({
  A: 'pure-host',
  B: 'compozy',
  C: 'contextdevkit',
});

/**
 * Arms run in the PILOT phase: A-vs-C only. Compozy (B) is deferred to the full
 * run (panel M6) — the pilot validates harness + QA + budget cheaply.
 * @type {Readonly<string[]>}
 */
export const PILOT_ARMS = Object.freeze(['A', 'C']);

/**
 * Controls held equal across arms (benchmark-plan §"Controls held equal").
 * Cold/warm cache is measured SEPARATELY (see CACHE_WARMTH) — intentionally
 * not in this set so each warmth tier is its own measurement stratum.
 * @type {Readonly<string[]>}
 */
export const CONTROLS_HELD_EQUAL = Object.freeze([
  'repo', 'commit', 'task', 'model', 'host', 'reasoningLevel',
  'secretsTools', 'acceptanceCriteria', 'infra', 'timeLimit',
  'retryPolicy', 'initialState',
]);

/**
 * Valid cache-warmth tiers. Cold and warm runs are SEPARATE measurement strata
 * so that cache acceleration cannot be mistaken for arm-level effect (§13.3).
 * 'unknown' is the honest default when the operator cannot confirm warmth.
 * @type {Readonly<string[]>}
 */
export const CACHE_WARMTH = Object.freeze(['cold', 'warm', 'unknown']);

/**
 * Minimum repetitions per arm × task cell for the pilot (§13.3 panel hardening).
 * The pilot design requires ≥3 reps per cell; this constant is exported so the
 * run harness and selfchecks share the same floor.
 * @type {number}
 */
export const MIN_REPS_PER_CELL = 3;

/** Required control fields a run spec MUST carry — absence → skipped(). */
const REQUIRED_CONTROLS = Object.freeze(['repo', 'commit', 'task', 'model', 'host']);

/**
 * Stratified task types (benchmark-plan §"Task strata"). A pilot draws a small
 * subset; the full run covers the strata sized by the power calculation.
 * @type {Readonly<string[]>}
 */
export const TASK_STRATA = Object.freeze([
  'small-bug', 'medium-bug', 'small-feature', 'medium-feature', 'refactor',
  'docs', 'tests', 'architectural', 'security', 'multi-file',
]);

/**
 * Benchmark phases in order (benchmark-plan §Phases).
 * @type {Readonly<string[]>}
 */
export const BENCHMARK_PHASES = Object.freeze(['pilot', 'calibration', 'full', 'continuous']);

/**
 * Multiplier targets by phase (targets, not claims — ADR-0080).
 * @type {Readonly<{pilot: number, full: number, potential: number}>}
 */
export const BENCHMARK_TARGETS = Object.freeze({ pilot: 1.30, full: 1.50, potential: 1.70 });

const TARGETS_NOTE =
  'Targets (pilot 1.30×, full 1.50×, potential 1.70×) are design targets, not ' +
  'measured claims. No causal claim ships before #176 baseline + a powered run ' +
  '(#243). claim stays null until then (ADR-0080 evidence-tier policy).';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Non-empty string → trimmed value; else null. */
function str(value) {
  return (typeof value === 'string' && value.trim().length > 0) ? value.trim() : null;
}

/** Collects the names of REQUIRED_CONTROLS that are missing/invalid in `input`. */
function missingControls(input) {
  const source = (input !== null && typeof input === 'object') ? input : {};
  return REQUIRED_CONTROLS.filter((key) => str(source[key]) === null);
}

/** Validates an arm key against ARMS; returns the key or null. */
function arm(value) {
  const key = str(value);
  return (key !== null && Object.prototype.hasOwnProperty.call(ARMS, key)) ? key : null;
}

/** Returns the subset of `requested` arms that are valid, preserving order. */
function validArms(requested) {
  if (!Array.isArray(requested)) return [];
  const seen = new Set();
  const result = [];
  for (const candidate of requested) {
    const key = arm(candidate);
    if (key !== null && !seen.has(key)) { seen.add(key); result.push(key); }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exported builders
// ---------------------------------------------------------------------------

/**
 * Builds a frozen, pre-registered benchmark run spec. Returns skipped() when a
 * required control is missing or no valid arm is requested. The spec records the
 * controls held equal, the task stratum, cache warmth tier, minimum repetitions,
 * and maximum budget ceiling, but executes nothing.
 *
 * `capturedAt` is null unless opts.now (epoch ms) is injected (deterministic).
 *
 * @param {{ repo?: unknown, commit?: unknown, task?: unknown, model?: unknown,
 *   host?: unknown, arms?: unknown, stratum?: unknown, reasoningLevel?: unknown,
 *   acceptanceCriteria?: unknown, timeLimitSec?: unknown, retryPolicy?: unknown,
 *   cacheWarmth?: unknown, minReps?: unknown, maxBudgetUsd?: unknown }} input
 * @param {{ now?: number }} [opts] - epoch ms injected by caller; never internal Date.
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function buildRunSpec(input, opts = {}) {
  const missing = missingControls(input);
  if (missing.length > 0) {
    return skipped('missing required controls: ' + missing.join(', '));
  }
  const arms = validArms(input?.arms);
  if (arms.length === 0) {
    return skipped('no valid arms requested (expected a subset of A/B/C)');
  }

  const rawStratum = str(input?.stratum);
  const stratum = (rawStratum !== null && TASK_STRATA.includes(rawStratum)) ? rawStratum : null;

  const nowVal = opts?.now;
  const capturedAt = (typeof nowVal === 'number' && Number.isFinite(nowVal)) ? nowVal : null;

  // Cold/warm cache separation (§13.3 item 9): warmth tier defaults to 'unknown'
  // when not supplied — never silently assume cold or warm.
  const rawWarmth = str(input?.cacheWarmth);
  const cacheWarmth = (rawWarmth !== null && CACHE_WARMTH.includes(rawWarmth)) ? rawWarmth : 'unknown';

  // Minimum repetitions per cell (§13.3 item 10: ≥3). Callers may raise the
  // floor; they may not lower it below MIN_REPS_PER_CELL.
  const inputReps = input?.minReps;
  const minReps = (typeof inputReps === 'number' && Number.isFinite(inputReps) && inputReps >= MIN_REPS_PER_CELL)
    ? Math.floor(inputReps)
    : MIN_REPS_PER_CELL;

  // Maximum budget ceiling (§13.3 item 12): required for the paid-run gate.
  // null when not supplied — the harness may run in mock mode without a budget.
  const inputBudget = input?.maxBudgetUsd;
  const maxBudgetUsd = (typeof inputBudget === 'number' && Number.isFinite(inputBudget) && inputBudget > 0)
    ? inputBudget
    : null;

  return Object.freeze({
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    repo:   str(input?.repo),
    commit: str(input?.commit),
    task:   str(input?.task),
    model:  str(input?.model),
    host:   str(input?.host),
    arms,
    stratum,
    cacheWarmth,
    minReps,
    maxBudgetUsd,
    reasoningLevel:     str(input?.reasoningLevel),
    acceptanceCriteria: str(input?.acceptanceCriteria),
    timeLimitSec: (typeof input?.timeLimitSec === 'number' && input.timeLimitSec > 0) ? input.timeLimitSec : null,
    retryPolicy:  str(input?.retryPolicy),
    controlsHeldEqual: CONTROLS_HELD_EQUAL,
    targets: BENCHMARK_TARGETS,
    capturedAt,
    note: TARGETS_NOTE,
  });
}

/**
 * Convenience wrapper for the PILOT phase: forces arms to A-vs-C (PILOT_ARMS),
 * ignoring any caller-supplied arms (Compozy/B is deferred — panel M6).
 *
 * @param {object} input - same controls as buildRunSpec (arms is overridden).
 * @param {{ now?: number }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function pilotSpec(input, opts = {}) {
  const source = (input !== null && typeof input === 'object') ? input : {};
  return buildRunSpec({ ...source, arms: [...PILOT_ARMS] }, opts);
}

/**
 * Deterministic cell-ordering for the pilot (§13.3 item 11 — no Math.random()).
 *
 * Produces a shuffled ordering of arm × task × rep cells using a seeded linear
 * congruential generator (LCG). The same seed always yields the same order, so
 * the run sequence is reproducible and pre-registerable. Callers must inject the
 * seed; the module never reads Date.now() or Math.random().
 *
 * Each returned cell is `{ arm, task, rep, cacheWarmth }` where:
 *   - arm: an arm key from ARMS
 *   - task: the task identifier (string)
 *   - rep: 1-based repetition index
 *   - cacheWarmth: 'cold' | 'warm' | 'unknown'
 *
 * @param {string[]} arms - Arms to include (must be a subset of Object.keys(ARMS)).
 * @param {string[]} tasks - Task identifiers (non-empty strings).
 * @param {number} reps - Number of repetitions per cell (must be ≥ MIN_REPS_PER_CELL).
 * @param {number} seed - Integer seed for the LCG (must be a finite integer).
 * @param {string} [cacheWarmth] - 'cold' | 'warm' | 'unknown' (default 'unknown').
 * @returns {Readonly<Array<Readonly<{arm:string, task:string, rep:number, cacheWarmth:string}>>>}
 * @throws {TypeError} When arms/tasks are empty, reps < MIN_REPS_PER_CELL, or seed is invalid.
 */
export function shuffleCells(arms, tasks, reps, seed, cacheWarmth = 'unknown') {
  if (!Array.isArray(arms) || arms.length === 0) {
    throw new TypeError('shuffleCells: arms must be a non-empty array');
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new TypeError('shuffleCells: tasks must be a non-empty array');
  }
  if (typeof reps !== 'number' || !Number.isFinite(reps) || reps < MIN_REPS_PER_CELL) {
    throw new TypeError(`shuffleCells: reps must be a finite number >= ${MIN_REPS_PER_CELL}`);
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new TypeError('shuffleCells: seed must be a finite integer');
  }

  const warmth = CACHE_WARMTH.includes(cacheWarmth) ? cacheWarmth : 'unknown';
  const repFloor = Math.floor(reps);

  // Build the full Cartesian product: arm × task × rep
  const cells = [];
  for (const armKey of arms) {
    for (const task of tasks) {
      for (let rep = 1; rep <= repFloor; rep++) {
        cells.push(Object.freeze({ arm: armKey, task, rep, cacheWarmth: warmth }));
      }
    }
  }

  // Fisher-Yates shuffle using a seeded LCG (Knuth multiplicative — no built-ins).
  // Constants: a=1664525, c=1013904223, m=2^32 (Numerical Recipes).
  let state = (seed >>> 0); // coerce to unsigned 32-bit
  const lcgNext = () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state;
  };

  for (let i = cells.length - 1; i > 0; i--) {
    const j = lcgNext() % (i + 1);
    const temp = cells[i];
    cells[i] = cells[j];
    cells[j] = temp;
  }

  return Object.freeze(cells);
}
