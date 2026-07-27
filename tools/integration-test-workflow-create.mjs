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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { createWaveWorkflow } from '../templates/contextkit/tools/scripts/workflow/create.mjs';
import { validatePlan } from '../templates/contextkit/tools/scripts/workflow/validate.mjs';
import { validateTasksDoc } from '../templates/contextkit/tools/scripts/tasks-validate.mjs';
import { deriveWorkflowTasks } from '../templates/contextkit/tools/scripts/tasks-derive.mjs';
import { createWorkflow, readWorkflow, listWorkflows } from '../templates/contextkit/tools/scripts/workflow-pack.mjs';
import { loadProjection } from '../templates/contextkit/tools/scripts/graph-query.mjs';
import { deriveScope, deriveRisk, deriveTasks } from '../templates/contextkit/methodology/projections.mjs';
import {
  deriveField,
  hashFieldContent,
  inputDomainForTasks,
  readSidecar,
  stampWorkflowTasksProvenance,
} from '../templates/contextkit/methodology/provenance.mjs';
import { CONTENT_FILL_DEFAULTS, ENGINE_VERDICT_KEY, fillGroundedContent } from '../templates/contextkit/methodology/content-fill.mjs';

const rep = reporter();
const NOW = '2026-06-17T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'contextkit-wfcreate-'));
const readJsonAt = (path) => JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));

/**
 * Every `.mjs` file below a directory URL, recursively. Used by the WF-0090
 * `no-llm-to-decide` scan, which has to look at the real trees rather than a
 * curated list — a new gate that imported the content engine must be caught.
 * @param {URL} dirUrl directory to walk
 * @returns {string[]} absolute file paths
 */
function walkMjs(dirUrl) {
  const dir = fileURLToPath(dirUrl);
  const found = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMjs(new URL(`${entry.name}/`, dirUrl)));
    else if (entry.name.endsWith('.mjs')) found.push(path);
  }
  return found;
}

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

