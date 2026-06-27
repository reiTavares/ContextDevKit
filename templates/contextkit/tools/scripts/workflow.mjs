#!/usr/bin/env node
/**
 * `/workflow` CLI (ADR-0057). Owns the user-facing command dispatch while
 * `workflow-pack.mjs` owns the folder/legacy parsing and report mechanics.
 */
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { statSync } from 'node:fs';
import { advanceWorkflow, checkWorkflow, createWorkflow, listWorkflows, readWorkflow } from './workflow-pack.mjs';
import { writeReport } from './workflow-report.mjs';
import { localVsFleet } from './registry/ids.mjs';
import { createWaveWorkflow } from './workflow/create.mjs';
import { refreshIndex, refreshTasks } from './workflow/render.mjs';
import { explainFile, requiredFiles } from './workflow/files.mjs';
import { listProfiles } from './workflow/profiles.mjs';
import { readJsonSafe } from './workflow/io.mjs';
import { approveGateCmd, auditCmd, checkGate, closeWave, migrateCmd, migratePlanCmd, nextRun, ownershipCheck, recordResult, refreshContinuationCmd } from './workflow/commands.mjs';

/** Best-effort git facts for the continuation prompt (never throws). */
function gitFacts() {
  const safe = (cmd) => {
    try { return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim(); } catch { return ''; }
  };
  return { branch: currentBranch(), head: safe('git rev-parse --short HEAD'), worktree: ROOT, dirty: safe('git status --porcelain').length > 0 };
}

const ROOT = process.cwd();

/** Current branch name, or '' when git is unavailable (defensive, never throws). */
function currentBranch() {
  try {
    return execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/** Repeated `--addon x --addon y` → ['x','y']. */
function multiArg(name) {
  const out = [];
  process.argv.forEach((token, idx) => {
    if (token === `--${name}` && process.argv[idx + 1]) out.push(process.argv[idx + 1]);
  });
  return out;
}

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] || fallback : fallback;
}

function positional() {
  return process.argv.slice(3).filter((item) => !item.startsWith('--'));
}

function printWorkflow(workflow) {
  if (workflow.malformed) {
    console.log(`\n  skipped (malformed): ${workflow.path}`);
    return;
  }
  console.log(`\n  ${workflow.slug} (${workflow.format}, started ${String(workflow.started).slice(0, 10) || '?'}) - current: ${workflow.currentPhase}`);
  for (const [phase, state] of Object.entries(workflow.phases)) {
    const marker = state.status === 'done' ? 'x' : state.status === 'in-progress' ? '*' : '-';
    console.log(`    ${marker} ${phase.padEnd(10)} ${state.status}${state.ref ? ` -> ${state.ref}` : ''}`);
  }
}

function status() {
  const asJson = process.argv.includes('--json');
  const target = positional()[0];
  const workflows = target ? [readWorkflow(ROOT, target)].filter(Boolean) : listWorkflows(ROOT);
  if (asJson) {
    console.log(JSON.stringify(workflows, null, 2));
    return;
  }
  if (workflows.length === 0) {
    console.log(target ? `  Workflow "${target}" not found.` : '  No workflows yet. Start one with `workflow.mjs new <slug>`.');
    return;
  }
  workflows.forEach(printWorkflow);
  console.log('');
}

