/**
 * spawn-record.mjs — the §17 subagent spawn-record evidence bridge (ADR-0128
 * §17, WF-0065). Answers the evidence-ruling question: which REQUIRED agents
 * actually ran? An agent named in a prompt never counts — only a real spawn
 * record PLUS a recorded completion satisfies the requirement.
 *
 * Reuses the EXISTING subagent spawn substrate at
 * `<pipeline>/state/<taskId>/subagents/*.json` (written by `subagent-gate.mjs`
 * on the spawn moment) — no second recorder. This module adds the missing
 * §17 layer: the completion stamp (`recordSpawnStop`), the PURE planned-vs-
 * dispatched-vs-completed comparator (`compareSpawn`, the testable heart) and a
 * standalone §17 writer (`recordSpawn`) for tests and hosts with a native
 * SubagentStart event.
 *
 * Every write is defensive + fail-open (immutable rule 2): a refused write
 * returns a reason code, never throws, never a false completion.
 *
 * Zero runtime dependencies beyond `node:*` + sibling runtime primitives.
 *
 * @module domain-engineering/spawn-record
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';
import { pathsFor } from '../config/paths.mjs';

/** Spawn-record schema version — bump on any breaking shape change (§17). */
export const SPAWN_RECORD_SCHEMA_VERSION = 1;

/** Absolute dir holding a task's subagent spawn records (the shared substrate). */
function subagentsDirFor(root, taskId) {
  return join(pathsFor(root).pipeline, 'state', String(taskId), 'subagents');
}

/**
 * Reads every spawn record for a task. Defensive — a missing dir or an
 * unparseable file yields [] / is skipped, never throws.
 *
 * @param {string} root project root.
 * @param {string} taskId governing task id.
 * @returns {object[]} the spawn records (each carries at least `label`).
 */
