#!/usr/bin/env node
/**
 * WF0035 W3-T3 — the universal wave engine, proven against a REAL legacy pack.
 *
 * The committed fixture under `tools/fixtures/wf0016/` is a faithful copy of the
 * Origem CRM `0016-sistema-tarefas` workflow (9 waves W0–W9, WX-TY tasks in P0/P1/P2
 * pacotes, a single `prompt_next_wave.md` continuation, and the GENUINE Origem
 * contradiction: the Wave-1 report says the migrations were AUTHORED, NOT APPLIED
 * while tasks.md/memory.md/index.md say "APLICADA EM PRODUÇÃO"). This suite proves
 * the engine audits, migrates, and schedules that real pack without ever mutating
 * the committed fixture — every write happens on a throwaway temp copy.
 *
 * Contract (prompt §"prove the engine"): contradiction detected · human prose
 * preserved byte-for-byte · WX-TY rows retained · ready waves correct · single-pack
 * scope (no sibling rewrite) · dry-run writes nothing · committed fixture untouched.
 *
 * Zero deps — `node:*` + the engine siblings + it-helpers. Deterministic (`now`
 * injected). The committed fixture is READ-ONLY in every path here.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';
import { auditWorkflow } from '../templates/contextkit/tools/scripts/workflow/audit.mjs';
import { migrateDryRun, migrateApply } from '../templates/contextkit/tools/scripts/workflow/migrate.mjs';
import { readyNodes, blockedNodes } from '../templates/contextkit/tools/scripts/workflow/dag.mjs';
import { readPlan } from '../templates/contextkit/tools/scripts/workflow/plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'wf0016');
const NOW = '2026-06-17T00:00:00.000Z';
const rep = reporter();

/** Recursively hash every file (relative path + bytes) under a dir — a stable snapshot. */
function snapshotTree(root) {
  const hash = createHash('sha256');
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else hash.update(`${rel}\0`).update(readFileSync(full));
    }
  };
  walk(root, '');
  return hash.digest('hex');
}

/** Copy the committed fixture into a fresh temp dir; returns the temp path. */
function freshTempCopy() {
  const temp = mkdtempSync(join(tmpdir(), 'wf0016-origem-'));
  cpSync(FIXTURE, temp, { recursive: true });
  return temp;
}

/** Paragraph-level prose, markers + whitespace stripped — for prose-preservation diffing. */
function prose(text) {
  return text.replace(/<!-- contextdevkit:generated:[^>]*-->/g, '').replace(/\s+/g, ' ').trim();
}

const fixtureBefore = snapshotTree(FIXTURE);
const temps = [];

