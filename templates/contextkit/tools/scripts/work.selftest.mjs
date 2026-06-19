/**
 * In-process self-test for the `work` CLI (BIZ-0001 / WF-0036, A1-T2).
 *
 * Zero-dependency, runs under plain `node`. Proves the two acceptance criteria:
 *   (a) operation create dry-run prints a plan and writes NOTHING;
 *   (b) `--apply` writes a schema-valid operation.json + reason.md + tasks.md
 *       atomically (all three present, operation.json validates);
 *   (c) re-render is byte-idempotent AND preserves out-of-block human notes.
 *
 * Uses a throwaway temp root (os.tmpdir) so it never touches the real tree.
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripBom } from '../../runtime/work/enums.mjs';
import { validateOperation } from '../../runtime/work/schema-operation.mjs';
import { PLATFORM_DIR } from '../../runtime/config/paths.mjs';
import { parseArgs } from './work-io.mjs';
import { dispatch } from './work.mjs';
import { renderTasksFile } from './work-render.mjs';

const failures = [];
/** Records a named assertion. @param {string} label @param {boolean} cond */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

const ROOT = mkdtempSync(join(tmpdir(), 'work-selftest-'));
try {
  const opsRoot = join(ROOT, PLATFORM_DIR, 'memory', 'operations');

  // (a) dry-run: plan only, no writes.
  const dryArgs = parseArgs(['operation', 'Rotate staging API key', '--mode', 'direct']);
  const dryReceipt = dispatch(dryArgs, { root: ROOT });
  assert('dry-run mode is dry-run', dryReceipt.applied === false && dryReceipt.mode === 'dry-run');
  assert('dry-run plans 3 files', dryReceipt.writes.length === 3);
  assert('dry-run writes nothing to disk', !existsSync(opsRoot));

  // (b) --apply: atomic write of all three artifacts, schema-valid operation.json.
  const applyArgs = parseArgs(['operation', 'Rotate staging API key', '--mode', 'batch', '--apply']);
  const applyReceipt = dispatch(applyArgs, { root: ROOT });
  assert('apply mode is apply', applyReceipt.applied === true && applyReceipt.mode === 'apply');
  const dir = applyReceipt.detail.dir;
  assert('package dir exists', existsSync(dir));
  for (const name of ['operation.json', 'reason.md', 'tasks.md']) {
    assert(`${name} written`, existsSync(join(dir, name)));
  }
  const opJson = JSON.parse(stripBom(readFileSync(join(dir, 'operation.json'), 'utf8')));
  const verdict = validateOperation(opJson);
  assert('written operation.json is schema-valid', verdict.ok === true);
  if (!verdict.ok) process.stdout.write(`       errors: ${verdict.errors.join('; ')}\n`);
  assert('executionMode persisted as batch', opJson.executionMode === 'batch');

  // (c) render idempotency + human-note preservation.
  // Seed a DevPipeline card linked to OP-0001, plus a human note in tasks.md.
  const backlog = join(ROOT, PLATFORM_DIR, 'pipeline', 'backlog');
  mkdirSync(backlog, { recursive: true });
  writeFileSync(
    join(backlog, '500-rotate.md'),
    '---\nid: 500\ntitle: Rotate key\ntype: chore\npriority: P1\noperation: OP-0001\n---\nbody\n',
    'utf8',
  );
  const tasksPath = join(dir, 'tasks.md');
  const withNote = `${readFileSync(tasksPath, 'utf8')}\nHUMAN-NOTE-SENTINEL outside the block.\n`;
  writeFileSync(tasksPath, withNote, 'utf8');

  const first = dispatch(parseArgs(['render', '--operation', 'OP-0001']), { root: ROOT });
  assert('first render changed', first.applied === true);
  const afterFirst = readFileSync(tasksPath, 'utf8');
  assert('card projected into block', afterFirst.includes('Rotate key') && afterFirst.includes('| 500 |'));
  assert('human note preserved', afterFirst.includes('HUMAN-NOTE-SENTINEL outside the block.'));

  const second = renderTasksFile(tasksPath, [{ id: '500', title: 'Rotate key', type: 'chore', priority: 'P1', stage: 'backlog' }]);
  assert('second render is a no-op (idempotent)', second.changed === false);
  assert('bytes identical after re-render', readFileSync(tasksPath, 'utf8') === afterFirst);
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
