/**
 * Plane-wide governance-token measurement + the BIZ-0006 north-star (WF-0086 IN2,
 * ADR-0148 §13).
 *
 * This is the seam `methodology/token-guardrail.mjs` names and deliberately does
 * NOT implement: that module reads one lever (`content-fill`) because WF-0090 must
 * not grow a plane-wide reader to fake one. This module is that reader.
 *
 * Two readings, both honest-or-absent:
 *
 *  - **the guardrail** — `governance-tokens/session` must NOT rise. HARD per
 *    ADR-0148 §13: a rising reading blocks promotion. It compares this session's
 *    governance spend to the most recent PRIOR session's.
 *  - **the north-star** — concluded work contexts per 1k governance tokens. The
 *    ratio only means anything with both a numerator and a denominator, so an
 *    absent ledger yields `available:false` with a reason, never a flattering zero.
 *
 * "Governance tokens" is derived from the economy registry, not invented here: the
 * plane's own machinery is every resource whose category is `lifecycle` or
 * `advisory`. The four observable `lever` resources (boot-delta, run-compact,
 * project-map, routing) are excluded — they exist to SAVE tokens, and folding a
 * saving into a spend measurement would make the guardrail unfalsifiable.
 *
 * Every governance decision here is a deterministic comparison. No model call —
 * a gate that dispatched an LLM to decide would be the token tax §13 forbids.
 *
 * Zero runtime dependencies — `node:*` and sibling scripts only.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { economyEventsFile, readEconomyEventsSync } from '../economy/economy-events.mjs';
import { ECONOMY_RESOURCES } from '../economy/registry.mjs';
import { workflowCorpusRoots } from '../workflow/invariants.mjs';

/**
 * The plane's own machinery: every economy resource that SPENDS governance tokens.
 * Derived from the registry so a new resource is classified once, at its source.
 */
export const GOVERNANCE_RESOURCES = Object.freeze(
  ECONOMY_RESOURCES.filter((entry) => entry.category !== 'lever').map((entry) => entry.resource),
);

/** Sums the observed token measurement on one economy event (absent ⇒ 0). */
function observedTokens(record) {
  const tokens = record?.observed?.tokens;
  return typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0;
}

/**
 * Reads the per-session governance-token series from the append-only economy
 * ledger. Fail-open and explicit: a missing/unreadable ledger, no governance rows,
 * or no identifiable prior session all report `available:false` with a reason.
 *
 * "The prior session" is the last DISTINCT session id in ledger-append order —
 * no clock, no sort on a formatted date (same rule as `token-guardrail.mjs`).
 *
 * @param {string} root project root holding `contextkit/memory/economy-events.jsonl`
 * @param {{sessionId?: string|null, readEvents?: Function}} [options]
 *   `sessionId` scopes "this session" (defaults to `CLAUDE_CODE_SESSION_ID`);
 *   `readEvents` is a test seam so the selftest never touches disk.
 * @returns {{available: boolean, sessionTokens: number|null,
 *   priorSessionTokens: number|null, sessionId: string|null,
 *   totalTokens: number, sessionCount: number, reason: string|null}}
 */
