/**
 * Integration test for the workflow execution-state machine
 * (`workflow/state.mjs`, WF0035 / W1-T3). Exercises the full mutation contract
 * against real temp files: monotonic revision, stale-write refusal, plan-hash
 * refusal, idempotent (no-churn) writes, forward-compat field preservation, and
 * atomic JSON validity. Timestamps are injected explicitly to keep the run
 * deterministic. Standalone-runnable; exits non-zero on any failure.
 */
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import {
  initState,
  readState,
  applyStateUpdate,
  writeState,
  setWaveStatus,
  setTaskStatus,
  recordRun,
  addCarryForward,
  recordIntegration,
  linkGateResult,
  StateConflictError,
} from '../templates/contextkit/tools/scripts/workflow/state.mjs';

const rep = reporter();
const tmp = mkdtempSync(join(tmpdir(), 'wf-state-it-'));
const statePath = join(tmp, 'workflow-state.json');

const T0 = '2026-06-17T10:00:00.000Z';
const T1 = '2026-06-17T10:01:00.000Z';
const PLAN_HASH = 'a'.repeat(64);

try {
  // init → revision 0
  const fresh = initState({ workflowId: '0035', planHash: PLAN_HASH, journeyPhase: 'spec', now: T0 });
  fresh.revision === 0 ? rep.ok('initState → revision 0') : rep.bad(`init revision ${fresh.revision}`);
  fresh.lastUpdate === T0 ? rep.ok('initState stamps injected now') : rep.bad('init lastUpdate not injected');
  fresh.overallStatus === 'not-started' ? rep.ok('init overallStatus not-started') : rep.bad('init status wrong');

  // apply update → revision 1, input not mutated
  const next = applyStateUpdate(fresh, { overallStatus: 'in-progress' }, { now: T1 });
  next.revision === 1 ? rep.ok('applyStateUpdate → revision 1') : rep.bad(`update revision ${next.revision}`);
  fresh.revision === 0 ? rep.ok('applyStateUpdate does not mutate input') : rep.bad('input mutated');
  next.lastUpdate === T1 ? rep.ok('update stamps injected now') : rep.bad('update lastUpdate wrong');

  // stale expectedRevision throws
  let threwStale = false;
  try {
    applyStateUpdate(next, {}, { expectedRevision: 0, now: T1 });
  } catch (err) {
    threwStale = err instanceof StateConflictError && err.code === 'stale-revision';
  }
  threwStale ? rep.ok('stale expectedRevision rejected (typed)') : rep.bad('stale write not rejected');

  // matching expectedRevision accepted
  let acceptedMatch = false;
  try {
    const ok = applyStateUpdate(next, {}, { expectedRevision: 1, now: T1 });
    acceptedMatch = ok.revision === 2;
  } catch {
    acceptedMatch = false;
  }
  acceptedMatch ? rep.ok('matching expectedRevision accepted') : rep.bad('matching revision rejected');

  // planHash mismatch throws
  let threwHash = false;
  try {
    applyStateUpdate(next, {}, { planHash: 'b'.repeat(64), now: T1 });
  } catch (err) {
    threwHash = err instanceof StateConflictError && err.code === 'plan-hash-mismatch';
  }
  threwHash ? rep.ok('planHash mismatch rejected (typed)') : rep.bad('plan-hash mismatch not rejected');

  // matching planHash accepted
  let acceptedHash = true;
  try {
    applyStateUpdate(next, {}, { planHash: PLAN_HASH, now: T1 });
  } catch {
    acceptedHash = false;
  }
  acceptedHash ? rep.ok('matching planHash accepted') : rep.bad('matching planHash rejected');

  // unknown pre-existing field preserved across an update
  const withUnknown = { ...next, futureField: { keep: true } };
  const merged = applyStateUpdate(withUnknown, { overallStatus: 'in-progress' }, { now: T1 });
  merged.futureField && merged.futureField.keep === true
    ? rep.ok('unknown field preserved across update')
    : rep.bad('unknown field discarded');

  // convenience setters funnel through applyStateUpdate
  const w = setWaveStatus(fresh, 'W1', 'in-progress', { now: T1, extra: { startedAt: T1 } });
  w.revision === 1 && w.waveStates.W1.status === 'in-progress' && w.waveStates.W1.startedAt === T1
    ? rep.ok('setWaveStatus sets status + extra, bumps revision')
    : rep.bad('setWaveStatus wrong');

  const t = setTaskStatus(fresh, 'W1-T3', 'done', { now: T1, extra: { resultRef: 'reports/agents/W1-T3.json' } });
  t.taskStates['W1-T3'].status === 'done' && t.taskStates['W1-T3'].resultRef === 'reports/agents/W1-T3.json'
    ? rep.ok('setTaskStatus sets status + resultRef')
    : rep.bad('setTaskStatus wrong');

  const r = recordRun(fresh, { runId: 'RUN-001-A', waveId: 'W1', assignments: [] }, { now: T1 });
  r.runs.length === 1 && r.runs[0].runId === 'RUN-001-A' ? rep.ok('recordRun appends run') : rep.bad('recordRun wrong');

  const cf = addCarryForward(fresh, { id: 'CF-1', fromWave: 'W1', targetWave: 'W2', status: 'open' }, { now: T1 });
  cf.carryForwards.length === 1 ? rep.ok('addCarryForward appends') : rep.bad('addCarryForward wrong');

  const ir = recordIntegration(fresh, { waveId: 'W1', commit: 'c'.repeat(40) }, { now: T1 });
  ir.integrationRecords.length === 1 ? rep.ok('recordIntegration appends') : rep.bad('recordIntegration wrong');

  const g = linkGateResult(fresh, 'G-W1', 'reports/gates/G-W1.json', { now: T1 });
  g.gateResults['G-W1'] === 'reports/gates/G-W1.json' ? rep.ok('linkGateResult links ref') : rep.bad('linkGateResult wrong');

  // write → valid JSON on disk, round-trips
  const firstWrite = writeState(statePath, next);
  firstWrite.changed === true ? rep.ok('writeState reports changed on first write') : rep.bad('first write not changed');
  let reparsed = null;
  try {
    reparsed = JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    reparsed = null;
  }
  reparsed && reparsed.revision === 1 ? rep.ok('written file is valid JSON (reparse)') : rep.bad('written file not valid JSON');
  const roundTrip = readState(statePath);
  roundTrip && roundTrip.planHash === PLAN_HASH ? rep.ok('readState round-trips') : rep.bad('readState round-trip failed');

  // write twice identical → no mtime churn
  const mtimeBefore = statSync(statePath).mtimeMs;
  const secondWrite = writeState(statePath, next);
  const mtimeAfter = statSync(statePath).mtimeMs;
  secondWrite.changed === false ? rep.ok('writeState identical → changed:false') : rep.bad('identical write churned');
  mtimeBefore === mtimeAfter ? rep.ok('identical write does not churn mtime') : rep.bad('mtime changed on identical write');

  // readState on absent file → null
  readState(join(tmp, 'nope.json')) === null ? rep.ok('readState absent → null') : rep.bad('readState absent not null');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

rep.finish('workflow-state');
