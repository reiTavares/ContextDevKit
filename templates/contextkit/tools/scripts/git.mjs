#!/usr/bin/env node
/**
 * Version-control diagnostics — facts for the `/git` skill.
 *
 * Reports git presence, repo/commit state, the remote + inferred provider
 * (GitHub/GitLab/Bitbucket/Azure), whether the provider CLI (`gh`/`glab`) is
 * installed and authenticated, the current branch, dirtiness, and ahead/behind
 * vs upstream. `/git` reads this and suggests the exact next commands.
 *
 * Read-only by default (ticket 065): the ahead/behind count uses local
 * remote-tracking refs and is flagged `stale`; pass `--fetch` to refresh from the
 * network first (the only flag that performs a write/network side-effect).
 *
 * Usage:  node contextkit/tools/scripts/git.mjs status [--json] [--fetch]
 */
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

/**
 * Hard ceiling (ms) for any git/CLI subprocess. A hung network call — `git fetch`
 * against an unreachable remote, or `gh auth status` with no connectivity — must
 * not freeze `/git status`. On timeout `execFileSync` throws, so `run()` returns
 * `{ ok:false }` (the same path as a failed command) and the report degrades
 * gracefully. Overridable via env so tests can drive the timeout path fast.
 */
const CMD_TIMEOUT_MS = Number.parseInt(process.env.CONTEXT_GIT_TIMEOUT_MS || '', 10) || 10000;

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: CMD_TIMEOUT_MS }).trim() };
  } catch (err) {
    return { ok: false, out: '', code: err?.status };
  }
}

function providerFromUrl(url) {
  if (!url) return null;
  if (/github\.com/i.test(url)) return 'github';
  if (/gitlab/i.test(url)) return 'gitlab';
  if (/bitbucket\.org/i.test(url)) return 'bitbucket';
  if (/dev\.azure\.com|visualstudio\.com/i.test(url)) return 'azure';
  return 'other';
}

function collect(doFetch) {
  const gitV = run('git', ['--version']);
  const isRepo = run('git', ['rev-parse', '--is-inside-work-tree']).ok;
  const hasCommits = isRepo && run('git', ['rev-parse', 'HEAD']).ok;
  const remoteUrl = run('git', ['remote', 'get-url', 'origin']).out || null;
  const provider = providerFromUrl(remoteUrl);
  const branch = run('git', ['symbolic-ref', '--short', 'HEAD']).out || null;
  const dirty = isRepo ? run('git', ['status', '--porcelain']).out.length > 0 : false;

  // Provider CLIs.
  const gh = run('gh', ['--version']).ok;
  const ghAuth = gh ? run('gh', ['auth', 'status']).ok : false;
  const glab = run('glab', ['--version']).ok;
  const glabAuth = glab ? run('glab', ['auth', 'status']).ok : false;

  // ahead/behind vs upstream. Read-only by default — only fetch on --fetch (065).
  let ahead = null;
  let behind = null;
  let stale = false;
  if (remoteUrl && branch) {
    if (doFetch) run('git', ['fetch', 'origin', '--quiet']);
    const counts = run('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    if (counts.ok) {
      const [a, b] = counts.out.split(/\s+/);
      ahead = Number.parseInt(a ?? '0', 10);
      behind = Number.parseInt(b ?? '0', 10);
      stale = !doFetch;
    }
  }

  return {
    git: gitV.ok ? gitV.out.replace('git version ', '') : null,
    isRepo,
    hasCommits,
    remoteUrl,
    provider,
    branch,
    dirty,
    cli: { gh, ghAuth, glab, glabAuth },
    ahead,
    behind,
    stale,
  };
}

const s = collect(process.argv.includes('--fetch'));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(s, null, 2));
} else {
  console.log('🔧 Version control\n');
  console.log(`git:         ${s.git ?? 'NOT INSTALLED'}`);
  console.log(`repo:        ${s.isRepo ? (s.hasCommits ? 'yes (has commits)' : 'yes (no commits yet)') : 'NOT a git repo'}`);
  console.log(`branch:      ${s.branch ?? '—'}${s.dirty ? ' (uncommitted changes)' : ''}`);
  console.log(`remote:      ${s.remoteUrl ?? 'NONE'}${s.provider ? ` [${s.provider}]` : ''}`);
  if (s.ahead != null) console.log(`sync:        ahead ${s.ahead} / behind ${s.behind}${s.stale ? ' · local refs, may be stale (pass --fetch to refresh)' : ''}`);
  console.log(`gh CLI:      ${s.cli.gh ? (s.cli.ghAuth ? 'installed + authed' : 'installed, NOT authed') : 'not installed'}`);
  console.log(`glab CLI:    ${s.cli.glab ? (s.cli.glabAuth ? 'installed + authed' : 'installed, NOT authed') : 'not installed'}`);
  if (!s.remoteUrl) console.log('\n→ No remote. Run /git to set one up (GitHub/GitLab/other) + install the CLI.');
}
