/**
 * Command glue for the universal wave workflow engine CLI (ADR-0100 §12, WF0035).
 * Orchestrator-owned: keeps `workflow.mjs` a thin dispatcher by holding the
 * load-plan+state → compute → (maybe) update-state flow for the WAVE 2 verbs
 * (next-run, ownership-check, record-agent-result, check-gate, approve-gate,
 * close-wave, refresh-continuation). Pure-engine modules stay pure; this layer
 * is the only place that reads a pack from a slug and writes state back.
 *
 * Zero runtime dependencies beyond `node:*` + the sibling engine modules.
 * Timestamps are injected by the CLI (`now`); none are generated here.
 */
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';
import { readWorkflow } from '../workflow-pack.mjs';
import { readJsonSafe } from './io.mjs';
import { planHash, readPlan } from './plan.mjs';
import { initState, readState, setTaskStatus, setWaveStatus, writeState } from './state.mjs';
import { computeSchedule } from './scheduler.mjs';
import { detectCollisions, validateResultPaths } from './ownership.mjs';
import { approveGate, evaluateGate, readGateResult } from './gates.mjs';
import { recordAgentResult } from './results.mjs';
import { refreshContinuation } from './continuation.mjs';
import { auditWorkflow } from './audit.mjs';
import { migrateApply, migrateDryRun, migrationPlan } from './migrate.mjs';

/** Resolve a workflow pack directory from a slug/number, or throw. */
function resolvePackDir(root, slug) {
  const workflow = readWorkflow(root, slug);
  if (!workflow) throw new Error(`Workflow "${slug}" not found.`);
  return statSync(workflow.path).isDirectory() ? workflow.path : dirname(workflow.path);
}

/**
 * Load a pack's machine contract + state from a slug.
 * @returns {{ packDir: string, planPath: string, statePath: string, plan: object, state: object|null }}
 */
export function loadPack(root, slug) {
  const packDir = resolvePackDir(root, slug);
  const planPath = join(packDir, 'workflow-plan.json');
  const statePath = join(packDir, 'workflow-state.json');
  return { packDir, planPath, statePath, plan: readPlan(planPath), state: readState(statePath) };
}

/** All tasks across all waves, flattened. */
function allTasks(plan) {
  return (plan.waves || []).flatMap((wave) => wave.tasks || []);
}

/** The deterministic next-run dispatch plan (pure scheduler output). */
export function nextRun(root, slug) {
  const { plan, state } = loadPack(root, slug);
  return computeSchedule(plan, state || {});
}

/** Ownership collisions across the plan's agent tasks. */
export function ownershipCheck(root, slug) {
  const { plan } = loadPack(root, slug);
  return detectCollisions(allTasks(plan));
}

/**
 * Ingest an agent result file: validate ownership against the task's lane,
 * persist the result, and advance the task's status in state.
 * @returns {{ resultPath: string, violations: Array<object>, taskId: string }}
 */
export function recordResult(root, slug, file, now) {
  const { packDir, statePath, plan, state } = loadPack(root, slug);
  const result = readJsonSafe(file, null);
  if (!result) throw new Error(`No readable agent result at ${file}`);
  const task = allTasks(plan).find((candidate) => candidate.id === result.taskId);
  const violations = task ? validateResultPaths(task, result).violations : [];
  const resultPath = recordAgentResult(packDir, result, { now });
  let nextState = state || initState({ workflowId: plan.workflowId, planHash: planHash(plan), now });
  const status = result.status === 'success' || result.status === 'done' ? 'done' : 'in-progress';
  nextState = setTaskStatus(nextState, result.taskId, status, { now });
  writeState(statePath, nextState);
  return { resultPath, violations, taskId: result.taskId };
}

/** Build the machine-gate evaluation ctx for one gate from current state. */
function gateContext(plan, state, gate) {
  const wave = (plan.waves || []).find((candidate) => candidate.id === gate.waveId);
  const taskStatuses = {};
  for (const task of (wave && wave.tasks) || []) {
    taskStatuses[task.id] = state?.taskStates?.[task.id]?.status || 'pending';
  }
  return { taskStatuses, revision: state?.revision ?? 0 };
}

