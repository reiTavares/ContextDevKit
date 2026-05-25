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
import { rm } from 'node:fs/promises';
import {
  exists,
  extractLatestSession,
  extractUnreleased,
  readChangelog,
  readSessionsIndex,
  readWorkspaceSummary,
} from './boot-context-readers.mjs';
import {
  activeBranches,
  checkGitDivergence,
  getBranch,
  isGreenfield,
  predictionsReviewDue,
  projectName,
  securityModeDue,
} from './boot-signals.mjs';
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

/** A ledger touched within this window may belong to a LIVE concurrent session. */
const ACTIVE_GRACE_MS = 15 * 60 * 1000;

/** Most recent activity timestamp for a ledger (its start, or its last edit). */
function lastActivityAt(ledger) {
  const mods = Array.isArray(ledger.modifications) ? ledger.modifications : [];
  const lastMod = mods.reduce((mx, m) => (typeof m?.at === 'number' && m.at > mx ? m.at : mx), 0);
  return Math.max(typeof ledger.startedAt === 'number' ? ledger.startedAt : 0, lastMod);
}

async function analyzePriorLedgers(currentSessionId) {
  const all = await listAllLedgers();
  const drift = [];
  const now = Date.now();
  for (const { sessionId, ledger } of all) {
    if (sessionId === currentSessionId) continue;
    const mods = Array.isArray(ledger.modifications) ? ledger.modifications : [];
    const registered = ledger.registered || wasRegisteredDuringSession(ledger);
    const pending = pendingImportantPaths(ledger);
    if (registered || pending.length === 0) {
      // Reap a resolved ledger — but NEVER an empty one, nor one touched within the
      // grace window: that may be a LIVE concurrent session that just wrote its
      // fresh (empty) ledger. Deleting it was the race (008): a booting session
      // wiped a live peer. The owning session cleans up its own ledger.
      const maybeLive = mods.length === 0 || now - lastActivityAt(ledger) < ACTIVE_GRACE_MS;
      if (!maybeLive) await rm(ledgerPathFor(sessionId), { force: true }).catch(() => {});
      continue;
    }
    drift.push({ sessionId, paths: pending });
  }
  return drift;
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
  const branches = level >= 3 ? activeBranches(ROOT, getBranch(ROOT)) : null;
  const hasSnapshot = await exists(ROOT, CONTEXT_SNAPSHOT);
  const divergence = checkGitDivergence(ROOT);
  const secDue = securityModeDue(ROOT);
  const predDue = predictionsReviewDue(ROOT);

  if (!needsSetup && !sessions && !changelog && !latest && drift.length === 0 && !secDue && !predDue) return;

  const out = [];
  out.push('<project-context-boot>');
  out.push(`# 📚 Boot context — ${await projectName(ROOT)}`);
  out.push('');
  out.push(`Session id: \`${sessionId.slice(0, 16)}\` · Branch: \`${getBranch(ROOT)}\` · VibeDevKit level: \`L${level}\``);
  out.push('');

  if (needsSetup) {
    const empty = isGreenfield(ROOT);
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

  if (secDue) {
    out.push('## 🛡️ Security mode — time for a deep sweep');
    out.push('');
    out.push(`**${secDue} sessions** in. Run **\`/deep-analysis\`** — full code + security + deps + bug`);
    out.push('sweep → report → ADRs → backlog. (Active by default; disable via `securityMode.active`.)');
    out.push('');
  }

  if (predDue) {
    out.push('## 🔮 Predictions — close the loop');
    out.push('');
    out.push(`**${predDue} sessions** in with **unreviewed** \`/simulate-impact\` predictions. Run`);
    out.push('**`/predictions-review`** to fill their *Actual* section (predicted vs actual). It also');
    out.push('auto-runs at `/log-session`; disable the reminder via `predictionsReview.active`.');
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
