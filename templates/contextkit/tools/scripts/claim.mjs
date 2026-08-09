#!/usr/bin/env node
/**
 * Reserves resources for the current session (Level >= 3) — paths and, since
 * [ADR-0015 §B](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md),
 * DevPipeline task ids. Writes/updates `.claude/.workspace/<sid>.json`, then
 * regenerates `contextkit/memory/WORKSPACE.md`. Host environment identifiers
 * are used directly; governance does not create or depend on session markers.
 *
 * Usage:  node contextkit/tools/scripts/claim.mjs <path> [path2 ...]
 * API:    attachTask(taskId, tasksTarget) / detachTask(taskId) — used by pipeline.mjs
 *         start|stop so task ownership flows through the same single source
 *         of truth as path ownership.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const WS_DIR = resolve(ROOT, '.claude/.workspace');
const SESSION_ENV_KEYS = Object.freeze([
  'CONTEXTKIT_SESSION_ID',
  'CODEX_THREAD_ID',
  'CLAUDE_SESSION_ID',
  'ANTIGRAVITY_SESSION_ID',
  'AGY_SESSION_ID',
  'GROK_SESSION_ID',
]);

// execFileSync (argv array, no shell) — consistent with the other git callers.
function gitOut(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

export function sanitizeSid(value) {
  return String(value ?? 'local')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64) || 'local';
}

/**
 * Resolves a host-provided session identity without reading or writing marker
 * files. The process-local fallback deliberately avoids pretending that a
 * durable cross-process identity exists.
 *
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [environment]
 * @returns {string}
 */
export function sessionId(environment = process.env) {
  for (const key of SESSION_ENV_KEYS) {
    if (typeof environment[key] === 'string' && environment[key].trim() !== '') {
      return environment[key];
    }
  }
  return `local_${process.pid}`;
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
 * @param {string} tasksTarget canonical workflow/batch root or tasks.json path
 */
export async function attachTask(taskId, tasksTarget) {
  if (typeof tasksTarget !== 'string' || tasksTarget.trim() === '') {
    throw new TypeError('attachTask: tasksTarget must identify the canonical tasks.json scope');
  }
  const sid = sanitizeSid(sessionId());
  const record = await loadRecord(sid);
  const id = String(taskId);
  const canonicalTarget = resolve(ROOT, tasksTarget);
  const existing = record.tasks.find((task) => task.id === id && task.tasksTarget === canonicalTarget);
  if (existing) {
    existing.lastHeartbeat = Date.now();
  } else {
    record.tasks.push({ id, tasksTarget: canonicalTarget, startedAt: Date.now(), lastHeartbeat: Date.now() });
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
  const sid = sanitizeSid(sessionId());
  const record = await loadRecord(sid);
  const id = String(taskId);
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
  const sid = sanitizeSid(sessionId());
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
