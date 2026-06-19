/**
 * NON-DESTRUCTIVE legacy migration for the universal wave workflow engine
 * (WF0035, spec §22, ADR-0101 §11). Pipeline:
 * `discover → audit → propose → dry-run → explicit apply → verify → receipt`.
 *
 * Legacy/hybrid packs are user-authored project memory — there is NO forced or
 * global rewrite. `migrationPlan` proposes (zero writes); `migrateDryRun` previews
 * (zero writes — assert-able); `migrateApply` writes ONLY when `force === true`,
 * and only the two generated artifacts (`workflow-plan.json` + a managed `tasks`
 * block) plus a receipt — never the human prose of prd/spec/decisions/memory,
 * never another workflow. Contradictions are surfaced via the orchestrator-owned
 * `auditWorkflow`, never resolved: an irreducible ambiguity is carried, not
 * guessed (default-refuse). A second apply is a no-op (writeIfChanged).
 * Deterministic: timestamps injected (`now`), no `Date.now()`/`Math.random()`.
 * Zero deps — `node:*` + siblings (ADR-0001).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { auditWorkflow } from './audit.mjs';
import { normalizePlan, validatePlan, writePlan } from './plan.mjs';
import { readManagedBlock, updateManagedBlock, writeIfChanged, writeJsonStable } from './io.mjs';

/** Managed-block id projecting the migrated task view inside `tasks.md`. */
const TASK_BLOCK_ID = 'tasks';
/** A wave-section heading: `### W0 — Title` / `## WAVE 1 ...` (legacy variants). */
const WAVE_HEADING = /^#{2,4}\s+(?:WAVE\s+(\d+)|W(\d+))\b[^\n]*/i;
/** A wave-y task table row: `| **W0-T1** | P0 | objective | ... |`. */
const TASK_ROW = /^\|\s*\*{0,2}(W\d+-T\d+)\*{0,2}\s*\|\s*(P[0-3])?\s*\|\s*([^|]*)\|/;

/** Read a UTF-8 file BOM-stripped; '' when absent/unreadable (defensive). */
function readTextSafe(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8').replace(/^﻿/, '') : '';
  } catch {
    return '';
  }
}

/**
 * Map a legacy file population onto a registry profile name (conservative — never
 * upgrades past evidence). Wave usage or rich governance ⇒ `program`; prd+spec ⇒
 * `standard`; a bare tasks/spec pack ⇒ `basic`.
 * @returns {'basic'|'standard'|'program'}
 */
function inferProfile(present, hasWaves) {
  const has = (name) => present.includes(name);
  const richGovernance = has('risk-register.md') || has('acceptance-matrix.md') || has('rollout-plan.md');
  if (hasWaves || richGovernance) return 'program';
  if (has('prd.md') && has('spec.md')) return 'standard';
  return 'basic';
}

/**
 * Pick a wave pattern id consistent with the inferred profile, without importing
 * the registry (single-pack, dependency-light): a wave pack maps to the program
 * skeleton, standard to discovery-build-validate, basic to single-delivery.
 * @returns {string}
 */
function inferPattern(profile, hasWaves) {
  if (profile === 'program' || hasWaves) return 'architecture-foundation-integration';
  if (profile === 'standard') return 'discovery-build-validate';
  return 'single-delivery';
}

/**
 * Parse wave headings + wave-y task rows out of a tasks/spec body. Only SAFELY
 * parseable structure is extracted; free prose is ignored.
 * @returns {{ waves: Map<string,{id:string,title:string}>, tasks: object[] }}
 */
