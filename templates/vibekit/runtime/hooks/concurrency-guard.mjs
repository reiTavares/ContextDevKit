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
 * It WARNS (never blocks → no retry loops): prints a banner that becomes
 * context, telling the agent to re-read and merge rather than overwrite.
 * Cross-machine conflicts are caught at push time by the pre-push hook.
 *
 * Defensive: any error exits 0 silently.
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getLevel } from '../config/load.mjs';
import { listAllLedgers, readLedger, resolveSessionId, ROOT, toRepoRelative } from './ledger.mjs';

const RECENT_MS = 12 * 60 * 60 * 1000; // ignore stale ledgers older than 12h

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

function extractFilePath(payload) {
  const t = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  if ((t === 'Edit' || t === 'Write' || t === 'MultiEdit') && typeof input.file_path === 'string') return input.file_path;
  return null;
}

/** Most recent modification entry for `path` in a ledger (or null). */
function lastMod(ledger, path) {
  let best = null;
  for (const m of ledger.modifications || []) {
    if (m.path === path && (!best || m.at > best.at)) best = m;
  }
  return best;
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

  const filePath = extractFilePath(payload);
  if (!filePath) return;
  const target = toRepoRelative(filePath);
  if (!target) return;

  const myId = resolveSessionId(payload);
  const tool = payload.tool_name;
  const warnings = [];

  // 1. Another active session touched this exact file recently.
  const now = Date.now();
  for (const { sessionId, ledger } of await listAllLedgers()) {
    if (sessionId === myId) continue;
    if (ledger.registered) continue; // their work is already saved/registered
    const m = lastMod(ledger, target);
    if (m && now - m.at < RECENT_MS) {
      warnings.push(`another active session \`${sessionId.slice(0, 8)}\` modified it ${Math.round((now - m.at) / 60000)}m ago`);
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

  if (warnings.length === 0) return;

  const out = [
    '<concurrency-warning>',
    `⚠️  Concurrency on \`${target}\`: ${warnings.join('; ')}.`,
    tool === 'Write'
      ? '   You are about to OVERWRITE the whole file. Re-read it first, then preserve the other'
      : '   Re-read it first, then make sure you only change your part —',
    '   changes and add yours — do NOT clobber another session\'s work.',
    '</concurrency-warning>',
  ].join('\n');
  process.stdout.write(out);
}

main().catch((err) => {
  process.stderr.write(`[concurrency-guard] ${err?.message ?? err}\n`);
  process.exit(0);
});
