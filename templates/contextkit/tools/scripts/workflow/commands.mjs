/**
 * Command glue for the universal wave workflow engine CLI (ADR-0101 §12, WF0035).
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
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { readWorkflow } from '../workflow-pack.mjs';
import { readJsonSafe, writeJsonStable } from './io.mjs';
import { planHash, readPlan } from './plan.mjs';
import {
  initState,
  linkGateResult,
  readState,
  setTaskStatus,
  setWaveStatus,
  writeState,
} from './state.mjs';
import { computeSchedule } from './scheduler.mjs';
import { detectCollisions, validateResultPaths } from './ownership.mjs';
import { approveGate, evaluateGate, readGateResult, deriveGateFacts, isHumanTask } from './gates.mjs';
import { recordAgentResult, readAgentResult } from './results.mjs';
import { refreshContinuation } from './continuation.mjs';
import { auditWorkflow } from './audit.mjs';
import { migrateApply, migrateDryRun, migrationPlan } from './migrate.mjs';
import { workflowRoots } from '../registry/ids.mjs';
import { parseFrontmatter } from '../workflow-frontmatter.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { concludePack, doneMovePack } from './finalization.mjs';
import { guardPack } from './invariant-guard.mjs';

/** Resolve a workflow pack directory from a slug/number, or throw. */
export function resolvePackDir(root, slug) {
  const workflow = readWorkflow(root, slug);
  if (workflow) return statSync(workflow.path).isDirectory() ? workflow.path : dirname(workflow.path);
  const archived = findArchivedPack(root, slug);
  if (archived) return archived;
  throw new Error(`Workflow "${slug}" not found.`);
}

/** Resolve a concluded pack from the active-only workflow reader's done archives. */
function findArchivedPack(root, slug) {
  for (const holder of workflowRoots(root).filter((candidate) => candidate.replace(/\\/g, '/').endsWith('/done'))) {
    if (!existsSync(holder)) continue;
    let entries = [];
    try { entries = readdirSync(holder, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const candidate = join(holder, entry.name);
      const indexPath = join(candidate, 'index.md');
      if (!existsSync(indexPath)) continue;
      try {
        const parsed = parseFrontmatter(readFileSync(indexPath, 'utf8'));
        const front = parsed?.frontmatter || {};
        if (front.slug === slug || entry.name === slug || `${front.number}-${front.slug}` === slug) return candidate;
      } catch { /* malformed archive entry is not a match */ }
    }
  }
  return null;
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

/** Conclude one resolved workflow pack through the finalization engine. */
export function concludeWorkflow(root, slug, options = {}) {
  return concludePack(root, loadPack(root, slug).packDir, options);
}

/** Move one resolved concluded workflow pack through the finalization engine. */
export function doneMoveWorkflow(root, slug, options = {}) {
  return doneMovePack(root, loadPack(root, slug).packDir, options);
}

/** Run the I1-I10 rollout guard for one resolved workflow pack. */
export function guardWorkflow(root, slug, options = {}) {
  return guardPack(root, loadPack(root, slug), options);
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

/**
 * Build the machine-gate evaluation ctx for one gate. Reads the wave's recorded
 * agent-results from disk (the only I/O here) and delegates the fact derivation
 * to the PURE `deriveGateFacts` in gates.mjs (ADR-0128 evidence ruling: facts
 * are proven by real recorded results, never asserted). Human-mode tasks are
 * excluded from the agent-completion facts — a human task's completion is its
 * gate approval, surfaced via `humanApprovalRecorded`.
 * @param {string} packDir workflow pack root (to read recorded agent-results)
 * @param {object} plan the workflow plan
 * @param {object} state the workflow state
 * @param {object} gate the gate being evaluated
 * @param {{ humanApprovalRecorded?: boolean }} [extra] facts the caller already resolved
 * @returns {Record<string, unknown>} evaluation facts
 */
function gateContext(packDir, plan, state, gate, extra = {}) {
  const wave = (plan.waves || []).find((candidate) => candidate.id === gate.waveId);
  const tasks = (wave && wave.tasks) || [];
  const agentResults = {};
  for (const task of tasks.filter((candidate) => !isHumanTask(candidate))) {
    agentResults[task.id] = readAgentResult(packDir, task.id);
  }
  const facts = deriveGateFacts({ tasks, taskStates: state?.taskStates ?? {}, agentResults });
  return {
    ...facts,
    humanApprovalRecorded: extra.humanApprovalRecorded === true,
    revision: state?.revision ?? 0,
  };
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
  const recorded = readGateResult(packDir, gateId, { expectedRevision: state?.revision ?? 0 });
  const humanApprovalRecorded = !!(recorded && recorded.status === 'approved');
  const verdict = evaluateGate(gate, gateContext(packDir, plan, state, gate, { humanApprovalRecorded }));
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
  // Human-mode tasks complete via their gate approval, not an agent-result, so
  // they are excluded from the agent-completion check; the wave's human gate
  // (checked below) is what proves the human task closed.
  const agentTasks = (wave.tasks || []).filter((task) => !isHumanTask(task));
  const allTasksDone = agentTasks.length === 0 ||
    agentTasks.every((task) => (state?.taskStates?.[task.id]?.status) === 'done');
  const gate = wave.gate ? checkGate(root, slug, wave.gate) : null;
  const gatePassed = !gate || gate.status === 'passed' || gate.status === 'approved';
  const blocked = [];
  if (!allTasksDone) blocked.push('tasks-incomplete');
  if (!gatePassed) blocked.push(`gate-${gate.status}`);
  let applied = false;
  if (apply && blocked.length === 0) {
    let nextState = state || initState({ workflowId: plan.workflowId, planHash: planHash(plan), now });
    let gatePath = null;
    if (gate) {
      const gateId = gate.gateId || wave.gate;
      const gateRef = join('reports', 'gates', `${gateId}.json`).split('\\').join('/');
      gatePath = join(resolvePackDir(root, slug), gateRef);
      nextState = linkGateResult(nextState, gateId, { status: gate.status, ref: gateRef }, { now });
    }
    nextState = setWaveStatus(nextState, waveId, 'done', { now });
    if (gate && gatePath) {
      mkdirSync(dirname(gatePath), { recursive: true });
      // Closing the wave advances state revision; bind the persisted verdict to
      // that final revision so a valid approval is not misclassified as stale.
      writeJsonStable(gatePath, { ...gate, revision: nextState.revision });
    }
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
