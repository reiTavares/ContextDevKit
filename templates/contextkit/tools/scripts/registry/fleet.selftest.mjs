/**
 * Self-test for fleet-aware + done-recursive intake numbering (ADR-0119).
 * Pure `node:*`, zero deps; exits non-zero on the first failed assertion.
 *
 * Coverage:
 *  1. `fleetMemoryRoots` returns local-only on a non-Git temp root.
 *  2. Injected porcelain fixtures cover Windows-style/path-with-spaces parsing
 *     without requiring the checkout to be a Git worktree.
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

  const siblingRoot = resolve(fixtureRoot, 'sibling worktree');
  mkdirSync(pathsFor(siblingRoot).memory, { recursive: true });
  const porcelain = [
    `worktree ${fixtureRoot.replace(/\\/g, '/')}`,
    'branch refs/heads/main',
    '',
    `worktree ${siblingRoot.replace(/\\/g, '/')}`,
    'branch refs/heads/feature/with-spaces',
    '',
  ].join('\n');
  const executeGit = () => porcelain;
  const injectedTrees = listWorktrees(fixtureRoot, { executeGit });
  assert('A3: injected porcelain returns both fixture worktrees', injectedTrees.length === 2);
  assert('A4: injected branch is parsed', injectedTrees[1]?.branch === 'refs/heads/feature/with-spaces');
  const injectedRoots = fleetMemoryRoots(fixtureRoot, { executeGit });
  assert('A5: fleet roots include the path-with-spaces sibling', injectedRoots.length === 2 && injectedRoots.every((r) => !r.includes('\\')));
  assert('A6: missing Git degrades to []', listWorktrees(fixtureRoot, { executeGit: () => { throw new Error('git unavailable'); } }).length === 0);

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
