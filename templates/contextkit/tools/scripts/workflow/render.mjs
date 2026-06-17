/**
 * Markdown PROJECTIONS for the universal wave workflow engine (WF0035,
 * ADR-0067 / ADR-0100 §17). Renders the static plan (`workflow-plan.json`) +
 * machine state (`workflow-state.json`) into managed blocks inside human-authored
 * documents (`tasks.md`, `index.md`), preserving everything OUTSIDE the markers
 * byte-for-byte.
 *
 * Projection-only: this module computes NO status — task/wave status is read
 * straight from `state.taskStates[id].status` / `state.waveStates[id].status`,
 * never hand-set (fallback "pending" when state is absent). Output is fully
 * deterministic (waves + tasks in plan order, no timestamps generated here) so
 * re-rendering identical inputs is byte-identical and `writeIfChanged` makes it a
 * no-op — no mtime churn.
 *
 * Zero runtime dependencies — `node:*` + sibling workflow modules only (ADR-0001).
 * Timestamps are INJECTED by the caller (`now`); `Date.now()`/`Math.random()` are
 * deliberately absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManagedBlock, updateManagedBlock, writeIfChanged } from './io.mjs';
import { normalizePlan, readPlan } from './plan.mjs';
import { readState } from './state.mjs';

/** Default status stamped on a task/wave when state is absent or omits it. */
const PENDING = 'pending';

/** Escape a cell value so a literal pipe never breaks the Markdown table. */
function escapeCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/**
 * Status of a single task from state, falling back to "pending".
 * @param {object|null} state the loaded `workflow-state.json` (or null)
 * @param {string} taskId e.g. "W1-T5"
 * @returns {string}
 */
function taskStatus(state, taskId) {
  const entry = state && state.taskStates ? state.taskStates[taskId] : undefined;
  return (entry && typeof entry.status === 'string' && entry.status) || PENDING;
}

/**
 * Status of a single wave from state, falling back to "pending".
 * @param {object|null} state
 * @param {string} waveId e.g. "W1"
 * @returns {string}
 */
function waveStatus(state, waveId) {
  const entry = state && state.waveStates ? state.waveStates[waveId] : undefined;
  return (entry && typeof entry.status === 'string' && entry.status) || PENDING;
}

/**
 * Summarize a task's acceptance list into a concise cell (Origem bar): the count
 * plus the first criterion, so the table stays scannable without losing intent.
 * @param {string[]} acceptance
 * @returns {string}
 */
function summarizeAcceptance(acceptance) {
  if (!Array.isArray(acceptance) || acceptance.length === 0) return '—';
  const first = escapeCell(acceptance[0]);
  return acceptance.length === 1 ? first : `${acceptance.length}× — ${first}`;
}

/** Join a string array into a compact cell, or an em-dash when empty. */
function listCell(values) {
  return Array.isArray(values) && values.length ? values.map(escapeCell).join(', ') : '—';
}

/**
 * Owner cell: the integration owner plus the first allowed write path, so the
 * disjoint-ownership contract is visible in the projection.
 * @param {object} task a normalized task
 * @returns {string}
 */
function ownerCell(task) {
  const paths = task.ownership && Array.isArray(task.ownership.allowedPaths) ? task.ownership.allowedPaths : [];
  if (paths.length === 0) return escapeCell((task.ownership && task.ownership.integrationOwner) || 'orchestrator');
  const head = escapeCell(paths[0]);
  return paths.length === 1 ? head : `${head} +${paths.length - 1}`;
}