function parseWaveTopology(body) {
  const waves = new Map();
  const tasks = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const headingMatch = rawLine.trim().match(WAVE_HEADING);
    if (headingMatch) {
      const id = `W${headingMatch[1] ?? headingMatch[2]}`;
      const title = rawLine.trim().replace(/^#+\s+/, '').replace(/[·|].*$/, '').replace(/_+/g, '').trim();
      if (!waves.has(id)) waves.set(id, { id, title: title || id });
      continue;
    }
    const rowMatch = rawLine.match(TASK_ROW);
    if (rowMatch) {
      const [, taskId, priority, objectiveCell] = rowMatch;
      const waveId = taskId.split('-')[0];
      if (!waves.has(waveId)) waves.set(waveId, { id: waveId, title: waveId });
      tasks.push({ id: taskId, waveId, priority: priority || 'P2', objective: objectiveCell.trim() });
    }
  }
  return { waves, tasks };
}

/**
 * Infer the wave list + extracted tasks from a pack's tasks/spec breadcrumbs.
 * No wave markers ⇒ a single synthesized `W1` carrying the pack (Basic shape).
 * @returns {{ inferredWaves: object[], extractedTasks: object[], hasWaves: boolean }}
 */
function inferTopology(packDir) {
  const body = `${readTextSafe(join(packDir, 'tasks.md'))}\n${readTextSafe(join(packDir, 'spec.md'))}`;
  const { waves, tasks } = parseWaveTopology(body);
  if (waves.size === 0) {
    return { hasWaves: false, inferredWaves: [{ id: 'W1', title: 'Migrated delivery', dependsOn: [] }], extractedTasks: [] };
  }
  const ordered = [...waves.values()].sort((left, right) => left.id.localeCompare(right.id));
  const inferredWaves = ordered.map((wave, index) => ({
    id: wave.id,
    title: wave.title,
    dependsOn: index === 0 ? [] : [ordered[index - 1].id],
  }));
  return { hasWaves: true, inferredWaves, extractedTasks: tasks };
}

/**
 * Derive ambiguities to CARRY (never resolve) from an audit report.
 * @param {object} auditReport result of `auditWorkflow`
 * @returns {Array<{kind:string, detail:string}>}
 */
function carriedAmbiguities(auditReport) {
  const out = [];
  for (const contradiction of auditReport.contradictions ?? []) {
    out.push({ kind: contradiction.kind, detail: contradiction.detail });
  }
  for (const redundancy of auditReport.redundancies ?? []) {
    if (redundancy.kind === 'fragmented-continuation') out.push({ kind: redundancy.kind, detail: redundancy.detail });
  }
  return out;
}

/**
 * Assemble the proposed (un-normalized) `workflow-plan.json` body from inferred
 * topology. Status is never stored in a plan (it is a state projection).
 * @param {object} ctx { id, slug, profile, pattern, inferredWaves, extractedTasks }
 * @returns {object} a raw plan (validated by the caller via plan.mjs)
 */
function buildProposedPlan(ctx) {
  const tasksByWave = new Map();
  for (const task of ctx.extractedTasks) {
    if (!tasksByWave.has(task.waveId)) tasksByWave.set(task.waveId, []);
    tasksByWave.get(task.waveId).push({
      id: task.id,
      waveId: task.waveId,
      title: task.objective.slice(0, 120),
      priority: task.priority,
      objective: task.objective,
      execution: { mode: 'agent', parallelizable: false, agentSlots: 1 },
      ownership: { allowedPaths: ['contextkit/memory/'] },
    });
  }
  const waves = ctx.inferredWaves.map((wave) => ({
    id: wave.id, title: wave.title, dependsOn: wave.dependsOn, gate: null, tasks: tasksByWave.get(wave.id) ?? [],
  }));
  return {
    schemaVersion: 1,
    workflowId: ctx.id,
    slug: ctx.slug,
    title: ctx.slug,
    profile: ctx.profile,
    pattern: ctx.pattern,
    addons: [],
    journey: { currentPhase: 'migrated' },
    waves,
    gates: [],
    artifacts: [],
  };
}

