#!/usr/bin/env node
/**
 * Stop hook (Level >= 2) — nudges Claude to register the session on drift.
 *
 * Session-aware via the per-session ledger keyed by `session_id`. Anti-loop
 * guard via the `stop_hook_active` flag plus a `stopWarnedAt` timestamp.
 *
 * Decision rules:
 *   - `stop_hook_active === true` → silent (anti-loop).
 *   - Important paths touched < 2 → silent.
 *   - Session already registered → silent.
 *   - Already nudged once → silent.
 *   - Otherwise: emit `decision: "block"` with the path list + instructions.
 *
 * Side jobs (informational, NEVER block): Level 5 archives old registered
 * ledgers and proposes a distillation cycle when the session count crosses
 * the configured threshold.
 *
 * Zero third-party deps.
 */
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ledgerPathFor,
  listAllLedgers,
  pendingImportantPaths,
  readLedger,
  resolveSessionId,
  SESSIONS_DIR,
  wasRegisteredDuringSession,
  writeLedger,
} from './ledger.mjs';
import { getLevel, loadConfig } from '../config/load.mjs';
import { SESSIONS_DIR as SESSIONS_MD_DIR, SESSIONS_INDEX } from '../config/paths.mjs';

const ROOT = process.cwd();
const ARCHIVE_DIR = resolve(SESSIONS_DIR, '.archive');
const DISTILL_NUDGE_PATH = resolve(SESSIONS_DIR, '.distill-nudge');
const DISTILL_NUDGE_DEBOUNCE_MS = 24 * 60 * 60 * 1000;
const ADVISOR_NUDGE_PATH = resolve(SESSIONS_DIR, '.advisor-nudge');
const ADVISOR_NUDGE_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

function buildReason(paths, sessionId) {
  const list = paths.slice(0, 12).map((p) => `  - ${p}`).join('\n');
  const overflow = paths.length > 12 ? `\n  (… and ${paths.length - 12} more)` : '';
  return [
    `⚠️  Session drift detected (session id: ${sessionId.slice(0, 8)}…).`,
    `${paths.length} important file(s) were modified, but ${SESSIONS_INDEX} was not updated.`,
    '',
    'Modified paths:',
    list + overflow,
    '',
    'Before finalizing, do ONE of the following and then stop again:',
    '  1. Run /log-session to register this session and update the CHANGELOG.',
    '  2. If this session is intentionally discardable (experiment that will be',
    '     reverted), tell the user and confirm before stopping.',
    '',
    'You will not be nudged again for this session — this notice fires once.',
  ].join('\n');
}

/** L5 — archives ledgers that are registered AND older than the cutoff. */
async function archiveOldRegisteredLedgers() {
  let config;
  try {
    config = await loadConfig(ROOT);
  } catch {
    return;
  }
  const ageDays = Number(config?.l5?.distill?.archiveLedgersOlderThanDays);
  if (!Number.isFinite(ageDays) || ageDays <= 0) return;
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = await listAllLedgers();
  } catch {
    return;
  }
  for (const { sessionId, ledger } of entries) {
    if (!(ledger.registered || wasRegisteredDuringSession(ledger))) continue;
    const path = ledgerPathFor(sessionId);
    try {
      const st = await stat(path);
      if (st.mtimeMs > cutoff) continue;
      await mkdir(ARCHIVE_DIR, { recursive: true });
      await rename(path, resolve(ARCHIVE_DIR, `${sessionId}.json`));
    } catch {
      /* best effort */
    }
  }
}

