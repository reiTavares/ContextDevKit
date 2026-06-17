/**
 * Integration test for the rendering projections (WF0035, W1-T5). Drives
 * render.mjs against plan + state in a throwaway temp pack: manual prose outside
 * a managed block is preserved, status cells come from `workflow-state.json`,
 * a second render is idempotent, a status change re-renders in place (no block
 * duplication), and output is deterministic. Block-insertion (no pre-existing
 * markers) is also covered. Standalone runnable:
 *   `node tools/integration-test-workflow-render.mjs`
 *
 * Zero runtime deps — node:* + the kit's own modules only (ADR-0001).
 * Timestamps are injected (`now`); no `Date.now()` / `Math.random()` here.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import {
  applyRender,
  refreshIndex,
  refreshTasks,
  renderIndexStatus,
  renderTasksTable,
} from '../templates/contextkit/tools/scripts/workflow/render.mjs';

const rep = reporter();
const NOW = '2026-06-17T00:00:00.000Z';
const START = '<!-- contextdevkit:generated:tasks:start -->';
const END = '<!-- contextdevkit:generated:tasks:end -->';

/** A small 2-wave plan with a few agent tasks. */
function buildPlan() {
  const ownership = (path) => ({
    allowedPaths: [path], forbiddenPaths: [], readOnlyPaths: [], sharedPaths: [],
    integrationOwner: 'orchestrator',
  });
  return {
    schemaVersion: 1, workflowId: '9999', slug: 'render-fixture', title: 'Render Fixture',
    profile: 'program', pattern: 'architecture-foundation-integration',
    journey: { currentPhase: 'spec' },
    waves: [
      {
        id: 'W1', title: 'Core', description: 'Foundation wave.', type: 'implementation',
        tasks: [
          { id: 'W1-T1', waveId: 'W1', title: 'Plan', priority: 'P0', objective: 'Plan model',
            acceptance: ['normalizes', 'rejects dups'], dependsOn: [],
            execution: { mode: 'agent', parallelizable: true, agentSlots: 1 }, ownership: ownership('a/plan.mjs') },
          { id: 'W1-T2', waveId: 'W1', title: 'State', priority: 'P0', objective: 'State model',
            acceptance: ['revision bumps'], dependsOn: ['W1-T1'],
            execution: { mode: 'agent', parallelizable: true, agentSlots: 1 }, ownership: ownership('a/state.mjs') },
        ],
      },
      {
        id: 'W2', title: 'Orchestration', description: '', type: 'implementation',
        tasks: [
          { id: 'W2-T1', waveId: 'W2', title: 'DAG', priority: 'P1', objective: 'DAG engine',
            acceptance: ['cycle detection', 'topo order', 'ready waves'], dependsOn: [],
            execution: { mode: 'agent', parallelizable: true, agentSlots: 1 }, ownership: ownership('a/dag.mjs') },
        ],
      },
    ],
    gates: [], addons: [], artifacts: [],
  };
}

/** A state with a couple of explicit task/wave statuses. */
function buildState(planHash) {
  return {
    schemaVersion: 1, workflowId: '9999', planHash, revision: 4, overallStatus: 'in-progress',
    journeyPhase: 'spec',
    waveStates: { W1: { status: 'in-progress' }, W2: { status: 'pending' } },
    taskStates: { 'W1-T1': { status: 'done' }, 'W1-T2': { status: 'in-progress' } },
    runs: [], gateResults: {}, carryForwards: [], integrationRecords: [],
    openBlockers: [], events: [], lastUpdate: NOW,
  };
}

