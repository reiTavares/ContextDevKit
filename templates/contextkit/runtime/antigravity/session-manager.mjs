#!/usr/bin/env node
/**
 * Antigravity Session Manager — replaces Claude Code's hook lifecycle.
 *
 * Claude Code uses automatic hooks (SessionStart, PostToolUse, PreToolUse, Stop)
 * wired via .claude/settings.json. On agy the same lifecycle is wired natively
 * through `.agents/hooks.json` [ADR-0049]: SessionStart runs `start`, Stop runs
 * `end`. The explicit CLI commands remain for hook-less agy versions and for
 * on-demand checks.
 *
 * Usage:
 *   node contextkit/runtime/antigravity/session-manager.mjs start
 *   node contextkit/runtime/antigravity/session-manager.mjs status
 *   node contextkit/runtime/antigravity/session-manager.mjs end
 *
 * All output goes to stdout as Markdown so the Antigravity agent can consume it.
 * Defensive: any error exits 0 (never breaks a session).
 *
 * Trust model (ticket 090): like the ctx.mjs runner, npm scripts, or git hooks,
 * this script executes project-local code — it spawns boot-context.mjs from the
 * CURRENT project's platform dir (cwd). Only run it inside a project you trust;
 * the action argument is resolved against a fixed allow-map (start|status|end),
 * never against the filesystem.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { LEDGER_DIR, PLATFORM_DIR } from '../config/paths.mjs';
import { listAllLedgers, pendingImportantPaths, wasRegisteredDuringSession } from '../hooks/ledger.mjs';
import { AGY_SESSION_MARKER } from '../hooks/host-adapter.mjs';
import { writeFileAtomic } from '../hooks/safe-io.mjs';

const ROOT = process.cwd();
const action = process.argv[2] ?? 'start';

// ── helpers ──

async function safeRead(path) {
  try { return await readFile(path, 'utf-8'); } catch { return null; }
}

function extractUnreleased(changelog) {
  if (!changelog) return null;
  const match = changelog.match(/## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## \[|$)/);
  return match?.[1]?.trim() || null;
}

async function latestSession() {
  const dir = resolve(ROOT, PLATFORM_DIR, 'memory/sessions');
  try {
    const files = (await readdir(dir))
      .filter(f => /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/.test(f))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const content = await safeRead(join(dir, files[0]));
    const title = content?.match(/^# (.+)/m)?.[1] ?? files[0];
    return { file: files[0], title, count: files.length };
  } catch { return null; }
}

async function gitBranch() {
  try {
    const head = await safeRead(join(ROOT, '.git/HEAD'));
    return head?.trim().replace('ref: refs/heads/', '') ?? 'unknown';
  } catch { return 'unknown'; }
}

async function loadConfig() {
  try {
    return JSON.parse(await readFile(join(ROOT, PLATFORM_DIR, 'config.json'), 'utf-8'));
  } catch { return {}; }
}

async function projectName() {
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));
    return pkg.name ?? 'project';
  } catch { return 'project'; }
}

/**
 * Lists sessions with unregistered drift, using the SAME predicate as the Stop
 * hook (`pendingImportantPaths` in hooks/ledger.mjs) — ticket 092. Both surfaces
 * now agree by construction on which paths count as important; only the nudge
 * threshold differs (the hook stays quiet below 2 paths, the status report
 * lists every pending session).
 */
async function pendingSessions() {
  try {
    const pending = [];
    for (const { sessionId, ledger } of await listAllLedgers()) {
      if (ledger.registered || wasRegisteredDuringSession(ledger)) continue;
      const paths = pendingImportantPaths(ledger);
      if (paths.length > 0) pending.push({ id: sessionId, paths });
    }
    return pending;
  } catch { return []; }
}

// ── actions ──

/**
 * Mints a stable agy session id so per-event hook processes (track-edits,
 * concurrency-guard, …) share ONE ledger instead of fragmenting — agy hook
 * payloads carry no session_id [ADR-0049]. Best-effort: a failed marker only
 * means hooks fall back to the shared `agy_local` id.
 */
