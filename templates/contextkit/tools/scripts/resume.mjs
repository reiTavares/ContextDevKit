#!/usr/bin/env node
/**
 * `/resume` — re-bind the current Claude Code session to a previously
 * **unregistered** ledger (ticket 046, Compozy follow-through). When a
 * session ended without `/log-session`, its ledger sits in
 * `.claude/.sessions/<sid>.json` with `registered: false` and the boot
 * context flags it as drift. `/resume <sid>` makes that ledger the
 * active one — subsequent edits continue appending there, `/log-session`
 * registers it properly, claims (if any) are re-asserted under the same id.
 *
 * Usage:
 *   resume.mjs                    list unregistered candidates
 *   resume.mjs <session-id>       re-bind to that session
 *   resume.mjs --json             machine-readable listing
 *
 * Refusal modes (rule 8 — refuse, don't assume):
 *   - target id not present in `.claude/.sessions/` → exit 1
 *   - target id is already registered (no drift to recover) → exit 1
 *   - target's path claims overlap an active session's claims → exit 1
 *
 * Read-only on the session ledgers themselves; only rewrites the
 * `.last-touched` pointer atomically.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAST_TOUCHED_PATH, listAllLedgers, sanitizeSid } from '../../runtime/hooks/ledger.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const WORKSPACE_DIR = resolve(ROOT, '.claude/.workspace');
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Returns the set of paths currently claimed by any *active* (non-stale)
 * session OTHER than `excludeSid`. Used to detect resume-time conflicts.
 *
 * @param {string} excludeSid — the session id we're resuming to (its own
 *   claims shouldn't count as a conflict with itself)
 * @returns {Set<string>}
 */
function activePathClaims(excludeSid) {
  const out = new Set();
  if (!existsSync(WORKSPACE_DIR)) return out;
  for (const name of readdirSync(WORKSPACE_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(readFileSync(resolve(WORKSPACE_DIR, name), 'utf-8'));
      if (rec.sessionId === excludeSid) continue;
      if (typeof rec.lastHeartbeat !== 'number' || Date.now() - rec.lastHeartbeat > STALE_AFTER_MS) continue;
      for (const c of rec.claims || []) out.add(c.path);
    } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * Reads `claims[]` for the given session id, if any. Workspace records are
 * optional — a session can be in drift without ever calling `/claim`.
 */
function claimsFor(sid) {
  const file = resolve(WORKSPACE_DIR, `${sid}.json`);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')).claims || []; } catch { return []; }
}

async function listUnregistered() {
  const all = await listAllLedgers();
  return all.filter(({ ledger }) => !ledger.registered && Array.isArray(ledger.modifications) && ledger.modifications.length > 0);
}

function fmtAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function listCmd(asJson) {
  const candidates = await listUnregistered();
  if (asJson) { console.log(JSON.stringify(candidates.map(({ sessionId, ledger }) => ({ sessionId, modifications: ledger.modifications.length, startedAt: ledger.startedAt, claims: claimsFor(sessionId).length })), null, 2)); return; }
  if (candidates.length === 0) { console.log('  No unregistered sessions found. The workspace is clean.'); return; }
  console.log(`\n  ${candidates.length} unregistered session(s) — candidates for /resume:\n`);
  for (const { sessionId, ledger } of candidates) {
    const claims = claimsFor(sessionId).length;
    const claimNote = claims > 0 ? ` · ${claims} claim(s)` : '';
    console.log(`  ${sessionId.slice(0, 12).padEnd(12)} · ${ledger.modifications.length} edit(s) · started ${fmtAgo(ledger.startedAt)}${claimNote}`);
  }
  console.log('\n  Resume with: node contextkit/tools/scripts/resume.mjs <session-id>\n');
}

async function resumeCmd(targetSid) {
  const sid = sanitizeSid(targetSid);
  const candidates = await listUnregistered();
  const match = candidates.find((c) => c.sessionId === sid || c.sessionId.startsWith(sid));
  if (!match) { console.error(`✗ session "${targetSid}" not found among unregistered drift candidates.`); process.exit(1); }
  if (match.ledger.registered) { console.error(`✗ session ${match.sessionId} is already registered — nothing to resume.`); process.exit(1); }
  const myClaims = new Set(claimsFor(match.sessionId).map((c) => c.path));
  const otherActiveClaims = activePathClaims(match.sessionId);
  const conflicts = [...myClaims].filter((p) => otherActiveClaims.has(p));
  if (conflicts.length > 0) { console.error(`✗ cannot resume: path(s) claimed by another active session: ${conflicts.join(', ')}`); process.exit(1); }
  writeFileAtomicSync(LAST_TOUCHED_PATH, JSON.stringify({ sessionId: match.sessionId, at: Date.now() }));
  console.log(`▶  Resumed session ${match.sessionId.slice(0, 12)} (${match.ledger.modifications.length} prior edit(s), ${myClaims.size} claim(s)).`);
  console.log(`   Run /log-session to register this session properly when you're done.`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--json') { await listCmd(arg === '--json'); return; }
  if (arg === '--help' || arg === '-h') { console.log('Usage: resume.mjs [<session-id> | --json]'); return; }
  await resumeCmd(arg);
}

main().catch((err) => { console.error(`✗ resume failed: ${err?.message || err}`); process.exit(1); });
