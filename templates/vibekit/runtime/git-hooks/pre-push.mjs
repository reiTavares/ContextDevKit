#!/usr/bin/env node
/**
 * pre-push hook (Level >= 3) — conflict pre-check against the latest remote.
 *
 * Before a push lands, this fetches the target branch (config l3.mainBranch,
 * default "main"), compares what you changed against what changed upstream since
 * your merge-base, and:
 *   - BLOCKS (exit 1) if a real textual conflict exists (git merge-tree) — so a
 *     parallel dev/agent who edited the same lines isn't silently overwritten.
 *   - WARNS (exit 0) if you both touched the same files but they auto-merge.
 *   - stays silent when there is no overlap.
 *
 * This is the cross-machine guarantee: the per-session ledger can't see other
 * machines, but git can. Bypass (audited): VIBE_ALLOW_CONFLICT_PUSH=1 git push.
 *
 * Defensive: no remote / offline / old git → allow (never block on tooling).
 */
import { execFileSync } from 'node:child_process';
import { loadConfigSync } from '../config/load.mjs';

const ROOT = process.cwd();
const MAIN = loadConfigSync(ROOT).l3?.mainBranch || 'main';

/**
 * Cap every git subprocess (ms) so the network `fetch` below can't hang a push
 * against an unreachable/slow remote. On timeout `execFileSync` throws → `git()`
 * returns `{ ok:false }`, which the conflict check already treats as "couldn't
 * refresh, allow the push" (defensive: never block on tooling). Env-overridable.
 */
const GIT_TIMEOUT_MS = Number.parseInt(process.env.VIBE_GIT_TIMEOUT_MS || '', 10) || 15000;

if (process.env.VIBE_ALLOW_CONFLICT_PUSH === '1') {
  console.error('⚠️  pre-push: conflict check bypassed (VIBE_ALLOW_CONFLICT_PUSH=1).');
  process.exit(0);
}

function git(args, allowFail = true) {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS }).trim() };
  } catch (err) {
    if (!allowFail) throw err;
    return { ok: false, out: '', status: err?.status };
  }
}

function fileList(range) {
  const r = git(['diff', '--name-only', range]);
  return r.ok ? r.out.split('\n').filter(Boolean) : [];
}

function main() {
  // Refresh the remote ref (best effort, short timeout via git's own).
  git(['fetch', 'origin', MAIN, '--quiet']);

  const remote = `origin/${MAIN}`;
  if (!git(['rev-parse', '--verify', '--quiet', remote]).ok) process.exit(0); // no upstream yet

  const base = git(['merge-base', 'HEAD', remote]);
  if (!base.ok || !base.out) process.exit(0);

  const ours = new Set(fileList(`${base.out}..HEAD`));
  const theirs = fileList(`${base.out}..${remote}`);
  const overlap = theirs.filter((f) => ours.has(f));
  if (overlap.length === 0) process.exit(0); // disjoint — safe

  // Real textual conflict? `git merge-tree --write-tree` exits 1 on conflict.
  const mt = git(['merge-tree', '--write-tree', 'HEAD', remote]);
  const hasConflict = mt.status === 1; // status>1 / unsupported → unknown

  if (hasConflict) {
    console.error('');
    console.error(`✗ pre-push BLOCKED — your branch conflicts with ${remote} (someone pushed there).`);
    console.error('');
    console.error('  Files changed on BOTH sides (likely conflicts):');
    for (const f of overlap) console.error(`    - ${f}`);
    console.error('');
    console.error('  Two sessions/devs changed the same file. Reconcile before pushing so');
    console.error('  neither change is lost:');
    console.error(`    git pull --rebase origin ${MAIN}   # replay your work on top, resolve conflicts`);
    console.error('    # review each file: keep BOTH functions/changes, then continue the rebase');
    console.error('');
    console.error('  Emergency bypass (audited): VIBE_ALLOW_CONFLICT_PUSH=1 git push ...');
    console.error('');
    process.exit(1);
  }

  // Overlap but auto-mergeable — warn, don't block.
  console.error('');
  console.error(`⚠️  pre-push: you and ${remote} both changed these files (git can auto-merge,`);
  console.error('   but double-check nothing is logically clobbered):');
  for (const f of overlap) console.error(`    - ${f}`);
  console.error(`   Tip: git pull --rebase origin ${MAIN} before pushing keeps history clean.`);
  console.error('');
  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[pre-push] ${err?.message ?? err}\n`);
  process.exit(0);
}