/** Render the header + one data row per task for a single wave (Origem columns). */
function renderWaveSection(wave, state) {
  const lines = [];
  const title = escapeCell(wave.title || wave.id);
  lines.push(`### ${escapeCell(wave.id)} — ${title} · _${waveStatus(state, wave.id)}_`);
  if (wave.description) lines.push('', escapeCell(wave.description));
  lines.push('');
  lines.push('| Task | P | Objective | Acceptance | Deps | Owns | Status |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const task of wave.tasks) {
    lines.push(
      `| **${escapeCell(task.id)}** | ${escapeCell(task.priority)} | ${escapeCell(task.objective) || '—'}` +
        ` | ${summarizeAcceptance(task.acceptance)} | ${listCell(task.dependsOn)}` +
        ` | ${ownerCell(task)} | ${taskStatus(state, task.id)} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Render the full tasks table (inner content of the `tasks` managed block):
 * one section per wave, grouped + ordered as the normalized plan, every status
 * sourced from state.
 * @param {object} plan a plan (normalized internally)
 * @param {object|null} state the loaded state, or null (all-pending)
 * @returns {string} Markdown — the inner block content (no markers)
 */
export function renderTasksTable(plan, state) {
  const normalized = normalizePlan(plan);
  if (normalized.waves.length === 0) return '_No waves defined yet._';
  return normalized.waves.map((wave) => renderWaveSection(wave, state)).join('\n\n');
}

/**
 * Compose a one-line wave-status summary, e.g. "W1 in-progress · W2 pending".
 * @param {object[]} waves normalized waves
 * @param {object|null} state
 * @returns {string}
 */
function waveStatusSummary(waves, state) {
  if (waves.length === 0) return '—';
  return waves.map((wave) => `${wave.id} ${waveStatus(state, wave.id)}`).join(' · ');
}

/**
 * Render the index-status managed block: profile, pattern, journey phase,
 * wave-status summary, and the state revision (engine truth at a glance).
 * @param {object} plan a plan (normalized internally)
 * @param {object|null} state the loaded state, or null
 * @returns {string} Markdown — the inner block content (no markers)
 */
export function renderIndexStatus(plan, state) {
  const normalized = normalizePlan(plan);
  const phase = (normalized.journey && normalized.journey.currentPhase) || (state && state.journeyPhase) || 'intake';
  const revision = state && typeof state.revision === 'number' ? state.revision : 0;
  const overall = (state && state.overallStatus) || 'not-started';
  return [
    `- **Profile:** ${escapeCell(normalized.profile || '—')} · **Pattern:** ${escapeCell(normalized.pattern || '—')}`,
    `- **Journey phase:** ${escapeCell(phase)} · **Overall:** ${escapeCell(overall)}`,
    `- **Waves:** ${waveStatusSummary(normalized.waves, state)}`,
    `- **State revision:** ${revision}`,
  ].join('\n');
}

/**
 * Idempotently write `innerContent` into the named managed block of `filePath`,
 * preserving all human content outside the markers. Reads the existing file (or
 * treats a missing file as empty), updates the block, and writes only on change.
 * @param {string} filePath absolute path to the projection document
 * @param {string} blockId managed-block id (e.g. "tasks", "index-status")
 * @param {string} innerContent the rendered inner content (no markers)
 * @returns {{ changed: boolean }} whether a write occurred (idempotent re-render → false)
 * @throws {TypeError} when arguments are missing
 */
export function applyRender(filePath, blockId, innerContent) {
  if (!filePath) throw new TypeError('applyRender: filePath is required');
  if (!blockId) throw new TypeError('applyRender: blockId is required');
  const source = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const next = updateManagedBlock(source, blockId, innerContent);
  return writeIfChanged(filePath, next);
}

/**
 * Load `workflow-plan.json` + optional `workflow-state.json` from `packDir`.
 * A missing state file is not an error — it yields all-pending projections.
 * @param {string} packDir the workflow pack directory
 * @returns {{ plan: object, state: object|null }}
 * @throws {Error} when no readable plan exists in `packDir`
 */
function loadPack(packDir) {
  const plan = readPlan(join(packDir, 'workflow-plan.json'));
  const state = readState(join(packDir, 'workflow-state.json'));
  return { plan, state };
}

/**
 * Refresh the `tasks` managed block of `packDir/tasks.md` from plan + state.
 * @param {string} packDir the workflow pack directory
 * @param {{ now?: string }} [opts] injected timestamp (reserved; projection is timeless)
 * @returns {{ changed: boolean }}
 * @throws {Error} when no readable plan exists
 */
export function refreshTasks(packDir, { now } = {}) {
  void now;
  const { plan, state } = loadPack(packDir);
  return applyRender(join(packDir, 'tasks.md'), 'tasks', renderTasksTable(plan, state));
}

/**
 * Refresh the `index-status` managed block of `packDir/index.md` from plan + state.
 * @param {string} packDir the workflow pack directory
 * @param {{ now?: string }} [opts] injected timestamp (reserved; projection is timeless)
 * @returns {{ changed: boolean }}
 * @throws {Error} when no readable plan exists
 */
export function refreshIndex(packDir, { now } = {}) {
  void now;
  const { plan, state } = loadPack(packDir);
  return applyRender(join(packDir, 'index.md'), 'index-status', renderIndexStatus(plan, state));
}

export { readManagedBlock };
