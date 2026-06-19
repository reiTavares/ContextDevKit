/**
 * Compact CONTINUATION-PROMPT.md generator for the universal wave workflow engine
 * (WF0035, ADR-0101 §10/§18). Renders ONE canonical continuation file that lets a
 * fresh session resume the workflow without re-reading the transcript.
 *
 * Token-efficiency rule (ADR-0101 §18): completed history is compacted to one line
 * per wave; the wave(s) currently in flight get full task-level detail; future
 * waves are reduced to title + deps + status. No transcript content is ever
 * embedded — only machine-derived facts from plan + state + scheduler output.
 *
 * Projection-only: status is read from `workflow-state.json`, never invented. The
 * human-authored managed block (`contextdevkit:human-authored:*`) is preserved
 * verbatim across regeneration so hand notes survive every refresh. Output is
 * deterministic (plan order, injected `now`/`gitFacts`), so `writeIfChanged` makes
 * an unchanged refresh a no-op (idempotent, no mtime churn).
 *
 * Zero runtime dependencies — `node:*` + sibling workflow modules only (ADR-0001).
 * `Date.now()`/`Math.random()` are deliberately absent (inject `now`/`gitFacts`).
 */
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { writeIfChanged } from './io.mjs';
import { normalizePlan, readPlan } from './plan.mjs';
import { readState } from './state.mjs';

/** Status stamped on a wave/task when state is absent or omits it. */
const PENDING = 'pending';
/** Wave statuses that count as "current" (full detail) vs "completed"/"future". */
const ACTIVE = Object.freeze(['in-progress', 'ready']);
/** Sentinels for the preserved human-authored block (NOT a generated block). */
const HUMAN_START = '<!-- contextdevkit:human-authored:start -->';
const HUMAN_END = '<!-- contextdevkit:human-authored:end -->';
const HUMAN_DEFAULT = `${HUMAN_START}\n<!-- Human-authored continuation notes; preserved across regeneration. -->\n${HUMAN_END}`;

/** Read a wave's status from state, falling back to "pending". */
function waveStatus(state, waveId) {
  const entry = state && state.waveStates ? state.waveStates[waveId] : undefined;
  return (entry && typeof entry.status === 'string' && entry.status) || PENDING;
}

/** Read a task's status from state, falling back to "pending". */
function taskStatus(state, taskId) {
  const entry = state && state.taskStates ? state.taskStates[taskId] : undefined;
  return (entry && typeof entry.status === 'string' && entry.status) || PENDING;
}

/** Compact one completed wave to a single line: `W1 — Title ✅`. */
function renderCompletedWave(wave) {
  return `- **${wave.id} — ${wave.title || wave.id}** ✅`;
}

/** Full detail for a current wave: heading + one task line each (status from state). */
function renderCurrentWave(wave, state) {
  const lines = [`- **${wave.id} — ${wave.title || wave.id}** _(${waveStatus(state, wave.id)})_`];
  if (wave.description) lines.push(`  - ${wave.description}`);
  for (const task of wave.tasks) {
    const deps = task.dependsOn.length ? ` · deps ${task.dependsOn.join(', ')}` : '';
    lines.push(`  - \`${task.id}\` ${task.title || ''} [${task.priority}] — ${taskStatus(state, task.id)}${deps}`);
  }
  return lines.join('\n');
}

/** Compact one future wave: title + deps + status only (no tasks). */
function renderFutureWave(wave, state) {
  const deps = wave.dependsOn.length ? wave.dependsOn.join(', ') : 'none';
  return `- **${wave.id} — ${wave.title || wave.id}** · deps ${deps} · ${waveStatus(state, wave.id)}`;
}

/** Render the git-state section from injected facts (no git is shelled here). */
function renderGitState(gitFacts) {
  const facts = gitFacts || {};
  const dirty = facts.dirty ? 'dirty' : 'clean';
  return [
    '## Git state',
    '',
    `- Worktree \`${facts.worktree || '—'}\` · branch \`${facts.branch || '—'}\` @ \`${facts.head || '—'}\` (${dirty})`,
  ].join('\n');
}

