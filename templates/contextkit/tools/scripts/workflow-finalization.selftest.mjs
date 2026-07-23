#!/usr/bin/env node
/**
 * WF-0084 adversarial selftest: finalization retry, state CAS, projection
 * refusal, and one outcome-driven drift fixture for every I1-I10 invariant.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createWaveWorkflow } from './workflow/create.mjs';
import { concludeWorkflow, doneMoveWorkflow, loadPack } from './workflow/commands.mjs';
import { applyStateUpdate, initState, writeState, writeStateCas, StateConflictError } from './workflow/state.mjs';
import { planHash } from './workflow/plan.mjs';
import { checkInvariant, evaluateInvariants } from './workflow/invariants.mjs';
import { parseFrontmatter } from './workflow-frontmatter.mjs';
import { renderIndexStatus } from './workflow/render.mjs';
import { runWorkflowInvariantHook } from '../../runtime/git-hooks/workflow-invariant-hook.mjs';

const NOW = '2026-07-23T12:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'wf0084-finalization-'));
let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

function fixturePlan(workflowId, slug) {
  return {
    schemaVersion: 1,
    workflowId,
    slug,
    profile: 'program',
    waves: [],
    gates: [],
  };
}

try {
  process.stdout.write('Block A — conclude / retry / projection\n');
  const created = createWaveWorkflow(root, 'finalization-fixture', {
    profile: 'program',
    plan: fixturePlan('9901', 'finalization-fixture'),
    now: NOW,
  });
  const first = concludeWorkflow(root, 'finalization-fixture', { apply: true, now: NOW, actor: 'agent' });
  assert('A1: conclude applies the authoritative state', first.applied && first.overallStatus === 'done' && first.journalSeq === 1);
  const archiveDir = first.movedTo;
  const persisted = JSON.parse(readFileSync(join(archiveDir, 'workflow-state.json'), 'utf8'));
  assert('A2: state has one finalization event', persisted.overallStatus === 'done' && persisted.events.length === 1 && persisted.events[0].type === 'workflow.concluded');
  assert('A3: index conclusion is regenerated from state', readFileSync(join(archiveDir, 'index.md'), 'utf8').includes('conclusion: done'));
  const stateProjection = renderIndexStatus({
    profile: 'program',
    pattern: 'large-program',
    journey: { currentPhase: 'intake' },
    waves: [],
  }, { journeyPhase: 'conclusion', overallStatus: 'done', revision: 22 });
  assert('A3b: generated status follows the authoritative state phase', stateProjection.includes('**Journey phase:** conclusion') && stateProjection.includes('**Overall:** done'));
  assert('A4: directory is filed under done', existsSync(archiveDir) && !existsSync(created.dir));

  const retry = concludeWorkflow(root, 'finalization-fixture', { apply: true, now: '2026-07-23T12:01:00.000Z' });
  const retriedState = JSON.parse(readFileSync(join(archiveDir, 'workflow-state.json'), 'utf8'));
  assert('A5: conclude retry is idempotent', retry.status === 'noop' && retry.applied === false && retriedState.events.length === 1);

  process.stdout.write('\nBlock B — CAS and reconcile-or-refuse\n');
  const casPath = join(root, 'cas-state.json');
  const casInitial = initState({ workflowId: '9902', planHash: 'a'.repeat(64), now: NOW });
  writeState(casPath, casInitial);
  const casNext = applyStateUpdate(casInitial, { overallStatus: 'in-progress' }, { now: NOW });
  writeStateCas(casPath, casNext, { expectedRevision: 0, planHash: 'a'.repeat(64) });
  let staleRejected = false;
  try { writeStateCas(casPath, casNext, { expectedRevision: 0, planHash: 'a'.repeat(64) }); }
  catch (error) { staleRejected = error instanceof StateConflictError && error.code === 'stale-revision'; }
  assert('B1: stale disk CAS is rejected', staleRejected);

  const mismatch = createWaveWorkflow(root, 'projection-mismatch', {
    profile: 'program',
    plan: fixturePlan('9903', 'projection-mismatch'),
    now: NOW,
  });
  const mismatchIndex = join(mismatch.dir, 'index.md');
  writeFileSync(mismatchIndex, readFileSync(mismatchIndex, 'utf8').replace('conclusion: pending', 'conclusion: done'));
  assert('B2-pre: mismatch fixture carries conclusion projection', readFileSync(mismatchIndex, 'utf8').includes('conclusion: done'));
  writeState(join(mismatch.dir, 'workflow-state.json'), initState({ workflowId: '9903', planHash: 'b'.repeat(64), now: NOW }));
  const mismatchLoaded = loadPack(root, 'projection-mismatch');
  assert('B2-state: mismatch state is readable by command', Boolean(mismatchLoaded.state));
  assert('B2-front: command index parser sees conclusion', parseFrontmatter(readFileSync(join(mismatchLoaded.packDir, 'index.md'), 'utf8'))?.frontmatter?.conclusion === 'done');
  let mismatchRejected = false;
  try { doneMoveWorkflow(root, 'projection-mismatch', { apply: true, now: NOW }); }
  catch (error) { mismatchRejected = /contradict|refused/i.test(error.message); }
  assert('B2: index/state mismatch refuses done-move', mismatchRejected);

  process.stdout.write('\nBlock C — I1-I10 drift outcomes\n');
  const driftCases = [
    ['I1', { inDone: true, statePresent: true, stateReadable: true, state: { overallStatus: 'not-started' } }],
    ['I2', { journal: [{ type: 'task.status', seq: 1, taskId: 'T1', status: 'done' }], taskStates: { T1: { status: 'in-progress' } } }],
    ['I3', { root, businessRecords: [{ workflows: { authorized: ['WF-9999'] } }], resolvedRefs: { 'WF-9999': false } }],
    ['I4', { inDone: true, statePresent: true, stateReadable: true, state: { overallStatus: 'done', events: [] } }],
    ['I5', { taskMappings: [{ tasksPath: 'orphan/tasks.json', workflowRef: 'WF-9999' }], registeredWorkflows: [] }],
    ['I6', { statePresent: true, indexPresent: true, stateReadable: true, indexReadable: true, state: { overallStatus: 'not-started' }, index: { conclusion: 'done' } }],
    ['I7', { adrNumberContiguous: false }],
    ['I8', { workflowNestedUnderOwner: false }],
    ['I9', { state: { planHash: 'a'.repeat(64) }, expectedPlanHash: 'b'.repeat(64) }],
    ['I10', { journal: [{ seq: 2 }, { seq: 1 }] }],
  ];
  for (const [id, input] of driftCases) assert(`${id}: drifted fixture fails`, checkInvariant(id, input).status === 'fail');

  const unknown = evaluateInvariants({ mode: 'guarded' });
  assert('C11: absent substrate is fail-open and never blocked', unknown.status === 'skipped' && unknown.blocked.length === 0);
  const advisory = evaluateInvariants({ mode: 'advisory', inDone: true, statePresent: true, stateReadable: true, state: { overallStatus: 'not-started' } });
  assert('C12: advisory mode warns without blocking', advisory.status === 'advisory' && advisory.blocked.length === 0);
  const guarded = evaluateInvariants({ mode: 'guarded', inDone: true, statePresent: true, stateReadable: true, state: { overallStatus: 'not-started' } });
  assert('C13: guarded mode blocks hot-path I1', guarded.status === 'blocked' && guarded.blocked.some((row) => row.id === 'I1'));
  const selfHeal = evaluateInvariants({
    mode: 'shadow',
    inDone: true,
    statePresent: true,
    stateReadable: true,
    state: { overallStatus: 'not-started', events: [{ type: 'workflow.concluded', seq: 1, status: 'done' }] },
  });
  assert('C14: I1 exposes a journal-backed self-heal proposal', selfHeal.selfHealing.some((repair) => repair.action === 'rebuild-state-status'));

  process.stdout.write('\nBlock D — pre-commit rollout adapter\n');
  const hookFixture = createWaveWorkflow(root, 'hook-fixture', {
    profile: 'program',
    plan: fixturePlan('9904', 'hook-fixture'),
    now: NOW,
  });
  const changedWorkflowFile = `${relative(root, hookFixture.dir).replace(/\\/g, '/')}/index.md`;
  const hookStatePath = join(hookFixture.dir, 'workflow-state.json');
  writeState(hookStatePath, initState({
    workflowId: '9904',
    planHash: planHash(fixturePlan('9904', 'hook-fixture')),
    now: NOW,
  }));
  const shadowHook = runWorkflowInvariantHook(root, {
    stagedFiles: [changedWorkflowFile],
    config: { workflowIntegrity: { invariantGuard: { enabled: true, mode: 'shadow' } } },
    now: NOW,
  });
  assert('D1: shadow hook observes without blocking', shadowHook.exitCode === 0 && shadowHook.packs.length === 1);
  writeFileSync(hookStatePath, JSON.stringify({
    ...JSON.parse(readFileSync(hookStatePath, 'utf8')),
    overallStatus: 'done',
  }));
  const guardedHook = runWorkflowInvariantHook(root, {
    stagedFiles: [changedWorkflowFile],
    config: { workflowIntegrity: { invariantGuard: { enabled: true, mode: 'guarded' } } },
    now: NOW,
  });
  assert('D2: guarded hook blocks a positively-false hot invariant', guardedHook.exitCode === 1 && guardedHook.status === 'blocked');
  const disabledHook = runWorkflowInvariantHook(root, {
    stagedFiles: [changedWorkflowFile],
    config: { workflowIntegrity: { invariantGuard: { enabled: false, mode: 'guarded' } } },
    now: NOW,
  });
  assert('D3: kill path leaves work unblocked', disabledHook.exitCode === 0 && disabledHook.status === 'disabled');
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(`\nworkflow-finalization selftest: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