/** L5 — proposes `/distill-sessions` once the session count crosses threshold. */
async function maybeProposeDistillation() {
  let config;
  try {
    config = await loadConfig(ROOT);
  } catch {
    return null;
  }
  const threshold = Number(config?.l5?.distill?.proposeAfterSessions);
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  let count = 0;
  try {
    const entries = await readdir(resolve(ROOT, SESSIONS_MD_DIR));
    count = entries.filter((f) => /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/.test(f)).length;
  } catch {
    return null;
  }
  if (count < threshold) return null;
  let lastNudgeAt = 0;
  try {
    lastNudgeAt = Number.parseInt((await readFile(DISTILL_NUDGE_PATH, 'utf-8')).trim(), 10) || 0;
  } catch {
    /* no prior nudge */
  }
  if (Date.now() - lastNudgeAt < DISTILL_NUDGE_DEBOUNCE_MS) return null;
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(DISTILL_NUDGE_PATH, String(Date.now()), 'utf-8');
  } catch {
    return null;
  }
  return [
    `💡 Distillation cycle ready (L5): ${count} sessions registered (threshold ${threshold}).`,
    '   Consider `/distill-sessions` to propose CLAUDE.md refinements, then `/distill-apply`.',
    "   Skipping is fine — you'll be reminded again in 24h.",
  ].join('\n');
}

/**
 * ADR-0028 — proactively suggests `/advise` after a PRODUCTIVE session.
 * Mirrors `maybeProposeDistillation`: config-gated (`advisor.active` &&
 * `advisor.nudgeOnStop`), fires only when ≥ 2 important paths were touched this
 * session (real implementation), and debounced 24h. Nudge-only — never blocks,
 * never runs the network or the AI (that lives in the `/advise` command).
 *
 * @param {object} ledger - this session's ledger (for the "real work" signal).
 * @returns {Promise<string|null>} the nudge text, or null when it should stay silent.
 */
async function maybeProposeAdvisor(ledger) {
  let config;
  try {
    config = await loadConfig(ROOT);
  } catch {
    return null;
  }
  const advisor = config?.advisor;
  if (advisor?.active !== true || advisor?.nudgeOnStop !== true) return null;
  const touched = pendingImportantPaths(ledger).length;
  if (touched < 2) return null;
  let lastNudgeAt = 0;
  try {
    lastNudgeAt = Number.parseInt((await readFile(ADVISOR_NUDGE_PATH, 'utf-8')).trim(), 10) || 0;
  } catch {
    /* no prior nudge */
  }
  if (Date.now() - lastNudgeAt < ADVISOR_NUDGE_DEBOUNCE_MS) return null;
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(ADVISOR_NUDGE_PATH, String(Date.now()), 'utf-8');
  } catch {
    return null;
  }
  return [
    `💡 Proactive Advisor (L6): ${touched} important file(s) touched this session.`,
    '   Run `/advise` for a six-lane improvement scan (architecture · features · deepen ·',
    '   security · UX · growth) before you wrap up. Skipping is fine — reminded again in 24h.',
  ].join('\n');
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (payload.stop_hook_active === true) return;

  const sessionId = resolveSessionId(payload);
  const ledger = await readLedger(sessionId);
  const level = getLevel(ROOT);

  const sideSuggestions = [];
  if (level >= 5) {
    await archiveOldRegisteredLedgers();
    const distill = await maybeProposeDistillation();
    if (distill) sideSuggestions.push(distill);
    const advise = await maybeProposeAdvisor(ledger);
    if (advise) sideSuggestions.push(advise);
  }
  const flushSide = () => {
    if (sideSuggestions.length > 0) process.stdout.write(sideSuggestions.join('\n\n') + '\n');
  };

  if (ledger.registered || wasRegisteredDuringSession(ledger)) return flushSide();

  const paths = pendingImportantPaths(ledger);
  if (paths.length < 2) return flushSide();
  if (typeof ledger.stopWarnedAt === 'number') return flushSide();

  // Mark BEFORE emitting to avoid races.
  ledger.stopWarnedAt = Date.now();
  await writeLedger(sessionId, ledger);

  const reason =
    sideSuggestions.length > 0
      ? `${buildReason(paths, sessionId)}\n\n${sideSuggestions.join('\n\n')}`
      : buildReason(paths, sessionId);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

main().catch((err) => {
  process.stderr.write(`[check-registration] ${err?.message ?? err}\n`);
  process.exit(0);
});
