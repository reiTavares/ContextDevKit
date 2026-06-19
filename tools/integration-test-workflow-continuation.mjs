/**
 * Integration test for the compact continuation generator (WF0035, W2-T5).
 * Drives continuation.mjs against a 3-wave plan + a state (W1 done, W2
 * in-progress, W3 pending) in a throwaway temp pack, asserting the token rule:
 * completed waves compacted to one line, the current wave fully detailed, future
 * waves reduced to title/deps/status. Also verifies blocked reasons, an open
 * carry-forward, git state, NO transcript content, a preserved human-authored
 * block across regeneration, and an idempotent second refresh. Standalone:
 *   `node tools/integration-test-workflow-continuation.mjs`
 *
 * Zero runtime deps — node:* + the kit's own modules only (ADR-0001).
 * Timestamps are injected (`now`); no `Date.now()` / `Math.random()` here.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import {
  refreshContinuation,
  renderContinuation,
  writeContinuation,
} from '../templates/contextkit/tools/scripts/workflow/continuation.mjs';
import { planHash } from '../templates/contextkit/tools/scripts/workflow/plan.mjs';

const rep = reporter();
const NOW = '2026-06-17T00:00:00.000Z';
const SENTINEL = 'KEEP-ME human note xyzzy';
const TRANSCRIPT = 'assistant: let me read the file, then I will think step by step';

/** A 3-wave program plan (one detailed current wave with two tasks). */
function buildPlan() {
  const owns = (path) => ({
    allowedPaths: [path], forbiddenPaths: [], readOnlyPaths: [], sharedPaths: [],
    integrationOwner: 'orchestrator',
  });
  const task = (id, waveId, title, dependsOn) => ({
    id, waveId, title, priority: 'P0', objective: `${title} objective`,
    acceptance: ['works'], dependsOn,
    execution: { mode: 'agent', parallelizable: true, agentSlots: 1 }, ownership: owns(`a/${id}.mjs`),
  });
  return {
    schemaVersion: 1, workflowId: '0035', slug: 'cont-fixture',
    title: 'Continuation Fixture', profile: 'program',
    pattern: 'architecture-foundation-integration', journey: { currentPhase: 'spec' },
    waves: [
      { id: 'W1', title: 'Foundation', type: 'implementation', tasks: [task('W1-T1', 'W1', 'Plan', [])] },
      { id: 'W2', title: 'Orchestration', type: 'implementation',
        tasks: [task('W2-T1', 'W2', 'DAG', []), task('W2-T2', 'W2', 'Scheduler', ['W2-T1'])] },
      { id: 'W3', title: 'Hardening', type: 'implementation', dependsOn: ['W2'], tasks: [task('W3-T1', 'W3', 'Audit', [])] },
    ],
    gates: [], addons: [], artifacts: [],
  };
}

/** State: W1 done, W2 in-progress, W3 pending; an open carry-forward + a gate. */
function buildState(hash) {
  return {
    schemaVersion: 1, workflowId: '0035', planHash: hash, revision: 7, overallStatus: 'in-progress',
    journeyPhase: 'spec',
    waveStates: { W1: { status: 'done' }, W2: { status: 'in-progress' }, W3: { status: 'pending' } },
    taskStates: {
      'W1-T1': { status: 'done', commit: 'abc1234' },
      'W2-T1': { status: 'done', commit: 'def5678' }, 'W2-T2': { status: 'in-progress' },
    },
    runs: [], gateResults: { 'G-W1': 'reports/gates/G-W1.json' },
    carryForwards: [{ id: 'CF-1', fromWave: 'W1', targetWave: 'W2', priority: 'P1', title: 'leftover lint', status: 'open' }],
    integrationRecords: [{ waveId: 'W1', commit: 'merge-w1' }],
    openBlockers: ['R8 scheduler determinism'], events: [], lastUpdate: NOW,
  };
}

const SCHEDULE = {
  status: 'ready', readyWaves: ['W2'],
  blockedWaves: [{ id: 'W3', blockedBy: ['W2'] }],
  dispatches: [{ runId: 'RUN-007-A', waveId: 'W2', assignments: [{ taskId: 'W2-T2', agentSlot: 'RUN-007-A01' }] }],
  deferredTasks: [], ownershipConflicts: [], humanActions: ['Review + authorize merge to main at G-W3'],
};
const GIT = { branch: 'feat/uwwe', head: 'cafe123', worktree: 'D:/devtool_ia-uwwe', dirty: false };

