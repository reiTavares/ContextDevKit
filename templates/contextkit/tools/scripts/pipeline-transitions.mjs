/**
 * DevPipeline stage transitions — extracted from pipeline.mjs (280-budget split,
 * ADR-0041 F1 / task 110; event log + auto verb in F2 / task 111).
 *
 * Legality (ADR-0043): `move` is the free-form HUMAN verb; `qa-reject` is the
 * ONLY testing→working path, always carrying a feedback block on the card; and
 * `auto-transition` (actor `auto`) exists ONLY on top of the append-only
 * state.json event log — it is consent-gated through `resolveAutonomy`
 * ('pipeline-move' must resolve `auto`) and may NEVER enter or leave
 * `conclusion` (sign-off stays human/QA). Every transition appends one event
 * with its recorded inverse (ADR-0043: reversible by construction).
 */
import { readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { readAutonomyOverride, resolveAutonomy } from '../../runtime/config/resolve-autonomy.mjs';
import { appendEvent, readState, writeState } from '../../runtime/state/state-io.mjs';
import { listTasks } from './pipeline-tasks.mjs';

const STAGES = { backlog: 'backlog', working: 'working', testing: 'testing', conclusion: 'conclusion' };
const STATUS = { backlog: 'backlog', working: 'working', testing: 'testing', conclusion: 'done' };

/**
 * Legal AUTOMATIC transitions (ADR-0043 §3): `auto` only advances forward
 * `backlog→working→testing`. It may NOT do `testing→working` (that bounce is
 * `qa-reject`'s monopoly, and must carry feedback), skip a stage, move backward,
 * or touch `conclusion` (human/QA sign-off). The free-form HUMAN `move` is the
 * escape hatch for anything else.
 */
const AUTO_LEGAL = { backlog: ['working'], working: ['testing'] };

function findTask(PIPE, id) {
  const task = listTasks(PIPE).find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) {
    console.error(`No task with id ${id}.`);
    process.exit(1);
  }
  return task;
}

/** Shared file-move mechanics + the ADR-0043 event append (best-effort, never fatal). */
function relocate(PIPE, task, stage, sync, actor, note, noteHeading = 'QA Feedback') {
  const from = resolve(PIPE, task.stage, task.file);
  const to = resolve(PIPE, stage, task.file);
  let text = readFileSync(from, 'utf-8').replace(/^(status:).*$/m, `status: ${STATUS[stage]}`);
  if (stage === 'conclusion' && !/^concluded:/m.test(text)) {
    text = text.replace(/^---\n([\s\S]*?)\n---/, (full, fm) => `---\n${fm}\nconcluded: ${new Date().toISOString().slice(0, 10)}\n---`);
  }
  if (note) text += `\n## ${noteHeading} (${new Date().toISOString()})\n\n\`\`\`text\n${note}\n\`\`\`\n`;
  writeFileAtomicSync(from, text);
  renameSync(from, to);
  sync();
  try {
    appendEvent(PIPE, task.id, { from: task.stage, to: stage, actor, note: note ? `${noteHeading.toLowerCase().replace(/\s+/g, '-')} on card` : undefined });
    if (readState(PIPE, task.id)) writeState(PIPE, task.id, stage === 'conclusion' ? { status: STATUS[stage], endedAt: Date.now() } : { status: STATUS[stage] });
  } catch {
    /* observability is best-effort — the board move itself never fails on it */
  }
}

/** Free-form human move: `pipeline.mjs move <id> <stage>`. */
export function move({ PIPE, sync }) {
  const id = process.argv[3];
  const stage = process.argv[4];
  if (!id || !STAGES[stage]) {
    console.error('Usage: pipeline.mjs move <id> <backlog|working|testing|conclusion>');
    process.exit(1);
  }
  const task = findTask(PIPE, id);
  relocate(PIPE, task, stage, sync, 'human');
  console.log(`✅ Moved ${task.id} → ${stage}`);
}

/**
 * QA bounce — the ONLY testing→working path (ADR-0043 legality): the card goes
 * back to work carrying the QA feedback/stack-trace block, so the rejection is
 * actionable and on-record. Refuses from any other stage.
 */
