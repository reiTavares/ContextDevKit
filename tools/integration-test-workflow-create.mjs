/**
 * Integration test — wave-workflow creator (WF0035, W1-T4).
 *
 * Exercises `createWaveWorkflow` over the basic / standard / program paths plus
 * add-ons, asserts the created `workflow-plan.json` passes `validatePlan`, proves
 * the legacy `readWorkflow` status parser still reads a wave-created `index.md`,
 * and confirms re-creating an existing slug throws (no clobber).
 *
 * Standalone runnable: `node tools/integration-test-workflow-create.mjs` → exit 0.
 * Packs are built in a throwaway temp root; cleaned up at the end. The clock is
 * injected (`now`) so the run is deterministic.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { createWaveWorkflow } from '../templates/contextkit/tools/scripts/workflow/create.mjs';
import { validatePlan } from '../templates/contextkit/tools/scripts/workflow/validate.mjs';
import { readWorkflow, listWorkflows } from '../templates/contextkit/tools/scripts/workflow-pack.mjs';

const rep = reporter();
const NOW = '2026-06-17T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'contextkit-wfcreate-'));
const readJsonAt = (path) => JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));

/** Assert a created pack's plan is structurally valid, return the parsed plan. */
function assertValidPlan(packDir, label) {
  const planPath = join(packDir, 'workflow-plan.json');
  if (!existsSync(planPath)) { rep.bad(`${label}: workflow-plan.json missing`); return null; }
  const plan = readJsonAt(planPath);
  const verdict = validatePlan(plan);
  verdict.valid
    ? rep.ok(`${label}: workflow-plan.json passes validatePlan`)
    : rep.bad(`${label}: plan invalid — ${verdict.errors.map((e) => e.code).join(', ')}`);
  return plan;
}

/** Assert each named file exists inside the pack dir. */
function assertFiles(packDir, names, label) {
  for (const name of names) {
    existsSync(join(packDir, name))
      ? rep.ok(`${label}: has ${name}`)
      : rep.bad(`${label}: missing ${name}`);
  }
}

