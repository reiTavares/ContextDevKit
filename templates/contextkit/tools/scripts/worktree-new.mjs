#!/usr/bin/env node
/**
 * Creates a git worktree + branch for a parallel session on the same machine.
 *
 * Each worktree gets its own `.claude/.sessions/` (it lives outside `.git`),
 * so parallel Claude chats never collide on the ledger or on live edits.
 *
 * Usage:  node contextkit/tools/scripts/worktree-new.mjs <feature> [base-branch]
 *   Creates branch `feat/<feature>` and worktree `../<repo>-<feature>`.
 */
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

const ROOT = process.cwd();

// execFileSync (argv array, NO shell) so a crafted base-branch arg can never
// inject — e.g. `worktree-new.mjs feat "HEAD; rm -rf ~"` is passed to git as a
// single literal revision and simply fails, instead of running the `rm`.
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

function main() {
  const feature = process.argv[2];
  const base = process.argv[3] || 'HEAD';
  if (!feature) {
    console.error('Usage: worktree-new.mjs <feature> [base-branch]');
    process.exit(1);
  }
  const slug = feature.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const branch = `feat/${slug}`;
  const repoName = basename(ROOT);
  const dest = resolve(ROOT, '..', `${repoName}-${slug}`);

  try {
    git(['worktree', 'add', '-b', branch, dest, base]);
  } catch (err) {
    console.error(`❌ Could not create worktree: ${err?.message ?? err}`);
    process.exit(1);
  }

  console.log(`✅ Worktree created.`);
  console.log(`   Branch:   ${branch}`);
  console.log(`   Path:     ${dest}`);
  console.log(`\nOpen it in a separate Claude Code window:`);
  console.log(`   code "${dest}"`);
  console.log(`\nWhen done:  git push -u origin ${branch}  (then open a PR).`);
}

main();