/**
 * Render the managed `tasks` block: a deterministic table projecting the inferred
 * topology. Human prose outside the markers is preserved on apply.
 * @param {object[]} waves normalized plan waves
 * @returns {string} the block inner content (markers added by updateManagedBlock)
 */
function renderTaskBlock(waves) {
  const lines = ['## Migrated task projection (generated — do not hand-edit)', '', '| Task | Wave | Priority | Objective |', '| --- | --- | --- | --- |'];
  for (const wave of waves) {
    for (const task of wave.tasks) {
      lines.push(`| ${task.id} | ${wave.id} | ${task.priority} | ${task.objective.replace(/\|/g, '/').slice(0, 120)} |`);
    }
  }
  if (waves.every((wave) => wave.tasks.length === 0)) {
    lines.push('| (none extracted) | — | — | No wave-y task rows were safely parseable. |');
  }
  return lines.join('\n');
}

/**
 * Produce a migration PROPOSAL for one pack. Pure read — performs ZERO writes.
 * @param {string} packDir absolute path to a `NNNN-slug` pack
 * @returns {object} the proposal (see module doc-comment)
 * @throws {TypeError} when packDir is not a readable directory
 */
export function migrationPlan(packDir) {
  let present;
  try {
    present = readdirSync(packDir).slice().sort();
  } catch (cause) {
    throw new TypeError(`migrationPlan: cannot read pack "${packDir}": ${cause.message}`);
  }
  const auditReport = auditWorkflow(packDir);
  const { inferredWaves, extractedTasks, hasWaves } = inferTopology(packDir);
  const inferredProfile = inferProfile(present, hasWaves);
  const inferredPattern = inferPattern(inferredProfile, hasWaves);
  const ambiguities = carriedAmbiguities(auditReport);

  const planExists = present.includes('workflow-plan.json');
  const tasksText = readTextSafe(join(packDir, 'tasks.md'));
  const blockExists = readManagedBlock(tasksText, TASK_BLOCK_ID) !== null;
  const proposedFiles = [
    { file: 'workflow-plan.json', action: planExists ? 'would-overwrite-existing' : 'would-create' },
    { file: 'tasks.md', action: blockExists ? 'would-update-managed-block' : 'would-insert-managed-block' },
    { file: 'reports/migration-receipt.json', action: 'would-create' },
  ];
  const filesLeftUntouched = present.filter((name) => !['workflow-plan.json', 'tasks.md', 'reports'].includes(name));
  const duplicateStatus = (auditReport.redundancies ?? []).filter((entry) => entry.kind === 'duplicated-status');
  const managedBlockChanges = [{ file: 'tasks.md', blockId: TASK_BLOCK_ID, present: blockExists }];
  return {
    packDir, id: auditReport.id, slug: auditReport.slug, inferredProfile, inferredPattern,
    inferredWaves, extractedTasks, ambiguities, duplicateStatus, proposedFiles,
    managedBlockChanges, filesLeftUntouched, planExists,
  };
}

/**
 * Dry-run a migration: returns the proposal plus a textual preview. Performs ZERO
 * writes (assert-able — never calls a write function).
 * @param {string} packDir
 * @returns {{ plan: object, preview: string }}
 */
export function migrateDryRun(packDir) {
  const plan = migrationPlan(packDir);
  const lines = [
    `Migration dry-run for ${plan.slug} (${plan.id})`,
    `  inferred profile : ${plan.inferredProfile}`,
    `  inferred pattern : ${plan.inferredPattern}`,
    `  waves            : ${plan.inferredWaves.map((wave) => wave.id).join(', ') || '(none)'}`,
    `  extracted tasks  : ${plan.extractedTasks.length}`,
    `  ambiguities      : ${plan.ambiguities.length} (carried, NOT resolved)`,
    ...plan.ambiguities.map((entry) => `    - ${entry.kind}: ${entry.detail}`),
    '  proposed writes  :',
    ...plan.proposedFiles.map((entry) => `    - ${entry.file}: ${entry.action}`),
    `  untouched files  : ${plan.filesLeftUntouched.join(', ') || '(none)'}`,
    '  NOTE: dry-run wrote nothing.',
  ];
  return { plan, preview: lines.join('\n') };
}