try {
  // --- Basic (1-wave single-delivery) ------------------------------------
  const basic = createWaveWorkflow(root, 'basic-fix', { profile: 'basic', now: NOW });
  assertFiles(basic.dir, ['index.md', 'spec.md', 'tasks.md', 'decisions.md', 'workflow-plan.json', 'reports'], 'basic');
  const basicPlan = assertValidPlan(basic.dir, 'basic');
  if (basicPlan) {
    basicPlan.waves.length === 1
      ? rep.ok('basic: single-delivery produced 1 wave')
      : rep.bad(`basic: expected 1 wave, got ${basicPlan.waves.length}`);
  }
  // state must NOT be created at creation time
  existsSync(join(basic.dir, 'workflow-state.json'))
    ? rep.bad('basic: workflow-state.json should not exist at creation')
    : rep.ok('basic: no workflow-state.json (state is born on execution)');

  // --- Standard (multi-wave discovery-build-validate) --------------------
  const standard = createWaveWorkflow(root, 'standard-feature', { profile: 'standard', now: NOW });
  assertFiles(standard.dir, ['index.md', 'prd.md', 'spec.md', 'tasks.md', 'decisions.md', 'workflow-plan.json'], 'standard');
  const standardPlan = assertValidPlan(standard.dir, 'standard');
  if (standardPlan) {
    const waveIds = standardPlan.waves.map((w) => w.id).sort().join(',');
    waveIds === 'W0,W1,W2'
      ? rep.ok('standard: discovery-build-validate waves present (W0,W1,W2)')
      : rep.bad(`standard: unexpected waves "${waveIds}"`);
  }

  // --- Program (from a caller-provided plan) -----------------------------
  const programPlan = {
    schemaVersion: 1,
    workflowId: '9999',
    slug: 'will-be-overwritten',
    profile: 'program',
    waves: [
      { id: 'W1', title: 'Foundation', dependsOn: [], gate: 'G-W1',
        tasks: [{ id: 'W1-T1', waveId: 'W1', execution: { mode: 'agent' }, ownership: { allowedPaths: ['src/a/'] } }] },
      { id: 'W2', title: 'Integration', dependsOn: ['W1'], gate: 'G-W2', tasks: [] },
    ],
    gates: [
      { id: 'G-W1', waveId: 'W1', type: 'machine', requirements: [] },
      { id: 'G-W2', waveId: 'W2', type: 'human', requirements: [] },
    ],
  };
  const program = createWaveWorkflow(root, 'program-build', { profile: 'program', plan: programPlan, now: NOW });
  assertFiles(program.dir, ['index.md', 'prd.md', 'spec.md', 'memory.md', 'risk-register.md', 'rollout-plan.md', 'workflow-plan.json'], 'program');
  const programParsed = assertValidPlan(program.dir, 'program');
  if (programParsed) {
    programParsed.slug === 'program-build'
      ? rep.ok('program: provided plan slug overwritten with the pack slug')
      : rep.bad(`program: slug not reconciled (got "${programParsed.slug}")`);
    programParsed.waves.length === 2
      ? rep.ok('program: provided plan waves preserved (2)')
      : rep.bad(`program: expected 2 waves, got ${programParsed.waves.length}`);
  }

  // --- Add-on artifact creation ------------------------------------------
  const withAddon = createWaveWorkflow(root, 'secure-change', { profile: 'standard', addons: ['security'], now: NOW });
  assertFiles(withAddon.dir, ['threat-model.md'], 'addon');

  // --- Legacy status parser still reads a wave-created index.md ----------
  const parsed = readWorkflow(root, 'basic-fix');
  if (parsed && parsed.slug === 'basic-fix' && parsed.currentPhase === 'intake' && parsed.phases && parsed.phases.intake) {
    rep.ok('legacy readWorkflow parses a wave-created index.md (slug + currentPhase + phases)');
  } else {
    rep.bad(`legacy readWorkflow failed to parse wave index (got ${JSON.stringify(parsed && parsed.slug)})`);
  }

  // --- No clobber: re-creating an existing slug throws -------------------
  let threw = false;
  try {
    createWaveWorkflow(root, 'basic-fix', { profile: 'basic', now: NOW, number: basic.number });
  } catch {
    threw = true;
  }
  threw ? rep.ok('re-creating an existing slug throws (no clobber)') : rep.bad('duplicate-slug creation did not throw');

  // --- Unknown profile throws (fail-fast) --------------------------------
  let badProfileThrew = false;
  try { createWaveWorkflow(root, 'nope', { profile: 'does-not-exist', now: NOW }); } catch { badProfileThrew = true; }
  badProfileThrew ? rep.ok('unknown profile throws') : rep.bad('unknown profile did not throw');

  // --- Owned placement (WF-0057, BIZ-0001 rule 3) ------------------------
  // An owned workflow must nest under its parent context with `WF-` naming, NOT
  // land in the central legacy root with `NNNN-` naming.
  const opSlug = 'OP-0009-sample-operation';
  mkdirSync(join(root, 'contextkit', 'memory', 'operations', opSlug), { recursive: true });
  const owned = createWaveWorkflow(root, 'owned-change', { profile: 'basic', now: NOW, owner: 'OP-0009' });
  const ownedRel = owned.dir.split('\\').join('/');
  ownedRel.includes(`operations/${opSlug}/workflows/`) && /\/WF-\d{4}-owned-change$/.test(ownedRel)
    ? rep.ok(`owned workflow nests under operations/${opSlug}/workflows/WF-…-owned-change`)
    : rep.bad(`owned workflow misplaced: ${owned.dir}`);
  !existsSync(join(root, 'contextkit', 'memory', 'workflows', `${owned.number}-owned-change`))
    ? rep.ok('owned workflow did NOT land in the central legacy root')
    : rep.bad('owned workflow leaked into central memory/workflows/');

  // --- Cross-root RESOLVER (WF-0036 A4 gap close) ------------------------
  // The owner-nested pack above must be reachable by `readWorkflow`/`status`
  // (single-slug) AND appear in `listWorkflows` — previously both were blind to
  // anything outside the top-level `workflows/` dir.
  const nested = readWorkflow(root, 'owned-change');
  nested && nested.slug === 'owned-change' && nested.currentPhase === 'intake'
    ? rep.ok('readWorkflow resolves an owner-NESTED workflow (cross-root)')
    : rep.bad(`readWorkflow blind to nested workflow (got ${JSON.stringify(nested && nested.slug)})`);
  const nestedByPath = (nested && nested.path || '').split('\\').join('/');
  nestedByPath.includes(`operations/${opSlug}/workflows/`)
    ? rep.ok('readWorkflow returns the nested pack path (not a central path)')
    : rep.bad(`readWorkflow returned a non-nested path: ${nested && nested.path}`);
  const listed = listWorkflows(root).filter((wf) => !wf.malformed).map((wf) => wf.slug);
  listed.includes('owned-change') && listed.includes('basic-fix')
    ? rep.ok('listWorkflows includes BOTH a nested and a central workflow')
    : rep.bad(`listWorkflows missing nested/central slug (got ${JSON.stringify(listed)})`);

  // --- Absent owner folder throws (fail-fast, never silent central fallback)
  let missingOwnerThrew = false;
  try {
    createWaveWorkflow(root, 'orphan-change', { profile: 'basic', now: NOW, owner: 'OP-9999' });
  } catch {
    missingOwnerThrew = true;
  }
  missingOwnerThrew
    ? rep.ok('owner with no context folder throws (no silent fallback to central)')
    : rep.bad('missing-owner-folder creation did not throw');
} finally {
  rmSync(root, { recursive: true, force: true });
}

rep.finish('workflow-create');
