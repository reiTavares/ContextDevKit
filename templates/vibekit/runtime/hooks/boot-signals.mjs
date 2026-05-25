/**
 * Boot signals — environment detectors for the SessionStart banner.
 *
 * Pure-ish read-only helpers split out of `session-start.mjs` to keep that hook
 * under the line budget: git divergence/branch, other active branches, project
 * name, greenfield detection, and the config-driven cadence triggers
 * (security-mode, predictions-review). All best-effort and silent on error —
 * a signal never blocks a session. Zero third-party deps.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { loadConfigSync } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';

export function checkGitDivergence(root) {
  try {
    execSync('git fetch origin --quiet', { cwd: root, stdio: 'ignore', timeout: 5000 });
  } catch {
    return null;
  }
  try {
    const counts = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd: root, encoding: 'utf-8', timeout: 3000 }).trim();
    const [a, b] = counts.split(/\s+/);
    return { ahead: Number.parseInt(a ?? '0', 10), behind: Number.parseInt(b ?? '0', 10) };
  } catch {
    return null;
  }
}

export function getBranch(root) {
  try {
    return execSync('git symbolic-ref --short HEAD', { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'detached';
  }
}

/**
 * Cross-machine + same-machine awareness (L3): recent OTHER branches — local
 * worktrees and remote feature branches — with author + age, so parallel work
 * (other devs/agents) is visible at boot. Read-only, best effort.
 */
export function activeBranches(root, currentBranch) {
  const lines = [];
  try {
    const worktrees = execSync('git worktree list --porcelain', { cwd: root, encoding: 'utf-8', timeout: 3000 })
      .split('\n')
      .filter((l) => l.startsWith('branch '))
      .map((l) => l.replace('branch refs/heads/', '').trim())
      .filter((b) => b && b !== currentBranch);
    for (const b of [...new Set(worktrees)].slice(0, 5)) lines.push(`- 🌳 local worktree on \`${b}\``);
  } catch {
    /* not a worktree setup */
  }
  try {
    const remote = execSync(
      `git for-each-ref --sort=-committerdate --count=20 --format="%(refname:short)|%(committerdate:relative)|%(authorname)" refs/remotes`,
      { cwd: root, encoding: 'utf-8', timeout: 3000 },
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split('|'))
      .filter(([ref]) => ref && !/\/(main|master|HEAD)$/.test(ref) && !ref.endsWith(`/${currentBranch}`))
      .filter(([, rel]) => !/(month|year)/.test(rel || ''))
      .slice(0, 5);
    for (const [ref, rel, author] of remote) lines.push(`- ☁️  \`${ref}\` — ${rel} by ${author}`);
  } catch {
    /* no remote */
  }
  return lines.length ? lines.join('\n') : null;
}

/** True when the project has no source code yet (routes first-run to /aidevtool-from0). */
export function isGreenfield(root) {
  return !['src', 'app', 'apps', 'packages', 'lib', 'components', 'pages', 'server', 'cmd', 'internal'].some((d) => existsSync(resolve(root, d)));
}

export async function projectName(root) {
  try {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf-8'));
    if (typeof pkg?.name === 'string' && pkg.name) return pkg.name;
  } catch {
    /* no package.json */
  }
  return basename(root);
}

/** Counts registered session files. Shared by the cadence triggers. */
function sessionCount(root) {
  try {
    return readdirSync(pathsFor(root).sessions).filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

/** Security mode (config): returns the cadence N when a /deep-analysis is due, else 0. */
export function securityModeDue(root) {
  const cfg = loadConfigSync(root)?.securityMode;
  if (!cfg || cfg.active !== true) return 0;
  const everyN = Number(cfg.everyNSessions) > 0 ? Number(cfg.everyNSessions) : 10;
  const n = sessionCount(root);
  return n > 0 && n % everyN === 0 ? everyN : 0;
}

/**
 * Predictions-review cadence (config): returns N when a review is due — an
 * every-N-sessions tick AND at least one `/simulate-impact` prediction is still
 * unreviewed (`fill on review` stub). Zero noise when there's nothing to review.
 */
export function predictionsReviewDue(root) {
  const cfg = loadConfigSync(root)?.predictionsReview;
  if (!cfg || cfg.active !== true) return 0;
  const everyN = Number(cfg.everyNSessions) > 0 ? Number(cfg.everyNSessions) : 10;
  const n = sessionCount(root);
  if (n === 0 || n % everyN !== 0) return 0;
  try {
    const dir = pathsFor(root).predictions;
    const unreviewed = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .some((f) => {
        try {
          return readFileSync(resolve(dir, f), 'utf-8').includes('fill on review');
        } catch {
          return false;
        }
      });
    return unreviewed ? everyN : 0;
  } catch {
    return 0;
  }
}
