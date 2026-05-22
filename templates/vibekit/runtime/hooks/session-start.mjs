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
import { getLevel } from '../config/load.mjs';
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

  // Fresh ledger for this session (Level >= 2 uses it; harmless at L1).
  await writeLedger(sessionId, freshLedger(sessionId));

  const drift = level >= 2 ? await analyzePriorLedgers(sessionId) : [];
  const sessions = await readSessionsIndex(ROOT);
  const changelog = await readChangelog(ROOT);
  const latest = await extractLatestSession(ROOT);
  const workspace = level >= 3 ? await readWorkspaceSummary(ROOT) : null;
  const hasSnapshot = await exists(ROOT, CONTEXT_SNAPSHOT);
  const divergence = checkGitDivergence();

  if (!sessions && !changelog && !latest && drift.length === 0) return;

  const out = [];
  out.push('<project-context-boot>');
  out.push(`# 📚 Boot context — ${await projectName()}`);
  out.push('');
  out.push(`Session id: \`${sessionId.slice(0, 16)}\` · Branch: \`${getBranch()}\` · VibeDevKit level: \`L${level}\``);
  out.push('');

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
