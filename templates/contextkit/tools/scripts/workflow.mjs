#!/usr/bin/env node
/**
 * `/workflow` CLI (ADR-0057). Owns the user-facing command dispatch while
 * `workflow-pack.mjs` owns the folder/legacy parsing and report mechanics.
 */
import { advanceWorkflow, createWorkflow, listWorkflows, readWorkflow, writeReport } from './workflow-pack.mjs';

const ROOT = process.cwd();

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] || fallback : fallback;
}

function positional() {
  return process.argv.slice(3).filter((item) => !item.startsWith('--'));
}

function printWorkflow(workflow) {
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
      const workflow = createWorkflow(ROOT, slug, arg('kind', 'feature'));
      console.log(`Workflow "${workflow.slug}" created. Next phase: intake.`);
      return;
    }
    if (cmd === 'advance') {
      const [slug, legacyRef] = positional();
      const workflow = advanceWorkflow(ROOT, slug, arg('ref', legacyRef || ''));
      console.log(workflow.currentPhase === 'done'
        ? `Workflow "${workflow.slug}" complete.`
        : `Workflow "${workflow.slug}" advanced. Next phase: ${workflow.currentPhase}.`);
      return;
    }
    if (cmd === 'status') {
      status();
      return;
    }
    if (cmd === 'report') {
      const [slug] = positional();
      const reportPath = writeReport(ROOT, slug, arg('task'));
      console.log(`Workflow report written: ${reportPath}`);
      return;
    }
    console.error('Usage: workflow.mjs <new <slug> [--kind kind] | advance <slug> [--ref ref] | status [slug] [--json] | report <slug> [--task id]>');
    process.exit(1);
  } catch (err) {
    console.error(`workflow: ${err?.message ?? err}`);
    process.exit(1);
  }
}

run();
