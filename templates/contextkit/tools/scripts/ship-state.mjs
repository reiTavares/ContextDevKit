#!/usr/bin/env node
/**
 * /ship resume substrate (ticket 074) — records the live `/ship` pipeline's
 * current stage in the canonical state.json (`kind: 'pipeline-run'`) so an
 * interrupted ship resumes from where it stopped instead of restarting. A thin,
 * deterministic CLI over the ADR-0015 §C state-io substrate; it owns no logic of
 * its own beyond mapping the 9 ship stages to a `step.current` marker.
 *
 * The `/ship` briefing calls:
 *   ship-state.mjs begin "<objective>"      → opens a run, prints its id
 *   ship-state.mjs step <stage> [--id x]     → advances current_step
 *   ship-state.mjs block | run [--id x]       → checkpoint pause / resume
 *   ship-state.mjs end [done|failed] [--id x]  → closes the run
 *   ship-state.mjs current [--json]             → the in-flight ship, for resume
 */
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeState, readState, listStates } from '../../runtime/state/state-io.mjs';

/** The 9 stages of ship.md, in order. `step.current` is one of these. */
export const SHIP_STAGES = ['scope', 'design', 'plan-tests', 'implement', 'self-review', 'test', 'quality-gates', 'record', 'report'];

const PIPE = pathsFor(process.cwd()).pipeline;

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'run';
const getArg = (name) => { const i = process.argv.indexOf(`--${name}`); return i !== -1 ? process.argv[i + 1] : undefined; };

/** In-flight ship runs (not done/failed, no endedAt), newest first. */
export function inflightRuns(pipeDir) {
  return listStates(pipeDir, { kind: 'pipeline-run' })
    .filter((s) => s.endedAt == null && s.status !== 'done' && s.status !== 'failed' && String(s.id).startsWith('ship-'));
}

/** Resolve which run a verb targets: explicit `--id`, else the sole in-flight one. */
function resolveRunId(explicit) {
  if (explicit) return explicit.startsWith('ship-') ? explicit : `ship-${slug(explicit)}`;
  const live = inflightRuns(PIPE);
  if (live.length === 0) throw new Error('no in-flight ship — run `ship-state.mjs begin "<objective>"` first');
  if (live.length > 1) throw new Error(`ambiguous: ${live.length} in-flight ships (${live.map((s) => s.id).join(', ')}). Pass --id <id>.`);
  return live[0].id;
}

function begin(objective) {
  if (!objective) { console.error('Usage: ship-state.mjs begin "<objective>"'); process.exit(1); }
  const id = `ship-${slug(objective)}`;
  writeState(PIPE, id, { kind: 'pipeline-run', status: 'running', step: { current: SHIP_STAGES[0], index: 1, total: SHIP_STAGES.length }, endedAt: null });
  console.log(`🚢 ship run opened: ${id} (stage 1/${SHIP_STAGES.length}: ${SHIP_STAGES[0]})`);
}

function step(stage) {
  if (!SHIP_STAGES.includes(stage)) { console.error(`Unknown stage "${stage}". One of: ${SHIP_STAGES.join(', ')}`); process.exit(1); }
  const id = resolveRunId(getArg('id'));
  const index = SHIP_STAGES.indexOf(stage) + 1;
  writeState(PIPE, id, { status: 'running', step: { current: stage, index, total: SHIP_STAGES.length } });
  console.log(`▶ ${id} → stage ${index}/${SHIP_STAGES.length}: ${stage}`);
}

function setStatus(status, label) {
  const id = resolveRunId(getArg('id'));
  writeState(PIPE, id, { status });
  console.log(`${label} ${id} (${status})`);
}

function end(verb) {
  const status = verb === 'failed' ? 'failed' : 'done';
  const id = resolveRunId(getArg('id'));
  writeState(PIPE, id, { status, endedAt: Date.now() });
  console.log(`${status === 'failed' ? '✗' : '✅'} ship run ${id} → ${status}`);
}