function run() {
  const cmd = process.argv[2];
  try {
    if (cmd === 'new') {
      const [slug] = positional();
      const profile = arg('profile');
      if (!profile) {
        // ADR-0116: feature/architecture workflows must declare an owner work-context.
        const owner = arg('operation') || arg('business') || null;
        // ADR-0119 intake gate (advisory): the allocator is already fleet-aware, so
        // the id is collision-safe by construction; surface it only when a parallel
        // worktree held a higher WF id (local-only would have collided). Quiet otherwise.
        const wfDiverges = localVsFleet(ROOT).find((row) => row.kind === 'WF')?.diverges;
        const workflow = createWorkflow(ROOT, slug, arg('kind', 'feature'), owner);
        console.log(`Workflow "${workflow.slug}" created. Next phase: intake.`);
        if (wfDiverges) console.log('🔢 intake gate: WF number fleet-reconciled — a parallel worktree held a higher id, so a local-only allocation would have collided.');
        return;
      }
      const planPath = arg('plan');
      // ADR-0116 — feature/architecture workflows declare an owner work-context;
      // honor it on the profile/wave branch too so an owned wave-workflow nests
      // under its parent (BIZ-0001 ownership rule 3), never lands in central.
      const owner = arg('operation') || arg('business') || null;
      const result = createWaveWorkflow(ROOT, slug, {
        profile,
        pattern: arg('pattern') || undefined,
        addons: multiArg('addon'),
        plan: planPath ? readJsonSafe(planPath) : null,
        now: new Date().toISOString(),
        branch: currentBranch(),
        owner,
      });
      console.log(`Wave workflow "${result.slug}" (${result.number}) created — profile ${result.profile}, pattern ${result.pattern}.`);
      console.log(`  ${result.files.length} file(s) at ${result.dir}`);
      return;
    }
    if (cmd === 'refresh' || cmd === 'render') {
      const [slug] = positional();
      const target = readWorkflow(ROOT, slug);
      if (!target) throw new Error(`Workflow "${slug}" not found.`);
      // readWorkflow().path is the index.md file for pack workflows; the pack
      // dir is its parent. Guard the legacy single-file (.md) format too.
      const packDir = statSync(target.path).isDirectory() ? target.path : dirname(target.path);
      const now = new Date().toISOString();
      const tasksChanged = refreshTasks(packDir, { now }).changed;
      const indexChanged = refreshIndex(packDir, { now }).changed;
      const contChanged = refreshContinuationCmd(ROOT, slug, { gitFacts: gitFacts(), now }).changed;
      console.log(`Refreshed "${slug}": tasks.md ${tasksChanged ? 'updated' : 'unchanged'}, index.md ${indexChanged ? 'updated' : 'unchanged'}, CONTINUATION-PROMPT.md ${contChanged ? 'updated' : 'unchanged'}.`);
      return;
    }
    if (cmd === 'next-run') {
      const [slug] = positional();
      console.log(JSON.stringify(nextRun(ROOT, slug), null, 2));
      return;
    }
    if (cmd === 'ownership-check') {
      const [slug] = positional();
      const collisions = ownershipCheck(ROOT, slug);
      console.log(JSON.stringify(collisions, null, 2));
      if (collisions.length) process.exit(1);
      return;
    }
    if (cmd === 'record-agent-result') {
      const [slug] = positional();
      const outcome = recordResult(ROOT, slug, arg('file'), new Date().toISOString());
      console.log(`Recorded result for ${outcome.taskId} → ${outcome.resultPath}`);
      if (outcome.violations.length) {
        console.error(`  ⚠ ${outcome.violations.length} ownership violation(s): ${JSON.stringify(outcome.violations)}`);
        process.exit(1);
      }
      return;
    }
    if (cmd === 'check-gate') {
      const [slug, gateId] = positional();
      const verdict = checkGate(ROOT, slug, gateId);
      console.log(JSON.stringify(verdict, null, 2));
      if (verdict.status !== 'passed' && verdict.status !== 'approved') process.exit(1);
      return;
    }
    if (cmd === 'approve-gate') {
      const [slug, gateId] = positional();
      const approver = arg('approver') || currentBranch() || '';
      const path = approveGateCmd(ROOT, slug, gateId, { approver, evidenceFile: arg('evidence'), now: new Date().toISOString() });
      console.log(`Gate "${gateId}" approved by "${approver}" → ${path}`);
      return;
    }
    if (cmd === 'close-wave') {
      const [slug, waveId] = positional();
      const apply = process.argv.includes('--apply');
      const outcome = closeWave(ROOT, slug, waveId, { apply, now: new Date().toISOString() });
      console.log(JSON.stringify({ waveId: outcome.waveId, allTasksDone: outcome.allTasksDone, gateStatus: outcome.gate?.status ?? null, applied: outcome.applied, blocked: outcome.blocked }, null, 2));
      if (!outcome.applied && apply) process.exit(1);
      return;
    }
    if (cmd === 'audit') {
      const [slug] = positional();
      console.log(JSON.stringify(auditCmd(ROOT, slug), null, 2));
      return;
    }
    if (cmd === 'migrate-plan') {
      const [slug] = positional();
      console.log(JSON.stringify(migratePlanCmd(ROOT, slug), null, 2));
      return;
    }
    if (cmd === 'migrate') {
      const [slug] = positional();
      const apply = process.argv.includes('--apply');
      const outcome = migrateCmd(ROOT, slug, { apply, now: new Date().toISOString() });
      console.log(JSON.stringify(outcome, null, 2));
      return;
    }
    if (cmd === 'explain-file') {
      const [artifactId] = positional();
      console.log(JSON.stringify(explainFile(artifactId), null, 2));
      return;
    }
    if (cmd === 'required-files') {
      const profile = arg('profile');
      if (!profile) {
        console.log(`Profiles: ${listProfiles().join(', ')}`);
        return;
      }
      console.log(JSON.stringify(requiredFiles({ profile, addons: multiArg('addon') }), null, 2));
      return;
    }
    if (cmd === 'advance') {
      const [slug, legacyRef] = positional();
      const workflow = advanceWorkflow(ROOT, slug, arg('ref', legacyRef || ''), { force: process.argv.includes('--force') });
      console.log(workflow.currentPhase === 'done'
        ? `Workflow "${workflow.slug}" complete.`
        : `Workflow "${workflow.slug}" advanced. Next phase: ${workflow.currentPhase}.`);
      // ADR-0119 — on completion, NUDGE (don't move): filing happens at end-of-session
      // via the done-sweep Stop hook, so a concluded workflow's path stays stable for
      // the rest of THIS command/session (moving it here breaks in-flight path use).
      if (workflow.currentPhase === 'done') {
        console.log('🧹 done-sweep will file this workflow into its done/ archive at session end (or run: workflow-done-sweep.mjs --write).');
      }
      return;
    }
    if (cmd === 'check') {
      const [slug] = positional();
      const { currentPhase, missing } = checkWorkflow(ROOT, slug);
      if (!missing.length) {
        console.log(`[ok] Workflow "${slug}" - phase "${currentPhase}" is complete; ready to advance.`);
      } else {
        console.log(`[missing] Workflow "${slug}" - phase "${currentPhase}" is missing:`);
        missing.forEach((gap) => console.log(`  - ${gap}`));
        process.exit(1);
      }
      return;
    }
    if (cmd === 'status') {
      status();
      return;
    }
    if (cmd === 'report') {
      const [slug] = positional();
      const reportPath = writeReport(ROOT, slug, arg('task'), process.argv.includes('--force'));
      console.log(`Workflow report written: ${reportPath}`);
      return;
    }
    console.error('Usage: workflow.mjs <new <slug> [--kind kind] | new <slug> --profile <p> [--pattern p] [--addon a]... [--plan file] | advance <slug> [--ref ref] [--force] | check <slug> | status [slug] [--json] | refresh <slug> | next-run <slug> | ownership-check <slug> | record-agent-result <slug> --file f | check-gate <slug> <gate> | approve-gate <slug> <gate> --approver name [--evidence f] | close-wave <slug> <wave> [--apply] | audit <slug> | migrate-plan <slug> | migrate <slug> [--apply] | explain-file <id> | required-files [--profile p] | report <slug> [--task id] [--force]>');
    process.exit(1);
  } catch (err) {
    console.error(`workflow: ${err?.message ?? err}`);
    process.exit(1);
  }
}

run();
