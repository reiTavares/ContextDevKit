/**
 * Benchmark experimental design — EACP Wave 6 / card #242 (EACP-13).
 *
 * The frozen, pre-registered A/B/C design that the pilot harness runs against:
 * arms, controls held equal, task strata, phases, and the run-spec builder.
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
 * Cold/warm cache is measured SEPARATELY and is intentionally not in this set.
 * @type {Readonly<string[]>}
 */
export const CONTROLS_HELD_EQUAL = Object.freeze([
  'repo', 'commit', 'task', 'model', 'host', 'reasoningLevel',
  'secretsTools', 'acceptanceCriteria', 'infra', 'timeLimit',
  'retryPolicy', 'initialState',
]);

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
 * controls held equal and the task stratum but executes nothing.
 *
 * `capturedAt` is null unless opts.now (epoch ms) is injected (deterministic).
 *
 * @param {{ repo?: unknown, commit?: unknown, task?: unknown, model?: unknown,
 *   host?: unknown, arms?: unknown, stratum?: unknown, reasoningLevel?: unknown,
 *   acceptanceCriteria?: unknown, timeLimitSec?: unknown, retryPolicy?: unknown }} input
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

  return Object.freeze({
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    repo:   str(input?.repo),
    commit: str(input?.commit),
    task:   str(input?.task),
    model:  str(input?.model),
    host:   str(input?.host),
    arms,
    stratum,
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
