#!/usr/bin/env node
/**
 * GitHub sync awareness — facts for `/dev-start` (preflight) and `/git pr` (prepr).
 *
 * The boot banner already shows branch/commit divergence and recent branches;
 * `pre-push` blocks textual conflicts. This script adds the missing **PR** layer
 * at the two moments that matter, WITHOUT touching the SessionStart hot path:
 *
 *   - preflight (before coding): ahead/behind, recent in-flight branches, and
 *     OPEN PRs with CI/review status — flagging PRs *awaiting status* that may
 *     overlap the objective.
 *   - prepr (before opening a PR): re-check divergence vs the default branch and
 *     detect a DUPLICATE open PR for the current branch.
 *
 * `gh` is optional. Absent/unauthed ⇒ the git-only half runs and the PR half is
 * reported as **skipped, never a pass** (Rule 8). No remote / offline ⇒ silent,
 * exit 0. Read-only: it never creates, edits, or merges a PR. Zero deps. [ADR-0026]
 *
 * Usage:
 *   node contextkit/tools/scripts/sync-check.mjs preflight [--json]
 *   node contextkit/tools/scripts/sync-check.mjs prepr     [--json]
 */
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

/**
 * Hard ceiling (ms) for any git/`gh` subprocess. A hung `git fetch` or `gh pr
 * list` against an unreachable remote must not freeze the dev flow. On timeout
 * `execFileSync` throws → `run()` returns `{ ok:false }` (the failed-command
 * path) and the report degrades gracefully. Env-overridable for fast tests.
 */
const CMD_TIMEOUT_MS = Number.parseInt(process.env.CONTEXT_GIT_TIMEOUT_MS || '', 10) || 10000;

/** PR fields pulled from `gh` — enough to derive checks + review status. */
const PR_FIELDS = 'number,title,headRefName,state,statusCheckRollup,reviewDecision,updatedAt,url,isDraft';

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: CMD_TIMEOUT_MS }).trim() };
  } catch (err) {
    return { ok: false, out: '', code: err?.status };
  }
}

function int(value) {
  return Number.parseInt(value ?? '0', 10) || 0;
}

/** Strip a UTF-8 BOM and parse; returns null on any malformation (Rule 4). */
function parseJson(text) {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function currentBranch() {
  return run('git', ['symbolic-ref', '--short', 'HEAD']).out || null;
}

function hasRemote() {
  return Boolean(run('git', ['remote', 'get-url', 'origin']).out);
}

/** The default branch (origin/HEAD target), falling back to "main". */
function mainBranch() {
  const ref = run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  return ref.ok && ref.out ? ref.out.replace(/^origin\//, '') : 'main';
}

/**
 * ahead/behind vs the remote. **Read-only by default** (ticket 065): a diagnostic
 * must not mutate refs or hit the network behind the user's back, so the
 * `git fetch` only runs when `doFetch` is true (`--fetch`). Without it, the count
 * is against the *already-fetched* remote-tracking refs and is flagged `stale`.
 * Prefers the branch's own upstream (`@{u}`); a branch with no upstream falls back
 * to `origin/<main>`. null when unknowable.
 *
 * @param {string} main — default branch name
 * @param {boolean} doFetch — refresh remote refs first (network + ref write)
 */
function divergence(main, doFetch) {
  if (doFetch) run('git', ['fetch', 'origin', '--quiet']);
  const upstream = run('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (upstream.ok) {
    const [a, b] = upstream.out.split(/\s+/);
    return { ahead: int(a), behind: int(b), against: '@{u}', stale: !doFetch };
  }
  const trunk = run('git', ['rev-list', '--left-right', '--count', `HEAD...origin/${main}`]);
  if (!trunk.ok) return null;
  const [a, b] = trunk.out.split(/\s+/);
  return { ahead: int(a), behind: int(b), against: `origin/${main}`, stale: !doFetch };
}

/** The 20 most-recent OTHER remote branches (in-flight work), newest first. */
function recentBranches(branch, limit = 20) {
  const r = run('git', ['for-each-ref', '--sort=-committerdate', `--count=${limit}`, '--format=%(refname:short)|%(committerdate:relative)|%(authorname)', 'refs/remotes']);
  if (!r.ok) return [];
  return r.out.split('\n').map((line) => line.trim()).filter(Boolean)
    .map((line) => line.split('|'))
    .filter(([ref]) => ref && ref.includes('/') && !/\/(main|master|HEAD)$/.test(ref) && ref !== `origin/${branch}`)
    .map(([ref, age, author]) => ({ ref, age, author }));
}

/** `gh` is usable only when installed AND authenticated. */
function ghReady() {
  return run('gh', ['--version']).ok && run('gh', ['auth', 'status']).ok;
}

/** Collapse a PR's check-rollup into one of: passing | failing | pending | none. */
function rollupChecks(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  let failing = false;
  for (const check of rollup) {
    const { status, conclusion, state } = check ?? {};
    if (state === 'PENDING' || (status && status !== 'COMPLETED')) pending = true;
    if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)) failing = true;
    if (state === 'FAILURE' || state === 'ERROR') failing = true;
  }
  if (failing) return 'failing';
  if (pending) return 'pending';
  return 'passing';
}

function reviewLabel(decision) {
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (decision === 'REVIEW_REQUIRED') return 'review-required';
  return 'none';
}

