/**
 * DevPipeline stage transitions — extracted from pipeline.mjs (280-budget split,
 * ADR-0041 F1 / task 110).
 *
 * Legality (ADR-0043): the verbs here are HUMAN verbs — a human may move a card
 * anywhere (`move`), and `qa-reject` is the ONLY testing→working path, always
 * carrying a feedback block on the card. AUTOMATIC transitions (actor `auto`)
 * do not exist yet by design: they land in F2 (ADR-0043) only on top of the
 * append-only state.json event log — an auto-move with no transition ledger is
 * an unobservable mutation (the refused `auto-transition` draft).
 */
import { readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { listTasks } from './pipeline-tasks.mjs';

const STAGES = { backlog: 'backlog', working: 'working', testing: 'testing', conclusion: 'conclusion' };
const STATUS = { backlog: 'backlog', working: 'working', testing: 'testing', conclusion: 'done' };

function findTask(PIPE, id) {
  const task = listTasks(PIPE).find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) {
    console.error(`No task with id ${id}.`);
    process.exit(1);
  }
  return task;
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
  const from = resolve(PIPE, task.stage, task.file);
  const to = resolve(PIPE, stage, task.file);
  let text = readFileSync(from, 'utf-8').replace(/^(status:).*$/m, `status: ${STATUS[stage]}`);
  if (stage === 'conclusion' && !/^concluded:/m.test(text)) {
    text = text.replace(/^---\n([\s\S]*?)\n---/, (full, fm) => `---\n${fm}\nconcluded: ${new Date().toISOString().slice(0, 10)}\n---`);
  }
  writeFileAtomicSync(from, text);
  renameSync(from, to);
  sync();
  // ADR-0015 §C — fire-and-forget state.json mirror (observability, best-effort).
  import('../../runtime/state/state-io.mjs').then((m) => m.readState(PIPE, task.id) && m.writeState(PIPE, task.id, stage === 'conclusion' ? { status: STATUS[stage], endedAt: Date.now() } : { status: STATUS[stage] })).catch(() => {});
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
  const from = resolve(PIPE, task.stage, task.file);
  const to = resolve(PIPE, 'working', task.file);
  let text = readFileSync(from, 'utf-8').replace(/^(status:).*$/m, 'status: working');
  text += `\n## QA Feedback (${new Date().toISOString()})\n\n\`\`\`text\n${feedback}\n\`\`\`\n`;
  writeFileAtomicSync(from, text);
  renameSync(from, to);
  sync();
  import('../../runtime/state/state-io.mjs').then((m) => m.readState(PIPE, task.id) && m.writeState(PIPE, task.id, { status: 'working' })).catch(() => {});
  console.log(`✅ Rejected ${task.id} → working (with feedback)`);
}