export function qaReject({ PIPE, sync }) {
  const id = process.argv[3];
  const feedback = process.argv[4] || 'No feedback provided.';
  if (!id) {
    console.error('Usage: pipeline.mjs qa-reject <id> "feedback/stack trace"');
    process.exit(1);
  }
  const task = findTask(PIPE, id);
  if (task.stage !== 'testing') {
    console.error(`Task ${id} is in stage '${task.stage}', not 'testing'. qa-reject is the testing→working bounce only (ADR-0043).`);
    process.exit(1);
  }
  relocate(PIPE, task, 'working', sync, 'qa', feedback);
  console.log(`✅ Rejected ${task.id} → working (with feedback)`);
}

/**
 * Deterministic QA sign-off (ADR-0055) — the ONLY testing→conclusion path
 * besides the free-form human `move`. Actor `qa`. Refuses without evidence
 * (the suite verdict goes on the card and in the event note) and refuses a
 * card whose acceptance criteria are missing or not fully checked — an
 * unverifiable card cannot be signed off deterministically (rule 8).
 */
export function qaApprove({ PIPE, sync }) {
  const id = process.argv[3];
  const evidenceAt = process.argv.indexOf('--evidence');
  const evidence = evidenceAt >= 0 ? process.argv[evidenceAt + 1] : null;
  if (!id || !evidence) {
    console.error('Usage: pipeline.mjs qa-approve <id> --evidence "<suite verdict, e.g. npm run ci exit 0 @2026-06-11>"');
    process.exit(1);
  }
  const task = findTask(PIPE, id);
  if (task.stage !== 'testing') {
    console.error(`qa-approve refused: task ${id} is in '${task.stage}', not 'testing' — sign-off only closes the testing lane (ADR-0055).`);
    process.exit(1);
  }
  const card = readFileSync(resolve(PIPE, task.stage, task.file), 'utf-8');
  const unchecked = (card.match(/^\s*-\s*\[ \]/gm) || []).length;
  const checked = (card.match(/^\s*-\s*\[x\]/gim) || []).length;
  if (checked === 0 || unchecked > 0) {
    console.error(`qa-approve refused: acceptance criteria not deterministically satisfiable — ${checked} checked, ${unchecked} unchecked (need ≥1 checked, 0 unchecked). Complete the card or use the human \`move\` (ADR-0055).`);
    process.exit(1);
  }
  relocate(PIPE, task, 'conclusion', sync, 'qa', evidence, 'QA Sign-off');
  console.log(`✅ QA-approved ${task.id} → conclusion (actor=qa, evidence on card)`);
}

/**
 * AUTOMATIC transition (actor `auto`, ADR-0043) — consent-gated and
 * conclusion-fenced: refuses unless `resolveAutonomy('pipeline-move')` says
 * `auto` (grade ≥3, no floor hit), and never enters or leaves `conclusion`.
 * Per-id and explicit — there is deliberately no bulk sweep.
 */
export function autoTransition({ ROOT, PIPE, sync }) {
  const id = process.argv[3];
  const stage = process.argv[4];
  if (!id || !STAGES[stage]) {
    console.error('Usage: pipeline.mjs auto-transition <id> <backlog|working|testing>');
    process.exit(1);
  }
  let dial;
  try {
    dial = resolveAutonomy('pipeline-move', loadConfigSync(ROOT), readAutonomyOverride(ROOT));
  } catch (err) {
    console.error(`auto-transition refused: ${err?.message ?? err}`);
    process.exit(1);
  }
  if (dial.mode !== 'auto') {
    console.error(`auto-transition refused: pipeline-move resolves "${dial.mode}" at grade ${dial.grade} (${dial.reason}). Move it yourself or raise the dial: /autonomy.`);
    process.exit(1);
  }
  const task = findTask(PIPE, id);
  if (stage === 'conclusion' || task.stage === 'conclusion') {
    console.error('auto-transition refused: conclusion is human/QA sign-off territory at every grade (ADR-0043 legality).');
    process.exit(1);
  }
  if (!(AUTO_LEGAL[task.stage] || []).includes(stage)) {
    console.error(`auto-transition refused: ${task.stage}→${stage} is not a legal automatic move (ADR-0043). Auto advances backlog→working→testing only; the testing→working bounce is qa-reject (it must carry feedback). Use \`pipeline.mjs move\` for anything else.`);
    process.exit(1);
  }
  relocate(PIPE, task, stage, sync, 'auto');
  console.log(`✅ Auto-moved ${task.id} → ${stage} (actor=auto, grade ${dial.grade}; inverse recorded)`);
}
