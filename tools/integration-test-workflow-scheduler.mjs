/**
 * Integration test — deterministic scheduler (`workflow/scheduler.mjs`).
 *
 * Standalone suite (registered by the orchestrator, never self-registered).
 * Builds plans + states inline through plan.normalizePlan and asserts the
 * scheduler output shape (spec §11): ready/blocked waves, capacity-bounded runs
 * and slots, execution-mode filtering, ownership-collision deferral, priority
 * ordering, and byte-identical determinism across two runs.
 *
 * Coverage: 1-wave / 4-wave / 10-wave schedules; 4 concurrent waves; 5 agents
 * per run; 20-agent global cap; 6 agent tasks → 5 slots (1 deferred); no slot to
 * deterministic/orchestrator/human; ownership collision drops a task; priority
 * order; deterministic output.
 *
 * RUN: cd /d D:/devtool_ia-uwwe && node tools/integration-test-workflow-scheduler.mjs
 */
import { reporter } from './it-helpers.mjs';
import { normalizePlan } from '../templates/contextkit/tools/scripts/workflow/plan.mjs';
import { computeSchedule } from '../templates/contextkit/tools/scripts/workflow/scheduler.mjs';

const rep = reporter();

/** Deep ordered equality via stable JSON. */
const eq = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Build a normalized agent task with an isolated allowedPaths lane.
 * @param {string} id task id
 * @param {object} [over] overrides (waveId, dependsOn, priority, mode, allowedPaths)
 * @returns {object} a task fragment
 */
function agentTask(id, over = {}) {
  return {
    id,
    waveId: over.waveId ?? 'W1',
    title: id,
    priority: over.priority ?? 'P1',
    dependsOn: over.dependsOn ?? [],
    execution: { mode: over.mode ?? 'agent', parallelizable: true, agentSlots: 1 },
    ownership: { allowedPaths: over.allowedPaths ?? [`src/${id}/**`] },
  };
}

/**
 * Wrap waves into a normalized program plan with an explicit capacity ceiling.
 * @param {object[]} waves wave fragments
 * @param {object} capacity capacity ceiling
 * @param {object[]} [gates] gate fragments
 * @returns {object} a normalized plan
 */
function planOf(waves, capacity, gates = []) {
  return normalizePlan({
    schemaVersion: 1, workflowId: '9999', slug: 'sched-test', profile: 'program',
    capacity, waves, gates,
  });
}

// --- 1: single ready wave, one agent task -> one dispatch ----------------
{
  const plan = planOf(
    [{ id: 'W1', dependsOn: [], priority: 'P0', tasks: [agentTask('W1-T1')] }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 1, maxAgentsPerRun: 5, maxTotalAgents: 5 },
  );
  const out = computeSchedule(plan, {});
  rep[eq(out.readyWaves, ['W1']) ? 'ok' : 'bad']('1-wave: W1 ready');
  rep[out.dispatches.length === 1 && out.dispatches[0].assignments.length === 1 ? 'ok' : 'bad'](
    '1-wave: one dispatch, one assignment',
  );
  rep[out.dispatches[0].assignments[0].agentSlot === 'RUN-001-A01' ? 'ok' : 'bad'](
    `1-wave: slot id RUN-001-A01 (got ${out.dispatches[0]?.assignments[0]?.agentSlot})`,
  );
}

