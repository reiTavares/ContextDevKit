/**
 * In-process self-test for the `work` CLI (BIZ-0001 / WF-0036, A1-T2).
 *
 * Zero-dependency, runs under plain `node`. Proves the two acceptance criteria:
 *   (a) operation create dry-run prints a plan and writes NOTHING;
 *   (b) batch `--apply` writes a schema-valid operation plus canonical task store;
 *   (c) render repairs `tasks.md` exactly and byte-idempotently from JSON.
 *
 * Uses a throwaway temp root (os.tmpdir) so it never touches the real tree.
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripBom } from '../../runtime/work/enums.mjs';
import { validateOperation } from '../../runtime/work/schema-operation.mjs';
import { PLATFORM_DIR } from '../../runtime/config/paths.mjs';
import { parseArgs } from './work-io.mjs';
import { dispatch } from './work.mjs';
import { renderTasksMarkdown } from './tasks-render.mjs';
import { readTasksDocument } from './tasks-store.mjs';

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
  assert('direct dry-run plans definition and reason only', dryReceipt.writes.length === 2);
  assert('dry-run writes nothing to disk', !existsSync(opsRoot));

  // (b) --apply: batch package includes canonical store + projection + reports.
  const applyArgs = parseArgs(['operation', 'Rotate staging API key', '--mode', 'batch', '--apply']);
  const applyReceipt = dispatch(applyArgs, { root: ROOT });
  assert('apply mode is apply', applyReceipt.applied === true && applyReceipt.mode === 'apply');
  const dir = applyReceipt.detail.dir;
  assert('package dir exists', existsSync(dir));
  for (const name of ['operation.json', 'reason.md']) {
    assert(`${name} written`, existsSync(join(dir, name)));
  }
  assert('canonical tasks.json written', existsSync(join(dir, 'batch', 'tasks.json')));
  assert('generated tasks.md written', existsSync(join(dir, 'batch', 'tasks.md')));
  assert('batch reports directory written', existsSync(join(dir, 'batch', 'reports')));
  const opJson = JSON.parse(stripBom(readFileSync(join(dir, 'operation.json'), 'utf8')));
  const verdict = validateOperation(opJson);
  assert('written operation.json is schema-valid', verdict.ok === true);
  if (!verdict.ok) process.stdout.write(`       errors: ${verdict.errors.join('; ')}\n`);
  assert('executionMode persisted as batch', opJson.executionMode === 'batch');

  // (c) render is dry-run by default, then repairs solely from JSON.
  const tasksPath = join(dir, 'batch', 'tasks.md');
  writeFileSync(tasksPath, 'corrupt projection\n', 'utf8');
  const dryRender = dispatch(parseArgs(['render', '--operation', 'OP-0001']), { root: ROOT });
  assert('render is dry-run by default', dryRender.applied === false && readFileSync(tasksPath, 'utf8') === 'corrupt projection\n');
  const first = dispatch(parseArgs(['render', '--operation', 'OP-0001', '--apply']), { root: ROOT });
  assert('applied render repairs projection', first.applied === true);
  const afterFirst = readFileSync(tasksPath, 'utf8');
  assert('projection equals canonical renderer', afterFirst === renderTasksMarkdown(readTasksDocument(join(dir, 'batch', 'tasks.json'))));
  dispatch(parseArgs(['render', '--operation', 'OP-0001', '--apply']), { root: ROOT });
  assert('bytes identical after re-render', readFileSync(tasksPath, 'utf8') === afterFirst);
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