/**
 * Apply a migration — ONLY when `force === true` (explicit opt-in). Writes a
 * validated `workflow-plan.json`, inserts a managed `tasks` block (preserving all
 * human content outside it), and `reports/migration-receipt.json`. Idempotent
 * (writeIfChanged). A clobbered hand-authored plan is noted in the receipt.
 * @param {string} packDir
 * @param {{ now: string, force?: boolean }} options injected timestamp + opt-in
 * @returns {{ applied: boolean, reason?: string, receiptPath?: string, receipt?: object, changes?: object[] }}
 * @throws {Error} when `now` is missing or the inferred plan fails validation
 */
export function migrateApply(packDir, options = {}) {
  const { now, force = false } = options;
  if (typeof now !== 'string' || now.length === 0) {
    throw new Error('migrateApply: an injected ISO `now` timestamp is required.');
  }
  const proposal = migrationPlan(packDir);
  if (!force) {
    return { applied: false, reason: 'refused: apply needs an explicit force flag (non-destructive by default).' };
  }

  const normalized = normalizePlan(buildProposedPlan({
    id: proposal.id, slug: proposal.slug, profile: proposal.inferredProfile,
    pattern: proposal.inferredPattern, inferredWaves: proposal.inferredWaves, extractedTasks: proposal.extractedTasks,
  }));
  const verdict = validatePlan(normalized);
  if (!verdict.valid) {
    throw new Error(`migrateApply: inferred plan failed validation — ${verdict.errors.map((error) => `${error.code} @ ${error.path}`).join('; ')}`);
  }

  // "Clobbered a hand-authored plan" is true ONLY when a pre-existing plan was
  // genuinely replaced (different content) — never on a create, never on an
  // idempotent re-apply (writeIfChanged makes the re-write a no-op). This keeps
  // the receipt a pure function of pack + inferred plan ⇒ byte-identical second apply.
  const planPath = join(packDir, 'workflow-plan.json');
  const planWrite = writePlan(planPath, normalized);
  const clobberedDifferentPlan = proposal.planExists && planWrite.changed;

  const tasksPath = join(packDir, 'tasks.md');
  const tasksText = readTextSafe(tasksPath);
  const blockExisted = readManagedBlock(tasksText, TASK_BLOCK_ID) !== null;
  const tasksWrite = writeIfChanged(tasksPath, updateManagedBlock(tasksText, TASK_BLOCK_ID, renderTaskBlock(normalized.waves)));
  const replacedDifferentBlock = blockExisted && tasksWrite.changed;

  const receiptPath = join(packDir, 'reports', 'migration-receipt.json');
  mkdirSync(dirname(receiptPath), { recursive: true });
  const changes = [
    { file: 'workflow-plan.json', state: 'present', planClobbered: clobberedDifferentPlan },
    { file: 'tasks.md', state: 'managed-block-present', blockReplaced: replacedDifferentBlock },
  ];
  const receipt = {
    schemaVersion: 1, packId: proposal.id, slug: proposal.slug, appliedAt: now,
    inferredProfile: proposal.inferredProfile, inferredPattern: proposal.inferredPattern,
    waveCount: normalized.waves.length, taskCount: proposal.extractedTasks.length, changes,
    carriedAmbiguities: proposal.ambiguities, planWasBackedUp: clobberedDifferentPlan,
    backupNote: clobberedDifferentPlan ? 'A pre-existing workflow-plan.json was overwritten under an explicit force flag.' : null,
    filesLeftUntouched: proposal.filesLeftUntouched,
  };
  writeJsonStable(receiptPath, receipt);
  return { applied: true, receiptPath, receipt, changes };
}