export function readSpawnRecords(root, taskId) {
  let names;
  try {
    names = readdirSync(subagentsDirFor(root, taskId)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const record = readJsonSafe(join(subagentsDirFor(root, taskId), name), null);
    if (record && typeof record === 'object') out.push(record);
  }
  return out;
}

/**
 * Records a §17 spawn: a real dispatch of `agent` for `taskId`, optionally linked
 * to the governing Implementation Packet. Standalone writer for tests + hosts
 * with a native SubagentStart (Claude Code's `subagent-gate` writes the base
 * record on PreToolUse instead). Defensive — never throws.
 *
 * @param {string} root project root.
 * @param {object} params
 * @param {string} params.taskId governing task id.
 * @param {string} params.agent dispatched agent label.
 * @param {string} [params.packetId] governing Implementation Packet id (WF-0067
 *   persists packets; null in shadow — the LINK mechanism ships here).
 * @param {string} [params.spawnId] deterministic id (tests inject).
 * @param {number} [params.at] createdAt (tests inject).
 * @returns {{ record?: object, persisted: boolean, reasonCode: string }}
 */
export function recordSpawn(root, { taskId, agent, packetId = null, spawnId, at } = {}) {
  if (!isNonEmptyString(taskId) || !isNonEmptyString(agent)) {
    return { persisted: false, reasonCode: 'SPAWN_INVALID_INPUT' };
  }
  const id = isNonEmptyString(spawnId) ? spawnId : `${sanitize(agent)}-${typeof at === 'number' ? at : Date.now()}`;
  const record = {
    schemaVersion: SPAWN_RECORD_SCHEMA_VERSION,
    spawnId: id,
    taskId,
    label: agent,
    packetId: isNonEmptyString(packetId) ? packetId : null,
    completedAt: null,
    receiptRef: null,
    createdAt: typeof at === 'number' ? at : Date.now(),
  };
  try {
    mkdirSync(subagentsDirFor(root, taskId), { recursive: true });
    writeFileAtomicSync(join(subagentsDirFor(root, taskId), `${id}.json`), JSON.stringify(record, null, 2));
    return { record, persisted: true, reasonCode: 'SPAWN_RECORDED' };
  } catch {
    return { record, persisted: false, reasonCode: 'SPAWN_WRITE_FAILED' };
  }
}

/**
 * Stamps completion on a spawn record — the §17 evidence that a dispatched agent
 * actually finished. Matches by `spawnId`, else the latest un-completed record
 * for `agent`. Additive (preserves the record's other fields), fail-open.
 *
 * @param {string} root project root.
 * @param {object} params
 * @param {string} params.taskId governing task id.
 * @param {string} [params.agent] agent label (used when spawnId is absent).
 * @param {string} [params.spawnId] exact record id.
 * @param {string} [params.receiptRef] link to the real artifact (agent-result /
 *   skill-receipt) — never a planned value treated as proof.
 * @param {number} [params.at] completedAt (tests inject).
 * @returns {{ record?: object, persisted: boolean, reasonCode: string }}
 */
export function recordSpawnStop(root, { taskId, agent, spawnId, receiptRef = null, at } = {}) {
  if (!isNonEmptyString(taskId)) return { persisted: false, reasonCode: 'SPAWN_INVALID_INPUT' };
  const target = pickTarget(readSpawnRecords(root, taskId), { spawnId, agent });
  if (!target) return { persisted: false, reasonCode: 'SPAWN_NO_MATCH' };
  const stamped = {
    ...target,
    completedAt: typeof at === 'number' ? at : Date.now(),
    receiptRef: isNonEmptyString(receiptRef) ? receiptRef : (target.receiptRef ?? null),
  };
  try {
    mkdirSync(subagentsDirFor(root, taskId), { recursive: true });
    writeFileAtomicSync(join(subagentsDirFor(root, taskId), `${target.spawnId}.json`), JSON.stringify(stamped, null, 2));
    return { record: stamped, persisted: true, reasonCode: 'SPAWN_COMPLETED' };
  } catch {
    return { persisted: false, reasonCode: 'SPAWN_WRITE_FAILED' };
  }
}

/** Distinct agent labels that were dispatched (a spawn record exists). */
export function dispatchedAgents(records) {
  return uniq(asArray(records).map((r) => r?.label).filter(isNonEmptyString));
}

/** Distinct agent labels that recorded completion (`completedAt` stamped). */
export function completedAgents(records) {
  return uniq(asArray(records).filter((r) => r?.completedAt).map((r) => r.label).filter(isNonEmptyString));
}

/**
 * PURE planned-vs-dispatched-vs-completed comparator (the §17 testable heart).
 * `satisfied` is true only when EVERY planned agent recorded a completion — an
 * agent merely named (planned) or merely dispatched never counts.
 *
 * @param {object} params
 * @param {string[]} [params.planned] required agents (from the packet/profile).
 * @param {string[]} [params.dispatched] agents with a spawn record.
 * @param {string[]} [params.completed] agents with a recorded completion.
 * @returns {{ plannedNotDispatched: string[], dispatchedNotCompleted: string[],
 *   completed: string[], extraneous: string[], satisfied: boolean, reasonCodes: string[] }}
 */
export function compareSpawn({ planned = [], dispatched = [], completed = [] } = {}) {
  const plannedSet = new Set(asList(planned));
  const dispatchedSet = new Set(asList(dispatched));
  const completedSet = new Set(asList(completed));
  const plannedNotDispatched = [...plannedSet].filter((a) => !dispatchedSet.has(a));
  const dispatchedNotCompleted = [...dispatchedSet].filter((a) => !completedSet.has(a));
  const completedPlanned = [...plannedSet].filter((a) => completedSet.has(a));
  const extraneous = [...dispatchedSet].filter((a) => !plannedSet.has(a));
  const satisfied = [...plannedSet].every((a) => completedSet.has(a));

  const reasonCodes = [];
  if (plannedNotDispatched.length > 0) reasonCodes.push('SPAWN_PLANNED_NOT_DISPATCHED');
  if (dispatchedNotCompleted.length > 0) reasonCodes.push('SPAWN_DISPATCHED_NOT_COMPLETED');
  if (extraneous.length > 0) reasonCodes.push('SPAWN_EXTRANEOUS_DISPATCH');
  reasonCodes.push(satisfied ? 'SPAWN_SATISFIED' : 'SPAWN_UNSATISFIED');

  return { plannedNotDispatched, dispatchedNotCompleted, completed: completedPlanned, extraneous, satisfied, reasonCodes };
}

/**
 * Convenience: reads the task's records and compares them against `planned`.
 * The integration entry the lifecycle hooks + PreCompact continuity use.
 *
 * @param {string} root project root.
 * @param {string} taskId governing task id.
 * @param {string[]} planned required agents (from the packet/profile).
 * @returns {ReturnType<typeof compareSpawn>}
 */
export function summarizeSpawnEvidence(root, taskId, planned) {
  const records = readSpawnRecords(root, taskId);
  return compareSpawn({ planned, dispatched: dispatchedAgents(records), completed: completedAgents(records) });
}

/**
 * Resolves the record to stamp: an exact `spawnId` match wins; else scope to the
 * `agent` label when given (else all records) and take the latest un-completed
 * one (fallback: the latest overall). The no-identifier path mirrors the existing
 * `subagent-gate.loadLatestSpawnRecord` heuristic for a SubagentStop event that
 * does not carry the agent label.
 */
function pickTarget(records, { spawnId, agent }) {
  if (isNonEmptyString(spawnId)) return records.find((r) => r.spawnId === spawnId) || null;
  const scoped = isNonEmptyString(agent) ? records.filter((r) => r.label === agent) : records;
  const open = scoped.filter((r) => !r.completedAt);
  const pool = open.length > 0 ? open : scoped;
  return pool.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

/** Filters an unknown value to a string[] (drops non-strings). */
function asList(value) {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

/** Coerces to an array, else []. */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Distinct entries, first-seen order. */
function uniq(list) {
  return [...new Set(list)];
}

/** True for a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** Filesystem-safe token for a spawn id. */
function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}
