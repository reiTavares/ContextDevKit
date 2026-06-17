/**
 * Gate evaluation + explicit human approval for the universal wave workflow
 * engine (ADR-0100 §9, WF0035, spec §Contracts). Gates are first-class: a wave
 * cannot close while its gate is incomplete, and **human approval is never
 * inferred** — it is recorded explicitly by a named approver or it does not
 * exist.
 *
 * Two gate types:
 *   - `machine` — passes only when ctx satisfies EVERY requirement. Pure,
 *     deterministic, derived from facts (tasks done, tests green, reports
 *     present, commit present, integration done, …).
 *   - `human`   — ALWAYS `pending` when evaluated from ctx. It can only become
 *     approved through `approveGate`, which demands a named approver. This is
 *     the critical safety property (default-refuse, constitution §8): no ctx
 *     fact, however complete, can auto-pass a human gate.
 *
 * A recorded gate verdict is bound to a plan/state `revision`; a stored
 * approval whose revision no longer matches the live revision is STALE and is
 * not treated as passed (spec acceptance: "stale evidence ⇒ not passed").
 *
 * Zero runtime dependencies — `node:*` + shared `io.mjs` only (ADR-0001).
 * Timestamps are injected (`now`); none are generated here.
 */
import { join } from 'node:path';
import { readJsonSafe, writeJsonStable } from './io.mjs';

/**
 * Map each known machine requirement to the ctx predicate that proves it. A
 * requirement absent from this table is treated as UNPROVABLE (never met), so
 * an unknown requirement fails closed rather than silently passing.
 * @param {string} requirement requirement name from the gate
 * @param {Record<string, unknown>} ctx evaluated facts
 * @returns {{ met: boolean, evidence: string }}
 */
function evaluateMachineRequirement(requirement, ctx) {
  const taskStatuses = ctx.taskStatuses && typeof ctx.taskStatuses === 'object' ? ctx.taskStatuses : {};
  const allTasksDone = Object.values(taskStatuses).length > 0 &&
    Object.values(taskStatuses).every((status) => status === 'done');
  switch (requirement) {
    case 'tasks-completed':
      return { met: allTasksDone, evidence: `taskStatuses=${JSON.stringify(taskStatuses)}` };
    case 'tests-green':
      return { met: ctx.testsGreen === true, evidence: `testsGreen=${ctx.testsGreen === true}` };
    case 'ci-green':
      return { met: ctx.ciGreen === true, evidence: `ciGreen=${ctx.ciGreen === true}` };
    case 'reports-present':
      return { met: ctx.reportsPresent === true, evidence: `reportsPresent=${ctx.reportsPresent === true}` };
    case 'commit-present':
      return { met: ctx.commitPresent === true, evidence: `commitPresent=${ctx.commitPresent === true}` };
    case 'integration-done':
      return { met: ctx.integrationDone === true, evidence: `integrationDone=${ctx.integrationDone === true}` };
    default: {
      const flags = ctx.requirementFlags && typeof ctx.requirementFlags === 'object' ? ctx.requirementFlags : {};
      const met = flags[requirement] === true;
      return { met, evidence: `requirementFlags.${requirement}=${met}` };
    }
  }
}

/**
 * Evaluate a gate against ctx WITHOUT consulting any recorded approval. A
 * machine gate passes only when all requirements are met; a human gate is
 * always `pending` here — it cannot auto-pass from ctx (critical safety
 * property). Pure and deterministic.
 * @param {{ id: string, type: 'machine'|'human', requirements?: string[] }} gate
 * @param {Record<string, unknown>} [ctx] facts to evaluate against
 * @returns {{ gateId: string, status: 'passed'|'failed'|'pending', requirements: Array<{ name: string, met: boolean, evidence: string }>, humanApproval: { required: boolean, approver: string|null, timestamp: string|null }, revision: number }}
 */
export function evaluateGate(gate, ctx = {}) {
  if (!gate || typeof gate.id !== 'string' || gate.id.length === 0) {
    throw new Error('evaluateGate: gate.id must be a non-empty string');
  }
  if (gate.type !== 'machine' && gate.type !== 'human') {
    throw new Error(`evaluateGate: gate.type must be machine|human (got "${gate.type}")`);
  }
  const requirementNames = Array.isArray(gate.requirements) ? gate.requirements : [];
  const requirements = requirementNames.map((name) => {
    const { met, evidence } = evaluateMachineRequirement(name, ctx);
    return { name, met, evidence };
  });
  const revision = Number.isInteger(ctx.revision) ? ctx.revision : 0;

  if (gate.type === 'human') {
    // Human gates NEVER auto-pass from ctx — explicit approval only.
    return {
      gateId: gate.id,
      status: 'pending',
      requirements,
      humanApproval: { required: true, approver: null, timestamp: null },
      revision,
    };
  }

  const allMet = requirements.length > 0 && requirements.every((entry) => entry.met);
  return {
    gateId: gate.id,
    status: allMet ? 'passed' : 'failed',
    requirements,
    humanApproval: { required: false, approver: null, timestamp: null },
    revision,
  };
}

/** Directory holding per-gate result files inside a pack. */
const gatesDir = (packDir) => join(packDir, 'reports', 'gates');

/**
 * Record an EXPLICIT human approval to `reports/gates/<gateId>.json`. Demands a
 * named approver — there is no inferred or anonymous approval (default-refuse,
 * constitution §8). The verdict is bound to `revision` so a later revision can
 * detect staleness.
 * @param {string} packDir workflow pack root
 * @param {string} gateId gate id (file stem)
 * @param {{ approver: string, evidence?: string[], now: string, revision?: number }} opts
 * @returns {string} the path written
 * @throws {Error} when approver or now is missing/empty
 */
export function approveGate(packDir, gateId, { approver, evidence = [], now, revision = 0 } = {}) {
  if (typeof gateId !== 'string' || gateId.length === 0) {
    throw new Error('approveGate: gateId must be a non-empty string');
  }
  if (typeof approver !== 'string' || approver.trim().length === 0) {
    throw new Error('approveGate: a named approver is required — approval is never inferred');
  }
  if (typeof now !== 'string' || now.length === 0) {
    throw new Error('approveGate: `now` (ISO timestamp) must be injected');
  }
  const result = {
    gateId,
    status: 'approved',
    requirements: [],
    evidence: Array.isArray(evidence) ? evidence : [],
    humanApproval: { required: true, approver, timestamp: now },
    revision: Number.isInteger(revision) ? revision : 0,
  };
  const path = join(gatesDir(packDir), `${gateId}.json`);
  writeJsonStable(path, result);
  return path;
}

/**
 * Read a recorded gate verdict, or null when none exists. When `expectedRevision`
 * is provided, a verdict whose revision differs is STALE: its status is masked
 * to `stale` so callers never treat missing/stale evidence as passed (spec
 * acceptance). The raw stored revision is preserved for diagnostics.
 * @param {string} packDir workflow pack root
 * @param {string} gateId gate id
 * @param {{ expectedRevision?: number }} [opts]
 * @returns {object|null} the verdict (status `stale` when revision mismatches), or null
 */
export function readGateResult(packDir, gateId, { expectedRevision } = {}) {
  const stored = readJsonSafe(join(gatesDir(packDir), `${gateId}.json`), null);
  if (stored === null) return null;
  if (Number.isInteger(expectedRevision) && stored.revision !== expectedRevision) {
    return { ...stored, status: 'stale', staleAgainst: expectedRevision };
  }
  return stored;
}
