/**
 * Integration test (W2-T4, WF0035) for the workflow gate + result contracts —
 * `templates/contextkit/tools/scripts/workflow/{gates,results}.mjs`.
 *
 * Standalone (not registered in test-suites.mjs by design). Drives the real
 * modules against a throwaway pack directory, proving the spec §Contracts +
 * ADR-0100 §9 acceptance points, above all the critical safety property: a
 * HUMAN gate can NEVER auto-pass from ctx — only an explicit named approver
 * approves it.
 *
 * RUN: cd /d D:/devtool_ia-uwwe && node tools/integration-test-workflow-gates.mjs
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import {
  evaluateGate,
  approveGate,
  readGateResult,
} from '../templates/contextkit/tools/scripts/workflow/gates.mjs';
import {
  validateAgentResult,
  validateWaveResult,
  validateGateResult,
  recordAgentResult,
  readAgentResult,
  listAgentResults,
} from '../templates/contextkit/tools/scripts/workflow/results.mjs';

const rep = reporter();
const NOW = '2026-06-17T12:00:00.000Z';

/** Fresh pack dir with the reports/{agents,gates} layout the engine expects. */
function makePack() {
  const packDir = mkdtempSync(join(tmpdir(), 'wf-gates-it-'));
  mkdirSync(join(packDir, 'reports', 'agents'), { recursive: true });
  mkdirSync(join(packDir, 'reports', 'gates'), { recursive: true });
  return packDir;
}

const packDir = makePack();

/** A well-formed agent result used across the contract checks. */
const goodAgentResult = {
  taskId: 'W2-T4',
  waveId: 'W2',
  status: 'done',
  branch: 'feat/uwwe',
  worktree: 'D:/devtool_ia-uwwe',
  commit: 'abc1234',
  filesCreated: ['gates.mjs', 'results.mjs'],
  filesModified: [],
  filesDeleted: [],
  tests: [{ name: 'gates', passed: true }],
  exitCodes: [0],
  acceptanceMet: ['human-gate-cannot-autopass'],
  acceptanceNotMet: [],
  risks: [],
  integrationNotes: 'clean',
  timestamp: NOW,
};

// ── Machine gate: passes when all requirements met ─────────────────────────
const machineGate = {
  id: 'G-W1',
  type: 'machine',
  requirements: ['tasks-completed', 'tests-green', 'reports-present', 'commit-present'],
};
const passingCtx = {
  taskStatuses: { 'W1-T1': 'done', 'W1-T2': 'done' },
  testsGreen: true,
  reportsPresent: true,
  commitPresent: true,
  revision: 3,
};
const machinePass = evaluateGate(machineGate, passingCtx);
machinePass.status === 'passed'
  ? rep.ok('machine gate passes when all requirements met')
  : rep.bad(`machine gate should pass, got ${machinePass.status}`);
machinePass.requirements.every((entry) => entry.met)
  ? rep.ok('machine gate reports every requirement met with evidence')
  : rep.bad('machine gate requirements not all met');

// ── Machine gate: fails when a requirement is missing ──────────────────────
const failingCtx = { ...passingCtx, testsGreen: false };
const machineFail = evaluateGate(machineGate, failingCtx);
machineFail.status === 'failed'
  ? rep.ok('machine gate fails when a requirement is unmet')
  : rep.bad(`machine gate should fail, got ${machineFail.status}`);

// ── Machine gate with no requirements never auto-passes ────────────────────
const emptyMachine = evaluateGate({ id: 'G-X', type: 'machine', requirements: [] }, passingCtx);
emptyMachine.status === 'failed'
  ? rep.ok('machine gate with zero requirements does not pass')
  : rep.bad(`empty machine gate should fail, got ${emptyMachine.status}`);

// ── CRITICAL: human gate stays pending from ctx, even a "complete" ctx ──────
const humanGate = { id: 'G-W3', type: 'human', requirements: ['human-merge-authorization'] };
const overcompleteCtx = {
  ...passingCtx,
  integrationDone: true,
  ciGreen: true,
  requirementFlags: { 'human-merge-authorization': true },
};
const humanEval = evaluateGate(humanGate, overcompleteCtx);
humanEval.status === 'pending'
  ? rep.ok('human gate stays PENDING from ctx (cannot auto-pass) — critical safety property')
  : rep.bad(`human gate must be pending from ctx, got ${humanEval.status}`);
humanEval.humanApproval.required === true && humanEval.humanApproval.approver === null
  ? rep.ok('human gate envelope: required=true, approver=null until explicit approval')
  : rep.bad('human gate approval envelope wrong before approval');

// ── Human gate becomes approved ONLY via explicit named approveGate ────────
const gatePath = approveGate(packDir, 'G-W3', {
  approver: 'profusaodigitalmarketing@gmail.com',
  evidence: ['human reviewed the merge'],
  now: NOW,
  revision: 3,
});
const approved = readGateResult(packDir, 'G-W3');
approved && approved.status === 'approved' && approved.humanApproval.approver === 'profusaodigitalmarketing@gmail.com'
  ? rep.ok('human gate becomes approved via explicit approveGate with a named approver')
  : rep.bad('approveGate did not record a named approval');
approved && approved.humanApproval.timestamp === NOW
  ? rep.ok('approval stamps the injected timestamp (no Date.now)')
  : rep.bad('approval timestamp not the injected now');
typeof gatePath === 'string' && gatePath.endsWith('G-W3.json')
  ? rep.ok('approveGate returns the written path')
  : rep.bad('approveGate path wrong');