/** Render the workflow-identity section (id/profile/pattern/phase/revision). */
function renderWorkflowSection(plan, state) {
  const phase = (plan.journey && plan.journey.currentPhase) || (state && state.journeyPhase) || 'intake';
  const revision = state && typeof state.revision === 'number' ? state.revision : 0;
  return [
    '## Workflow',
    '',
    `- ID \`${plan.workflowId || '—'}\` · profile \`${plan.profile || '—'}\` · pattern \`${plan.pattern || '—'}\``,
    `- Journey phase: \`${phase}\` · State revision: ${revision}`,
  ].join('\n');
}

/** Bucket waves into completed / current / future by their state status. */
function bucketWaves(waves, state) {
  const completed = [];
  const current = [];
  const future = [];
  for (const wave of waves) {
    const status = waveStatus(state, wave.id);
    if (status === 'done') completed.push(wave);
    else if (ACTIVE.includes(status)) current.push(wave);
    else future.push(wave);
  }
  return { completed, current, future };
}

/** Render the three wave sections applying the compact/detailed/compact rule. */
function renderWaveSections(plan, state) {
  const { completed, current, future } = bucketWaves(plan.waves, state);
  const sections = [];
  sections.push(['## Completed (compact)', '', completed.length
    ? completed.map(renderCompletedWave).join('\n') : '- _None._'].join('\n'));
  sections.push(['## Current / in flight (detailed)', '', current.length
    ? current.map((wave) => renderCurrentWave(wave, state)).join('\n\n') : '- _None active._'].join('\n'));
  sections.push(['## Future waves (title · deps · status)', '', future.length
    ? future.map((wave) => renderFutureWave(wave, state)).join('\n') : '- _None._'].join('\n'));
  return sections.join('\n\n');
}

/** Render the next-dispatch section from the (CLI-computed) scheduler output. */
function renderDispatch(scheduleOutput) {
  const out = scheduleOutput || {};
  const ready = (out.readyWaves || []).join(', ') || 'none';
  const lines = ['## Next dispatch', '', `- Ready waves: ${ready}`];
  for (const blocked of out.blockedWaves || []) {
    lines.push(`- Blocked: \`${blocked.id}\` — needs ${(blocked.blockedBy || []).join(', ') || 'unknown'}`);
  }
  for (const dispatch of out.dispatches || []) {
    const slots = (dispatch.assignments || []).map((a) => `${a.taskId}→${a.agentSlot}`).join(', ');
    lines.push(`- Run \`${dispatch.runId}\` (${dispatch.waveId}): ${slots || 'no assignments'}`);
  }
  if ((out.deferredTasks || []).length) lines.push(`- Deferred (over capacity): ${out.deferredTasks.join(', ')}`);
  return lines.join('\n');
}

/** Best-effort list of agent commits not yet integrated (records vs results). */
function unintegratedCommits(state) {
  const integrated = new Set((state && state.integrationRecords ? state.integrationRecords : []).map((r) => r.waveId));
  const tasks = state && state.taskStates ? state.taskStates : {};
  const pending = [];
  for (const [taskId, entry] of Object.entries(tasks)) {
    const waveId = taskId.split('-')[0];
    if (entry && entry.commit && !integrated.has(waveId)) pending.push(`${taskId} @ ${entry.commit}`);
  }
  return pending;
}

/** Render carry-forwards / risks / gates / un-integrated commits / human actions. */
function renderOpenItems(state, scheduleOutput) {
  const carry = (state && state.carryForwards ? state.carryForwards : []).filter((c) => c.status === 'open');
  const risks = (state && state.openBlockers ? state.openBlockers : []);
  const gates = state && state.gateResults ? Object.keys(state.gateResults) : [];
  const commits = unintegratedCommits(state);
  const human = (scheduleOutput && scheduleOutput.humanActions) || [];
  const fmt = (items, mapper) => (items.length ? items.map(mapper).join('; ') : 'none');
  return [
    '## Open items',
    '',
    `- Carry-forwards (open): ${fmt(carry, (c) => `${c.id} → ${c.targetWave} (${c.title || c.priority})`)}`,
    `- Open risks: ${fmt(risks, (r) => (typeof r === 'string' ? r : r.id || JSON.stringify(r)))}`,
    `- Recorded gates: ${gates.length ? gates.join(', ') : 'none'}`,
    `- Un-integrated agent commits: ${fmt(commits, (c) => c)}`,
    `- Human actions required: ${fmt(human, (h) => (typeof h === 'string' ? h : h.action || JSON.stringify(h)))}`,
  ].join('\n');
}

