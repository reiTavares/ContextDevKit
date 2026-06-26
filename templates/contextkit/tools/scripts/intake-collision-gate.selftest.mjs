/**
 * Self-test for the advisory intake collision gate (ADR-0119).
 * Pure `node:*`, zero deps; exits non-zero on the first failed assertion.
 *
 * Coverage:
 *  1. `buildReport` returns the 4 kind rows + the considered worktrees.
 *  2. `renderReport` shows every kind and the all-clear line when nothing diverges.
 *  3. `renderReport` shows the warning line when a kind diverges (synthetic report).
 *  4. The CLI always exits 0 — it is advisory and never blocks.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildReport, renderReport } from './intake-collision-gate.mjs';

let failures = 0;
function assert(label, condition) {
  process.stdout.write(`${condition ? '  ok  ' : 'FAIL  '}${label}\n`);
  if (!condition) failures += 1;
}

const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'ckit-gate-'));
try {
  process.stdout.write('Block A — buildReport\n');
  const report = buildReport(fixtureRoot);
  assert('A1: 4 kind rows', report.rows.length === 4);
  assert('A2: worktrees is an array', Array.isArray(report.worktrees));
  assert('A3: non-git fixture does not diverge', report.diverged === false);

  process.stdout.write('\nBlock B — renderReport (clean)\n');
  const clean = renderReport(report).join('\n');
  assert('B1: shows all four kinds', ['BIZ', 'OP', 'WF', 'ADR'].every((k) => clean.includes(k)));
  assert('B2: shows the all-clear line', clean.includes('No divergence'));

  process.stdout.write('\nBlock C — renderReport (synthetic divergence)\n');
  const diverged = renderReport({
    rows: [{ kind: 'WF', local: 'WF-0042', fleet: 'WF-0043', diverges: true }],
    worktrees: [{ path: '/x', branch: 'a' }, { path: '/y', branch: 'b' }],
    diverged: true,
  }).join('\n');
  assert('C1: warns about a parallel worktree', diverged.includes('parallel worktree'));
  assert('C2: names the fleet number to use', diverged.includes('WF→WF-0043'));
  assert('C3: states it is advisory', diverged.toLowerCase().includes('advisory'));

  process.stdout.write('\nBlock D — CLI exits 0 (advisory)\n');
  const cli = resolve(process.cwd(), 'templates/contextkit/tools/scripts/intake-collision-gate.mjs');
  const run = spawnSync(process.execPath, [cli], { cwd: process.cwd(), encoding: 'utf-8' });
  assert('D1: CLI exit code is 0', run.status === 0);
  assert('D2: CLI prints the gate header', run.stdout.includes('Intake collision gate'));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nPASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
