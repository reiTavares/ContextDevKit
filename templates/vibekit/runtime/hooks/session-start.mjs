#!/usr/bin/env node
/**
 * SessionStart hook (Level >= 1) — injects project context at session start.
 *
 * Behavior:
 *   1. `git fetch origin` silently to surface ahead/behind divergence.
 *   2. Detects drift from prior sessions (ledgers with unregistered important
 *      modifications) and emits a banner. Cleans up resolved ledgers.
 *   3. Includes the latest registered session, the CHANGELOG `[Unreleased]`,
 *      and active workspace claims when present.
 *
 * Constraints: concise output, all errors silent (NEVER block a session),
 * zero third-party deps.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  exists,
  extractLatestSession,
  extractUnreleased,
  readChangelog,
  readSessionsIndex,
  readWorkspaceSummary,
} from './boot-context-readers.mjs';
import {
  freshLedger,
  ledgerPathFor,
  listAllLedgers,
  pendingImportantPaths,
  resolveSessionId,
  wasRegisteredDuringSession,
  writeLedger,
} from './ledger.mjs';
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { CONTEXT_SNAPSHOT } from '../config/paths.mjs';

const ROOT = process.cwd();

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

async function analyzePriorLedgers(currentSessionId) {
  const all = await listAllLedgers();
  const drift = [];
  for (const { sessionId, ledger } of all) {
    if (sessionId === currentSessionId) continue;
    const registered = ledger.registered || wasRegisteredDuringSession(ledger);
    const pending = pendingImportantPaths(ledger);
    if (registered || pending.length === 0) {
      await rm(ledgerPathFor(sessionId), { force: true }).catch(() => {});
      continue;
    }
    drift.push({ sessionId, paths: pending });
  }
  return drift;
}

function checkGitDivergence() {
  try {
    execSync('git fetch origin --quiet', { cwd: ROOT, stdio: 'ignore', timeout: 5000 });
  } catch {
    return null;
  }
  try {
    const counts = execSync('git rev-list --left-right --count HEAD...@{u}', {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    const [a, b] = counts.split(/\s+/);
    return { ahead: Number.parseInt(a ?? '0', 10), behind: Number.parseInt(b ?? '0', 10) };
  } catch {
    return null;
  }
}

function getBranch() {
  try {
    return execSync('git symbolic-ref --short HEAD', { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'detached';
  }
}

/**
 * Cross-machine + same-machine awareness (L3): recent OTHER branches — local
 * worktrees and remote feature branches — with author + age, so parallel work
 * (other devs/agents) is visible at boot. Read-only, best effort.
 */
function activeBranches(currentBranch) {
  const lines = [];
  try {
    const worktrees = execSync('git worktree list --porcelain', { cwd: ROOT, encoding: 'utf-8', timeout: 3000 })
      .split('\n')
      .filter((l) => l.startsWith('branch '))
      .map((l) => l.replace('branch refs/heads/', '').trim())
      .filter((b) => b && b !== currentBranch);
    for (const b of [...new Set(worktrees)].slice(0, 5)) lines.push(`- 🌳 local worktree on \`${b}\``);
  } catch {
    /* not a worktree setup */
  }
  try {
    const cutoff = '2.weeks.ago';
    const remote = execSync(
      `git for-each-ref --sort=-committerdate --count=20 --format="%(refname:short)|%(committerdate:relative)|%(authorname)" refs/remotes`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 3000 },
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split('|'))
      .filter(([ref]) => ref && !/\/(main|master|HEAD)$/.test(ref) && !ref.endsWith(`/${currentBranch}`))
      .filter(([, rel]) => !/(month|year)/.test(rel || ''))
      .slice(0, 5);
    for (const [ref, rel, author] of remote) lines.push(`- ☁️  \`${ref}\` — ${rel} by ${author}`);
    void cutoff;
  } catch {
    /* no remote */
  }
  return lines.length ? lines.join('\n') : null;
}

/** True when the project has no source code yet (routes first-run to /aidevtool-from0). */
function isGreenfield() {
  return !['src', 'app', 'apps', 'packages', 'lib', 'components', 'pages', 'server', 'cmd', 'internal'].some((d) => existsSync(resolve(ROOT, d)));
}