/**
 * Evaluate a gate. A recorded explicit approval at the current revision wins
 * over the pending verdict; a stale/absent approval never auto-passes.
 * @returns {object} gate verdict
 */
export function checkGate(root, slug, gateId) {
  const { packDir, plan, state } = loadPack(root, slug);
  const gate = (plan.gates || []).find((candidate) => candidate.id === gateId);
  if (!gate) throw new Error(`Gate "${gateId}" not found in plan.`);
  const verdict = evaluateGate(gate, gateContext(plan, state, gate));
  const recorded = readGateResult(packDir, gateId, { expectedRevision: state?.revision ?? 0 });
  if (recorded && recorded.status === 'approved') {
    return { ...verdict, status: 'approved', humanApproval: recorded.humanApproval };
  }
  return verdict;
}

/** Record an explicit human gate approval (named approver required). */
export function approveGateCmd(root, slug, gateId, { approver, evidenceFile, now }) {
  const { packDir, state } = loadPack(root, slug);
  const evidence = evidenceFile ? [evidenceFile] : [];
  return approveGate(packDir, gateId, { approver, evidence, now, revision: state?.revision ?? 0 });
}

/**
 * Close a wave. `--check` reports readiness; `--apply` marks the wave done only
 * when every task in it is done AND its gate is passed/approved (default-refuse).
 * @returns {{ waveId: string, allTasksDone: boolean, gate: object|null, applied: boolean, blocked: string[] }}
 */
export function closeWave(root, slug, waveId, { apply, now }) {
  const { statePath, plan, state } = loadPack(root, slug);
  const wave = (plan.waves || []).find((candidate) => candidate.id === waveId);
  if (!wave) throw new Error(`Wave "${waveId}" not found in plan.`);
  const tasks = wave.tasks || [];
  const allTasksDone = tasks.length === 0 ||
    tasks.every((task) => (state?.taskStates?.[task.id]?.status) === 'done');
  const gate = wave.gate ? checkGate(root, slug, wave.gate) : null;
  const gatePassed = !gate || gate.status === 'passed' || gate.status === 'approved';
  const blocked = [];
  if (!allTasksDone) blocked.push('tasks-incomplete');
  if (!gatePassed) blocked.push(`gate-${gate.status}`);
  let applied = false;
  if (apply && blocked.length === 0) {
    const nextState = setWaveStatus(state || initState({ workflowId: plan.workflowId, planHash: planHash(plan), now }), waveId, 'done', { now });
    writeState(statePath, nextState);
    applied = true;
  }
  return { waveId, allTasksDone, gate, applied, blocked };
}

/** Regenerate the single CONTINUATION-PROMPT.md from plan + state + schedule. */
export function refreshContinuationCmd(root, slug, { gitFacts, now }) {
  const { packDir, plan, state } = loadPack(root, slug);
  const scheduleOutput = computeSchedule(plan, state || {});
  return refreshContinuation(packDir, { scheduleOutput, gitFacts, now });
}

/** Read-only consistency + redundancy audit of one workflow pack. */
export function auditCmd(root, slug) {
  return auditWorkflow(resolvePackDir(root, slug));
}

/** Non-destructive migration proposal (zero writes) for one workflow pack. */
export function migratePlanCmd(root, slug) {
  return migrationPlan(resolvePackDir(root, slug));
}

/**
 * Migrate a legacy pack. `--dry-run` (default) writes nothing; `--apply` requires
 * an explicit force flag and inserts generated artifacts non-destructively.
 * @returns {object} dry-run preview or the apply receipt
 */
export function migrateCmd(root, slug, { apply, now }) {
  const packDir = resolvePackDir(root, slug);
  return apply ? migrateApply(packDir, { now, force: true }) : migrateDryRun(packDir);
}