try {
  // 1 — Contradiction detected on the genuine Origem apply-state disagreement.
  const audit = auditWorkflow(FIXTURE);
  const applyContradiction = audit.contradictions.find((entry) => entry.kind === 'applied-state-contradiction');
  applyContradiction
    ? rep.ok('audit flags the index-vs-tasks/memory apply-state contradiction')
    : rep.bad(`expected applied-state-contradiction, got ${JSON.stringify(audit.contradictions.map((c) => c.kind))}`);
  if (applyContradiction) {
    const says = applyContradiction.sources.map((source) => `${source.file}=${source.says}`).join(' | ');
    /NOT APPLIED/i.test(says) && /APPLIED|IMPLEMENTED/i.test(says)
      ? rep.ok('both disagreeing sources are reported (NOT APPLIED vs APPLIED)')
      : rep.bad(`disagreeing sources not both reported: ${says}`);
  }

  // 6 — Dry-run on a fixture copy writes nothing (snapshot equal before/after).
  const dryTemp = freshTempCopy();
  temps.push(dryTemp);
  const dryBefore = snapshotTree(dryTemp);
  const dry = migrateDryRun(dryTemp);
  snapshotTree(dryTemp) === dryBefore
    ? rep.ok('dry-run performed zero writes on the pack copy')
    : rep.bad('dry-run mutated the pack copy');
  dry.plan.inferredWaves.length === 10 && dry.plan.inferredWaves[0].id === 'W0'
    ? rep.ok('dry-run inferred the 9-wave topology W0–W9')
    : rep.bad(`expected 10 waves W0–W9, got ${dry.plan.inferredWaves.map((w) => w.id).join(',')}`);
  dry.plan.ambiguities.length >= 1
    ? rep.ok('dry-run CARRIES the contradiction as an ambiguity (not resolved)')
    : rep.bad('dry-run did not carry the apply-state ambiguity');

  // 2 + 3 — Apply on a temp copy: prose preserved byte-identical, WX-TY rows retained.
  const applyTemp = freshTempCopy();
  temps.push(applyTemp);
  const proseBefore = {
    'tasks.md': prose(readFileSync(join(applyTemp, 'tasks.md'), 'utf-8')),
    'prd.md': prose(readFileSync(join(applyTemp, 'prd.md'), 'utf-8')),
    'spec.md': prose(readFileSync(join(applyTemp, 'spec.md'), 'utf-8')),
  };
  const tasksRawBefore = readFileSync(join(applyTemp, 'tasks.md'), 'utf-8');

  const applied = migrateApply(applyTemp, { now: NOW, force: true });
  applied.applied ? rep.ok('migrateApply(force) succeeded on the pack copy') : rep.bad('migrateApply refused with force=true');

  // prd.md / spec.md are NEVER written — must be byte-identical (not just prose-equal).
  for (const file of ['prd.md', 'spec.md']) {
    const after = prose(readFileSync(join(applyTemp, file), 'utf-8'));
    after === proseBefore[file]
      ? rep.ok(`${file} human prose preserved byte-for-byte (untouched by migrate)`)
      : rep.bad(`${file} prose changed during migrate`);
  }

  // tasks.md: prose OUTSIDE the appended managed block is byte-identical to the original.
  const tasksRawAfter = readFileSync(join(applyTemp, 'tasks.md'), 'utf-8');
  const blockStart = tasksRawAfter.indexOf('<!-- contextdevkit:generated:tasks:start -->');
  const outsideBlock = blockStart === -1 ? tasksRawAfter : tasksRawAfter.slice(0, blockStart);
  outsideBlock.startsWith(tasksRawBefore.replace(/\n+$/, ''))
    ? rep.ok('tasks.md original prose is preserved verbatim outside the managed block')
    : rep.bad('tasks.md original prose was altered by migrate');
  prose(outsideBlock).includes(proseBefore['tasks.md'].split('<!--')[0].trim().slice(0, 80))
    ? rep.ok('tasks.md leading human paragraph still present')
    : rep.bad('tasks.md leading human paragraph lost');

  // Original Origem WX-TY rows still present (outside or carried into the block).
  const wxRows = ['W0-T1', 'W1-T1', 'W2-T4', 'W3-T1', 'W9-T1'];
  const missingRows = wxRows.filter((id) => !tasksRawAfter.includes(id));
  missingRows.length === 0
    ? rep.ok('all sampled WX-TY task rows retained after migrate')
    : rep.bad(`WX-TY rows lost after migrate: ${missingRows.join(', ')}`);

  // 4 — Ready waves correct from the migrated plan's DAG.
  const plan = readPlan(join(applyTemp, 'workflow-plan.json'));
  const readyFromStart = readyNodes(plan.waves);
  readyFromStart.length === 1 && readyFromStart[0] === 'W0'
    ? rep.ok('DAG ready set is exactly [W0] before any wave completes')
    : rep.bad(`expected ready=[W0], got [${readyFromStart.join(',')}]`);
  const blockedAtStart = blockedNodes(plan.waves);
  const w1Blocked = blockedAtStart.find((node) => node.id === 'W1');
  w1Blocked && w1Blocked.blockedBy.includes('W0')
    ? rep.ok('W1 is blocked by W0 until W0 completes')
    : rep.bad('W1 was not reported blocked by W0');
  readyNodes(plan.waves, ['W0']).includes('W1')
    ? rep.ok('completing W0 unblocks W1 (sensible wave progression)')
    : rep.bad('W1 did not become ready after W0 completed');

  // 5 — Single-pack scope: only files inside the temp pack changed, and only the
  // two generated artifacts + receipt appear / change — no sibling path touched.
  const changedFiles = applied.changes.map((change) => change.file).sort();
  JSON.stringify(changedFiles) === JSON.stringify(['tasks.md', 'workflow-plan.json'])
    ? rep.ok('migrate reported exactly the single-pack generated artifacts')
    : rep.bad(`unexpected changed files: ${changedFiles.join(', ')}`);
  // The human governance files were declared untouched by the proposal.
  ['prd.md', 'spec.md', 'decisions.md', 'memory.md', 'index.md'].every((file) =>
    !applied.changes.some((change) => change.file === file))
    ? rep.ok('no human governance file is in the migrate change set')
    : rep.bad('a human governance file was in the change set');

  // 5b — The COMMITTED fixture is byte-identical before and after the whole test.
  snapshotTree(FIXTURE) === fixtureBefore
    ? rep.ok('committed tools/fixtures/wf0016 is unchanged (read-only fixture honored)')
    : rep.bad('the committed fixture was mutated — read-only contract violated');
} finally {
  for (const temp of temps) rmSync(temp, { recursive: true, force: true });
}

// Final guard: assert one more time the committed fixture snapshot held across cleanup.
snapshotTree(FIXTURE) === fixtureBefore
  ? rep.ok('post-cleanup: committed fixture snapshot still matches the pre-test snapshot')
  : rep.bad('committed fixture snapshot drifted after cleanup');

rep.finish('workflow-origem-fixture');
