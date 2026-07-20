/**
 * Integration test for the close-wave state transition.
 *
 * A passed wave gate must be written to both the gate evidence file and
 * workflow-state.json; the scheduler then uses that state link to unlock the
 * dependent wave. A completed wave without the link must remain blocked.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { createWaveWorkflow } from '../templates/contextkit/tools/scripts/workflow/create.mjs';
import { checkGate, closeWave, nextRun } from '../templates/contextkit/tools/scripts/workflow/commands.mjs';
import { readPlan, planHash } from '../templates/contextkit/tools/scripts/workflow/plan.mjs';
import { initState, setTaskStatus, writeState } from '../templates/contextkit/tools/scripts/workflow/state.mjs';
import { recordAgentResult } from '../templates/contextkit/tools/scripts/workflow/results.mjs';

const rep = reporter();
const NOW = '2026-06-17T12:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'wf-close-wave-it-'));

try {
  const created = createWaveWorkflow(root, 'close-wave-gate', {
    profile: 'program',
    plan: {
      schemaVersion: 1,
      workflowId: '9999',
      slug: 'close-wave-gate',
      profile: 'program',
      waves: [
        {
          id: 'W1',
          dependsOn: [],
          gate: 'G-W1',
          tasks: [{
            id: 'W1-T1',
            waveId: 'W1',
            execution: { mode: 'agent' },
            ownership: { allowedPaths: ['src/shape/**'] },
          }],
        },
        {
          id: 'W2',
          dependsOn: ['W1'],
          gate: 'G-W2',
          tasks: [{
            id: 'W2-T1',
            waveId: 'W2',
            execution: { mode: 'agent' },
            ownership: { allowedPaths: ['src/next/**'] },
          }],
        },
      ],
      gates: [
        {
          id: 'G-W1',
          waveId: 'W1',
          type: 'machine',
          requirements: ['acceptance-evidence-present', 'all-wave-tasks-done', 'no-unresolved-critical-risk'],
        },
        { id: 'G-W2', waveId: 'W2', type: 'machine', requirements: ['acceptance-evidence-present'] },
      ],
    },
    now: NOW,
  });
  const plan = readPlan(join(created.dir, 'workflow-plan.json'));
  mkdirSync(join(created.dir, 'reports', 'agents'), { recursive: true });
  const initialState = initState({ workflowId: plan.workflowId, planHash: planHash(plan), now: NOW });
  writeState(
    join(created.dir, 'workflow-state.json'),
    setTaskStatus(initialState, 'W1-T1', 'done', { now: NOW }),
  );
  recordAgentResult(created.dir, {
    taskId: 'W1-T1',
    waveId: 'W1',
    status: 'done',
    branch: 'feat/close-wave',
    worktree: root,
    commit: 'abc1234',
    filesCreated: ['src/shape/resolver.mjs'],
    filesModified: [],
    filesDeleted: [],
    tests: [{ name: 'close-wave', passed: true }],
    exitCodes: [0],
    acceptanceMet: ['gate result persists'],
    acceptanceNotMet: [],
    risks: [],
    integrationNotes: 'clean',
    timestamp: NOW,
  }, { now: NOW });

  const close = closeWave(root, 'close-wave-gate', 'W1', { apply: true, now: NOW });
  close.applied && close.gate?.status === 'passed'
    ? rep.ok('close-wave applies only after a passed machine gate')
    : rep.bad('close-wave should apply with a passed gate: ' + JSON.stringify(close));

  const persistedState = JSON.parse(readFileSync(join(created.dir, 'workflow-state.json'), 'utf-8'));
  const storedGate = persistedState.gateResults?.['G-W1'];
  storedGate?.status === 'passed' && storedGate.ref === 'reports/gates/G-W1.json'
    ? rep.ok('close-wave links the passed gate into workflow-state.json')
    : rep.bad('close-wave did not persist the gate link: ' + JSON.stringify(storedGate));
  existsSync(join(created.dir, 'reports', 'gates', 'G-W1.json'))
    ? rep.ok('close-wave writes the gate evidence report')
    : rep.bad('close-wave gate evidence report is missing');
  checkGate(root, 'close-wave-gate', 'G-W1').status === 'passed'
    ? rep.ok('check-gate keeps the persisted verdict valid after close-wave revision')
    : rep.bad('check-gate treated the close-wave gate evidence as stale');
  nextRun(root, 'close-wave-gate').readyWaves.includes('W2')
    ? rep.ok('scheduler unlocks the dependent wave after close-wave')
    : rep.bad('scheduler kept the dependent wave blocked after close-wave');
} finally {
  rmSync(root, { recursive: true, force: true });
}

rep.finish('workflow-close-wave');