function current() {
  const live = inflightRuns(PIPE);
  if (getArg('json') !== undefined || process.argv.includes('--json')) {
    console.log(JSON.stringify(live.map((s) => ({ id: s.id, status: s.status, step: s.step, startedAt: s.startedAt })), null, 2));
    return;
  }
  if (live.length === 0) { console.log('No in-flight ship — nothing to resume.'); return; }
  for (const s of live) {
    const at = s.step ? `stage ${s.step.index}/${s.step.total}: ${s.step.current}` : 'unknown stage';
    console.log(`🚢 ${s.id} — ${s.status} at ${at}`);
  }
  console.log(`\nResume from the reported stage, or close it: ship-state.mjs end done`);
}

/**
 * Stamps a `resume` object into an existing pipeline-run state so a future
 * session can reconstruct context without re-reading every prior log.
 *
 * The `resumeObj` shape (all fields optional but recommended):
 *   {
 *     objective: string,       // human-readable goal (mirrors the run's purpose)
 *     currentStep: string,     // stage name at checkpoint time
 *     decisions: string[],     // non-derivable "why" choices made so far
 *     touchSet: Array<{ path: string, why: string }>,  // files edited + rationale
 *     openThreads: string[],   // next 1-3 things to do on resume
 *     pointers: {              // PATHS, never file bodies
 *       adr?: string, spec?: string, session?: string
 *     },
 *     stampedAt: number        // auto-set if absent
 *   }
 *
 * Advisory + fail-open: a missing run logs a warning but does not throw.
 *
 * @param {string} pipeDir
 * @param {string} id
 * @param {object} resumeObj
 * @returns {object | null} merged state, or null if the run could not be found
 */
export function checkpoint(pipeDir, id, resumeObj) {
  if (!resumeObj || typeof resumeObj !== 'object') {
    process.stderr.write(`[ship-state] checkpoint: resumeObj must be an object\n`);
    return null;
  }
  const existing = readState(pipeDir, id);
  if (!existing) {
    process.stderr.write(`[ship-state] checkpoint: run "${id}" not found — skipping\n`);
    return null;
  }
  const stamped = {
    objective: typeof resumeObj.objective === 'string' ? resumeObj.objective : '',
    currentStep: typeof resumeObj.currentStep === 'string' ? resumeObj.currentStep : (existing.step?.current ?? ''),
    decisions: Array.isArray(resumeObj.decisions) ? resumeObj.decisions : [],
    touchSet: Array.isArray(resumeObj.touchSet) ? resumeObj.touchSet : [],
    openThreads: Array.isArray(resumeObj.openThreads) ? resumeObj.openThreads : [],
    pointers: (resumeObj.pointers && typeof resumeObj.pointers === 'object') ? resumeObj.pointers : {},
    stampedAt: typeof resumeObj.stampedAt === 'number' ? resumeObj.stampedAt : Date.now(),
  };
  return writeState(pipeDir, id, { resume: stamped });
}

function cliCheckpoint() {
  const id = resolveRunId(getArg('id'));
  // Accept resume JSON from --data arg or stdin placeholder; for CLI use a minimal stub.
  const rawData = getArg('data');
  let resumeObj = {};
  if (rawData) {
    try { resumeObj = JSON.parse(rawData); } catch { process.stderr.write('[ship-state] checkpoint: --data is not valid JSON\n'); }
  }
  const result = checkpoint(PIPE, id, resumeObj);
  if (result) console.log(`[ship-state] checkpoint stamped on ${id} at ${new Date(result.resume.stampedAt).toISOString()}`);
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'begin') begin(process.argv[3]);
  else if (cmd === 'step') step(process.argv[3]);
  else if (cmd === 'block') setStatus('blocked-on-checkpoint', '⏸');
  else if (cmd === 'run') setStatus('running', '▶');
  else if (cmd === 'end') end(process.argv[3]);
  else if (cmd === 'current') current();
  else if (cmd === 'checkpoint') cliCheckpoint();
  else { console.error('Usage: ship-state.mjs <begin|step|block|run|end|current|checkpoint> [...]'); process.exit(1); }
}

if (process.argv[1]?.endsWith('ship-state.mjs')) main();
