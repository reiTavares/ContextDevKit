#!/usr/bin/env node
/**
 * Reserves resources for the current session (Level >= 3) — paths and, since
 * [ADR-0015 §B](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md),
 * DevPipeline task ids. Writes/updates `.claude/.workspace/<sid>.json`, then
 * regenerates `contextkit/memory/WORKSPACE.md`. The current session id is read
 * from the `.last-touched` pointer the hooks maintain.
 *
 * Usage:  node contextkit/tools/scripts/claim.mjs <path> [path2 ...]
 * API:    attachTask(taskId) / detachTask(taskId) — used by pipeline.mjs
 *         start|stop so task ownership flows through the same single source
 *         of truth as path ownership.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSid } from '../../runtime/hooks/ledger.mjs';
import { writeFileAtomic } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const WS_DIR = resolve(ROOT, '.claude/.workspace');
const LAST_TOUCHED = resolve(ROOT, '.claude/.sessions/.last-touched');

// execFileSync (argv array, no shell) — consistent with the other git callers.
function gitOut(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

async function sessionId() {
  try {
    return JSON.parse(await readFile(LAST_TOUCHED, 'utf-8')).sessionId;
  } catch {
    return `local_${process.pid}`;
  }
}

/**
 * Loads (or creates) the current session's workspace record. Backward-compat:
 * records without `tasks[]` get an empty default so old sessions parse fine.
 *
 * @param {string} sid — already sanitized
 * @returns {Promise<{ sessionId, branch, user, startedAt, lastHeartbeat, claims, tasks, file }>}
 */
async function loadRecord(sid) {
  await mkdir(WS_DIR, { recursive: true });
  const file = resolve(WS_DIR, `${sid}.json`);
  const fresh = { sessionId: sid, branch: gitOut(['symbolic-ref', '--short', 'HEAD'], 'detached'), user: gitOut(['config', 'user.name'], 'unknown'), startedAt: Date.now(), lastHeartbeat: Date.now(), claims: [], tasks: [] };
  if (!existsSync(file)) return { ...fresh, file };
  try {
    const existing = JSON.parse(await readFile(file, 'utf-8'));
    return { ...fresh, ...existing, tasks: Array.isArray(existing.tasks) ? existing.tasks : [], file };
  } catch {
    return { ...fresh, file };
  }
}

async function persistRecord(record) {
  record.lastHeartbeat = Date.now();
  const { file, ...body } = record;
  await writeFileAtomic(file, JSON.stringify(body, null, 2));
  try {
    execFileSync('node', ['contextkit/tools/scripts/workspace-sync.mjs'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    /* best effort */
  }
}

/**
 * Attaches a DevPipeline task id to the current session's record (ADR-0015 §B).
 * Called by `pipeline.mjs start <id>`. Idempotent: re-attaching a task id is a
 * no-op (heartbeat refresh only).
 *
 * @param {string} taskId
 */
export async function attachTask(taskId) {
  const sid = sanitizeSid(await sessionId());
  const record = await loadRecord(sid);
  const id = String(taskId).padStart(3, '0');
  const existing = record.tasks.find((t) => t.id === id);
  if (existing) {
    existing.lastHeartbeat = Date.now();
  } else {
    record.tasks.push({ id, startedAt: Date.now(), lastHeartbeat: Date.now() });
  }
  await persistRecord(record);
}

/**
 * Detaches a DevPipeline task id from the current session's record. Called by
 * `pipeline.mjs stop <id>` and by the stale-eviction sweep in workspace-sync.
 * No-op if the task wasn't on this session's list.
 *
 * @param {string} taskId
 */
export async function detachTask(taskId) {
  const sid = sanitizeSid(await sessionId());
  const record = await loadRecord(sid);
  const id = String(taskId).padStart(3, '0');
  const before = record.tasks.length;
  record.tasks = record.tasks.filter((t) => t.id !== id);
  if (record.tasks.length === before) return;
  await persistRecord(record);
}

async function main() {
  const paths = process.argv.slice(2).map((p) => p.replaceAll('\\', '/'));
  if (paths.length === 0) {
    console.error('Usage: claim.mjs <path> [path2 ...]');
    process.exit(1);
  }
  const sid = sanitizeSid(await sessionId());
  const record = await loadRecord(sid);
  const existing = new Set((record.claims || []).map((c) => c.path));
  for (const p of paths) {
    if (!existing.has(p)) record.claims.push({ path: p, claimedAt: Date.now() });
  }
  await persistRecord(record);
  console.log(`✅ Claimed ${paths.length} path(s) for session ${sid.slice(0, 8)}: ${paths.join(', ')}`);
}

// Only run the CLI when invoked directly; library imports stay side-effect-free.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('❌ claim failed:', err);
    process.exit(1);
  });
}