export function readGovernanceTokenSeries(root, options = {}) {
  const sessionId = options.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  const blank = {
    available: false, sessionTokens: null, priorSessionTokens: null,
    sessionId, totalTokens: 0, sessionCount: 0,
  };

  if (typeof root !== 'string' || root.trim().length === 0) {
    return { ...blank, reason: 'no project root supplied' };
  }

  let records;
  try {
    const read = typeof options.readEvents === 'function' ? options.readEvents : readEconomyEventsSync;
    records = read(economyEventsFile(root));
  } catch {
    return { ...blank, reason: 'economy-events ledger unreadable' };
  }

  const governanceRows = (Array.isArray(records) ? records : [])
    .filter((record) => GOVERNANCE_RESOURCES.includes(record?.lever));
  if (governanceRows.length === 0) {
    return { ...blank, reason: 'no governance rows in the economy-events ledger (nothing measured yet)' };
  }

  const totalsBySession = new Map();
  let totalTokens = 0;
  for (const record of governanceRows) {
    const spend = observedTokens(record);
    totalTokens += spend;
    const rowSession = typeof record?.sessionId === 'string' ? record.sessionId : null;
    if (!rowSession) continue;
    totalsBySession.set(rowSession, (totalsBySession.get(rowSession) ?? 0) + spend);
  }

  const sessions = [...totalsBySession.keys()];
  const measured = { totalTokens, sessionCount: sessions.length, sessionId };
  if (!sessionId) {
    return { ...blank, ...measured, reason: 'no session id — cannot scope a per-session comparison' };
  }
  const priorSessions = sessions.filter((candidate) => candidate !== sessionId);
  const sessionTokens = totalsBySession.get(sessionId) ?? 0;
  if (priorSessions.length === 0) {
    return {
      ...measured,
      available: false,
      sessionTokens,
      priorSessionTokens: null,
      reason: 'no prior session in the ledger — a non-regression check needs a baseline',
    };
  }

  return {
    ...measured,
    available: true,
    sessionTokens,
    priorSessionTokens: totalsBySession.get(priorSessions[priorSessions.length - 1]) ?? 0,
    reason: null,
  };
}

/**
 * Counts concluded work contexts across the whole workflow corpus — the
 * north-star's numerator. A context counts only when its state authority says so
 * (`overallStatus === 'done'`), never because of where the directory sits: the
 * placement-vs-state divergence is exactly the drift BIZ-0006 exists to kill, so
 * trusting placement here would let the metric flatter itself.
 *
 * @param {string} root project root
 * @param {{roots?: string[], readState?: Function, exists?: Function,
 *   listDirs?: Function}} [options] test seams — `listDirs` yields the workflow
 *   directory names under one corpus root, mirroring the `readEvents` seam style
 *   so the selftest never touches disk.
 * @returns {{available: boolean, concluded: number, scanned: number, reason: string|null}}
 */
