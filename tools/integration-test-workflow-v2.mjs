#!/usr/bin/env node
/** Workflow v2 atomic package, round-trip, portability, and repair tests. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { reporter } from './it-helpers.mjs';
import {
  createWaveWorkflow,
  repairWorkflowScaffold,
} from '../templates/contextkit/tools/scripts/workflow/create.mjs';
import {
  advanceWorkflow,
  listWorkflows,
  loadWorkflowPack,
  readWorkflow,
} from '../templates/contextkit/tools/scripts/workflow-pack.mjs';
import { requiredWorkflowArtifacts } from '../templates/contextkit/tools/scripts/workflow/catalog.mjs';
import { renderWorkflowPack } from '../templates/contextkit/tools/scripts/workflow/render.mjs';
import { validatePack } from '../templates/contextkit/tools/scripts/workflow/validate.mjs';

const rep = reporter();
const NOW = '2026-08-08T12:00:00.000Z';
const tempBase = mkdtempSync(join(tmpdir(), 'contextkit-wf-v2-'));
const root = join(tempBase, 'non git windows path');
mkdirSync(root, { recursive: true });

/** Report a boolean assertion. */
function check(condition, success, failure = success) {
  condition ? rep.ok(success) : rep.bad(failure);
}

try {
  check(!existsSync(join(root, '.git')), 'fixture is genuinely non-Git');

  const created = createWaveWorkflow(root, 'portable-flow', {
    id: 'WF-0042',
    title: 'Portable flow',
    objective: 'Prove the Workflow v2 package contract',
    now: NOW,
  });
  check(created.dir.includes('non git windows path'), 'creation works in a non-Git path containing spaces');
  check(created.dir.endsWith(join('workflows', 'WF-0042-portable-flow')), 'canonical path uses WF id and platform separators');

  for (const artifact of requiredWorkflowArtifacts()) {
    check(existsSync(join(created.dir, artifact.filename)), `create emits required ${artifact.kind}: ${artifact.filename}`);
  }
  check(readdirSync(join(created.dir, 'reports')).length === 0, 'reports directory exists even when initially empty');

  const creationVerdict = validatePack(created.dir);
  check(creationVerdict.valid, 'validatePack accepts the complete created package', JSON.stringify(creationVerdict.errors));
  check(creationVerdict.pack.definition.schemaVersion === 2, 'workflow.json uses schemaVersion 2');
  check(creationVerdict.pack.state.schemaVersion === 2 && creationVerdict.pack.state.revision === 0, 'workflow-state.json starts complete at revision 0');
  check(creationVerdict.pack.tasks.schemaVersion === 2 && creationVerdict.pack.tasks.scopeRef === 'WF-0042', 'tasks.json comes from the W06 v2 contract');
  check(creationVerdict.pack.definition.owner.kind === 'none' && creationVerdict.pack.definition.owner.id === null, 'none is an explicit valid owner');
  check(!Object.hasOwn(creationVerdict.pack.definition, 'status') && !Object.hasOwn(creationVerdict.pack.state, 'taskStates'), 'definition, aggregate state, and task authority remain separate');

  const firstRender = renderWorkflowPack(created.dir);
  check(!firstRender.tasksChanged && !firstRender.indexChanged, 'first re-render is byte-idempotent');
  const secondRender = renderWorkflowPack(created.dir);
  check(!secondRender.tasksChanged && !secondRender.indexChanged, 'second re-render remains a no-op');

  writeFileSync(join(created.dir, 'reports', '0001.md'), '# Report\n\nTests passed.\n', 'utf8');
  const loaded = loadWorkflowPack(root, 'WF-0042');
  check(loaded.definition.id === loaded.state.workflowId && loaded.tasks.scopeRef === loaded.definition.id, 'create → read preserves cross-file identity');
  check(loaded.documents.prd.includes('# PRD/PDR') && loaded.documents.spec.includes('# SPEC') && loaded.documents.decisions.includes('# Decisions'), 'read-only loader includes governed document contents');
  check(loaded.reports.length === 1 && loaded.reports[0].content.includes('Tests passed.'), 'read-only loader includes ordered report contents');
  check(validatePack(loaded.dir).valid, 'create → read → render → validate round-trip passes');

  const concise = readWorkflow(root, 'portable-flow');
  check(concise.id === 'WF-0042' && concise.currentPhase === 'intake', 'reader resolves by slug without parsing index.md');
  check(listWorkflows(root).some((workflow) => workflow.id === 'WF-0042'), 'catalog lists the neutral v2 workflow');

  const canonicalTasks = readFileSync(join(created.dir, 'pipeline', 'tasks.json'), 'utf8');
  writeFileSync(join(created.dir, 'pipeline', 'tasks.md'), '# drift\n', 'utf8');
  check(validatePack(created.dir).errors.some((error) => error.code === 'projection-drift'), 'validator detects generated Markdown drift');
  check(renderWorkflowPack(created.dir).tasksChanged, 'renderer repairs tasks.md from canonical JSON');
  check(readFileSync(join(created.dir, 'pipeline', 'tasks.json'), 'utf8') === canonicalTasks, 'projection repair never mutates tasks.json');
  check(!renderWorkflowPack(created.dir).tasksChanged, 'projection repair is idempotent');

  const absenceRoot = join(tempBase, 'absence-fixtures');
  mkdirSync(absenceRoot, { recursive: true });
  for (const artifact of requiredWorkflowArtifacts()) {
    const fixture = join(absenceRoot, artifact.id);
    cpSync(created.dir, fixture, { recursive: true });
    rmSync(join(fixture, artifact.filename), { recursive: true, force: true });
    const verdict = validatePack(fixture);
    check(!verdict.valid && verdict.errors.some((error) => error.path === artifact.filename), `validatePack detects missing ${artifact.filename}`);
  }

  rmSync(join(created.dir, 'workflow-state.json'));
  const dryRun = repairWorkflowScaffold(created.dir, { write: false, now: NOW });
  check(dryRun.status === 'repair-required' && dryRun.missing.includes('workflow-state.json'), 'incomplete v2 scaffold repair is explicit and dry-run first');
  check(!existsSync(join(created.dir, 'workflow-state.json')), 'repair dry-run performs zero writes');
  const repaired = repairWorkflowScaffold(created.dir, { write: true, now: NOW });
  check(repaired.status === 'repaired' && validatePack(created.dir).valid, 'write repair stages, validates, swaps, and restores a complete package');
  const parentEntries = readdirSync(join(root, 'contextkit', 'memory', 'workflows'));
  check(!parentEntries.some((name) => name.includes('.repair-') || name.includes('.previous')), 'repair leaves no staging or backup directory');

  const advanced = advanceWorkflow(root, 'WF-0042', '', { now: '2026-08-08T12:01:00.000Z', expectedRevision: 0 });
  check(advanced.revision === 1 && advanced.currentPhase === 'prd' && advanced.status === 'working', 'aggregate state advances with monotonic CAS revision');
  check(validatePack(created.dir).valid, 'aggregate state advance regenerates projections and leaves the package valid');

  writeFileSync(join(created.dir, 'workflow-plan.json'), '{}\n', 'utf8');
  check(validatePack(created.dir).errors.some((error) => error.code === 'duplicate-authority'), 'validator rejects workflow-plan.json as a duplicate runtime authority');
  rmSync(join(created.dir, 'workflow-plan.json'));

  let creationFailed = false;
  try {
    createWaveWorkflow(root, 'invalid-task', {
      id: 'WF-0099',
      objective: 'Force a staged validation failure',
      now: NOW,
      tasks: [{ id: 'T-001' }],
    });
  } catch {
    creationFailed = true;
  }
  check(creationFailed, 'invalid tasks refuse creation before publication');
  check(!existsSync(join(root, 'contextkit', 'memory', 'workflows', 'WF-0099-invalid-task')), 'failed creation publishes no partial target');
  check(!readdirSync(join(root, 'contextkit', 'memory', 'workflows')).some((name) => name.startsWith('.workflow-create-')), 'failed creation removes its staging directory');

  const cli = join(process.cwd(), 'templates', 'contextkit', 'tools', 'scripts', 'workflow.mjs');
  const removedPlanHash = spawnSync(process.execPath, [cli, 'conclude', 'WF-0042', '--adopt-plan-hash'], {
    cwd: root,
    encoding: 'utf8',
  });
  check(removedPlanHash.status === 1 && removedPlanHash.stderr.includes('explicit offline migrate-v3-to-v4'), 'v2 CLI fences the staged ADR-0156 plan-hash surface with explicit migration guidance');
} finally {
  rmSync(tempBase, { recursive: true, force: true });
}

rep.finish('workflow-v2');
