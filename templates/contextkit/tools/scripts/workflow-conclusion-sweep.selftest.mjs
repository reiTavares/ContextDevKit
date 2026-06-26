/**
 * Self-test for the conclusion lifecycle (ADR-0119) + owner round-trip (#357).
 * Drives the REAL `workflow.mjs` CLI + the `done-sweep` Stop hook end-to-end, so
 * it exercises the wiring, not just the libraries. Pure `node:*`, zero deps.
 *
 * Contract under test:
 *  - advancing to completion does NOT move the workflow (path stays stable for the
 *    rest of the command/session — moving it synchronously broke that, ADR-0119);
 *  - `owner:` survives read→advance→render (#357 regression guard);
 *  - the done-sweep Stop hook then files the concluded workflow into <owner>/done/
 *    with its owner intact.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(SCRIPTS, 'workflow.mjs');
const HOOK = resolve(SCRIPTS, '..', '..', 'runtime', 'hooks', 'done-sweep.mjs');

let failures = 0;
function assert(label, condition) {
  process.stdout.write(`${condition ? '  ok  ' : 'FAIL  '}${label}\n`);
  if (!condition) failures += 1;
}
const run = (root, file, args) => spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf-8' });

const root = mkdtempSync(resolve(tmpdir(), 'ckit-concl-'));
try {
  const memory = resolve(root, 'contextkit', 'memory');
  mkdirSync(resolve(memory, 'business', 'BIZ-0001-fixture'), { recursive: true });
  const activeIndex = resolve(memory, 'workflows', '0001-concl-wf', 'index.md');
  const filedIndex = resolve(memory, 'business', 'BIZ-0001-fixture', 'done', '0001-concl-wf', 'index.md');

  process.stdout.write('Block A — create owned workflow\n');
  assert('A1: create exits 0', run(root, CLI, ['new', 'concl-wf', '--kind', 'feature', '--business', 'BIZ-0001']).status === 0);
  assert('A2: owner written at create', /owner:\s*BIZ-0001/.test(readFileSync(activeIndex, 'utf-8')));

  process.stdout.write('\nBlock B — advance to completion (no synchronous move)\n');
  let completed = false;
  for (let i = 0; i < 10 && !completed; i += 1) {
    const out = run(root, CLI, ['advance', 'concl-wf', '--force']);
    if (out.status !== 0) { assert(`B-advance #${i} exits 0`, false); break; }
    if (/complete/.test(out.stdout)) completed = true;
  }
  assert('B1: workflow reached completion', completed);
  assert('B2: still at active path (advance did NOT move it)', existsSync(activeIndex));
  assert('B3: owner survived round-trip', /owner:\s*BIZ-0001/.test(readFileSync(activeIndex, 'utf-8')));

  process.stdout.write('\nBlock C — done-sweep Stop hook files it under the owner\n');
  assert('C0: Stop hook exits 0', run(root, HOOK, []).status === 0);
  assert('C1: filed into <owner>/done/', existsSync(filedIndex));
  assert('C2: removed from active workflows/', !existsSync(activeIndex));
  assert('C3: owner intact after filing', /owner:\s*BIZ-0001/.test(readFileSync(filedIndex, 'utf-8')));
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nPASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