const dir = mkdtempSync(join(tmpdir(), 'contextkit-cont-'));
try {
  const plan = buildPlan();
  const hash = planHash(plan);
  const state = buildState(hash);

  // --- Pure render: assert the token rule + sections. ---
  const out = renderContinuation({ plan, state, scheduleOutput: SCHEDULE, gitFacts: GIT, now: NOW });

  out.includes('**W1 — Foundation** ✅') ? rep.ok('completed wave compacted to one line') : rep.bad('completed wave not compacted');
  out.includes('`W1-T1`') ? rep.bad('completed wave leaked task detail') : rep.ok('completed wave omits task detail');

  out.includes('**W2 — Orchestration** _(in-progress)_') ? rep.ok('current wave detailed heading') : rep.bad('current wave heading missing');
  out.includes('`W2-T1` DAG [P0] — done') && out.includes('`W2-T2` Scheduler [P0] — in-progress')
    ? rep.ok('current wave shows per-task status from state') : rep.bad('current wave task detail wrong');
  out.includes('deps W2-T1') ? rep.ok('current wave task deps shown') : rep.bad('current wave task deps missing');

  /-\s+\*\*W3 — Hardening\*\* · deps W2 · pending/.test(out) ? rep.ok('future wave compact (title/deps/status)') : rep.bad('future wave not compact');
  out.includes('`W3-T1`') ? rep.bad('future wave leaked task detail') : rep.ok('future wave omits task detail');

  out.includes('Blocked: `W3` — needs W2') ? rep.ok('blocked reason present') : rep.bad('blocked reason missing');
  out.includes('Ready waves: W2') ? rep.ok('ready waves present') : rep.bad('ready waves missing');
  out.includes('RUN-007-A') && out.includes('W2-T2→RUN-007-A01') ? rep.ok('dispatch assignment present') : rep.bad('dispatch assignment missing');

  out.includes('CF-1 → W2') ? rep.ok('open carry-forward shown') : rep.bad('carry-forward missing');
  out.includes('R8 scheduler determinism') ? rep.ok('open risk shown') : rep.bad('open risk missing');
  out.includes('G-W1') ? rep.ok('recorded gate shown') : rep.bad('recorded gate missing');
  out.includes('W2-T1 @ def5678') ? rep.ok('un-integrated agent commit detected') : rep.bad('un-integrated commit missing');
  out.includes('W1-T1 @ abc1234') ? rep.bad('integrated W1 commit wrongly flagged') : rep.ok('integrated wave commit not flagged');
  out.includes('Review + authorize merge to main at G-W3') ? rep.ok('human action present') : rep.bad('human action missing');

  out.includes('branch `feat/uwwe`') && out.includes('cafe123') && out.includes('(clean)') ? rep.ok('git state present') : rep.bad('git state missing');
  out.includes('profile `program`') && out.includes('State revision: 7') ? rep.ok('workflow identity present') : rep.bad('workflow identity missing');
  out.includes(TRANSCRIPT) ? rep.bad('transcript content leaked') : rep.ok('no transcript content');

  // --- now is required (typed throw). ---
  let threw = false;
  try { renderContinuation({ plan, state, scheduleOutput: SCHEDULE, gitFacts: GIT }); } catch { threw = true; }
  threw ? rep.ok('renderContinuation throws without now') : rep.bad('renderContinuation accepted missing now');

  // --- Human-authored block preservation across regeneration. ---
  const target = join(dir, 'CONTINUATION-PROMPT.md');
  const seeded = out
    .replace('<!-- Human-authored continuation notes; preserved across regeneration. -->', SENTINEL)
    + `\n<!-- stray transcript: ${TRANSCRIPT} should not survive regeneration -->\n`;
  writeFileSync(target, seeded, 'utf-8');

  writeFileSync(join(dir, 'workflow-plan.json'), JSON.stringify(plan), 'utf-8');
  writeFileSync(join(dir, 'workflow-state.json'), JSON.stringify(buildState(hash)), 'utf-8');

  const first = refreshContinuation(dir, { scheduleOutput: SCHEDULE, gitFacts: GIT, now: NOW });
  first.changed ? rep.ok('first refresh writes') : rep.bad('first refresh did not write');
  let onDisk = readFileSync(target, 'utf-8');
  onDisk.includes(SENTINEL) ? rep.ok('human-authored block preserved across regeneration') : rep.bad('human block lost');
  onDisk.includes(TRANSCRIPT) ? rep.bad('stray transcript survived regeneration') : rep.ok('stray transcript scrubbed (outside human block)');
  (onDisk.match(/contextdevkit:human-authored:start/g) || []).length === 1 ? rep.ok('exactly one human block') : rep.bad('human block duplicated');

  // --- Idempotent: a second refresh with identical inputs writes nothing. ---
  const second = refreshContinuation(dir, { scheduleOutput: SCHEDULE, gitFacts: GIT, now: NOW });
  second.changed ? rep.bad('second identical refresh wrote (not idempotent)') : rep.ok('second identical refresh is a no-op');
  readFileSync(target, 'utf-8').includes(SENTINEL) ? rep.ok('human block still present after idempotent refresh') : rep.bad('human block lost on second refresh');

  // --- Exactly ONE continuation file (no per-wave files). ---
  const { readdirSync } = await import('node:fs');
  readdirSync(dir).filter((f) => f.toUpperCase().includes('CONTINUATION')).length === 1
    ? rep.ok('exactly one CONTINUATION-PROMPT.md (no per-wave files)') : rep.bad('unexpected continuation file count');

  // --- writeContinuation preserves a human block even from a no-pack write. ---
  const out2 = renderContinuation({ plan, state, scheduleOutput: SCHEDULE, gitFacts: GIT, now: NOW });
  writeContinuation(dir, out2).changed ? rep.bad('writeContinuation rewrote identical content') : rep.ok('writeContinuation idempotent on identical content');

  // --- Missing state ⇒ all waves pending, no throw. ---
  rmSync(join(dir, 'workflow-state.json'), { force: true });
  let absentOk = true;
  try { refreshContinuation(dir, { scheduleOutput: SCHEDULE, gitFacts: GIT, now: NOW }); } catch { absentOk = false; }
  absentOk ? rep.ok('refreshContinuation tolerates missing state') : rep.bad('refreshContinuation threw on missing state');
  /-\s+\*\*W1 — Foundation\*\* · deps none · pending/.test(readFileSync(target, 'utf-8'))
    ? rep.ok('missing state → all waves pending (future bucket)') : rep.bad('missing state did not fall back to pending');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

rep.finish('workflow-continuation');
