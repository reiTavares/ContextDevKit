/**
 * Structured result contracts + ingestion for the universal wave workflow
 * engine (ADR-0101 §9, WF0035, spec §Contracts). Three result shapes flow out
 * of a wave run: per-agent results, the wave-level rollup, and gate verdicts.
 * This module is the single source of truth for their shape and persistence.
 *
 * Validation is pure and total (never throws on a bad object — it reports
 * `{valid, errors[]}`), so callers can surface every problem at once. Only the
 * persisting helpers throw, and only on a refused (invalid) write — default to
 * refuse (constitution §8): a malformed result never reaches disk.
 *
 * Zero runtime dependencies — `node:*` + the shared `io.mjs` only (ADR-0001).
 * Timestamps are injected by the caller (`now`), never generated here, so the
 * pure core stays deterministic (spec §Contracts: "timestamps are passed in").
 */
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { readJsonSafe, writeJsonStable } from './io.mjs';

/** @typedef {{ valid: boolean, errors: string[] }} ValidationResult */

const isString = (candidate) => typeof candidate === 'string';
const isNonEmptyString = (candidate) => isString(candidate) && candidate.length > 0;
const isStringArray = (candidate) =>
  Array.isArray(candidate) && candidate.every((entry) => isString(entry));
const AGENT_STATUS = new Set(['done', 'deferred', 'failed', 'blocked']);

/**
 * Append a typed error when `predicate` fails, keeping validators flat and
 * scannable. Mutates `errors` in place; returns nothing.
 * @param {string[]} errors accumulator
 * @param {boolean} predicate condition that must hold
 * @param {string} message error text when it does not
 */
function require_(errors, predicate, message) {
  if (!predicate) errors.push(message);
}

/**
 * Validate an agent result object against the spec §Contracts shape. Total:
 * collects every problem instead of failing on the first.
 * @param {unknown} candidate object to validate
 * @returns {ValidationResult}
 */
export function validateAgentResult(candidate) {
  const errors = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['agent result must be an object'] };
  }
  const result = /** @type {Record<string, unknown>} */ (candidate);
  require_(errors, isNonEmptyString(result.taskId), 'taskId must be a non-empty string');
  require_(errors, isNonEmptyString(result.waveId), 'waveId must be a non-empty string');
  require_(errors, AGENT_STATUS.has(result.status), `status must be one of ${[...AGENT_STATUS].join('|')}`);
  require_(errors, isString(result.branch), 'branch must be a string');
  require_(errors, isString(result.worktree), 'worktree must be a string');
  require_(errors, isString(result.commit), 'commit must be a string');
  require_(errors, isStringArray(result.filesCreated), 'filesCreated must be a string[]');
  require_(errors, isStringArray(result.filesModified), 'filesModified must be a string[]');
  require_(errors, isStringArray(result.filesDeleted), 'filesDeleted must be a string[]');
  require_(errors, Array.isArray(result.tests), 'tests must be an array');
  require_(errors, Array.isArray(result.exitCodes), 'exitCodes must be an array');
  require_(errors, isStringArray(result.acceptanceMet), 'acceptanceMet must be a string[]');
  require_(errors, isStringArray(result.acceptanceNotMet), 'acceptanceNotMet must be a string[]');
  require_(errors, Array.isArray(result.risks), 'risks must be an array');
  require_(errors, isString(result.integrationNotes), 'integrationNotes must be a string');
  require_(errors, isNonEmptyString(result.timestamp), 'timestamp must be a non-empty string');
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a wave-level rollup result (spec §Contracts).
 * @param {unknown} candidate object to validate
 * @returns {ValidationResult}
 */
