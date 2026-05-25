#!/usr/bin/env node
/**
 * PostToolUse hook (Level >= 2) — appends file modifications to the
 * per-session ledger and warns about cross-session claim collisions (L3).
 *
 * Wired with matcher "Edit|Write|MultiEdit". Receives the tool payload via
 * stdin (JSON). Silent on stdout UNLESS a cross-claim is detected.
 *
 * Side effects:
 *   1. Updates `.claude/.sessions/<sid>.json`.
 *   2. Auto-presence: ensures `.claude/.workspace/<sid>.json` exists with a fresh
 *      heartbeat — editing a file IS an implicit claim, so a live session is
 *      visible (to the board, WORKSPACE.md and the L3 concurrency guard) even if
 *      it never ran `/claim`.
 *   3. Surfaces a cross-claim warning when editing another session's claim.
 *
 * Defensive: any failure exits 0 with a stderr note. Zero third-party deps.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isTrackable, readLedger, resolveSessionId, toRepoRelative, writeLedger } from './ledger.mjs';
import { WORKSPACE_STATE_DIR } from '../config/paths.mjs';

const ROOT = process.cwd();
const WORKSPACE_DIR = resolve(ROOT, WORKSPACE_STATE_DIR);

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/** Extracts file paths from an Edit/Write/MultiEdit payload. */
function extractPaths(payload) {
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  if (tool === 'Edit' || tool === 'Write') return input.file_path ? [input.file_path] : [];
  if (tool === 'MultiEdit') {
    if (input.file_path) return [input.file_path];
    if (Array.isArray(input.edits)) return input.edits.map((e) => e?.file_path).filter(Boolean);
  }
  return [];
}

/**
 * Auto-presence: create the workspace file if missing (so editing == implicit
 * claim) and stamp a fresh heartbeat. `startedAt` is seeded from the ledger so
 * the concurrency guard's seniority check is consistent across both stores.
 * Best effort — never blocks an edit.
 */
async function ensurePresence(sessionId, startedAt) {
  const path = resolve(WORKSPACE_DIR, `${sessionId}.json`);
  try {
    await mkdir(WORKSPACE_DIR, { recursive: true });
    let data;
    try {
      data = JSON.parse(await readFile(path, 'utf-8'));
    } catch {
      data = { sessionId, startedAt, claims: [] };
    }
    if (typeof data.startedAt !== 'number') data.startedAt = startedAt;
    if (!Array.isArray(data.claims)) data.claims = [];
    data.lastHeartbeat = Date.now();
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    /* best effort — presence is advisory */
  }
}

async function loadOtherClaims(mySessionId) {
  const claims = new Map();
  let files = [];
  try {
    files = await readdir(WORKSPACE_DIR);
  } catch {
    return claims;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const otherSid = f.slice(0, -5);
    if (otherSid === mySessionId) continue;
    try {
      const data = JSON.parse(await readFile(resolve(WORKSPACE_DIR, f), 'utf-8'));
      if (Array.isArray(data?.claims)) {
        for (const cl of data.claims) if (typeof cl?.path === 'string') claims.set(cl.path, otherSid);
      }
    } catch {
      /* skip malformed */
    }
  }
  return claims;
}

function pathCollides(editedPath, claimedPath) {
  if (editedPath === claimedPath) return true;
  const claimAsDir = claimedPath.endsWith('/') ? claimedPath : `${claimedPath}/`;
  return editedPath.startsWith(claimAsDir);
}

function buildWarning(collisions) {
  const list = collisions.map((c) => `  - \`${c.path}\` (claimed by session \`${c.owner.slice(0, 8)}\`)`).join('\n');
  return [
    '<cross-claim-warning>',
    '⚠️  You just edited a path claimed by ANOTHER active session:',
    list,
    '',
    'Coordinate before continuing. If the claim is stale, ask the user to /release it.',
    '</cross-claim-warning>',
  ].join('\n');
}

async function main() {
  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const sessionId = resolveSessionId(payload);
  const paths = extractPaths(payload).map(toRepoRelative).filter(isTrackable);
  if (paths.length === 0) return;

  // 1. Append to ledger (recording each file's post-edit mtime so the L3
  //    concurrency guard can later detect an EXTERNAL change to the same file).
  const ledger = await readLedger(sessionId);
  const tool = payload.tool_name ?? 'unknown';
  const now = Date.now();
  for (const p of paths) {
    let mtime = null;
    try {
      mtime = (await stat(resolve(ROOT, p))).mtimeMs;
    } catch {
      /* file may not exist yet */
    }
    ledger.modifications.push({ path: p, tool, at: now, mtime });
  }
  await writeLedger(sessionId, ledger);

  // 2. Auto-presence: make this session visible (fresh heartbeat) even if it
  //    never ran /claim — editing a file IS an implicit claim.
  await ensurePresence(sessionId, ledger.startedAt);

  // 3. Cross-claim detection (L3).
  const otherClaims = await loadOtherClaims(sessionId);
  if (otherClaims.size === 0) return;
  const collisions = [];
  for (const editedPath of paths) {
    for (const [claimedPath, owner] of otherClaims) {
      if (pathCollides(editedPath, claimedPath)) {
        collisions.push({ path: editedPath, owner });
        break;
      }
    }
  }
  if (collisions.length > 0) process.stdout.write(buildWarning(collisions));
}

main().catch((err) => {
  process.stderr.write(`[track-edits] ${err?.message ?? err}\n`);
  process.exit(0);
});