// ── approveGate without a named approver THROWS (no inferred approval) ──────
let threwNoApprover = false;
try {
  approveGate(packDir, 'G-W3', { approver: '   ', now: NOW, revision: 3 });
} catch {
  threwNoApprover = true;
}
threwNoApprover
  ? rep.ok('approveGate throws when approver is missing/empty (approval never inferred)')
  : rep.bad('approveGate should throw without a named approver');

let threwNoNow = false;
try {
  approveGate(packDir, 'G-W3', { approver: 'someone', revision: 3 });
} catch {
  threwNoNow = true;
}
threwNoNow ? rep.ok('approveGate throws when now is not injected') : rep.bad('approveGate should require now');

// ── Stale evidence: revision mismatch ⇒ NOT treated as passed ──────────────
const stale = readGateResult(packDir, 'G-W3', { expectedRevision: 7 });
stale && stale.status === 'stale'
  ? rep.ok('stale evidence (revision mismatch) ⇒ not passed (status masked to stale)')
  : rep.bad(`expected stale status on revision mismatch, got ${stale && stale.status}`);
const fresh = readGateResult(packDir, 'G-W3', { expectedRevision: 3 });
fresh && fresh.status === 'approved'
  ? rep.ok('matching revision keeps the approved verdict')
  : rep.bad('matching revision should stay approved');

// ── Missing evidence ⇒ null, never passed ──────────────────────────────────
readGateResult(packDir, 'G-NOPE') === null
  ? rep.ok('missing gate evidence ⇒ null (never treated as passed)')
  : rep.bad('absent gate result should be null');

// ── Agent result contract validates good + rejects malformed ───────────────
validateAgentResult(goodAgentResult).valid
  ? rep.ok('valid agent result passes validation')
  : rep.bad('valid agent result rejected');
const badAgent = validateAgentResult({ ...goodAgentResult, status: 'bogus', filesCreated: 'nope', taskId: '' });
!badAgent.valid && badAgent.errors.length >= 3
  ? rep.ok('malformed agent result rejected with multiple errors')
  : rep.bad('malformed agent result not rejected properly');
!validateAgentResult(null).valid && !validateAgentResult([]).valid
  ? rep.ok('non-object agent result rejected')
  : rep.bad('non-object agent result should be rejected');

// ── Wave result contract ───────────────────────────────────────────────────
const goodWave = {
  waveId: 'W2',
  completedTasks: ['W2-T4'],
  deferredTasks: [],
  agentResults: [goodAgentResult],
  integrationCommit: 'def5678',
  gateResult: {},
  testEvidence: {},
  carryForwards: [],
  openRisks: [],
};
validateWaveResult(goodWave).valid
  ? rep.ok('valid wave result passes validation')
  : rep.bad('valid wave result rejected');
!validateWaveResult({ waveId: 'W2', completedTasks: 'x' }).valid
  ? rep.ok('malformed wave result rejected')
  : rep.bad('malformed wave result not rejected');

// ── Gate result contract ───────────────────────────────────────────────────
validateGateResult(approved).valid
  ? rep.ok('recorded gate result satisfies the gate-result contract')
  : rep.bad('recorded gate result fails its own contract');
const badGate = validateGateResult({ gateId: 'G', status: 'approved', requirements: [], evidence: [], humanApproval: { required: 'yes', approver: 5, timestamp: null }, revision: 'x' });
!badGate.valid
  ? rep.ok('malformed gate result rejected (bad approval envelope + revision)')
  : rep.bad('malformed gate result not rejected');

// ── recordAgentResult: writes valid JSON, re-readable; rejects invalid ──────
const writtenPath = recordAgentResult(packDir, goodAgentResult, { now: NOW });
typeof writtenPath === 'string' && writtenPath.endsWith('W2-T4.json')
  ? rep.ok('recordAgentResult writes to reports/agents/<taskId>.json')
  : rep.bad('recordAgentResult path wrong');
const reread = readAgentResult(packDir, 'W2-T4');
reread && reread.taskId === 'W2-T4' && reread.timestamp === NOW
  ? rep.ok('recorded agent result is re-readable as valid JSON')
  : rep.bad('recorded agent result not re-readable');

// timestamp injected when absent on the input
const stampedPath = recordAgentResult(packDir, { ...goodAgentResult, taskId: 'W2-T5', timestamp: undefined }, { now: NOW });
const stamped = readAgentResult(packDir, 'W2-T5');
stamped && stamped.timestamp === NOW
  ? rep.ok('recordAgentResult injects now when timestamp is absent')
  : rep.bad('recordAgentResult should inject now');
void stampedPath;

let threwInvalidRecord = false;
try {
  recordAgentResult(packDir, { ...goodAgentResult, status: 'bogus' }, { now: NOW });
} catch {
  threwInvalidRecord = true;
}
threwInvalidRecord
  ? rep.ok('recordAgentResult throws on an invalid result (never reaches disk)')
  : rep.bad('recordAgentResult should reject invalid input');

let threwNoNowRecord = false;
try {
  recordAgentResult(packDir, goodAgentResult, {});
} catch {
  threwNoNowRecord = true;
}
threwNoNowRecord ? rep.ok('recordAgentResult requires injected now') : rep.bad('recordAgentResult should require now');

// ── listAgentResults: stable, both written results present ─────────────────
const listed = listAgentResults(packDir);
listed.length === 2 && listed[0].taskId === 'W2-T4' && listed[1].taskId === 'W2-T5'
  ? rep.ok('listAgentResults returns all recorded results, sorted by taskId')
  : rep.bad(`listAgentResults wrong: ${JSON.stringify(listed.map((r) => r.taskId))}`);

// ── Cleanup ────────────────────────────────────────────────────────────────
rmSync(packDir, { recursive: true, force: true });

rep.finish('workflow-gates');