async function projectName() {
  try {
    const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf-8'));
    if (typeof pkg?.name === 'string' && pkg.name) return pkg.name;
  } catch {
    /* no package.json */
  }
  return basename(ROOT);
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    /* keep empty */
  }
  const sessionId = resolveSessionId(payload);
  const level = getLevel(ROOT);
  const needsSetup = loadConfigSync(ROOT)?.setup?.completed !== true;

  // Fresh ledger for this session (Level >= 2 uses it; harmless at L1).
  await writeLedger(sessionId, freshLedger(sessionId));

  const drift = level >= 2 ? await analyzePriorLedgers(sessionId) : [];
  const sessions = await readSessionsIndex(ROOT);
  const changelog = await readChangelog(ROOT);
  const latest = await extractLatestSession(ROOT);
  const workspace = level >= 3 ? await readWorkspaceSummary(ROOT) : null;
  const branches = level >= 3 ? activeBranches(getBranch()) : null;
  const hasSnapshot = await exists(ROOT, CONTEXT_SNAPSHOT);
  const divergence = checkGitDivergence();

  if (!needsSetup && !sessions && !changelog && !latest && drift.length === 0) return;

  const out = [];
  out.push('<project-context-boot>');
  out.push(`# 📚 Boot context — ${await projectName()}`);
  out.push('');
  out.push(`Session id: \`${sessionId.slice(0, 16)}\` · Branch: \`${getBranch()}\` · VibeDevKit level: \`L${level}\``);
  out.push('');

  if (needsSetup) {
    const empty = isGreenfield();
    out.push('## 🚀 First run — VibeDevKit not configured yet');
    out.push('');
    if (empty) {
      out.push('This folder looks **empty (no code yet)**. Run **`/aidevtool-from0`** — it interviews you');
      out.push('about the product, suggests/refines the stack, drafts a roadmap, adopts the best-practices');
      out.push('constitution, and seeds the DevPipeline. From zero, the kit stays ACTIVE: it keeps');
      out.push('suggesting the next practice/level as the product takes shape.');
    } else {
      out.push('This project already has code. Run **`/setupvibedevkit`** — it inspects the project, tunes');
      out.push('the config to this stack, fills in `CLAUDE.md`, flags high-risk paths, installs what is');
      out.push('needed, and records a baseline ADR. (Empty project instead? use `/aidevtool-from0`.)');
    }
    out.push('');
  }

  if (loadConfigSync(ROOT)?.practices?.active === true) {
    out.push('## 🧠 Best-practices skill is ACTIVE');
    out.push('');
    out.push('Honor `vibekit/best-practices.md` (file-size budget, intelligent refactor by responsibility,');
    out.push('SoC, naming, docs). Run `/analyze-code-ia-practices` to audit + get refactor proposals.');
    out.push('');
  }

  if (divergence && (divergence.ahead > 0 || divergence.behind > 0)) {
    out.push('## 🔄 Git status vs upstream');
    out.push('');
    if (divergence.behind > 0) out.push(`- ⚠️  Behind upstream by **${divergence.behind}** commit(s). Consider \`git pull\` before editing.`);
    if (divergence.ahead > 0) out.push(`- ℹ️  Ahead of upstream by **${divergence.ahead}** commit(s) (unpushed).`);
    out.push('');
  }

  if (drift.length > 0) {
    out.push('## 🚨 Drift from previous session(s)');
    out.push('');
    for (const d of drift) {
      out.push(`Session \`${d.sessionId.slice(0, 8)}\` ended without \`/log-session\` and left ${d.paths.length} important file(s) modified:`);
      for (const p of d.paths.slice(0, 8)) out.push(`  - ${p}`);
      if (d.paths.length > 8) out.push(`  (… and ${d.paths.length - 8} more)`);
      out.push('');
    }
    out.push('If those changes still matter, **offer to retroactively register them** before new work.');
    out.push('');
  }

  if (workspace) {
    out.push('## 👥 Active workspace claims');
    out.push('');
    out.push(workspace);
    out.push('');
  }

  if (branches) {
    out.push('## 🌿 Other active branches (parallel work)');
    out.push('');
    out.push(branches);
    out.push('');
    out.push('If you will touch files another branch changed, coordinate (or `/claim`) — the pre-push');
    out.push('hook will also block a conflicting push.');
    out.push('');
  }

  if (latest) {
    out.push('## 🗓️ Last registered session');
    out.push('');
    out.push(latest.content);
    out.push('');
  }

  if (changelog) {
    const unreleased = extractUnreleased(changelog);
    if (unreleased) {
      out.push('## 📝 Unreleased changes (CHANGELOG `[Unreleased]`)');
      out.push('');
      out.push(unreleased);
      out.push('');
    }
  }

  out.push('## ⚠️ Process rules');
  out.push('');
  out.push('1. Read SESSIONS index + relevant ADR before non-trivial changes.');
  out.push('2. New architectural decision → `/new-adr <title>` BEFORE implementing.');
  if (level >= 3) out.push('3. Reserve area before parallel work → `/claim <path>`. Free with `/release`.');
  out.push('4. End of productive session → `/log-session`.');
  out.push('5. `/state` for a quick state summary at any time.');
  if (hasSnapshot) out.push('6. `.context-snapshot.md` available for a full-project view.');
  out.push('</project-context-boot>');

  process.stdout.write(out.join('\n') + '\n');
}

main().catch((err) => {
  process.stderr.write(`[session-start] ${err?.message ?? err}\n`);
  process.exit(0);
});
