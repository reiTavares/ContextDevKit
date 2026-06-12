#!/usr/bin/env node
/**
 * PreToolUse concurrency guard (Level >= 3) — prevents one session from
 * silently clobbering another's work on the same file.
 *
 * Claude Code's own `Edit` already refuses to edit a file changed since the
 * agent last read it. This guard covers the remaining same-machine gaps:
 *   - `Write` (full overwrite) — does NOT check freshness, so it can clobber.
 *   - cross-session awareness — another live session (or an external tool)
 *     modified this exact file recently.
 *
 * Seniority rule (ADR-0004): if the conflicting session is ALSO active
 * (heartbeat < 1 h) AND started before this session (senior), the guard
 * DENYs the edit (exit 1) instead of merely warning. Set env var
 * CONTEXT_ALLOW_CLAIMED_EDIT=1 to demote a denial to advisory (audited).
 *
 * Cross-machine conflicts are caught at push time by the pre-push hook.
 * Defensive: any error falls through to advisory and exits 0 (fail-open).
 */
import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getLevel } from '../config/load.mjs';
import { listAllLedgers, readLedger, ROOT, toRepoRelative } from './ledger.mjs';
import { emitAdvisory, hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';
import { WORKSPACE_STATE_DIR } from '../config/paths.mjs';

const HOST = hookHost();

const RECENT_MS = 12 * 60 * 60 * 1000; // ignore stale ledgers older than 12 h
const ACTIVE_MS  =       60 * 60 * 1000; // seniority: active within 1 h

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/** Most recent modification entry for `path` in a ledger (or null). */
function lastMod(ledger, path) {
  let best = null;
  for (const m of ledger.modifications || []) {
    if (m.path === path && (!best || m.at > best.at)) best = m;
  }
  return best;
}

/** Read { startedAt, lastHeartbeat } from a workspace JSON, or null on error. */
async function readWorkspaceTimes(sessionId) {
  try {
    const wsPath = resolve(ROOT, WORKSPACE_STATE_DIR, `${sessionId}.json`);
    const ws = JSON.parse(await readFile(wsPath, 'utf-8'));
    return { startedAt: ws.startedAt ?? null, lastHeartbeat: ws.lastHeartbeat ?? null };
  } catch {
    return null;
  }
}

async function main() {
  if (getLevel(ROOT) < 3) return;
  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const normalized = normalizeToolPayload(payload);
  const filePath = normalized.filePaths[0];
  if (!filePath) return;
  const target = toRepoRelative(filePath);
  if (!target) return;

  const myId = resolveHookSessionId(payload, HOST);
  const tool = normalized.toolName;
  const warnings = [];
  const denials = [];

  // Read this session's startedAt for seniority comparison (fail-open: null → no deny).
  const myTimes = await readWorkspaceTimes(myId);
  const myStartedAt = myTimes?.startedAt ?? null;

  const now = Date.now();

  // 1. Another active session touched this exact file recently.
  for (const { sessionId, ledger } of await listAllLedgers()) {
    if (sessionId === myId) continue;
    if (ledger.registered) continue;
    const m = lastMod(ledger, target);
    if (!m || now - m.at >= RECENT_MS) continue;

    const ago = Math.round((now - m.at) / 60000);
    let denied = false;

    // Seniority rule: escalate to deny when the other session is active + senior.
    if (myStartedAt !== null) {
      try {
        const otherTimes = await readWorkspaceTimes(sessionId);
        if (
          otherTimes?.lastHeartbeat !== null &&
          now - otherTimes.lastHeartbeat < ACTIVE_MS &&
          otherTimes?.startedAt !== null &&
          otherTimes.startedAt < myStartedAt
        ) {
          const activeAgo = Math.round((now - otherTimes.lastHeartbeat) / 60000);
          denials.push(
            `session \`${sessionId.slice(0, 8)}\` has seniority ` +
            `(started ${Math.round((now - otherTimes.startedAt) / 60000)}m ago, ` +
            `active ${activeAgo}m ago) and modified \`${target}\` ${ago}m ago`,
          );
          denied = true;
        }
      } catch { /* workspace unreadable — fall through to advisory */ }
    }

    if (!denied) {
      warnings.push(`another active session \`${sessionId.slice(0, 8)}\` modified it ${ago}m ago`);
    }
  }

  // 2. The file changed on disk since THIS session last wrote it (external edit).
  const mine = lastMod(await readLedger(myId), target);
  if (mine && typeof mine.mtime === 'number') {
    try {
      const current = (await stat(resolve(ROOT, filePath))).mtimeMs;
      if (current > mine.mtime + 1) warnings.push('it changed on disk since you last wrote it');
    } catch {
      /* gone — ignore */
    }
  }

  // 3. Bypass: CONTEXT_ALLOW_CLAIMED_EDIT=1 demotes all denials to advisories.
  if (process.env.CONTEXT_ALLOW_CLAIMED_EDIT === '1' && denials.length > 0) {
    process.stderr.write(`[concurrency-guard] CONTEXT_ALLOW_CLAIMED_EDIT=1 — demoting ${denials.length} denial(s) to advisory\n`);
    warnings.push(...denials.splice(0));
  }

  // 4. Deny path — exits 1 so Claude Code surfaces the block to the user.
  if (denials.length > 0) {
    const out = [
      '<concurrency-deny>',
      `🚫  Concurrency DENY on \`${target}\`:`,
      ...denials.map((d) => `   • ${d}`),
      '',
      '   A senior active session has not yet registered its work. Do NOT proceed',
      '   until: (a) that session ends and runs /log-session, (b) you set',
      '   CONTEXT_ALLOW_CLAIMED_EDIT=1 to override (audited to stderr), or',
      '   (c) you confirm the file is unrelated to that session\'s task.',
      '</concurrency-deny>',
    ].join('\n');
    emitAdvisory(out, HOST);
    process.exit(1);
  }

  if (warnings.length === 0) return;

  const out = [
    '<concurrency-warning>',
    `⚠️  Concurrency on \`${target}\`: ${warnings.join('; ')}.`,
    tool === 'Write' || tool === 'write_to_file'
      ? '   You are about to OVERWRITE the whole file. Re-read it first, then preserve the other'
      : '   Re-read it first, then make sure you only change your part —',
    '   changes and add yours — do NOT clobber another session\'s work.',
    '</concurrency-warning>',
  ].join('\n');
  emitAdvisory(out, HOST);
}

main().catch((err) => {
  process.stderr.write(`[concurrency-guard] ${err?.message ?? err}\n`);
  process.exit(0);
});