const dir = mkdtempSync(join(tmpdir(), 'contextkit-render-'));
try {
  const plan = buildPlan();
  const state = buildState('deadbeef');

  // --- Pure render: status comes from state, deterministic. ---
  const table = renderTasksTable(plan, state);
  table.includes('| **W1-T1** |') && table.trimEnd().endsWith('|')
    ? rep.ok('tasks table renders rows')
    : rep.bad('tasks table missing rows');
  /W1-T1.*\| done \|/.test(table) ? rep.ok('W1-T1 status = done (from state)') : rep.bad('W1-T1 status wrong');
  /W1-T2.*\| in-progress \|/.test(table) ? rep.ok('W1-T2 status = in-progress (from state)') : rep.bad('W1-T2 status wrong');
  /W2-T1.*\| pending \|/.test(table) ? rep.ok('W2-T1 status = pending (no state entry)') : rep.bad('W2-T1 should be pending');
  /W1-T2.*\| W1-T1 \|/.test(table) ? rep.ok('deps cell shows dependency') : rep.bad('deps cell missing W1-T1');
  table.includes('a/plan.mjs') ? rep.ok('owns cell shows allowed path') : rep.bad('owns cell missing path');
  table.includes('2× — normalizes') ? rep.ok('acceptance summarized with count') : rep.bad('acceptance summary wrong');

  renderTasksTable(plan, state) === table ? rep.ok('renderTasksTable deterministic') : rep.bad('renderTasksTable non-deterministic');

  // --- Null state → all pending. ---
  const pendingTable = renderTasksTable(plan, null);
  /W1-T1.*\| pending \|/.test(pendingTable) ? rep.ok('null state → all pending') : rep.bad('null state not all pending');

  // --- Index status. ---
  const index = renderIndexStatus(plan, state);
  index.includes('**Profile:** program') && index.includes('W1 in-progress · W2 pending') && index.includes('State revision:** 4')
    ? rep.ok('index status: profile + wave summary + revision')
    : rep.bad('index status content wrong');

  // --- Manual content preservation + block insertion (no pre-existing block). ---
  const tasksPath = join(dir, 'tasks.md');
  const ABOVE = '# Tasks\n\nManual prose ABOVE the block.\n';
  const BELOW = '\n## Carry-forwards\n\nManual prose BELOW the block.\n';
  writeFileSync(tasksPath, `${ABOVE}${START}\n${END}${BELOW}`, 'utf-8');

  const first = applyRender(tasksPath, 'tasks', table);
  first.changed ? rep.ok('first render writes') : rep.bad('first render did not write');
  let onDisk = readFileSync(tasksPath, 'utf-8');
  onDisk.includes('Manual prose ABOVE the block.') && onDisk.includes('Manual prose BELOW the block.')
    ? rep.ok('manual prose above + below preserved')
    : rep.bad('manual prose lost');
  onDisk.includes('| **W1-T1** |') ? rep.ok('block populated with table') : rep.bad('block not populated');

  // --- Idempotent: a second identical render does not write. ---
  applyRender(tasksPath, 'tasks', table).changed
    ? rep.bad('second identical render wrote (not idempotent)')
    : rep.ok('second identical render is a no-op');

  // --- Status change → re-render in place, block not duplicated. ---
  const state2 = buildState('deadbeef');
  state2.taskStates['W1-T2'] = { status: 'done' };
  const table2 = renderTasksTable(plan, state2);
  applyRender(tasksPath, 'tasks', table2).changed ? rep.ok('changed status re-renders') : rep.bad('changed status did not re-render');
  onDisk = readFileSync(tasksPath, 'utf-8');
  /W1-T2.*\| done \|/.test(onDisk) ? rep.ok('status cell updated from new state') : rep.bad('status cell not updated');
  const startCount = onDisk.split(START).length - 1;
  startCount === 1 ? rep.ok('managed block not duplicated') : rep.bad(`block duplicated (${startCount} starts)`);
  onDisk.includes('Manual prose BELOW the block.') ? rep.ok('manual prose still preserved after re-render') : rep.bad('manual prose lost on re-render');

  // --- refreshTasks / refreshIndex from a real pack dir (state present). ---
  const { planHash } = await import('../templates/contextkit/tools/scripts/workflow/plan.mjs');
  const realHash = planHash(plan);
  writeFileSync(join(dir, 'workflow-plan.json'), JSON.stringify(plan), 'utf-8');
  writeFileSync(join(dir, 'workflow-state.json'), JSON.stringify(buildState(realHash)), 'utf-8');
  writeFileSync(join(dir, 'index.md'), '# Index\n\nManual.\n', 'utf-8');

  refreshTasks(dir, { now: NOW }).changed ? rep.ok('refreshTasks writes tasks.md') : rep.bad('refreshTasks no write (fresh pack)');
  refreshTasks(dir, { now: NOW }).changed ? rep.bad('refreshTasks not idempotent') : rep.ok('refreshTasks idempotent on re-run');
  refreshIndex(dir, { now: NOW }).changed ? rep.ok('refreshIndex writes index.md') : rep.bad('refreshIndex no write');
  readFileSync(join(dir, 'index.md'), 'utf-8').includes('Manual.') ? rep.ok('refreshIndex preserves manual content') : rep.bad('refreshIndex lost manual content');

  // --- refresh with state ABSENT → all pending, no failure. ---
  rmSync(join(dir, 'workflow-state.json'), { force: true });
  let absentOk = true;
  try {
    refreshTasks(dir, { now: NOW });
  } catch {
    absentOk = false;
  }
  absentOk ? rep.ok('refreshTasks tolerates missing state') : rep.bad('refreshTasks threw on missing state');
  /W1-T1.*\| pending \|/.test(readFileSync(join(dir, 'tasks.md'), 'utf-8'))
    ? rep.ok('missing state → all-pending projection')
    : rep.bad('missing state did not fall back to pending');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

rep.finish('workflow-render');
