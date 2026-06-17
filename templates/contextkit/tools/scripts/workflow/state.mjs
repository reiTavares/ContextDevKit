/**
 * Machine-owned execution state for the universal wave workflow engine
 * (`workflow-state.json`, ADR-0100 §State, WF0035). State is NEVER hand-edited:
 * only the mutators in this module produce the next revision. Every accepted
 * write increments `revision` monotonically; a stale `expectedRevision` or a
 * `planHash` mismatch is a typed refusal (fail-fast, ADR §8 "default to refuse").
 *
 * Determinism: timestamps are INJECTED by the caller (`now`), never generated
 * here — `new Date()`/`Date.now()`/`Math.random()` are deliberately absent so a
 * resumed run reproduces byte-identical state. Persistence is atomic +
 * write-if-changed via `io.writeJsonStable`, so re-writing equal state is a
 * no-op (no mtime churn). Zero runtime dependencies — `node:*` only (ADR-0001).
 */
import { readJsonSafe, writeJsonStable } from './io.mjs';

/** Current state schema version. Bump only with a migration + ADR. */
export const STATE_SCHEMA_VERSION = 1;

/**
 * Typed error for a refused state mutation (stale write or plan-hash drift), so
 * callers can distinguish a governance refusal from an I/O failure.
 */
export class StateConflictError extends Error {
  /**
   * @param {string} message human-readable refusal reason
   * @param {'stale-revision'|'plan-hash-mismatch'} code machine-readable kind
   */
  constructor(message, code) {
    super(message);
    this.name = 'StateConflictError';
    this.code = code;
  }
}

/**
 * Construct a fresh execution state at `revision: 0`. No timestamp is invented;
 * `now` stamps both `lastUpdate` and the initial creation marker.
 * @param {object} params
 * @param {string} params.workflowId NNNN workflow id (e.g. "0035")
 * @param {string} params.planHash sha-256 of the plan this state tracks
 * @param {string} [params.journeyPhase] ADR-0057 phase (default "intake")
 * @param {string} params.now ISO-8601 timestamp injected by the caller
 * @returns {object} a new, valid `workflow-state.json` value
 * @throws {TypeError} when a required field is missing
 */
export function initState({ workflowId, planHash, journeyPhase = 'intake', now }) {
  if (!workflowId) throw new TypeError('initState: workflowId is required');
  if (!planHash) throw new TypeError('initState: planHash is required');
  if (!now) throw new TypeError('initState: now (ISO timestamp) is required');
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    workflowId,
    planHash,
    revision: 0,
    overallStatus: 'not-started',
    journeyPhase,
    waveStates: {},
    taskStates: {},
    runs: [],
    gateResults: {},
    carryForwards: [],
    integrationRecords: [],
    openBlockers: [],
    events: [],
    lastUpdate: now,
  };
}

/**
 * Read a persisted state, or `null` when the file is absent/unreadable.
 * @param {string} path path to `workflow-state.json`
 * @returns {object|null}
 */
export function readState(path) {
  return readJsonSafe(path, null);
}

/**
 * Guard a mutation against the current state before producing the next one.
 * @param {object} current the state being mutated
 * @param {{ expectedRevision?: number, planHash?: string }} opts guards
 * @throws {TypeError} when `current` is not a state object
 * @throws {StateConflictError} on a stale revision or a plan-hash mismatch
 */
function assertWritable(current, opts) {
  if (!current || typeof current !== 'object') {
    throw new TypeError('applyStateUpdate: current state is required');
  }
  const { expectedRevision, planHash } = opts;
  if (
    expectedRevision !== undefined &&
    expectedRevision !== null &&
    expectedRevision !== current.revision
  ) {
    throw new StateConflictError(
      `stale write: expected revision ${expectedRevision}, but current is ${current.revision}`,
      'stale-revision',
    );
  }
  if (planHash !== undefined && planHash !== null && planHash !== current.planHash) {
    throw new StateConflictError(
      `plan changed: state planHash ${current.planHash} != ${planHash} — reconcile first`,
      'plan-hash-mismatch',
    );
  }
}

