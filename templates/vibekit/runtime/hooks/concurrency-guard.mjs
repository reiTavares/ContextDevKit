#!/usr/bin/env node
/**
 * PreToolUse concurrency guard (Level >= 3) — stops one session from clobbering
 * another's work on the same file.
 *
 * Two tiers, by confidence:
 *   1. HARD STOP (`decision: "block"`) — another session that is OLDER (earlier
 *      `startedAt`) and still ALIVE (fresh heartbeat) owns this exact file,
 *      because it is actively editing it or has `/claim`ed it. The newer session
 *      is blocked: the senior one must finish → PR → merge before the file is
 *      free. Editing a file is an implicit claim (track-edits auto-presence), so
 *      this works even without a manual `/claim`.
 *   2. SOFT WARN (banner, never blocks) — weaker signals: an older overlap
 *      outside the active window, or the file changed on disk since you wrote it.
 *
 * Seniority makes the rule deterministic: exactly one session (the oldest live
 * owner) keeps the file; everyone newer is told to wait or work elsewhere.
 * Cross-machine / cross-worktree conflicts are caught at push time by pre-push
 * (separate worktrees keep separate ledgers).
 *
 * Bypass (audited): `VIBE_ALLOW_CLAIMED_EDIT=1`. Defensive: any error exits 0
 * WITHOUT blocking — a broken guard must never break real work.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getLevel } from '../config/load.mjs';
import { listAllLedgers, readLedger, resolveSessionId, ROOT, toRepoRelative } from './ledger.mjs';
import { WORKSPACE_STATE_DIR } from '../config/paths.mjs';

const WARN_MS = 12 * 60 * 60 * 1000; // soft-warn window for another session's recent edit
const ACTIVE_MS = 60 * 60 * 1000; // "actively on a file" / "alive" window (matches workspace staleness)

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

/** Reads every workspace presence/claim file into a Map(sid → {startedAt, lastHeartbeat, claims[]}). */
async function loadWorkspaces() {
  const map = new Map();
  let files = [];
  try {
    files = await readdir(resolve(ROOT, WORKSPACE_STATE_DIR));
  } catch {
    return map;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await readFile(resolve(ROOT, WORKSPACE_STATE_DIR, f), 'utf-8'));
      map.set(f.slice(0, -5), {
        startedAt: data?.startedAt,
        lastHeartbeat: data?.lastHeartbeat,
        claims: Array.isArray(data?.claims) ? data.claims.map((c) => c?.path).filter((p) => typeof p === 'string') : [],
      });
    } catch {
      /* skip malformed */
    }
  }
  return map;
}

/** True when one of `claims` (a path, dir entries end in `/`) covers `target`. */
function claimCovers(claims, target) {
  for (const path of claims || []) {
    if (path === target) return true;
    const asDir = path.endsWith('/') ? path : `${path}/`;
    if (target.startsWith(asDir)) return true;
  }
  return false;
}

/**
 * Other sessions that are senior + alive + own `target` — i.e. this edit must be
 * blocked. Edit-ownership holds while alive or unknown; claim-ownership needs a
 * known-fresh heartbeat (a bare claim from a dead session must not lock forever).
 */
function seniorOwners({ target, myId, myStartedAt, now, ledgers, workspaces }) {
  const owners = [];
  const sids = new Set([...ledgers.map((l) => l.sessionId), ...workspaces.keys()]);
  for (const sid of sids) {
    if (sid === myId) continue;
    const ledger = ledgers.find((l) => l.sessionId === sid)?.ledger;
    if (ledger?.registered) continue; // their work is saved → file released
    const ws = workspaces.get(sid);

    const startedAt = typeof ledger?.startedAt === 'number' ? ledger.startedAt : typeof ws?.startedAt === 'number' ? ws.startedAt : Infinity;
    const senior = startedAt < myStartedAt || (startedAt === myStartedAt && String(sid) < String(myId));
    if (!senior) continue;

    const alive = typeof ws?.lastHeartbeat === 'number' ? now - ws.lastHeartbeat < ACTIVE_MS : null;
    if (alive === false) continue; // known-dead session never holds a lock

    const edit = ledger ? lastMod(ledger, target) : null;
    const editsIt = !!edit && now - edit.at < ACTIVE_MS;
    const claimsIt = !!ws && claimCovers(ws.claims, target);
    if (editsIt || (claimsIt && alive === true)) {
      owners.push({ sid, via: editsIt ? 'edit' : 'claim' });
    }
  }
  return owners;
}

