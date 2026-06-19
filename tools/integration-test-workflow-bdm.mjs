#!/usr/bin/env node
/**
 * Integration test — BIZ-0001 / WF-0036 Wave A1 end-to-end behaviour (Gate G-A1).
 *
 * Drives the real A1 runtime modules against throwaway temp project roots and
 * asserts the four load-bearing behaviours the gate requires:
 *   (a) `work operation` create is DRY-RUN BY DEFAULT (writes nothing); `--apply`
 *       writes a schema-VALID operation.json + reason.md + tasks.md atomically.
 *   (b) the task renderer is byte-IDEMPOTENT on re-render and preserves human
 *       notes that live OUTSIDE the managed block.
 *   (c) registry generation indexes BIZ-0001 + WF-0036 + WF-0037 + a legacy
 *       NNNN workflow, and a rebuild is byte-idempotent.
 *   (d) the ID allocators (nextWorkflowNumber / nextBusinessId / nextOperationId)
 *       scan ALL roots and never collide with existing ids.
 *
 * Modules are imported directly and exercised with an injected `root`, so the
 * assertions are real (no false-pass). Every scenario uses an isolated temp root
 * and cleans up. Zero runtime deps — node:* only; reuses `it-helpers.mjs#reporter`.
 *
 * Run: node tools/integration-test-workflow-bdm.mjs  (exits 0 on green).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { pathsFor } from '../templates/contextkit/runtime/config/paths.mjs';
import { validateOperation } from '../templates/contextkit/runtime/work/schema-operation.mjs';
import { runOperationCreate } from '../templates/contextkit/tools/scripts/work-operation.mjs';
import { renderTasksFile, operationTasksMarkers } from '../templates/contextkit/tools/scripts/work-render.mjs';
import { buildTasksMd, buildOperationJson } from '../templates/contextkit/tools/scripts/work-templates.mjs';
import {
  buildWorkContextRegistry, writeWorkContextRegistry,
} from '../templates/contextkit/tools/scripts/registry/work-context.mjs';
import {
  buildWorkflowRegistry, writeWorkflowRegistry, resolveWorkflow,
} from '../templates/contextkit/tools/scripts/registry/workflow.mjs';
import {
  nextBusinessId, nextOperationId, nextWorkflowNumber,
} from '../templates/contextkit/tools/scripts/registry/ids.mjs';
import { serializeRegistry } from '../templates/contextkit/tools/scripts/registry/serialize.mjs';

const rep = reporter();

/** Run `body(root)` against a fresh temp project root, always cleaning up. */
function withTempRoot(body) {
  const root = mkdtempSync(resolve(tmpdir(), 'ckit-bdm-it-'));
  try { body(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Writes a JSON file, creating parents. */
function writeJson(path, payload) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

// ===========================================================================
// (a) Operation create — dry-run writes nothing; --apply writes a valid package.
// ===========================================================================
withTempRoot((root) => {
  const ctx = { positionals: ['Rotate the staging API key'], flags: {}, root, now: '2026-06-19' };
  const operationsRoot = pathsFor(root).operations;

  // Dry-run (apply:false) — must write nothing but still plan three files.
  const dry = runOperationCreate({ ...ctx, apply: false });
  dry.applied === false && dry.mode === 'dry-run'
    ? rep.ok('create dry-run: receipt mode=dry-run, applied=false')
    : rep.bad(`create dry-run: wrong receipt ${JSON.stringify(dry)}`);
  dry.writes.length === 3
    ? rep.ok('create dry-run: plans exactly 3 files')
    : rep.bad(`create dry-run: expected 3 planned writes, got ${dry.writes.length}`);
  !existsSync(operationsRoot)
    ? rep.ok('create dry-run: NOTHING written to disk (operations root absent)')
    : rep.bad('create dry-run LEAKED a write — operations root exists after a dry-run');

  // Apply — must write a schema-valid operation.json + reason.md + tasks.md.
  const applied = runOperationCreate({ ...ctx, apply: true });
  applied.applied === true && applied.mode === 'apply'
    ? rep.ok('create --apply: receipt mode=apply, applied=true')
    : rep.bad(`create --apply: wrong receipt ${JSON.stringify(applied)}`);

  const dir = applied.detail.dir;
  const opJsonPath = resolve(dir, 'operation.json');
  const reasonPath = resolve(dir, 'reason.md');
  const tasksPath = resolve(dir, 'tasks.md');
  const allThere = existsSync(opJsonPath) && existsSync(reasonPath) && existsSync(tasksPath);
  allThere
    ? rep.ok('create --apply: operation.json + reason.md + tasks.md all written')
    : rep.bad(`create --apply: missing artifact(s) under ${dir}`);

  // The written operation.json must validate against the A1-T1 contract.
  try {
    const parsed = JSON.parse(readFileSync(opJsonPath, 'utf-8'));
    const verdict = validateOperation(parsed);
    verdict.ok
      ? rep.ok('create --apply: written operation.json is schema-VALID')
      : rep.bad(`create --apply: operation.json invalid — ${verdict.errors.join('; ')}`);
    parsed.id === 'OP-0001' && /^OP-0001-/.test(applied.detail.slug ? `OP-0001-${applied.detail.slug}` : '')
      ? rep.ok('create --apply: id OP-0001 + slugged folder')
      : rep.bad(`create --apply: unexpected id/slug ${parsed.id}/${applied.detail.slug}`);
  } catch (err) {
    rep.bad(`create --apply: operation.json unreadable/invalid JSON — ${err?.message ?? err}`);
  }

  // Atomicity proof: no leftover temp files in the package directory.
  const stray = readdirSync(dir).filter((name) => name.includes('.tmp') || /~$/.test(name));
  stray.length === 0
    ? rep.ok('create --apply: no temp residue (atomic writes)')
    : rep.bad(`create --apply: stray temp file(s) ${stray.join(', ')}`);

  // Direct/Batch modes both produce valid operations; workflow mode is refused.
  const batch = buildOperationJson({
    id: 'OP-0002', title: 'Backfill', slug: 'backfill', kind: 'MAINTENANCE',
    executionMode: 'batch', valueIntents: { primary: 'IMPROVE', secondary: [] },
  });
  validateOperation(batch).ok
    ? rep.ok('create: batch-mode operation is schema-valid')
    : rep.bad('create: batch-mode operation should validate');
  try {
    runOperationCreate({ positionals: ['x'], flags: { mode: 'workflow' }, root, apply: false });
    rep.bad('create: --mode workflow should be refused, but it was accepted');
  } catch (err) {
    /workflow/.test(err?.message ?? '')
      ? rep.ok('create: --mode workflow refused with a clear error')
      : rep.bad(`create: workflow refusal wrong error — ${err?.message}`);
  }
});

// ===========================================================================
// (b) Task renderer — byte-idempotent + preserves out-of-block human notes.
// ===========================================================================
withTempRoot((root) => {
  const markers = operationTasksMarkers();
  const tasksPath = resolve(root, 'tasks.md');
  const HUMAN_NOTE = '## Notes\n\nKEEP-ME: a human-authored note outside the block.\n';
  // Seed a tasks.md with an empty managed block + a human note section appended.
  const seed = `${buildTasksMd({ id: 'OP-0001' }, markers)}\n${HUMAN_NOTE}`;
  writeFileSync(tasksPath, seed);

  const cards = [
    { id: 'TASK-002', title: 'Second', type: 'task', priority: 'P1', stage: 'testing' },
    { id: 'TASK-001', title: 'First', type: 'bug', priority: 'P0', stage: 'backlog' },
  ];
  const first = renderTasksFile(tasksPath, cards);
  first.changed
    ? rep.ok('render: first render reports a change')
    : rep.bad('render: first render should have changed the file');
  const afterFirst = readFileSync(tasksPath, 'utf-8');

  // Idempotency: re-render with identical cards must be a byte-identical no-op.
  const second = renderTasksFile(tasksPath, cards);
  const afterSecond = readFileSync(tasksPath, 'utf-8');
  !second.changed && afterSecond === afterFirst
    ? rep.ok('render: re-render is byte-IDEMPOTENT (no change)')
    : rep.bad('render: re-render mutated the file — not idempotent');

  // Out-of-block human note survived the projection.
  afterFirst.includes('KEEP-ME: a human-authored note outside the block.')
    ? rep.ok('render: out-of-block human note preserved verbatim')
    : rep.bad('render: human note was clobbered by the renderer');

  // Cards are sorted by id inside the block (deterministic projection).
  afterFirst.indexOf('TASK-001') < afterFirst.indexOf('TASK-002')
    ? rep.ok('render: cards projected in id order (deterministic)')
    : rep.bad('render: cards not sorted by id');

  // A different card set DOES change the file (renderer is not inert).
  const third = renderTasksFile(tasksPath, [{ id: 'TASK-003', title: 'Third' }]);
  third.changed
    ? rep.ok('render: a new card set produces a real change')
    : rep.bad('render: changed inputs should have rewritten the block');
});

// ===========================================================================
// (c) Registry generation — indexes all roots; rebuild byte-idempotent.
// ===========================================================================
withTempRoot((root) => {
  const paths = pathsFor(root);
  const bizDir = resolve(paths.business, 'BIZ-0001-fixture');
  writeJson(resolve(bizDir, 'business.json'), { id: 'BIZ-0001', status: 'approved', title: 'Fixture Business' });
  const wfRoot = resolve(bizDir, 'workflows');
  writeJson(resolve(wfRoot, 'WF-0036-arch', 'workflow-plan.json'), { workflowId: 'WF-0036', slug: 'arch', title: 'Architecture' });
  writeJson(resolve(wfRoot, 'WF-0036-arch', 'workflow-state.json'), { overallStatus: 'in-progress' });
  writeJson(resolve(wfRoot, 'WF-0037-gov', 'workflow-plan.json'), { workflowId: 'WF-0037', slug: 'gov', title: 'Governance' });
  writeJson(resolve(wfRoot, 'WF-0037-gov', 'workflow-state.json'), { overallStatus: 'not-started' });
  const legacyDir = resolve(paths.memory, 'workflows', '0033-old-workflow');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(resolve(legacyDir, 'index.md'), '# WF0033 — old\n\n**Status:** planning complete\n');

  const wcText = writeWorkContextRegistry(root);
  const wc = JSON.parse(wcText);
  wc.contexts.some((row) => row.id === 'BIZ-0001' && row.type === 'business' && row.status === 'approved')
    ? rep.ok('work-context registry indexes BIZ-0001 with status')
    : rep.bad('work-context registry missing BIZ-0001 / status');

  const wfText = writeWorkflowRegistry(root);
  const wf = JSON.parse(wfText);
  const ids = wf.workflows.map((row) => row.id);
  ids.includes('WF-0036') && ids.includes('WF-0037') && ids.includes('0033')
    ? rep.ok('workflow registry indexes WF-0036 + WF-0037 + legacy 0033')
    : rep.bad(`workflow registry missing ids — got ${ids.join(', ')}`);
  resolveWorkflow(wf, '0033')?.format === 'legacy' && resolveWorkflow(wf, 'WF-0036')?.format === 'new'
    ? rep.ok('workflow registry tags legacy vs new format correctly')
    : rep.bad('workflow registry format tagging wrong');

  // Rebuild idempotency: regenerate and compare bytes; pure build matches too.
  writeWorkContextRegistry(root) === wcText && writeWorkflowRegistry(root) === wfText
    ? rep.ok('registry rebuild is byte-IDEMPOTENT (work-context + workflow)')
    : rep.bad('registry rebuild produced different bytes — not idempotent');
  serializeRegistry(buildWorkContextRegistry(root)) === wcText
    && serializeRegistry(buildWorkflowRegistry(root)) === wfText
    ? rep.ok('pure build serializes to the exact written bytes')
    : rep.bad('pure build bytes differ from the written registry');
});

// ===========================================================================
// (d) ID allocators scan ALL roots and never collide.
// ===========================================================================
withTempRoot((root) => {
  const paths = pathsFor(root);
  // Spread ids across DIFFERENT roots to prove the allocators scan all of them.
  mkdirSync(resolve(paths.business, 'BIZ-0001-a'), { recursive: true });
  mkdirSync(resolve(paths.business, 'BIZ-0002-b'), { recursive: true });
  mkdirSync(resolve(paths.operations, 'OP-0003-c'), { recursive: true });
  // A WF in a per-context workflows/ subfolder (not the top-level root).
  mkdirSync(resolve(paths.business, 'BIZ-0001-a', 'workflows', 'WF-0041-x'), { recursive: true });
  // A legacy NNNN workflow in the top-level workflows root.
  mkdirSync(resolve(paths.memory, 'workflows', '0040-legacy'), { recursive: true });

  nextBusinessId(root) === 'BIZ-0003'
    ? rep.ok('nextBusinessId scans business root → BIZ-0003')
    : rep.bad(`nextBusinessId wrong — got ${nextBusinessId(root)}`);
  nextOperationId(root) === 'OP-0004'
    ? rep.ok('nextOperationId scans operations root → OP-0004')
    : rep.bad(`nextOperationId wrong — got ${nextOperationId(root)}`);
  // Max across roots is WF-0041 (per-context) vs 0040 (legacy top) → next = 0042.
  nextWorkflowNumber(root) === '0042'
    ? rep.ok('nextWorkflowNumber takes the global max across roots → 0042')
    : rep.bad(`nextWorkflowNumber wrong — got ${nextWorkflowNumber(root)}`);

  // Empty roots fall back to the first id (refusal-free default).
  withTempRoot((emptyRoot) => {
    nextBusinessId(emptyRoot) === 'BIZ-0001'
      && nextOperationId(emptyRoot) === 'OP-0001'
      && nextWorkflowNumber(emptyRoot) === '0001'
      ? rep.ok('allocators default to the first id on an empty project')
      : rep.bad('allocators wrong on an empty project');
  });
});

rep.finish('workflow-bdm');