export function countConcludedContexts(root, options = {}) {
  let roots;
  try {
    roots = Array.isArray(options.roots) ? options.roots : workflowCorpusRoots(root);
  } catch {
    return { available: false, concluded: 0, scanned: 0, reason: 'workflow corpus roots unresolvable' };
  }

  const readState = typeof options.readState === 'function'
    ? options.readState
    : (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  const exists = typeof options.exists === 'function' ? options.exists : existsSync;
  const listDirs = typeof options.listDirs === 'function'
    ? options.listDirs
    : (dir) => readdirSync(dir, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name);

  let concluded = 0;
  let scanned = 0;
  for (const dir of roots) {
    if (!exists(dir)) continue;
    let names;
    try {
      names = listDirs(dir);
    } catch { continue; }
    for (const name of Array.isArray(names) ? names : []) {
      const statePath = join(dir, name, 'workflow-state.json');
      if (!exists(statePath)) continue;
      scanned += 1;
      try {
        if (readState(statePath)?.overallStatus === 'done') concluded += 1;
      } catch { /* an unreadable state is not a conclusion */ }
    }
  }

  if (scanned === 0) {
    return { available: false, concluded: 0, scanned: 0, reason: 'no workflow states found in the corpus' };
  }
  return { available: true, concluded, scanned, reason: null };
}

/**
 * The HARD ADR-0148 §13 guardrail: `governance-tokens/session` must NOT rise.
 * Pure comparison over a series reading.
 *
 * `skipped` is a first-class verdict, never promoted to `pass` (constitution §8):
 * an unmeasured guardrail has not held, it has simply not been read.
 *
 * @param {ReturnType<typeof readGovernanceTokenSeries>} series
 * @returns {{status: 'pass'|'fail'|'skipped', risen: boolean|null,
 *   delta: number|null, blocksPromotion: boolean, reason: string}}
 */
export function evaluateGovernanceTokenGuardrail(series) {
  if (!series?.available) {
    return {
      status: 'skipped',
      risen: null,
      delta: null,
      blocksPromotion: false,
      reason: series?.reason ?? 'no governance-token measurement available',
    };
  }
  const delta = series.sessionTokens - series.priorSessionTokens;
  if (delta > 0) {
    return {
      status: 'fail',
      risen: true,
      delta,
      blocksPromotion: true,
      reason: `governance tokens rose by ${delta} vs the prior session (${series.priorSessionTokens} → ${series.sessionTokens}) — ADR-0148 §13 blocks promotion`,
    };
  }
  return {
    status: 'pass',
    risen: false,
    delta,
    blocksPromotion: false,
    reason: `governance tokens did not rise (${series.priorSessionTokens} → ${series.sessionTokens})`,
  };
}

/**
 * The north-star reading: concluded work contexts per 1k governance tokens.
 *
 * `baseline` and `target` stay `null` — they are measured, never asserted
 * (constitution §8; BIZ-0006 growth targets are explicitly unset until shadow
 * calibration). This function reports the observation; it does not grade it.
 *
 * @param {ReturnType<typeof readGovernanceTokenSeries>} series
 * @param {ReturnType<typeof countConcludedContexts>} contexts
 * @returns {{available: boolean, metric: string, concludedContexts: number|null,
 *   governanceTokens: number|null, concludedPerThousandTokens: number|null,
 *   baseline: null, target: null, reason: string|null}}
 */
export function northStarReading(series, contexts) {
  const shape = {
    metric: 'concluded work contexts per 1k governance tokens',
    baseline: null,
    target: null,
  };
  if (!contexts?.available) {
    return {
      ...shape, available: false, concludedContexts: null, governanceTokens: null,
      concludedPerThousandTokens: null, reason: contexts?.reason ?? 'concluded-context count unavailable',
    };
  }
  const governanceTokens = typeof series?.totalTokens === 'number' ? series.totalTokens : 0;
  if (governanceTokens <= 0) {
    return {
      ...shape, available: false, concludedContexts: contexts.concluded, governanceTokens: null,
      concludedPerThousandTokens: null,
      reason: series?.reason ?? 'no governance-token spend measured — a ratio needs a denominator',
    };
  }
  return {
    ...shape,
    available: true,
    concludedContexts: contexts.concluded,
    governanceTokens,
    concludedPerThousandTokens: Number(((contexts.concluded / governanceTokens) * 1000).toFixed(4)),
    reason: null,
  };
}

/**
 * Renders both readings for `token-report`. Text only, no side effects.
 * @param {ReturnType<typeof northStarReading>} northStar
 * @param {ReturnType<typeof evaluateGovernanceTokenGuardrail>} guardrail
 * @returns {string}
 */
export function presentGovernanceNorthStar(northStar, guardrail) {
  const lines = ['Methodology plane — north-star + governance guardrail (BIZ-0006, ADR-0148 §13):'];
  lines.push(northStar?.available
    ? `  north-star: ${northStar.concludedPerThousandTokens} concluded context(s) per 1k governance tokens `
      + `(${northStar.concludedContexts} concluded / ${northStar.governanceTokens} tokens) · baseline null · target null`
    : `  north-star: skipped — ${northStar?.reason ?? 'unavailable'} (baseline null, target null)`);
  const mark = guardrail?.status === 'pass' ? '✓' : guardrail?.status === 'fail' ? '✗' : '–';
  lines.push(`  ${mark} governance-tokens/session: ${guardrail?.status ?? 'skipped'} — ${guardrail?.reason ?? 'unavailable'}`);
  if (guardrail?.blocksPromotion) lines.push('  ⛔ promotion is blocked while this reading rises.');
  return lines.join('\n');
}