// --- 2: 4-wave standard chain, only the head ready, rest blocked ---------
{
  const waves = [
    { id: 'W1', dependsOn: [], priority: 'P0', tasks: [agentTask('W1-T1')] },
    { id: 'W2', dependsOn: ['W1'], priority: 'P0', tasks: [agentTask('W2-T1', { waveId: 'W2' })] },
    { id: 'W3', dependsOn: ['W2'], priority: 'P1', tasks: [agentTask('W3-T1', { waveId: 'W3' })] },
    { id: 'W4', dependsOn: ['W3'], priority: 'P1', tasks: [agentTask('W4-T1', { waveId: 'W4' })] },
  ];
  const plan = planOf(waves, { maxConcurrentWaves: 4, maxConcurrentRuns: 4, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  rep[eq(out.readyWaves, ['W1']) ? 'ok' : 'bad']('4-wave: only W1 ready');
  rep[eq(out.blockedWaves.map((b) => b.id), ['W2', 'W3', 'W4']) ? 'ok' : 'bad']('4-wave: W2..W4 blocked');
  rep[eq(out.blockedWaves[0].blockedBy, ['W1']) ? 'ok' : 'bad']('4-wave: W2 blockedBy W1');
}

// --- 3: 10-wave program DAG; completing W1 + gate opens its dependents ----
{
  const waves = [];
  for (let i = 1; i <= 10; i += 1) {
    waves.push({
      id: `W${i}`, dependsOn: i === 1 ? [] : i <= 5 ? ['W1'] : ['W5'], priority: 'P1',
      gate: i === 1 ? 'G1' : null, tasks: [agentTask(`W${i}-T1`, { waveId: `W${i}` })],
    });
  }
  const plan = planOf(waves, { maxConcurrentWaves: 4, maxConcurrentRuns: 4, maxAgentsPerRun: 5, maxTotalAgents: 20 },
    [{ id: 'G1', waveId: 'W1', requirements: [] }]);
  const fresh = computeSchedule(plan, {});
  rep[eq(fresh.readyWaves, ['W1']) ? 'ok' : 'bad']('10-wave: only W1 ready initially');
  // W1 done but gate not passed -> dependents stay blocked (default-refuse).
  const gatePending = computeSchedule(plan, { waveStates: { W1: { status: 'completed' } } });
  rep[gatePending.readyWaves.length === 0 ? 'ok' : 'bad']('10-wave: W1 done but gate pending blocks dependents');
  // W1 done AND gate passed -> W2..W5 ready (capped at 4 concurrent waves).
  const open = computeSchedule(plan, { waveStates: { W1: { status: 'completed' } }, gateResults: { G1: 'passed' } });
  rep[open.readyWaves.length === 4 ? 'ok' : 'bad'](`10-wave: 4 concurrent waves cap (got ${open.readyWaves.length})`);
}

// --- 4: 4 concurrent waves respected, more ready than ceiling ------------
{
  const waves = ['W1', 'W2', 'W3', 'W4', 'W5'].map((id) => ({
    id, dependsOn: [], priority: 'P1', tasks: [agentTask(`${id}-T1`, { waveId: id })],
  }));
  const plan = planOf(waves, { maxConcurrentWaves: 4, maxConcurrentRuns: 4, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  rep[out.readyWaves.length === 4 ? 'ok' : 'bad'](`concurrent-waves: 5 ready capped to 4 (got ${out.readyWaves.length})`);
  rep[eq(out.readyWaves, ['W1', 'W2', 'W3', 'W4']) ? 'ok' : 'bad']('concurrent-waves: first four by id');
}

// --- 5: 6 agent tasks, 5 slots/run -> 5 assigned + 1 deferred ------------
{
  const tasks = [];
  for (let i = 1; i <= 6; i += 1) tasks.push(agentTask(`W1-T${i}`));
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 1, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  const assigned = out.dispatches.reduce((n, d) => n + d.assignments.length, 0);
  rep[assigned === 5 ? 'ok' : 'bad'](`6->5: 5 assigned (got ${assigned})`);
  rep[out.deferredTasks.length === 1 && out.deferredTasks[0].reason === 'capacity ceiling reached' ? 'ok' : 'bad'](
    `6->5: exactly 1 deferred for capacity (got ${out.deferredTasks.length})`,
  );
}

// --- 6: 5 agents per run cap with room for a second run ------------------
{
  const tasks = [];
  for (let i = 1; i <= 8; i += 1) tasks.push(agentTask(`W1-T${i}`));
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 2, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  rep[out.dispatches.length === 2 ? 'ok' : 'bad'](`per-run-cap: 2 runs (got ${out.dispatches.length})`);
  rep[out.dispatches[0].assignments.length === 5 ? 'ok' : 'bad']('per-run-cap: first run holds exactly 5');
  rep[out.dispatches[1].assignments.length === 3 ? 'ok' : 'bad']('per-run-cap: second run holds the remaining 3');
  rep[out.dispatches[1].runId === 'RUN-001-B' ? 'ok' : 'bad'](`per-run-cap: second runId RUN-001-B (got ${out.dispatches[1].runId})`);
}

// --- 7: 20-agent global cap across many runs -----------------------------
{
  const tasks = [];
  for (let i = 1; i <= 30; i += 1) tasks.push(agentTask(`W1-T${String(i).padStart(2, '0')}`));
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 10, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  const assigned = out.dispatches.reduce((n, d) => n + d.assignments.length, 0);
  rep[assigned === 20 ? 'ok' : 'bad'](`global-cap: exactly 20 assigned (got ${assigned})`);
  rep[out.deferredTasks.length === 10 ? 'ok' : 'bad'](`global-cap: 10 deferred (got ${out.deferredTasks.length})`);
}

// --- 8: no slot for deterministic/orchestrator/human tasks ----------------
{
  const tasks = [
    agentTask('W1-T1', { mode: 'agent' }),
    agentTask('W1-T2', { mode: 'deterministic' }),
    agentTask('W1-T3', { mode: 'orchestrator' }),
    agentTask('W1-T4', { mode: 'human' }),
  ];
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 1, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  const assignedIds = out.dispatches.flatMap((d) => d.assignments.map((a) => a.taskId));
  rep[eq(assignedIds, ['W1-T1']) ? 'ok' : 'bad'](`modes: only the agent task is slotted (got ${assignedIds.join(',')})`);
  rep[eq(out.humanActions.map((h) => h.taskId), ['W1-T2', 'W1-T3', 'W1-T4']) ? 'ok' : 'bad'](
    'modes: non-agent tasks surface in humanActions',
  );
}

// --- 9: ownership collision drops the later task to deferred -------------
{
  const tasks = [
    agentTask('W1-T1', { allowedPaths: ['src/shared/**'] }),
    agentTask('W1-T2', { allowedPaths: ['src/shared/**'] }),
  ];
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 1, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  const assignedIds = out.dispatches.flatMap((d) => d.assignments.map((a) => a.taskId));
  rep[eq(assignedIds, ['W1-T1']) ? 'ok' : 'bad'](`ownership: survivor W1-T1 slotted (got ${assignedIds.join(',')})`);
  rep[out.ownershipConflicts.length === 1 ? 'ok' : 'bad']('ownership: one conflict reported');
  rep[out.deferredTasks.some((d) => d.taskId === 'W1-T2' && d.reason === 'ownership collision') ? 'ok' : 'bad'](
    'ownership: W1-T2 deferred with ownership reason',
  );
}

// --- 10: priority ordering within a wave (P0 before P1) ------------------
{
  const tasks = [
    agentTask('W1-T1', { priority: 'P1' }),
    agentTask('W1-T2', { priority: 'P0' }),
  ];
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 1, maxAgentsPerRun: 1, maxTotalAgents: 1 });
  const out = computeSchedule(plan, {});
  const assignedIds = out.dispatches.flatMap((d) => d.assignments.map((a) => a.taskId));
  rep[eq(assignedIds, ['W1-T2']) ? 'ok' : 'bad'](`priority: P0 task wins the single slot (got ${assignedIds.join(',')})`);
}

// --- 11: task-level dependency defers an otherwise-ready task ------------
{
  const tasks = [
    agentTask('W1-T1'),
    agentTask('W1-T2', { dependsOn: ['W1-T1'] }),
  ];
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 1, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const out = computeSchedule(plan, {});
  const assignedIds = out.dispatches.flatMap((d) => d.assignments.map((a) => a.taskId));
  rep[eq(assignedIds, ['W1-T1']) ? 'ok' : 'bad']('task-deps: dependent task not yet slotted');
  rep[out.deferredTasks.some((d) => d.taskId === 'W1-T2' && d.reason === 'unmet task dependencies') ? 'ok' : 'bad'](
    'task-deps: W1-T2 deferred on unmet task dependency',
  );
}

// --- 12: deterministic output (run twice -> byte-identical) --------------
{
  const tasks = [];
  for (let i = 1; i <= 6; i += 1) tasks.push(agentTask(`W1-T${i}`, { priority: i % 2 ? 'P0' : 'P1' }));
  const plan = planOf([{ id: 'W1', dependsOn: [], priority: 'P0', tasks }],
    { maxConcurrentWaves: 1, maxConcurrentRuns: 2, maxAgentsPerRun: 5, maxTotalAgents: 20 });
  const first = JSON.stringify(computeSchedule(plan, {}));
  const second = JSON.stringify(computeSchedule(plan, {}));
  rep[first === second ? 'ok' : 'bad']('determinism: identical output across two runs');
}

// --- 13: non-object plan throws (fail-fast) ------------------------------
{
  let threw = false;
  try { computeSchedule(null); } catch { threw = true; }
  rep[threw ? 'ok' : 'bad']('guard: non-object plan throws TypeError');
}

rep.finish('workflow-scheduler');
