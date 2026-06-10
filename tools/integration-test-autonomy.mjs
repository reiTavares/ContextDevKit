#!/usr/bin/env node
/**
 * ContextDevKit integration test — AUTONOMY DIAL (ADR-0041/0042).
 *
 * The consent-dial cells, end-to-end against real hooks in a temp install:
 *   - grade-blind gate: no autonomy config shape may weaken the L5 gate
 *     (regression for the level-4 bypass incident, task 100).
 *   - Stop digest: at grade ≥3 the Stop hook emits the autonomous-actions
 *     receipt (files + undo pointers), task 109.
 *   - setter round-trip: persist + session override + audit line, task 107.
 *
 * Extracted from integration-test-guards.mjs at the line-budget seam.
 * Shared harness: it-helpers.mjs. Run: node tools/integration-test-autonomy.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — autonomy dial\n');

const fx = installFixture(rep);
const { proj, cfgPath, hook, script } = fx;

try {
  const cfg = readJson(cfgPath);
  cfg.l5.highRiskPaths = ['src/secure/'];
  cfg.autonomy = { grade: 4, level: 4 };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  hook('simulate-gate.mjs', { session_id: 'gb', tool_name: 'Write', tool_input: { file_path: 'src/secure/x.js' } }).includes('"decision":"block"')
    ? ok('L5 gate blocks regardless of any autonomy config (grade-blind)')
    : bad('L5 gate weakened by autonomy config — bypass regression');

  // Task 109 — the autonomous-actions digest (consent receipt) at grade ≥3.
  cfg.autonomy = { grade: 3 };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  hook('track-edits.mjs', { session_id: 'dg', tool_name: 'Write', tool_input: { file_path: 'src/auto1.js' } });
  hook('track-edits.mjs', { session_id: 'dg', tool_name: 'Write', tool_input: { file_path: 'src/auto2.js' } });
  const stopOut = hook('check-registration.mjs', { session_id: 'dg' });
  stopOut.includes('Autonomy digest (A3)') && stopOut.includes('undo: git checkout')
    ? ok('Stop emits the autonomy digest with undo pointers at grade 3 (task 109)')
    : bad('autonomy digest missing from the Stop output at grade 3');

  // Task 112 — the unseen receipt replays once at the next boot, then clears.
  const pendingPath = join(proj, '.claude', '.workspace', 'autonomy-digest-pending.json');
  existsSync(pendingPath)
    ? ok('Stop digest persists the pending receipt for replay (task 112)')
    : bad('no pending receipt written at grade 3');
  const boot1 = hook('session-start.mjs', { session_id: 'replay' });
  boot1.includes('Unacknowledged autonomy receipt') && boot1.includes('src/auto1.js')
    ? ok('next boot replays the unacknowledged receipt (task 112)')
    : bad('boot did not replay the pending receipt');
  !existsSync(pendingPath) && !hook('session-start.mjs', { session_id: 'replay2' }).includes('Unacknowledged autonomy receipt')
    ? ok('replayed receipt is consumed — shown exactly once')
    : bad('pending receipt not consumed after replay');

  // Task 112 — step-down nudge after ≥2 recent QA bounces at grade ≥3 (suggest-only).
  script('pipeline.mjs', 'add', '--type', 'bug', '--title', 'bounce-a');
  script('pipeline.mjs', 'add', '--type', 'bug', '--title', 'bounce-b');
  const ids = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').filter((t) => /^bounce-/.test(t.title)).map((t) => t.id);
  for (const id of ids) {
    script('pipeline.mjs', 'move', id, 'testing');
    script('pipeline.mjs', 'qa-reject', id, 'flaky assertion');
  }
  hook('track-edits.mjs', { session_id: 'sd', tool_name: 'Write', tool_input: { file_path: 'src/sd1.js' } });
  hook('track-edits.mjs', { session_id: 'sd', tool_name: 'Write', tool_input: { file_path: 'src/sd2.js' } });
  hook('check-registration.mjs', { session_id: 'sd' }).includes('consider stepping the dial down')
    ? ok('step-down nudge fires after 2 QA bounces at grade 3 (suggest-only, task 112)')
    : bad('step-down nudge missing after QA bounces');

  // Task 107 — setter round-trip: persist, session override, audit trail.
  script('autonomy.mjs', '1');
  readJson(cfgPath).autonomy?.grade === 1
    ? ok('autonomy setter persists the grade (round-trip)')
    : bad('setter did not persist autonomy.grade');
  script('autonomy.mjs', '3', '--session');
  const override = readJson(join(proj, '.claude', '.workspace', 'autonomy-session.json'));
  override?.grade === 3 && Number(override?.expiresAt) > Date.now()
    ? ok('autonomy --session writes an expiring override (cheap, reversible)')
    : bad('session override missing or not expiring');
  script('autonomy.mjs', '--clear');
  const auditPath = join(proj, 'contextkit', 'memory', 'autonomy-audit.jsonl');
  const audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf-8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  audit.length >= 3 && audit.every((a) => a.actor === 'human')
    ? ok(`every grade change audited with actor=human (${audit.length} lines, ADR-0042 §4)`)
    : bad(`audit trail incomplete: ${audit.length} lines`);
} catch (err) {
  bad(`autonomy suite crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (autonomy dial)');
