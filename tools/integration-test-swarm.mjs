#!/usr/bin/env node
/** Acceptance coverage for the optional v4 swarm planner and result report. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveTouchSet,
  expandWithTestHomes,
  planSwarm,
  rankCandidates,
} from '../templates/contextkit/tools/scripts/swarm-plan.mjs';
import {
  WS_STATUSES,
  byDispatch,
  byModel,
  createRun,
  evictStale,
  listRuns,
  manifestPath,
  readRun,
  renderReport,
  runTokens,
  updateWorkstream,
} from '../templates/contextkit/tools/scripts/swarm-state.mjs';

let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
  console.log(`  ok ${checks} - ${message}`);
};

const hinted = { id: 'T-001', title: 'Runtime change', touchHints: ['templates\\contextkit\\runtime\\x.mjs'] };
check(
  JSON.stringify(deriveTouchSet(hinted)) === JSON.stringify(['templates/contextkit/runtime/x.mjs']),
  'canonical touchHints are normalized without frontmatter parsing',
);
check(
  deriveTouchSet({ id: 'T-002', title: 'Change unique.mjs' }, ['src/unique.mjs']).includes('src/unique.mjs'),
  'unambiguous title inference remains optional',
);
check(
  deriveTouchSet({ id: 'T-003', title: 'No hint' }, [], [{ taskId: 'T-003', coveredPaths: ['src/a.mjs'] }])[0] === 'src/a.mjs',
  'simulation observations can enrich conflict prediction',
);
check(
  expandWithTestHomes(['templates/contextkit/runtime/x.mjs']).includes('tools/selfcheck-gates.mjs'),
  'shared test homes expand the advisory conflict set',
);
check(
  rankCandidates([{ id: 'T-2', priority: 'P4' }, { id: 'T-1', priority: 'P0' }])[0].id === 'T-1',
  'ranking uses only canonical priority and id',
);

const tasks = [
  { id: 'T-000', title: 'Dependency', status: 'done', priority: 'P1', dependsOn: [], touchHints: [] },
  { id: 'T-001', title: 'First', status: 'backlog', priority: 'P1', dependsOn: [], touchHints: ['src/a.mjs'] },
  { id: 'T-002', title: 'Second', status: 'backlog', priority: 'P2', dependsOn: ['T-000'], touchHints: ['src/b.mjs'] },
  { id: 'T-003', title: 'Waiting', status: 'backlog', priority: 'P0', dependsOn: ['T-999'], touchHints: ['src/c.mjs'] },
  { id: 'T-004', title: 'Already running', status: 'working', priority: 'P0', dependsOn: [], touchHints: ['src/d.mjs'] },
  { id: 'T-005', title: 'Unknown touch', status: 'backlog', priority: 'P4', dependsOn: [], touchHints: [] },
];
const plan = planSwarm({ runId: 'swarm-v4', tasks, repoName: 'kit' });
check(plan.workstreams.map((entry) => entry.taskId).join(',') === 'T-001,T-002,T-005', 'only ready canonical backlog tasks are planned');
check(plan.deferred.includes('T-003'), 'unfinished dependencies defer a task');
check(plan.workstreams.find((entry) => entry.taskId === 'T-005').warnings.includes('conflict-prediction-unavailable'), 'missing touch hints warn but do not deny planning');
check(plan.workstreams.every((entry) => !('tierHint' in entry) && !('model' in entry) && !('effort' in entry)), 'plan carries no binding route or model receipt');
check(!('refused' in plan), 'planner does not manufacture a refusal authority');

const overlap = planSwarm({
  runId: 'overlap',
  tasks: [
    { id: 'T-010', title: 'A', status: 'backlog', priority: 'P1', dependsOn: [], touchHints: ['src/shared.mjs'] },
    { id: 'T-011', title: 'B', status: 'backlog', priority: 'P2', dependsOn: [], touchHints: ['src/shared.mjs'] },
  ],
});
check(overlap.workstreams.length === 1 && overlap.deferred[0] === 'T-011', 'known writer overlap stays sequential');
check(planSwarm({ runId: 'limit', tasks, hostTechnicalLimit: 1 }).workstreams.length === 1, 'only a real host limit caps concurrency');

const root = mkdtempSync(join(tmpdir(), 'contextdevkit-swarm-v4-'));
try {
  const report = createRun(root, plan, { now: 1_000 });
  check(report.schemaVersion === 1 && report.workstreams.every((entry) => entry.status === 'planned'), 'explicit create writes an optional report');
  check(manifestPath(root, plan.runId).includes(join('contextkit', 'memory', 'reports', 'swarm')), 'report path is host-neutral project memory');
  check(!manifestPath(root, plan.runId).includes('.claude'), 'report does not create host-specific authority');
  check(!('configSnapshot' in report) && !('history' in report.workstreams[0]) && !('ruleId' in report.workstreams[0]), 'report omits retired authority and ledger fields');
  assert.throws(() => createRun(root, plan), /already exists/);
  checks += 1;
  console.log(`  ok ${checks} - duplicate run ids are refused atomically`);

  updateWorkstream(root, plan.runId, 'ws-T-001', { status: 'running', now: 2_000 });
  updateWorkstream(root, plan.runId, 'ws-T-002', { status: 'completed', model: 'observed-model', effort: 'observed-effort', tokens: 12, now: 2_100 });
  const updated = readRun(root, plan.runId);
  check(updated.workstreams.find((entry) => entry.id === 'ws-T-002').status === 'completed', 'explicit report updates do not mutate task authority');
  check(runTokens(updated) === 12 && byModel(updated).some((entry) => entry.model === 'observed-model'), 'optional cost observations aggregate when supplied');
  check(byDispatch(updated).some((entry) => entry.effort === 'observed-effort'), 'optional effort observation is report-only');
  assert.throws(() => updateWorkstream(root, plan.runId, 'ws-T-001', { status: 'parked-testing' }), /invalid status/);
  checks += 1;
  console.log(`  ok ${checks} - physical-lane workstream status is rejected`);
  check(evictStale(root, plan.runId, 1, { now: 100_000 }).includes('ws-T-001'), 'stale optional report is marked failed without cleanup');
  check(listRuns(root).length === 1, 'host-neutral reports are listable');
  check(renderReport(readRun(root, plan.runId)).includes('Swarm report swarm-v4'), 'human report renders current observations');
  check(WS_STATUSES.join('|') === 'planned|running|completed|failed|cancelled', 'workstream status vocabulary is small and lane-free');

  writeFileSync(manifestPath(root, plan.runId), '{broken', 'utf8');
  check(readRun(root, plan.runId) === null, 'corrupt optional report degrades explicitly to null');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\nSwarm v4 acceptance: ${checks} checks passed.`);
