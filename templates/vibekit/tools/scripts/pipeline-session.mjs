#!/usr/bin/env node
/**
 * DevPipeline ↔ session ownership.
 *
 * Links a pipeline task to the session that is executing it, so the board's
 * "in testing / in progress" lane can show WHO is on a task and whether that
 * session is still live. Read-only on runtime state (`.claude/...`) — it never
 * mutates ledgers or claims; the pure `stampOwnership` only rewrites task text.
 * Zero third-party deps.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEDGER_DIR, WORKSPACE_STATE_DIR } from '../../runtime/config/paths.mjs';

/** A session with no heartbeat for this long is no longer "active". */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/** git output (argv array, NO shell) or a fallback — never throws. */
function gitOut(root, args, fallback) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));
}

/**
 * Current session id (from the hook-maintained `.last-touched` pointer) + the
 * checked-out branch. Either field may be empty when unknown — callers degrade
 * gracefully (the board shows the task as unassigned).
 *
 * @returns {{ sessionId: string, branch: string }}
 */
export function readCurrentSession(root) {
  let sessionId = '';
  try {
    sessionId = readJson(resolve(root, LEDGER_DIR, '.last-touched')).sessionId || '';
  } catch {
    /* no pointer yet */
  }
  return { sessionId, branch: gitOut(root, ['symbolic-ref', '--short', 'HEAD'], '') };
}

/** True when `sessionId` has a fresh heartbeat in the workspace registry. */
export function isSessionActive(root, sessionId) {
  if (!sessionId) return false;
  try {
    const data = readJson(resolve(root, WORKSPACE_STATE_DIR, `${sessionId}.json`));
    return typeof data?.lastHeartbeat === 'number' && Date.now() - data.lastHeartbeat < STALE_AFTER_MS;
  } catch {
    return false;
  }
}

/**
 * Upserts owner / branch / startedTesting into a task's frontmatter — filling
 * only EMPTY fields, so the first session to pull a task keeps ownership even if
 * the task is re-moved through testing. Pure string transform.
 *
 * @param {string} text — full task markdown
 * @param {{ sessionId: string, branch: string }} session
 */
export function stampOwnership(text, session) {
  const upserts = { owner: session?.sessionId || '', branch: session?.branch || '', startedTesting: new Date().toISOString().slice(0, 10) };
  return text.replace(/^---\n([\s\S]*?)\n---/, (full, frontmatter) => {
    let body = frontmatter;
    for (const [key, value] of Object.entries(upserts)) {
      const line = new RegExp(`^${key}:.*$`, 'm');
      if (line.test(body)) body = body.replace(line, (current) => (current.slice(key.length + 1).trim() ? current : `${key}: ${value}`));
      else body += `\n${key}: ${value}`;
    }
    return `---\n${body}\n---`;
  });
}

/** Flags each in-testing task with `active` (its owning session is live). */
export function enrichActive(tasks, root) {
  for (const task of tasks) {
    if (task.stage === 'testing' && task.owner) task.active = isSessionActive(root, task.owner);
  }
  return tasks;
}