async function mintAgySession() {
  try {
    const ledgerDir = resolve(ROOT, LEDGER_DIR);
    await mkdir(ledgerDir, { recursive: true });
    const sid = `agy_${Date.now().toString(36)}`;
    await writeFileAtomic(join(ledgerDir, AGY_SESSION_MARKER), JSON.stringify({ sid, startedAt: Date.now() }));
  } catch {
    /* hooks degrade to the shared fallback id — never fatal */
  }
}

async function actionStart() {
  await mintAgySession();
  const p = new Promise((resolvePromise) => {
    const child = spawn('node', [resolve(ROOT, PLATFORM_DIR, 'runtime/antigravity/boot-context.mjs')], {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    child.on('exit', () => resolvePromise());
  });
  await p;

  const config = await loadConfig();
  const level = config.level ?? '?';

  const out = [];
  out.push('');
  out.push('## 📋 Antigravity Adaptation layer ACTIVE');
  out.push('');
  out.push('Ask for any skill by name. Example: "run the audit skill"');
  out.push('Key skills: `state`, `log-session`, `new-adr`, `dev-start`, `bug-hunt`,');
  out.push('`audit`, `ship`, `pipeline`, `simulate-impact`, `roadmap`');
  out.push('');
  out.push('## ⚠️ Antigravity Process rules');
  out.push('');
  out.push('1. Read SESSIONS index + relevant ADR before non-trivial changes.');
  out.push('2. New architectural decision → use the `new-adr` skill BEFORE implementing.');
  out.push('3. Before editing a sensitive file → `node ctx.mjs guard <path>` (L5 gate; exit 1 = simulate first).');
  out.push('4. End of productive session → use the `log-session` skill.');
  out.push('5. Use the `state` skill for a quick state summary at any time.');
  out.push('');

  console.log(out.join('\n'));
}

async function actionStatus() {
  const out = [];
  const drift = await pendingSessions();
  const session = await latestSession();
  const changelog = await safeRead(join(ROOT, 'docs/CHANGELOG.md'));
  const unreleased = extractUnreleased(changelog);

  out.push('# 📊 Session Status');
  out.push('');
  out.push(`- **Last session**: ${session ? session.title : 'none'}`);
  out.push(`- **Total sessions**: ${session?.count ?? 0}`);
  out.push(`- **Pending drift**: ${drift.length > 0 ? drift.length + ' session(s)' : 'none ✅'}`);
  out.push(`- **Unreleased changes**: ${unreleased ? 'yes' : 'none'}`);
  out.push('');

  if (drift.length > 0) {
    out.push('## Unregistered modifications');
    for (const d of drift) {
      out.push(`- Session \`${d.id.slice(0, 8)}\`: ${d.paths.length} file(s)`);
    }
    out.push('');
  }

  console.log(out.join('\n'));
}

async function actionEnd() {
  const out = [];
  const drift = await pendingSessions();
  const session = await latestSession();

  out.push('# 🏁 Session End Check');
  out.push('');

  if (drift.length > 0) {
    const total = drift.reduce((s, d) => s + d.paths.length, 0);
    out.push(`⚠️  **${total} important file(s)** were modified but not registered.`);
    out.push('');
    out.push('Before ending, do ONE of the following:');
    out.push('  1. Use the `log-session` skill to register this session.');
    out.push('  2. If this was an experiment, confirm it is intentionally discardable.');
    out.push('');
  } else {
    out.push('✅ No unregistered drift detected. Session can end cleanly.');
    out.push('');
  }

  console.log(out.join('\n'));
}

// ── main ──

const actions = { start: actionStart, status: actionStatus, end: actionEnd };
const fn = actions[action];
if (!fn) {
  console.log(`Usage: session-manager.mjs <start|status|end>\n\n  start  — boot context (run at session start)\n  status — check current state\n  end    — check drift before ending`);
  process.exit(0);
}
fn().catch(err => { process.stderr.write(`[session-manager] ${err?.message ?? err}\n`); process.exit(0); });
