/**
 * Self-test for fleet-aware + done-recursive intake numbering (ADR-0119).
 * Pure `node:*`, zero deps; exits non-zero on the first failed assertion.
 *
 * Coverage:
 *  1. `fleetMemoryRoots` returns local-only (length 1) on a non-git temp root, and
 *     is non-empty + forward-slash normalised on the live worktree.
 *  2. `listWorktrees` finds at least the local worktree on the live tree.
 *  3. done-recursion: a WF in `workflows/done/` and in `<owner>/done/` still raises
 *     `nextWorkflowNumber` — a filed-away number is never reused.
 *  4. `localVsFleet` returns one row per kind with `local`/`fleet`/`diverges`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { fleetMemoryRoots, listWorktrees } from './fleet.mjs';
import { nextWorkflowNumber, localVsFleet } from './ids.mjs';

let failures = 0;
function assert(label, condition) {
  process.stdout.write(`${condition ? '  ok  ' : 'FAIL  '}${label}\n`);
  if (!condition) failures += 1;
}

/** Materialises a workflow dir with a minimal index.md under `holder`. */
function writeWorkflow(holder, name) {
  const dir = resolve(holder, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.md'), `---\nnumber: ${name.slice(3, 7)}\n---\n`);
}

const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'ckit-fleet-'));
try {
  process.stdout.write('Block A — fleetMemoryRoots / listWorktrees\n');
  const fixtureMemory = pathsFor(fixtureRoot).memory;
  mkdirSync(fixtureMemory, { recursive: true });
  const fixtureRoots = fleetMemoryRoots(fixtureRoot);
  assert('A1: non-git fixture → local-only (length 1)', fixtureRoots.length === 1);
  assert('A2: local root is forward-slash normalised', !fixtureRoots[0].includes('\\'));

  const liveRoots = fleetMemoryRoots(process.cwd());
  assert('A3: live tree → non-empty', liveRoots.length >= 1);
  assert('A4: all live roots forward-slash normalised', liveRoots.every((r) => !r.includes('\\')));
  assert('A5: listWorktrees finds ≥1 on live tree', listWorktrees(process.cwd()).length >= 1);
  assert('A6: listWorktrees → [] on non-git temp', listWorktrees(fixtureRoot).length === 0);

  process.stdout.write('\nBlock B — done-recursion raises the workflow number\n');
  const memory = fixtureMemory;
  writeWorkflow(`${memory}/workflows`, 'WF-0050-active');
  assert('B1: active WF-0050 → next 0051', nextWorkflowNumber(fixtureRoot) === '0051');
  writeWorkflow(`${memory}/workflows/done`, 'WF-0055-filed');
  assert('B2: filed WF-0055 in workflows/done → next 0056', nextWorkflowNumber(fixtureRoot) === '0056');
  writeWorkflow(`${memory}/business/BIZ-0001-x/done`, 'WF-0060-owned');
  assert('B3: filed WF-0060 in owner/done → next 0061', nextWorkflowNumber(fixtureRoot) === '0061');

  process.stdout.write('\nBlock C — localVsFleet shape\n');
  const rows = localVsFleet(fixtureRoot);
  assert('C1: one row per kind (BIZ/OP/WF/ADR)', rows.length === 4);
  assert('C2: kinds present', ['BIZ', 'OP', 'WF', 'ADR'].every((k) => rows.some((r) => r.kind === k)));
  assert('C3: every row has local/fleet/diverges', rows.every((r) => r.local && r.fleet && typeof r.diverges === 'boolean'));
  const wfRow = rows.find((r) => r.kind === 'WF');
  assert('C4: WF fleet reflects done-recursion (WF-0061)', wfRow.fleet === 'WF-0061');
  assert('C5: single-root fixture does not diverge', rows.every((r) => r.diverges === false));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nPASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
