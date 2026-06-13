#!/usr/bin/env node
/**
 * SessionStart hook (Level >= 1) — injects project context at session start.
 *
 * Behavior:
 *   1. `git fetch origin` silently to surface ahead/behind divergence.
 *   2. Detects drift from prior sessions (ledgers with unregistered important
 *      modifications) and emits a banner. Cleans up resolved ledgers.
 *   3. Includes the latest registered session, the CHANGELOG `[Unreleased]`,
 *      and active workspace claims when present.
 *
 * Constraints: concise output, all errors silent (NEVER block a session),
 * zero third-party deps.
 */
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  digestLatestSession,
  digestUnreleased,
  exists,
  extractUnreleased,
  readChangelog,
  readSessionsIndex,
  readWorkspaceSummary,
} from './boot-context-readers.mjs';
import {
  activeBranches,
  checkGitDivergence,
  engineUpdateSignal,
  getBranch,
  isGreenfield,
  openBugsDue,
  predictionsReviewDue,
  projectMapStale,
  projectName,
  securityModeDue,
  valueLine,
} from './boot-signals.mjs';
import {
  freshLedger,
  ledgerPathFor,
  listAllLedgers,
  pendingImportantPaths,
  wasRegisteredDuringSession,
  writeLedger,
} from './ledger.mjs';
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { CONTEXT_SNAPSHOT, PLATFORM_DIR } from '../config/paths.mjs';
import { autonomyBadge, consumePendingDigest } from './autonomy-signals.mjs';
import { hookHost, rememberHookSessionId, resolveHookSessionId } from './host-adapter.mjs';
import { renderBootBanner } from './boot-banner.mjs';

const ROOT = process.cwd();
const HOST = hookHost();
const isCodex = HOST === 'codex';

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/** A ledger touched within this window may belong to a LIVE concurrent session. */
const ACTIVE_GRACE_MS = 15 * 60 * 1000;

/** Most recent activity timestamp for a ledger (its start, or its last edit). */
function lastActivityAt(ledger) {
  const mods = Array.isArray(ledger.modifications) ? ledger.modifications : [];
  const lastMod = mods.reduce((mx, m) => (typeof m?.at === 'number' && m.at > mx ? m.at : mx), 0);
  return Math.max(typeof ledger.startedAt === 'number' ? ledger.startedAt : 0, lastMod);
}

async function analyzePriorLedgers(currentSessionId) {
  const all = await listAllLedgers();
  const drift = [];
  const now = Date.now();
  for (const { sessionId, ledger } of all) {
    if (sessionId === currentSessionId) continue;
    const mods = Array.isArray(ledger.modifications) ? ledger.modifications : [];
    const registered = ledger.registered || wasRegisteredDuringSession(ledger);
    const pending = pendingImportantPaths(ledger);
    if (registered || pending.length === 0) {
      // Reap a resolved ledger — but NEVER an empty one, nor one touched within the
      // grace window: that may be a LIVE concurrent session that just wrote its
      // fresh (empty) ledger. Deleting it was the race (008): a booting session
      // wiped a live peer. The owning session cleans up its own ledger.
      const maybeLive = mods.length === 0 || now - lastActivityAt(ledger) < ACTIVE_GRACE_MS;
      if (!maybeLive) await rm(ledgerPathFor(sessionId), { force: true }).catch(() => {});
      continue;
    }
    drift.push({ sessionId, paths: pending, at: lastActivityAt(ledger) });
  }
  // ADR-0033 — freshest first, so the cap keeps what matters.
  drift.sort((a, b) => b.at - a.at);
  return drift;
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    /* keep empty */
  }
  const sessionId = resolveHookSessionId(payload, HOST);
  rememberHookSessionId(sessionId, HOST);
  const level = getLevel(ROOT);
  const needsSetup = loadConfigSync(ROOT)?.setup?.completed !== true;

  // Fresh ledger for this session (Level >= 2 uses it; harmless at L1).
  await writeLedger(sessionId, freshLedger(sessionId));

  const drift = level >= 2 ? await analyzePriorLedgers(sessionId) : [];
  const sessions = await readSessionsIndex(ROOT);
  const changelog = await readChangelog(ROOT);
  const latest = await digestLatestSession(ROOT);
  const workspace = level >= 3 ? await readWorkspaceSummary(ROOT) : null;
  const branches = level >= 3 ? activeBranches(ROOT, getBranch(ROOT)) : null;
  const hasSnapshot = await exists(ROOT, CONTEXT_SNAPSHOT);
  const divergence = checkGitDivergence(ROOT);
  const secDue = securityModeDue(ROOT);
  const predDue = predictionsReviewDue(ROOT);
  const engineSignal = engineUpdateSignal(ROOT);
  const value = valueLine(ROOT);
  const bugs = level >= 2 ? openBugsDue(ROOT) : null;
  const mapStale = level >= 2 ? projectMapStale(ROOT) : null;
  // Task 112 — an unseen grade-≥3 consent receipt replays once at the next boot.
  const pendingDigest = consumePendingDigest(ROOT);

  // Trigger squad-director.mjs to get active squads
  let squadContext = null;
  if (level >= 4) {
    try {
      const scriptPath = resolve(ROOT, PLATFORM_DIR, 'tools/scripts/squad-director.mjs');
      if (existsSync(scriptPath)) {
        const outStr = execFileSync('node', [scriptPath], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        squadContext = JSON.parse(outStr);
      }
    } catch {
      /* fail-silent */
    }
  }

  if (!needsSetup && !sessions && !changelog && !latest && drift.length === 0 && !secDue && !predDue && !engineSignal && !value && !bugs && !mapStale && !pendingDigest) return;

  // ADR-0044 D2: prefer the compact count-by-type + recent-entries digest; fall
  // back to the raw-truncated section on any parse miss (ADR-0027 contract).
  const unreleased = changelog ? digestUnreleased(changelog) || extractUnreleased(changelog) : null;

  // Hand the gathered signals to the pure presentation layer (boot-banner.mjs).
  const banner = renderBootBanner({
    host: HOST,
    isCodex,
    sessionId,
    branch: getBranch(ROOT),
    level,
    projectName: await projectName(ROOT),
    autonomyBadge: autonomyBadge(ROOT),
    needsSetup,
    greenfield: needsSetup ? isGreenfield(ROOT) : false,
    practicesActive: loadConfigSync(ROOT)?.practices?.active === true,
    behaviorsActive: loadConfigSync(ROOT)?.behaviors?.active === true,
    engineSignal,
    pendingDigest,
    secDue,
    predDue,
    bugs,
    mapStale,
    squadContext,
    divergence,
    drift,
    workspace,
    branches,
    latest,
    unreleased,
    value,
    hasSnapshot,
  });

  process.stdout.write(banner);
}

main().catch((err) => {
  process.stderr.write(`[session-start] ${err?.message ?? err}\n`);
  process.exit(0);
});