function buildBlockReason(target, owners) {
  const who = owners.map((o) => `\`${o.sid.slice(0, 8)}\` (${o.via === 'claim' ? 'claimed' : 'editing it'})`).join(', ');
  return [
    `🔒 Parallel-edit blocked on \`${target}\`.`,
    '',
    `An OLDER, still-active session is working on this file: ${who}.`,
    'To guarantee its work is not overwritten, this edit is blocked — the senior',
    'session owns this file until it lands.',
    '',
    'Do ONE of these instead:',
    '  1. Let that session FINISH → open its PR → get it MERGED. Then this file is',
    '     free: rebase onto the merge and edit safely.',
    '  2. Work on a DIFFERENT file that no other session owns — keep moving elsewhere.',
    '  3. If your change is tightly coupled to this file and cannot wait, pull a',
    '     different DevPipeline task (`/pipeline show`) or another roadmap item now.',
    '',
    'If that session is actually dead/abandoned: ask the user to `/release` its claim,',
    'or bypass once (audited): set VIBE_ALLOW_CLAIMED_EDIT=1 before retrying.',
  ].join('\n');
}

function buildWarning(target, tool, warnings) {
  return [
    '<concurrency-warning>',
    `⚠️  Concurrency on \`${target}\`: ${warnings.join('; ')}.`,
    tool === 'Write'
      ? '   You are about to OVERWRITE the whole file. Re-read it first, then preserve the other'
      : '   Re-read it first, then make sure you only change your part —',
    '   changes and add yours — do NOT clobber another session\'s work.',
    '</concurrency-warning>',
  ].join('\n');
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
  const now = Date.now();
  const myLedger = await readLedger(myId);
  const myStartedAt = typeof myLedger.startedAt === 'number' ? myLedger.startedAt : now;
  const ledgers = await listAllLedgers();
  const workspaces = await loadWorkspaces();

  // ── Tier 1: hard stop on a senior live owner. ──
  const bypass = process.env.VIBE_ALLOW_CLAIMED_EDIT === '1';
  const owners = bypass ? [] : seniorOwners({ target, myId, myStartedAt, now, ledgers, workspaces });
  if (owners.length > 0) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: buildBlockReason(target, owners) }));
    return;
  }
  if (bypass) process.stderr.write('[concurrency-guard] claim lock bypassed (VIBE_ALLOW_CLAIMED_EDIT=1).\n');

  // ── Tier 2: soft warnings on weaker signals. ──
  const warnings = [];
  for (const { sessionId, ledger } of ledgers) {
    if (sessionId === myId || ledger.registered) continue;
    const m = lastMod(ledger, target);
    if (m && now - m.at < WARN_MS) warnings.push(`another session \`${sessionId.slice(0, 8)}\` modified it ${Math.round((now - m.at) / 60000)}m ago`);
  }
  const mine = lastMod(myLedger, target);
  if (mine && typeof mine.mtime === 'number') {
    try {
      const current = (await stat(resolve(ROOT, filePath))).mtimeMs;
      if (current > mine.mtime + 1) warnings.push('it changed on disk since you last wrote it');
    } catch {
      /* gone — ignore */
    }
  }
  if (warnings.length > 0) process.stdout.write(buildWarning(target, tool, warnings));
}

main().catch((err) => {
  process.stderr.write(`[concurrency-guard] ${err?.message ?? err}\n`);
  process.exit(0);
});