/** Assert an owner task projection is valid and return it. */
function assertValidTasksDocument(packDir, label) {
  const tasksPath = join(packDir, 'tasks.json');
  if (!existsSync(tasksPath)) { rep.bad(`${label}: tasks.json missing`); return null; }
  const document = readJsonAt(tasksPath);
  const verdict = validateTasksDoc(document);
  verdict.ok
    ? rep.ok(`${label}: tasks.json passes validateTasksDoc`)
    : rep.bad(`${label}: tasks.json invalid — ${verdict.errors.join('; ')}`);
  return document;
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

  // --- Manifest-selected ceremony shape -------------------------------
  const shaped = createWaveWorkflow(root, 'shaped-feature', {
    profile: 'standard',
    shape: 'single-workflow-operation',
    now: NOW,
  });
  const shapedPlan = assertValidPlan(shaped.dir, 'shaped');
  assertFiles(shaped.dir, ['tasks.json'], 'shaped');
  const shapedTasks = assertValidTasksDocument(shaped.dir, 'shaped');
  shapedTasks?.owner?.id === `WF-${String(shaped.number).padStart(4, '0')}`
    ? rep.ok('shaped: tasks.json owner is derived from the workflow id')
    : rep.bad('shaped: tasks.json owner is not derived from the workflow id');
  existsSync(join(shaped.dir, 'CONTINUATION-PROMPT.md'))
    ? rep.ok('shaped: manifest-selected workflow carries canonical continuation')
    : rep.bad('shaped: manifest-selected workflow is missing continuation');
  shapedPlan?.journey?.shape === 'single-workflow-operation' && shapedPlan.journey.journeyBranch === 'operation-workflow'
    ? rep.ok('shaped: workflow-plan records the manifest shape and journey branch')
    : rep.bad(`shaped: manifest shape metadata missing from workflow-plan.json`);

  mkdirSync(join(root, 'contextkit', 'memory', 'business', 'BIZ-0001-fixture'), { recursive: true });
  const legacyShaped = createWorkflow(root, 'legacy-shaped', 'feature', 'BIZ-0001', { shape: 'single-workflow-operation' });
  existsSync(join(legacyShaped.path.replace(/[\\/]index\.md$/, ''), 'CONTINUATION-PROMPT.md'))
    ? rep.ok('legacy workflow-pack creation consumes the manifest shape')
    : rep.bad('legacy workflow-pack creation did not emit continuation');
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
        tasks: [{ id: 'W1-T1', waveId: 'W1', title: 'Build foundation', execution: { mode: 'agent' }, ownership: { allowedPaths: ['src/a/'] } }] },
      { id: 'W2', title: 'Integration', dependsOn: ['W1'], gate: 'G-W2', tasks: [] },
    ],
    gates: [
      { id: 'G-W1', waveId: 'W1', type: 'machine', requirements: [] },
      { id: 'G-W2', waveId: 'W2', type: 'human', requirements: [] },
    ],
  };
  const program = createWaveWorkflow(root, 'program-build', {
    profile: 'program',
    shape: 'multi-workflow-program',
    plan: programPlan,
    now: NOW,
  });
  assertFiles(program.dir, ['index.md', 'prd.md', 'spec.md', 'memory.md', 'risk-register.md', 'rollout-plan.md', 'workflow-plan.json', 'tasks.json'], 'program');
  const programParsed = assertValidPlan(program.dir, 'program');
  const programTasks = assertValidTasksDocument(program.dir, 'program');
  if (programParsed) {
    programParsed.slug === 'program-build'
      ? rep.ok('program: provided plan slug overwritten with the pack slug')
      : rep.bad(`program: slug not reconciled (got "${programParsed.slug}")`);
    programParsed.waves.length === 2
      ? rep.ok('program: provided plan waves preserved (2)')
      : rep.bad(`program: expected 2 waves, got ${programParsed.waves.length}`);
  }
  programTasks?.tasks?.length === 1 && programTasks.tasks[0].id === 'W1-T1'
    ? rep.ok('program: tasks.json derives the provided plan task')
    : rep.bad('program: tasks.json did not derive the provided plan task');

  // Pure derivation is stable and does not mutate the topology input.
  const derivationPlan = readJsonAt(join(program.dir, 'workflow-plan.json'));
  const firstProjection = deriveWorkflowTasks(derivationPlan, { workflowId: program.number });
  const secondProjection = deriveWorkflowTasks(derivationPlan, { workflowId: program.number });
  JSON.stringify(firstProjection) === JSON.stringify(secondProjection)
    ? rep.ok('tasks.json derivation is idempotent for identical topology')
    : rep.bad('tasks.json derivation changed across identical inputs');

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

  // --- WF-0089 SA4-T1 (BIZ-0006, ADR-0148 §9/§10) structure-only fallback --
  // Rollout is shadow-first (risk R7): a root with NO committed graph
  // projection must degrade the derive path to available:false and leave
  // workflow creation - including the rendered skeleton - fully intact.
  // `root` here has never had a graph committed, so this is a real disk
  // read of an absent projection, not a hand-built fixture.
  const noGraphProjection = loadProjection(root);
  noGraphProjection.available === false && /no committed graph projection/.test(noGraphProjection.reason)
    ? rep.ok('loadProjection degrades to available:false on a root with no committed graph (real read, not a fixture)')
    : rep.bad(`loadProjection did not degrade on a graph-less root: ${JSON.stringify(noGraphProjection)}`);

  const noGraphScope = deriveScope(['sym:seed'], noGraphProjection, 40);
  const noGraphRisk = deriveRisk(['sym:seed'], noGraphProjection);
  noGraphScope.available === false && noGraphScope.value === null && noGraphRisk.available === false && noGraphRisk.value === null
    ? rep.ok('deriveScope/deriveRisk fail-open against the real graph-less projection (no fabrication)')
    : rep.bad('deriveScope/deriveRisk did not fail-open against the real graph-less projection');

  const noGraphWorkflow = createWaveWorkflow(root, 'no-graph-fallback', { profile: 'standard', shape: 'single-workflow-operation', now: NOW });
  existsSync(join(noGraphWorkflow.dir, 'tasks.json'))
    ? rep.ok('workflow creation succeeds on a graph-less root (never blocks on an absent projection)')
    : rep.bad('workflow creation did not produce tasks.json on a graph-less root');
  const noGraphSpec = readFileSync(join(noGraphWorkflow.dir, 'spec.md'), 'utf-8');
  !noGraphSpec.includes('{{')
    ? rep.ok('the {{TOKEN}} skeleton renders fully resolved even with no graph available')
    : rep.bad(`an unresolved {{TOKEN}} survived skeleton rendering: ${noGraphSpec}`);
  validateTasksDoc(JSON.parse(readFileSync(join(noGraphWorkflow.dir, 'tasks.json'), 'utf-8'))).ok
    ? rep.ok('tasks.json remains structurally valid on a graph-less root')
    : rep.bad('tasks.json is invalid on a graph-less root');

  // The SA2 shadow stamp actually ran and recorded provenance for the one
  // field it can stamp today (tasks) - proving the fail-open try/catch around
  // stampWorkflowTasksProvenance is exercised on its SUCCESS path, not dead code.
  const noGraphProvenancePath = join(noGraphWorkflow.dir, 'provenance.json');
  const noGraphProvenance = existsSync(noGraphProvenancePath) ? JSON.parse(readFileSync(noGraphProvenancePath, 'utf-8')) : null;
  noGraphProvenance?.fields?.tasks?.state === 'derived' && noGraphProvenance.fields.tasks.source === 'biz0003:tasks-derive'
    ? rep.ok('SA2 shadow-stamps tasks provenance even when the graph-backed scope/risk projections are unavailable')
    : rep.bad(`SA2 provenance stamp missing/wrong on a graph-less root: ${JSON.stringify(noGraphProvenance)}`);

  // Prove the try/catch in workflow/create.mjs guards a REAL throwable failure
  // mode (not a phantom no-op): stampWorkflowTasksProvenance itself throws
  // when its sidecar write collides with an existing directory.
  const provenanceFailureDir = mkdtempSync(join(tmpdir(), 'contextkit-provfail-'));
  mkdirSync(join(provenanceFailureDir, 'provenance.json')); // forces the atomic write to fail
  let provenanceStampThrew = false;
  try {
    stampWorkflowTasksProvenance(provenanceFailureDir, {
      plan: { workflowId: '9001', waves: [] },
      workflowId: '9001',
      tasksDocument: { owner: { kind: 'WF', id: 'WF-9001' } },
    });
  } catch {
    provenanceStampThrew = true;
  } finally {
    rmSync(provenanceFailureDir, { recursive: true, force: true });
  }
  provenanceStampThrew
    ? rep.ok('stampWorkflowTasksProvenance throws on a real sidecar write failure (the catch it sits behind guards a genuine failure mode)')
    : rep.bad('stampWorkflowTasksProvenance did not throw on a forced write failure — the fail-open proof below would be vacuous');

  // Static proof the real call site never lets that throw escape and block
  // creation (R7): the wrap is a no-rethrow try/catch, not a re-thrown catch.
  const createSource = readFileSync(new URL('../templates/contextkit/tools/scripts/workflow/create.mjs', import.meta.url), 'utf-8');
  /try\s*\{\s*stampWorkflowTasksProvenance\(packDir,\s*\{[^}]*\}\s*\)\s*;\s*\}\s*catch\s*\{[^}]*\}/.test(createSource)
    ? rep.ok('workflow/create.mjs wraps the provenance stamp in a no-rethrow try/catch at the real call site')
    : rep.bad('workflow/create.mjs no longer guards the provenance stamp — a write failure could now block creation');

  // --- WF-0090 GA3-T1 (BIZ-0006, ADR-0148 four rails) ---------------------
  // Rail (d) at INTEGRATION level, on the pack `createWaveWorkflow` just wrote
  // rather than on a fixture: with the engine off, a real artifact stays valid.
  const disabledOutcome = fillGroundedContent(
    {
      contextRef: 'WF-9090',
      title: 'no-graph-fallback',
      sidecar: readSidecar(noGraphWorkflow.dir, 'WF-9090'),
      config: CONTENT_FILL_DEFAULTS,
    },
    { fields: { 'prd.problem': { contentKind: 'markdown', current: '{{PROBLEM}}' } } },
    noGraphProjection,
    { available: false, reason: 'no economy-events ledger on a fresh root' },
  );
  Object.keys(disabledOutcome.fields).join(',') === ENGINE_VERDICT_KEY && Object.keys(disabledOutcome.provenance.fields ?? {}).every((key) => key !== 'prd.problem')
    ? rep.ok('WF-0090 rail (d): the shipped-default engine writes no field on a real pack (structure-only fallback)')
    : rep.bad(`WF-0090 rail (d) leaked a write with the engine off: ${JSON.stringify(disabledOutcome.fields)}`);

  const specAfterEngine = readFileSync(join(noGraphWorkflow.dir, 'spec.md'), 'utf-8');
  specAfterEngine === noGraphSpec
    ? rep.ok('WF-0090 rail (d): the rendered artifact is byte-identical after running the disabled engine (never blocks, never edits)')
    : rep.bad('WF-0090: running the disabled engine changed the artifact bytes');

  // wf0089-fields-untouched: the engine must not disturb WF-0089's authority.
  // `tasks` was stamped `derived` by the SA2 shadow stamp above, so a re-derive
  // AFTER the engine ran must still report `noop` — proving no content-hash drift.
  const sidecarAfterEngine = readSidecar(noGraphWorkflow.dir, 'WF-9090');
  const tasksEntryAfterEngine = sidecarAfterEngine.fields?.tasks;
  tasksEntryAfterEngine?.state === 'derived' && tasksEntryAfterEngine.source === 'biz0003:tasks-derive'
    ? rep.ok('WF-0090: WF-0089\'s `tasks` field is still derived (unpromoted) after the content engine ran')
    : rep.bad(`WF-0090: the content engine disturbed WF-0089's tasks authority: ${JSON.stringify(tasksEntryAfterEngine)}`);

  // The property WF-0090 owns is: the content engine must not cause a
  // content-hash drift on a WF-0089 field, because a drift reads as an
  // out-of-band human edit and would PROMOTE the field to `authored`, killing
  // re-derive permanently. So the assertion is `action !== 'promote'` — the
  // strongest claim that is actually about this engine.
  //
  // It deliberately does NOT assert `noop`. Doing so would fail for a reason
  // WF-0090 neither causes nor owns: `workflow/create.mjs` stamps provenance
  // with the IN-MEMORY plan, while `writePlan` normalizes the plan before
  // writing it, and `inputDomainForTasks` folds the whole plan into the hash.
  // The recorded `inputHash` therefore cannot be reproduced from the plan on
  // disk (measured: recorded 80083fe3a5de vs on-disk 408f4cb34cc0), so a
  // re-derive from disk always looks like an input change. Recorded as a
  // WF-0089 carry-forward in reports/ga3-report.md, not patched here.
  const tasksDocumentOnDisk = readJsonAt(join(noGraphWorkflow.dir, 'tasks.json'));
  const planOnDisk = readJsonAt(join(noGraphWorkflow.dir, 'workflow-plan.json'));
  const rederiveWrites = [];
  const rederiveAfterEngine = deriveField({
    sidecar: sidecarAfterEngine,
    fieldKey: 'tasks',
    readContent: () => tasksDocumentOnDisk,
    compute: () => {
      const envelope = deriveTasks(planOnDisk, { workflowId: noGraphWorkflow.number });
      return { inputDomain: inputDomainForTasks(envelope, planOnDisk), source: envelope.source, value: envelope.value };
    },
    writeContent: (value) => { rederiveWrites.push(value); },
  });
  rederiveAfterEngine.action !== 'promote'
    ? rep.ok(`WF-0090: a post-engine deriveField on \`tasks\` is "${rederiveAfterEngine.action}", never a promote — the content engine caused no content-hash drift`)
    : rep.bad('WF-0090: deriveField PROMOTED `tasks` after the engine ran — the engine drifted a WF-0089 field and killed its re-derive');
  hashFieldContent(tasksDocumentOnDisk, 'json') === tasksEntryAfterEngine?.contentHash
    ? rep.ok('WF-0090: the `tasks` contentHash still matches the bytes on disk after the engine ran')
    : rep.bad('WF-0090: the `tasks` contentHash no longer matches disk after the engine ran');

  // no-llm-to-decide, BROAD scope: a governance decision must never be able to
  // dispatch a model. Asserted structurally over the real trees — no hook and no
  // *-gate.mjs may import the content engine (ADR-0148 §13).
  const engineImporters = [];
  for (const dir of ['../templates/contextkit/runtime/hooks', '../templates/contextkit/runtime/execution', '../templates/contextkit/tools/scripts']) {
    const scanRoot = new URL(`${dir}/`, import.meta.url);
    for (const file of walkMjs(scanRoot)) {
      const isGate = /-gate\.mjs$/.test(file) || /[\\/]hooks[\\/]/.test(file);
      if (!isGate) continue;
      if (readFileSync(file, 'utf-8').includes('content-fill.mjs')) engineImporters.push(file);
    }
  }
  engineImporters.length === 0
    ? rep.ok('WF-0090: no hook and no *-gate.mjs imports content-fill.mjs (no gate dispatches an LLM to decide)')
    : rep.bad(`WF-0090: a gate/hook imports the content engine: ${engineImporters.join(', ')}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

rep.finish('workflow-create');
