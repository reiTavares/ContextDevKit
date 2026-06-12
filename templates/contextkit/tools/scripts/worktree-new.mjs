#!/usr/bin/env node
/**
 * Creates a git worktree + branch for a parallel session on the same machine.
 *
 * Each worktree gets its own `.claude/.sessions/` (it lives outside `.git`),
 * so parallel Claude chats never collide on the ledger or on live edits.
 *
 * Usage:
 *   node contextkit/tools/scripts/worktree-new.mjs <feature> [base-branch]
 *     Creates branch `feat/<feature>` and worktree `../<repo>-<feature>`.
 *
 *   node contextkit/tools/scripts/worktree-new.mjs --swarm <runId> <taskId> [base-branch]
 *     ADR-0051 workstream mode: branch `swarm/<runId>/<taskId>`, worktree
 *     `../<repo>-sw-<taskId>`. The default branch is never checked out in a
 *     swarm worktree (workstreams park at `testing`; merges stay human).
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

const slugify = (value) => String(value).replace(/[^a-z0-9-]/gi, '-').toLowerCase();

/** Resolves { branch, dest, base } for both modes; throws on bad usage. */
function parseArgs(argv) {
  const repoName = basename(ROOT);
  if (argv[0] === '--swarm') {
    const [, runId, taskId, base] = argv;
    if (!runId || !taskId) throw new Error('Usage: worktree-new.mjs --swarm <runId> <taskId> [base-branch]');
    const run = slugify(runId);
    const task = slugify(taskId);
    return { branch: `swarm/${run}/${task}`, dest: resolve(ROOT, '..', `${repoName}-sw-${task}`), base: base || 'HEAD', swarm: true };
  }
  const [feature, base] = argv;
  if (!feature) throw new Error('Usage: worktree-new.mjs <feature> [base-branch]  |  --swarm <runId> <taskId> [base-branch]');
  const slug = slugify(feature);
  return { branch: `feat/${slug}`, dest: resolve(ROOT, '..', `${repoName}-${slug}`), base: base || 'HEAD', swarm: false };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const { branch, dest, base, swarm } = parsed;

  try {
    git(['worktree', 'add', '-b', branch, dest, base]);
  } catch (err) {
    console.error(`❌ Could not create worktree: ${err?.message ?? err}`);
    process.exit(1);
  }

  console.log(`✅ Worktree created.`);
  console.log(`   Branch:   ${branch}`);
  console.log(`   Path:     ${dest}`);
  if (swarm) {
    console.log(`\nSwarm workstream (ADR-0051): the coordinator dispatches into this path;`);
    console.log(`it parks at testing/ — merge stays human (/swarm review).`);
  } else {
    console.log(`\nOpen it in a separate Claude Code window:`);
    console.log(`   code "${dest}"`);
    console.log(`\nWhen done:  git push -u origin ${branch}  (then open a PR).`);
  }
}

main();