/**
 * Produce the NEXT state by merging `patch` over `current`, bumping `revision`
 * by exactly 1 and stamping `lastUpdate = now`. Pure: never mutates `current`.
 * Unknown pre-existing fields are preserved (forward-compat); `patch` shallow-
 * merges at the top level, with `revision`/`lastUpdate` always engine-owned.
 * @param {object} current the current state
 * @param {object} patch top-level fields to merge in
 * @param {object} ctx
 * @param {number} [ctx.expectedRevision] stale-write guard (reject if !== current.revision)
 * @param {string} [ctx.planHash] plan-hash guard (reject if !== current.planHash)
 * @param {string} ctx.now ISO-8601 timestamp injected by the caller
 * @returns {object} the next state at `revision + 1`
 * @throws {TypeError} when inputs are invalid
 * @throws {StateConflictError} on a stale revision or a plan-hash mismatch
 */
export function applyStateUpdate(current, patch, { expectedRevision, planHash, now } = {}) {
  assertWritable(current, { expectedRevision, planHash });
  if (!now) throw new TypeError('applyStateUpdate: now (ISO timestamp) is required');
  if (patch && typeof patch !== 'object') {
    throw new TypeError('applyStateUpdate: patch must be an object');
  }
  return {
    ...current,
    ...(patch || {}),
    revision: current.revision + 1,
    lastUpdate: now,
  };
}

/**
 * Persist a state atomically, only when it differs from disk (no mtime churn).
 * @param {string} path path to `workflow-state.json`
 * @param {object} state the state to write
 * @returns {{ changed: boolean }} whether a write occurred
 */
export function writeState(path, state) {
  return writeJsonStable(path, state);
}

/**
 * Set a wave's status, merging extra fields (e.g. `startedAt`) into its entry.
 * @param {object} state current state
 * @param {string} waveId e.g. "W1"
 * @param {string} status e.g. "in-progress" | "done" | "blocked"
 * @param {object} [opts] applyStateUpdate context + `{ extra }` wave fields
 * @returns {object} the next state
 */
export function setWaveStatus(state, waveId, status, opts = {}) {
  const { extra, ...ctx } = opts;
  const waveStates = { ...state.waveStates, [waveId]: { ...state.waveStates[waveId], ...extra, status } };
  return applyStateUpdate(state, { waveStates }, ctx);
}

/**
 * Set a task's status, merging extra fields (e.g. `resultRef`) into its entry.
 * @param {object} state current state
 * @param {string} taskId e.g. "W1-T2"
 * @param {string} status e.g. "ready" | "in-progress" | "done" | "deferred"
 * @param {object} [opts] applyStateUpdate context + `{ extra }` task fields
 * @returns {object} the next state
 */
export function setTaskStatus(state, taskId, status, opts = {}) {
  const { extra, ...ctx } = opts;
  const taskStates = { ...state.taskStates, [taskId]: { ...state.taskStates[taskId], ...extra, status } };
  return applyStateUpdate(state, { taskStates }, ctx);
}

/**
 * Append a run record to the immutable `runs[]` log.
 * @param {object} state current state
 * @param {object} run the run record (`{ runId, waveId, assignments }`)
 * @param {object} [opts] applyStateUpdate context
 * @returns {object} the next state
 */
export function recordRun(state, run, opts = {}) {
  return applyStateUpdate(state, { runs: [...state.runs, run] }, opts);
}

/**
 * Append a carry-forward to `carryForwards[]`.
 * @param {object} state current state
 * @param {object} carryForward `{ id, fromWave, targetWave, priority, title, status, evidence }`
 * @param {object} [opts] applyStateUpdate context
 * @returns {object} the next state
 */
export function addCarryForward(state, carryForward, opts = {}) {
  return applyStateUpdate(state, { carryForwards: [...state.carryForwards, carryForward] }, opts);
}

/**
 * Append an integration record (a wave's orchestrator-owned merge commit).
 * @param {object} state current state
 * @param {object} record `{ waveId, commit, ... }`
 * @param {object} [opts] applyStateUpdate context
 * @returns {object} the next state
 */
export function recordIntegration(state, record, opts = {}) {
  return applyStateUpdate(state, { integrationRecords: [...state.integrationRecords, record] }, opts);
}

/**
 * Link a gate's result report by reference (the narrative lives in the file).
 * @param {object} state current state
 * @param {string} gateId e.g. "G-W1"
 * @param {string} ref relative path to the gate result report
 * @param {object} [opts] applyStateUpdate context
 * @returns {object} the next state
 */
export function linkGateResult(state, gateId, ref, opts = {}) {
  const gateResults = { ...state.gateResults, [gateId]: ref };
  return applyStateUpdate(state, { gateResults }, opts);
}