export function validateWaveResult(candidate) {
  const errors = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['wave result must be an object'] };
  }
  const result = /** @type {Record<string, unknown>} */ (candidate);
  require_(errors, isNonEmptyString(result.waveId), 'waveId must be a non-empty string');
  require_(errors, isStringArray(result.completedTasks), 'completedTasks must be a string[]');
  require_(errors, isStringArray(result.deferredTasks), 'deferredTasks must be a string[]');
  require_(errors, Array.isArray(result.agentResults), 'agentResults must be an array');
  require_(errors, isString(result.integrationCommit), 'integrationCommit must be a string');
  require_(errors, Array.isArray(result.carryForwards), 'carryForwards must be an array');
  require_(errors, Array.isArray(result.openRisks), 'openRisks must be an array');
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a gate result object (spec §Contracts). The `humanApproval` envelope
 * must carry `required` plus nullable `approver`/`timestamp` — never an inferred
 * approval. `revision` ties the verdict to a plan/state revision (staleness).
 * @param {unknown} candidate object to validate
 * @returns {ValidationResult}
 */
export function validateGateResult(candidate) {
  const errors = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['gate result must be an object'] };
  }
  const result = /** @type {Record<string, unknown>} */ (candidate);
  require_(errors, isNonEmptyString(result.gateId), 'gateId must be a non-empty string');
  require_(errors, isNonEmptyString(result.status), 'status must be a non-empty string');
  require_(errors, Array.isArray(result.requirements), 'requirements must be an array');
  require_(errors, Array.isArray(result.evidence), 'evidence must be an array');
  const approval = result.humanApproval;
  if (approval === null || typeof approval !== 'object' || Array.isArray(approval)) {
    errors.push('humanApproval must be an object');
  } else {
    const envelope = /** @type {Record<string, unknown>} */ (approval);
    require_(errors, typeof envelope.required === 'boolean', 'humanApproval.required must be a boolean');
    require_(errors, envelope.approver === null || isString(envelope.approver), 'humanApproval.approver must be a string or null');
    require_(errors, envelope.timestamp === null || isString(envelope.timestamp), 'humanApproval.timestamp must be a string or null');
  }
  require_(errors, Number.isInteger(result.revision), 'revision must be an integer');
  return { valid: errors.length === 0, errors };
}

/** Directory holding per-agent result files inside a pack. */
const agentsDir = (packDir) => join(packDir, 'reports', 'agents');

/**
 * Validate and persist an agent result to `reports/agents/<taskId>.json` via
 * the atomic stable writer. Refuses (throws) on an invalid result — default to
 * refuse (constitution §8): a malformed result never reaches disk.
 * @param {string} packDir workflow pack root
 * @param {object} result agent result (timestamp may be filled from `now`)
 * @param {{ now: string }} opts injected timestamp source
 * @returns {string} the path written
 * @throws {Error} when the result is invalid
 */
export function recordAgentResult(packDir, result, { now } = {}) {
  if (!isNonEmptyString(now)) {
    throw new Error('recordAgentResult: `now` (ISO timestamp) must be injected');
  }
  const stamped = { ...result, timestamp: isNonEmptyString(result?.timestamp) ? result.timestamp : now };
  const { valid, errors } = validateAgentResult(stamped);
  if (!valid) {
    throw new Error(`recordAgentResult: invalid agent result — ${errors.join('; ')}`);
  }
  const path = join(agentsDir(packDir), `${stamped.taskId}.json`);
  writeJsonStable(path, stamped);
  return path;
}

/**
 * Read a previously recorded agent result, or null when absent.
 * @param {string} packDir workflow pack root
 * @param {string} taskId task id (file stem)
 * @returns {object|null}
 */
export function readAgentResult(packDir, taskId) {
  return readJsonSafe(join(agentsDir(packDir), `${taskId}.json`), null);
}

/**
 * List every recorded agent result, sorted by taskId for stable output.
 * @param {string} packDir workflow pack root
 * @returns {object[]}
 */
export function listAgentResults(packDir) {
  const dir = agentsDir(packDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJsonSafe(join(dir, name), null))
    .filter((entry) => entry !== null);
}
