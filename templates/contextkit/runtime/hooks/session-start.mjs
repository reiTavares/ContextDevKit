#!/usr/bin/env node
/**
 * SessionStart hook (Level >= 1) — injects project context at session start.
 *
 * Behavior:
 *   1. `git fetch origin` silently to surface ahead/behind divergence.
 *   2. Detects drift from prior sessions (ledgers with unregistered important
 *      modifications) and emits a banner. Never deletes ledgers — session
 *      cleanup is a separate explicit command [ADR-0099].
 *   3. Includes the latest registered session, the CHANGELOG `[Unreleased]`,
 *      and active workspace claims when present.
 *
 * Constraints: concise output, all errors silent (NEVER block a session),
 * zero third-party deps.
 */
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
  listAllLedgers,
  pendingImportantPaths,
  wasRegisteredDuringSession,
  writeLedger,
} from './ledger.mjs';
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { CONTEXT_SNAPSHOT } from '../config/paths.mjs';
import { resolveRoutingConfig, routingBannerLine } from '../../tools/scripts/routing/routing-config.mjs';
import { autonomyBadge, consumePendingDigest } from './autonomy-signals.mjs';
import { hookHost, rememberHookSessionId, resolveHookSessionId } from './host-adapter.mjs';
import { renderBootBanner } from './boot-banner.mjs';
import { readSquadContext } from './squad-context.mjs';
import { applyBootDeltaGate } from '../../tools/scripts/economy/boot-delta-gate.mjs';
import { economyActivationSection } from '../../tools/scripts/economy/economy-session-activation.mjs';
import { logSavingSync } from '../../tools/scripts/economy/economy-savings.mjs';
import { emitEconomy } from '../../tools/scripts/economy/telemetry-emit.mjs';

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

/** Most recent activity timestamp for a ledger (its start, or its last edit). */
function lastActivityAt(ledger) {
  const mods = Array.isArray(ledger.modifications) ? ledger.modifications : [];
  const lastMod = mods.reduce((mx, m) => (typeof m?.at === 'number' && m.at > mx ? m.at : mx), 0);
  return Math.max(typeof ledger.startedAt === 'number' ? ledger.startedAt : 0, lastMod);
}

async function analyzePriorLedgers(currentSessionId) {
  const all = await listAllLedgers();
  const drift = [];
  for (const { sessionId, ledger } of all) {
    if (sessionId === currentSessionId) continue;
    const registered = ledger.registered || wasRegisteredDuringSession(ledger);
    const pending = pendingImportantPaths(ledger);
    if (registered || pending.length === 0) {
      // Resolved ledgers (registered or no pending important paths) are skipped
      // from drift detection. They are NEVER deleted here — ledger cleanup is a
      // separate explicit command (ADR-0099). Deleting here caused the incident:
      // an --update restart fired SessionStart and wiped recently-resolved peers.
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

  // ADR-0094 — resolve the routing posture once; best-effort, never blocks boot.
  let routingLine = null;
  let routingState = null;
  try {
    const routing = resolveRoutingConfig({ project: loadConfigSync(ROOT)?.routing, level });
    routingLine = routingBannerLine(routing);
    routingState = { active: routing.active, mode: routing.mode };
  } catch {
    /* routing surface is best-effort (rule 2) */
  }

  const squadContext = readSquadContext(ROOT, level);
  const ledger = freshLedger(sessionId);
  if (squadContext) ledger.squads = squadContext.squads;
  if (routingState) ledger.routing = routingState;
  await writeLedger(sessionId, ledger);

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

  if (!needsSetup && !sessions && !changelog && !latest && drift.length === 0 && !secDue && !predDue && !engineSignal && !value && !bugs && !mapStale && !pendingDigest) return;

  // ADR-0044 D2: prefer the compact count-by-type + recent-entries digest; fall
  // back to the raw-truncated section on any parse miss (ADR-0027 contract).
  const unreleased = changelog ? digestUnreleased(changelog) || extractUnreleased(changelog) : null;

  // Hand the gathered signals to the pure presentation layer (boot-banner.mjs).
  // ADR-0103: boot-delta (#259) gates UNCHANGED informational sections — fail-open
  // (a broken gate returns the full bundle), Process rules + drift never gated.
  const boot = {
    host: HOST,
    isCodex,
    sessionId,
    branch: getBranch(ROOT),
    level,
    projectName: await projectName(ROOT),
    autonomyBadge: autonomyBadge(ROOT),
    routingLine,
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
    // Economy stack auto-activation (ADR-0103): emits the deterministic-tools
    // guidance every session by default. Best-effort; never blocks boot (rule 2).
    economyActivation: (() => { try { return economyActivationSection(loadConfigSync(ROOT)); } catch { return null; } })(),
  };
  const banner = renderBootBanner(applyBootDeltaGate(boot, { root: ROOT, config: loadConfigSync(ROOT) }));

  // Observed economy (best-effort): boot-delta gated unchanged sections; the saving
  // is the banner-size reduction vs the ungated render. Never blocks boot (rule 2).
  try {
    const fullLen = renderBootBanner(boot).length;
    logSavingSync(ROOT, { lever: 'boot-delta', savedTokens: Math.max(0, Math.round((fullLen - banner.length) / 4)), sessionId }, { now: Date.now() });
  } catch { /* advisory */ }

  // Economy (ADR-0117): run-compact is evaluated every session but DEFERRED — never
  // spawned at boot (rule 2). The real saving is recorded when the first test/build
  // is wrapped through run-compact, not here.
  try {
    emitEconomy(ROOT, 'run-compact', { category: 'lever', action: 'deferred', measurement: 'none', sessionId }, { now: Date.now() });
  } catch { /* advisory */ }

  process.stdout.write(banner);
}

main().catch((err) => {
  process.stderr.write(`[session-start] ${err?.message ?? err}\n`);
  process.exit(0);
});