/** Project a raw `gh` PR into the kit's summary shape + the "awaiting" verdict. */
function summarizePr(pr) {
  const checks = rollupChecks(pr.statusCheckRollup);
  const review = reviewLabel(pr.reviewDecision);
  const awaiting = checks === 'pending' || checks === 'failing' || review === 'review-required' || review === 'changes-requested';
  return { number: pr.number, title: pr.title, head: pr.headRefName, draft: Boolean(pr.isDraft), url: pr.url, updated: pr.updatedAt, checks, review, awaiting };
}

/** Open PRs (optionally filtered), or null when `gh` couldn't answer (a SKIP). */
function listOpenPRs(extraArgs = []) {
  const r = run('gh', ['pr', 'list', '--state', 'open', '--limit', '30', '--json', PR_FIELDS, ...extraArgs]);
  if (!r.ok) return null;
  const parsed = parseJson(r.out);
  return Array.isArray(parsed) ? parsed.map(summarizePr) : null;
}

function preflight(doFetch) {
  const branch = currentBranch();
  const remote = hasRemote();
  const main = mainBranch();
  const ghOk = remote && ghReady();
  return {
    mode: 'preflight',
    branch,
    remote,
    divergence: remote ? divergence(main, doFetch) : null,
    recentBranches: remote ? recentBranches(branch) : [],
    ghReady: ghOk,
    prs: ghOk ? listOpenPRs() : null,
  };
}

function prepr(doFetch) {
  const branch = currentBranch();
  const remote = hasRemote();
  const main = mainBranch();
  const ghOk = remote && ghReady();
  const branchPrs = ghOk && branch ? listOpenPRs(['--head', branch]) : null;
  return {
    mode: 'prepr',
    branch,
    main,
    remote,
    divergence: remote ? divergence(main, doFetch) : null,
    ghReady: ghOk,
    existingPr: Array.isArray(branchPrs) && branchPrs.length ? branchPrs[0] : (ghOk ? null : undefined),
  };
}

function printPreflight(s) {
  console.log('🔄 Sync preflight\n');
  console.log(`branch:      ${s.branch ?? '—'}`);
  if (!s.remote) { console.log('remote:      NONE → nothing to sync against yet.'); return; }
  if (s.divergence) console.log(`sync:        ahead ${s.divergence.ahead} / behind ${s.divergence.behind} (vs ${s.divergence.against})${s.divergence.stale ? ' · local refs, may be stale (pass --fetch to refresh)' : ''}`);
  if (s.recentBranches.length) {
    console.log('\nRecent remote branches (in flight):');
    for (const b of s.recentBranches.slice(0, 8)) console.log(`  - ${b.ref} — ${b.age} by ${b.author}`);
  }
  if (!s.ghReady) { console.log('\nPR checks skipped (gh not installed/authed) — git-only view above.'); return; }
  if (s.prs == null) { console.log('\nPR checks skipped (gh query failed) — git-only view above.'); return; }
  if (s.prs.length === 0) { console.log('\nOpen PRs: none.'); return; }
  console.log(`\nOpen PRs (${s.prs.length}):`);
  for (const pr of s.prs) {
    console.log(`  #${pr.number} ${pr.awaiting ? '⏳ awaiting' : '✓ ready'} — ${pr.title}`);
    console.log(`     head ${pr.head} · checks ${pr.checks} · review ${pr.review}${pr.draft ? ' · draft' : ''}`);
  }
  const awaiting = s.prs.filter((pr) => pr.awaiting).length;
  if (awaiting) console.log(`\n→ ${awaiting} PR(s) awaiting status/review — check overlap with your objective before coding.`);
}

function printPrepr(s) {
  console.log('🔄 Pre-PR check\n');
  console.log(`branch:      ${s.branch ?? '—'}`);
  if (!s.remote) { console.log('remote:      NONE → set one up with /git before opening a PR.'); return; }
  if (s.divergence) {
    console.log(`sync:        ahead ${s.divergence.ahead} / behind ${s.divergence.behind} (vs ${s.divergence.against})${s.divergence.stale ? ' · local refs, may be stale (pass --fetch to refresh)' : ''}`);
    if (s.divergence.behind > 0) console.log(`  ⚠️  behind by ${s.divergence.behind} — rebase first: git pull --rebase origin ${s.main}`);
  }
  if (!s.ghReady) { console.log('\nPR dedupe skipped (gh not installed/authed) — verify manually before opening.'); return; }
  if (!s.existingPr) { console.log('\nNo open PR for this branch — safe to create one.'); return; }
  const pr = s.existingPr;
  console.log(`\n⚠️  An open PR already exists for ${pr.head}:`);
  console.log(`  #${pr.number} — ${pr.title}`);
  console.log(`  ${pr.url}`);
  console.log(`  checks ${pr.checks} · review ${pr.review}${pr.draft ? ' · draft' : ''}`);
  console.log('  → Push to update it instead of creating a duplicate.');
}

const mode = process.argv[2];
const asJson = process.argv.includes('--json');
const doFetch = process.argv.includes('--fetch'); // ticket 065: opt-in to the network fetch

if (mode !== 'preflight' && mode !== 'prepr') {
  console.error('Usage: sync-check.mjs <preflight|prepr> [--json] [--fetch]');
  process.exit(2);
}

try {
  const summary = mode === 'preflight' ? preflight(doFetch) : prepr(doFetch);
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else if (mode === 'preflight') printPreflight(summary);
  else printPrepr(summary);
  process.exit(0);
} catch (err) {
  // Never break the dev flow — degrade to a one-line note (Rule 2).
  process.stderr.write(`[sync-check] ${err?.message ?? err}\n`);
  process.exit(0);
}
