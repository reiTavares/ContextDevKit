#!/usr/bin/env node
/**
 * Aggregates active session claims into `vibekit/memory/WORKSPACE.md`.
 *
 * Each active session writes its own JSON under `.claude/.workspace/<sid>.json`
 * (gitignored local state). This scans them, drops stale entries (no heartbeat
 * for > 1h), and rebuilds the committed markdown summary.
 *
 * Since [ADR-0015 §B](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md),
 * the summary also surfaces **task ownership across sessions** — which session
 * owns which DevPipeline task right now, and any cross-session collision. A
 * task whose owning session has been silent past `pipeline.workingStaleAfterMinutes`
 * (default 90) is auto-evicted: the task file moves from `working/` back to
 * `backlog/` and the owner detaches.
 *
 * Usage:  node vibekit/tools/scripts/workspace-sync.mjs
 */
import { existsSync, renameSync, readFileSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomic, writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const WORKSPACE_DIR = resolve(ROOT, '.claude/.workspace');
const OUTPUT_PATH = pathsFor(ROOT).workspaceIndex;
const PIPE_DIR = pathsFor(ROOT).pipeline;
const STALE_AFTER_MS = 60 * 60 * 1000;
const DEFAULT_TASK_STALE_MIN = 90;

async function loadClaims() {
  let files = [];
  try {
    files = await readdir(WORKSPACE_DIR);
  } catch {
    return [];
  }
  const claims = [];
  for (const filename of files) {
    if (!filename.endsWith('.json')) continue;
    try {
      claims.push(JSON.parse(await readFile(resolve(WORKSPACE_DIR, filename), 'utf-8')));
    } catch {
      /* skip malformed */
    }
  }
  return claims;
}

function isStale(claim) {
  if (typeof claim?.lastHeartbeat !== 'number') return true;
  return Date.now() - claim.lastHeartbeat > STALE_AFTER_MS;
}

function relativeTime(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Walks every workspace record's `tasks[]` and evicts any whose heartbeat
 * exceeds `workingStaleAfterMinutes`. Eviction moves the task file from
 * `working/` back to `backlog/`, stamps an audit line in its body, and rewrites
 * the workspace record without that task entry.
 *
 * Returns the set of evicted `{ sid, taskId }` so the caller (rendering) can
 * surface the action. Best-effort I/O — failures don't throw, the workspace
 * file is the source of truth either way.
 *
 * @param {Array<object>} claims — workspace records, in-place mutation allowed
 * @param {number} maxMinutes
 * @returns {Array<{ sid: string, taskId: string }>}
 */
function evictStaleTasks(claims, maxMinutes) {
  const limit = maxMinutes * 60 * 1000;
  const evicted = [];
  for (const record of claims) {
    if (!Array.isArray(record.tasks) || record.tasks.length === 0) continue;
    const survivors = [];
    for (const task of record.tasks) {
      const ageMs = Date.now() - (task.lastHeartbeat || record.lastHeartbeat || 0);
      if (ageMs <= limit) {
        survivors.push(task);
        continue;
      }
      const moved = moveTaskFile(task.id, 'working', 'backlog', { sid: record.sessionId, ageMs });
      if (moved) evicted.push({ sid: record.sessionId, taskId: task.id });
    }
    if (survivors.length !== record.tasks.length) {
      record.tasks = survivors;
      try {
        const sid = (record.sessionId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        const { ...body } = record;
        writeFileAtomicSync(resolve(WORKSPACE_DIR, `${sid}.json`), JSON.stringify(body, null, 2));
      } catch { /* best-effort */ }
    }
  }
  return evicted;
}

function moveTaskFile(taskId, fromStage, toStage, { sid, ageMs }) {
  try {
    const fromDir = resolve(PIPE_DIR, fromStage);
    if (!existsSync(fromDir)) return false;
    const fileName = readdirSync(fromDir).find((f) => f.startsWith(String(taskId).padStart(3, '0') + '-') && f.endsWith('.md'));
    if (!fileName) return false;
    const fromPath = resolve(fromDir, fileName);
    const toPath = resolve(PIPE_DIR, toStage, fileName);
    let text = readFileSync(fromPath, 'utf-8').replace(/^(status:).*$/m, `status: ${toStage}`);
    const note = `\n> auto-evicted from working/ at ${new Date().toISOString()} — session ${(sid || 'unknown').slice(0, 8)} idle for ${Math.floor(ageMs / 60000)}m\n`;
    if (!text.endsWith('\n')) text += '\n';
    text += note;
    writeFileAtomicSync(fromPath, text);
    renameSync(fromPath, toPath);
    return true;
  } catch {
    return false;
  }
}

function renderTasksTable(active) {
  const rows = [];
  const seen = new Map();
  for (const record of active) {
    if (!Array.isArray(record.tasks)) continue;
    for (const task of record.tasks) {
      const collision = seen.has(task.id);
      seen.set(task.id, (seen.get(task.id) || 0) + 1);
      rows.push({ id: task.id, sid: (record.sessionId ?? '?').slice(0, 8), user: record.user ?? '_unknown_', branch: record.branch ?? '_detached_', started: relativeTime(task.startedAt || Date.now()), heartbeat: relativeTime(task.lastHeartbeat || Date.now()), collision });
    }
  }
  if (rows.length === 0) return [];
  const out = [`## 🔵 Working tasks (${rows.length})`, '', '| Task | Session | User | Branch | Started | Heartbeat |', '| --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    const id = r.collision || (seen.get(r.id) || 0) > 1 ? `⚠️ ${r.id}` : r.id;
    out.push(`| ${id} | \`${r.sid}\` | ${r.user} | \`${r.branch}\` | ${r.started} | ${r.heartbeat} |`);
  }
  out.push('');
  return out;
}

function buildMarkdown(active, stale, evicted) {
  const out = [];
  out.push('# Workspace — Active Sessions');
  out.push('');
  out.push('> ⚠️  **AUTO-GENERATED FILE — DO NOT EDIT BY HAND**.');
  out.push('> Regenerated by `workspace-sync` (runs on pre-commit) from');
  out.push('> `.claude/.workspace/<sid>.json` files maintained by hooks and slash commands.');
  out.push('');
  const tasksSection = renderTasksTable(active);
  if (active.length === 0 && stale.length === 0 && tasksSection.length === 0) {
    out.push('_(No active sessions. The workspace is idle.)_');
    out.push('');
    return out.join('\n');
  }
  out.push(...tasksSection);
  if (active.length > 0) {
    out.push(`## 🟢 Active sessions (${active.length})`);
    out.push('');
    out.push('| Session | User | Branch | Started | Last activity | Claims |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const c of active) {
      const sid = (c.sessionId ?? '?').slice(0, 8);
      const claims = Array.isArray(c.claims) && c.claims.length > 0 ? c.claims.map((cl) => `\`${cl.path}\``).join(', ') : '_(none)_';
      out.push(`| \`${sid}\` | ${c.user ?? '_unknown_'} | \`${c.branch ?? '_detached_'}\` | ${c.startedAt ? relativeTime(c.startedAt) : '?'} | ${c.lastHeartbeat ? relativeTime(c.lastHeartbeat) : '?'} | ${claims} |`);
    }
    out.push('');
  }
  if (stale.length > 0) {
    out.push(`## 🟡 Stale (${stale.length}) — no heartbeat for > 1h`);
    out.push('');
    out.push('| Session | User | Branch | Last activity |');
    out.push('| --- | --- | --- | --- |');
    for (const c of stale) {
      out.push(`| \`${(c.sessionId ?? '?').slice(0, 8)}\` | ${c.user ?? '_unknown_'} | \`${c.branch ?? '_detached_'}\` | ${c.lastHeartbeat ? relativeTime(c.lastHeartbeat) : '?'} |`);
    }
    out.push('');
  }
  if (evicted.length > 0) {
    out.push(`## ♻️ Recently auto-evicted (this run): ${evicted.length}`);
    out.push('');
    for (const ev of evicted) out.push(`- task **${ev.taskId}** (was owned by session \`${ev.sid?.slice(0, 8) ?? '?'}\`) → moved back to \`backlog/\``);
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push('Slash commands: `/claim <path>` to reserve a path · `/pipeline start <id>` to attach a task · `/release` / `/pipeline stop <id>` to free · `/worktree-new <feature>` for parallel work.');
  return out.join('\n');
}

async function main() {
  const claims = await loadClaims();
  const cfg = loadConfigSync(ROOT).pipeline || {};
  const evicted = evictStaleTasks(claims, cfg.workingStaleAfterMinutes || DEFAULT_TASK_STALE_MIN);
  const active = claims.filter((c) => !isStale(c));
  const stale = claims.filter(isStale);
  await writeFileAtomic(OUTPUT_PATH, buildMarkdown(active, stale, evicted));
  console.log(`✅ WORKSPACE.md regenerated — ${active.length} active, ${stale.length} stale, ${evicted.length} task(s) auto-evicted.`);
}

main().catch((err) => {
  console.error('❌ Failed to sync workspace:', err);
  process.exit(1);
});