/**
 * Render the full CONTINUATION-PROMPT.md body as a Markdown string. The caller is
 * responsible for re-inserting any preserved human-authored block (see
 * {@link writeContinuation}); this function emits the default human block so a
 * fresh file always carries the sentinels.
 * @param {object} params
 * @param {object} params.plan a plan (normalized internally)
 * @param {object|null} params.state loaded state, or null (all-pending)
 * @param {object} params.scheduleOutput scheduler result (CLI-computed, injected)
 * @param {object} params.gitFacts `{ branch, head, worktree, dirty }`
 * @param {string} params.now ISO-8601 timestamp injected by the caller
 * @returns {string} the full Markdown document (newline-terminated)
 * @throws {TypeError} when `now` is missing
 */
export function renderContinuation({ plan, state, scheduleOutput, gitFacts, now }) {
  if (!now) throw new TypeError('renderContinuation: now (ISO timestamp) is required');
  const normalized = normalizePlan(plan);
  const heading = `# CONTINUATION — WF${normalized.workflowId || '????'} ${normalized.title || ''}`.trim();
  const sections = [
    heading,
    `> One canonical continuation (ADR-0101 §10). Completed = 1 line/wave; current =\n> full detail; future = title + deps + status. Regenerated ${now}.`,
    renderGitState(gitFacts),
    renderWorkflowSection(normalized, state),
    renderWaveSections(normalized, state),
    renderDispatch(scheduleOutput),
    renderOpenItems(state, scheduleOutput),
    HUMAN_DEFAULT,
  ];
  return `${sections.join('\n\n')}\n`;
}

/** Extract the human-authored block (inclusive of sentinels), or null if absent. */
function extractHumanBlock(source) {
  const startIdx = source.indexOf(HUMAN_START);
  const endIdx = source.indexOf(HUMAN_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  return source.slice(startIdx, endIdx + HUMAN_END.length);
}

/** Splice a preserved human block into generated content, replacing the default. */
function spliceHumanBlock(content, humanBlock) {
  if (!humanBlock) return content;
  const startIdx = content.indexOf(HUMAN_START);
  const endIdx = content.indexOf(HUMAN_END);
  if (startIdx === -1 || endIdx === -1) return content;
  return `${content.slice(0, startIdx)}${humanBlock}${content.slice(endIdx + HUMAN_END.length)}`;
}

/**
 * Write the rendered continuation to `packDir/CONTINUATION-PROMPT.md`, preserving
 * any pre-existing human-authored block. Idempotent via write-if-changed.
 * @param {string} packDir the workflow pack directory
 * @param {string} content the rendered continuation body (from renderContinuation)
 * @returns {{ changed: boolean }} whether a write occurred
 * @throws {TypeError} when arguments are missing
 */
export function writeContinuation(packDir, content) {
  if (!packDir) throw new TypeError('writeContinuation: packDir is required');
  if (typeof content !== 'string') throw new TypeError('writeContinuation: content must be a string');
  const target = join(packDir, 'CONTINUATION-PROMPT.md');
  const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '';
  const preserved = spliceHumanBlock(content, extractHumanBlock(existing));
  return writeIfChanged(target, preserved);
}

/**
 * Read plan + state from `packDir`, render the continuation, preserve the human
 * block, and write — the one-call refresh entry point. A missing state file is not
 * an error (all waves project as pending).
 * @param {string} packDir the workflow pack directory
 * @param {object} ctx
 * @param {object} ctx.scheduleOutput scheduler result (CLI-computed, injected)
 * @param {object} ctx.gitFacts `{ branch, head, worktree, dirty }`
 * @param {string} ctx.now ISO-8601 timestamp injected by the caller
 * @returns {{ changed: boolean }}
 * @throws {Error} when no readable plan exists in `packDir`
 */
export function refreshContinuation(packDir, { scheduleOutput, gitFacts, now }) {
  const plan = readPlan(join(packDir, 'workflow-plan.json'));
  const state = readState(join(packDir, 'workflow-state.json'));
  const content = renderContinuation({ plan, state, scheduleOutput, gitFacts, now });
  return writeContinuation(packDir, content);
}
