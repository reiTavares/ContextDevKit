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
 * The economy categories that count as governance spend. An explicit allow-list,
 * not `!== 'lever'`: the negation would silently absorb any category added later,
 * widening the guardrail's denominator without anyone deciding to. The selftest
 * asserts this list plus `lever` covers `ECONOMY_CATEGORIES` exactly, so a new
 * category fails the suite until it is classified on purpose.
 */
export const GOVERNANCE_CATEGORIES = Object.freeze(['lifecycle', 'advisory']);

/**
 * The plane's own machinery: every economy resource that SPENDS governance tokens.
 * Derived from the registry so a new resource is classified once, at its source.
 */
export const GOVERNANCE_RESOURCES = Object.freeze(
  ECONOMY_RESOURCES
    .filter((entry) => GOVERNANCE_CATEGORIES.includes(entry.category))
    .map((entry) => entry.resource),
);

/**
 * Reads the observed token measurement on one economy event.
 *
 * Returns `null` when the row carries no usable measurement — deliberately NOT 0.
 * `Number(null)` is 0, so folding an absent measurement into a sum makes "nothing
 * was measured" indistinguishable from "measured, and it cost nothing", and a
 * HARD guardrail would then report a green `pass` from zero evidence
 * (constitution §8). A negative or non-finite value is unusable, not zero.
 *
 * @param {object} record one economy-events row
 * @returns {number|null} the measured spend, or null when unmeasured/unusable
 */
function observedTokens(record) {
  const tokens = record?.observed?.tokens;
  return typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? tokens : null;
}

/** A usable token measurement: a finite, non-negative number. Strings do not coerce. */
function isUsableMeasurement(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
 *   totalTokens: number, reason: string|null}}
 */
export function readGovernanceTokenSeries(root, options = {}) {
  const sessionId = options.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  const blank = {
    available: false, sessionTokens: null, priorSessionTokens: null,
    sessionId, totalTokens: 0,
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

  // Only rows carrying a usable measurement contribute. A session present in the
  // ledger but with no measured row stays ABSENT from the map rather than landing
  // there as 0 — otherwise "unmeasured" becomes an authoritative-looking zero and
  // the guardrail below passes on no evidence at all.
  const totalsBySession = new Map();
  let totalTokens = 0;
  let measuredRows = 0;
  for (const record of governanceRows) {
    const spend = observedTokens(record);
    if (spend === null) continue;
    measuredRows += 1;
    totalTokens += spend;
    const rowSession = typeof record?.sessionId === 'string' ? record.sessionId : null;
    if (!rowSession) continue;
    totalsBySession.set(rowSession, (totalsBySession.get(rowSession) ?? 0) + spend);
  }

  if (measuredRows === 0) {
    return {
      ...blank,
      reason: `${governanceRows.length} governance row(s) present but none carries an observed token measurement (nothing measured yet)`,
    };
  }

  const sessions = [...totalsBySession.keys()];
  const measured = { totalTokens, sessionId };
  if (!sessionId) {
    return { ...blank, ...measured, reason: 'no session id — cannot scope a per-session comparison' };
  }
  const priorSessions = sessions.filter((candidate) => candidate !== sessionId);
  // `has`, not `?? 0`: an unmeasured side must read as null (unavailable), never as
  // a zero that would make a phantom rise or a phantom flat line look measured.
  const sessionTokens = totalsBySession.has(sessionId) ? totalsBySession.get(sessionId) : null;
  if (priorSessions.length === 0) {
    return {
      ...measured,
      available: false,
      sessionTokens,
      priorSessionTokens: null,
      reason: 'no prior session in the ledger — a non-regression check needs a baseline',
    };
  }
  const priorSessionTokens = totalsBySession.get(priorSessions[priorSessions.length - 1]);
  if (!isUsableMeasurement(sessionTokens)) {
    return {
      ...measured,
      available: false,
      sessionTokens,
      priorSessionTokens,
      reason: 'this session has no measured governance spend — a non-regression check needs both sides measured',
    };
  }

  return {
    ...measured,
    available: true,
    sessionTokens,
    priorSessionTokens,
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
  // Dedupe: a repeated corpus root would count the same pack twice and inflate the
  // numerator, which flatters the north-star. `workflowCorpusRoots` emits distinct
  // paths today, so this guards the seam rather than a live defect.
  roots = [...new Set(roots)];

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
  // Type-checked, never coerced. `Number(null)` is 0 and `NaN > 0` is false, so a
  // corrupt or absent reading would slide through the comparison below and land on
  // `pass` — a green HARD guardrail from an unusable measurement. Both sides must
  // be finite, non-negative numbers; a string that merely looks numeric is not one.
  if (!isUsableMeasurement(series.sessionTokens) || !isUsableMeasurement(series.priorSessionTokens)) {
    return {
      status: 'skipped',
      risen: null,
      delta: null,
      blocksPromotion: false,
      reason: `unusable governance-token measurement (session=${JSON.stringify(series.sessionTokens)}, prior=${JSON.stringify(series.priorSessionTokens)}) — an unreadable guardrail is skipped, never a pass`,
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
 * **Cohort caveat, disclosed rather than hidden.** The numerator counts every
 * concluded context in the corpus (all-time), while the denominator only covers
 * what the append-only ledger has recorded (its measurement window). Those are
 * different cohorts, so once spend is recorded the ratio counts conclusions that
 * predate measurement against post-measurement tokens and reads flatteringly
 * high. Narrowing the numerator to the window is not possible today: a
 * `workflow.concluded` event carries no ledger-correlatable stamp the counter can
 * filter on, and inventing one would be fabricating precision. So the reading
 * carries `cohort: 'corpus-all-time / ledger-window'` and every consumer is
 * expected to treat the absolute value as directional only — which is also why
 * `baseline`/`target` stay null until shadow calibration sets them from a series
 * measured under one cohort.
 *
 * @param {ReturnType<typeof readGovernanceTokenSeries>} series
 * @param {ReturnType<typeof countConcludedContexts>} contexts
 * @returns {{available: boolean, metric: string, concludedContexts: number|null,
 *   governanceTokens: number|null, concludedPerThousandTokens: number|null,
 *   cohort: string, baseline: null, target: null, reason: string|null}}
 */
export function northStarReading(series, contexts) {
  const shape = {
    metric: 'concluded work contexts per 1k governance tokens',
    cohort: 'corpus-all-time / ledger-window',
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
