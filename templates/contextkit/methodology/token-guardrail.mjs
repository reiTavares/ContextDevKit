/**
 * Rail (c) token guardrail + kill-switch (WF-0090 GA2, BIZ-0006, ADR-0148 §13).
 *
 * ADR-0148's hard guardrail: `governance-tokens/session` must NOT rise while
 * tokens-per-concluded-context falls. This module is what makes that a runtime
 * refusal rather than an aspiration — and it is deliberately the ONLY place in
 * WF-0090 that reads a ledger.
 *
 * Why the read boundary lives here (GA0 decision D3): `token-report.mjs` calls
 * `main()` at import and exports no reader, so requiring it would run a CLI as a
 * side effect of a fill; `session-pressure.mjs` exports pure scorers over a
 * session row it never fetches. Spawning the CLI per field, or re-implementing
 * transcript aggregation, were both refused (cost, and "reuse, don't
 * reimplement"). Instead this reads the existing append-only economy-events
 * ledger through `readEconomyEventsSync`, filtered to the engine's own lever.
 *
 * **The measurement loop is open, by sequence rather than by oversight.**
 * `recordContentFillSpend` below is the writer that closes it, and it currently
 * has NO caller: there is no production fill site yet (GA4 is the wiring wave).
 * So on any real root `readGovernanceTokenLedger` reports
 * `available:false, reason:'no content-fill rows…'` and the engine is OFF. The
 * failure direction is the safe one — unmeasured ⇒ off ⇒ rail (d) — but rail (c)
 * stays *unexercised against real data* until a fill path records spend. Whoever
 * wires `deps.killSwitch` must wire `recordContentFillSpend` in the same change,
 * or the guardrail can never arm.
 *
 * The honest limitation, recorded rather than hidden (GA0 risk R-C): this
 * measures the ENGINE's governance-token spend, not the whole plane's
 * `governance-tokens/session`. The plane-wide reader is a WF-0086 seam, and
 * WF-0090 must not grow a transcript reader to fake one.
 *
 * `evaluateKillSwitch` is pure, table-driven, and **never calls a model**: every
 * governance decision here is a deterministic comparison. A gate that dispatched
 * an LLM to decide would be a token tax and is forbidden (§13).
 *
 * Constitution §8 throughout: an absent, unparsable, or single-session ledger is
 * `available:false` ⇒ the engine is OFF with a named reason. A measurement that
 * could not be taken never authorizes spend — and never blocks work either, it
 * lands in rail (d).
 *
 * Zero runtime dependencies — `node:*` and sibling scripts only.
 */
import {
  economyEventsFile,
  logEconomyEventSync,
  readEconomyEventsSync,
} from '../tools/scripts/economy/economy-events.mjs';

/** The economy-registry resource id the content engine records its spend under. */
export const CONTENT_FILL_LEVER = 'content-fill';

/** Pressure bands that switch the engine off — an already-strained session buys nothing. */
const BLOCKING_PRESSURE_BANDS = Object.freeze(['hot', 'critical']);

/** Sums the observed token measurement on one economy event (absent ⇒ 0). */
function observedTokens(record) {
  const tokens = record?.observed?.tokens;
  return typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0;
}

/**
 * Reads the governance-token series for the content engine: this session's
 * recorded spend and the most recent PRIOR session's, which is what the
 * non-regression comparison needs.
 *
 * The one read boundary. Fail-open and honest: a missing file, a ledger with no
 * content-fill rows, or no identifiable prior session all return
 * `available:false` with a reason rather than a zero that would read as
 * "measured, and cheap".
 *
 * One case does report a real zero, and it is a measurement rather than a
 * fabrication: a ledger holding rows for a PRIOR session but none for this one
 * returns `available:true, sessionTokens:0`. On an append-only ledger "no rows
 * yet" genuinely means "nothing spent yet". The consequence worth knowing is that
 * the budget comparison cannot trip on a session's first fill — only the
 * non-regression comparison can.
 *
 * "The prior session" is the last DISTINCT session id in ledger-append order, so
 * an interleaved ledger (`A, self, A`) picks a baseline that includes rows
 * appended after this session began. Accepted: the alternative is a clock, and a
 * clock in the hash/compare path is what this module exists to avoid.
 *
 * @param {string} root project root (holds `contextkit/memory/economy-events.jsonl`)
 * @param {{sessionId?: string|null, readEvents?: Function}} [options]
 *   `sessionId` scopes "this session" (defaults to `CLAUDE_CODE_SESSION_ID`);
 *   `readEvents` is a test seam so the selftest never touches disk
 * @returns {{available: boolean, sessionTokens: number|null,
 *   priorSessionTokens: number|null, sessionId: string|null, reason: string|null}}
 */
export function readGovernanceTokenLedger(root, options = {}) {
  const sessionId = options.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  const blank = { available: false, sessionTokens: null, priorSessionTokens: null, sessionId };

  if (typeof root !== 'string' || root.trim().length === 0) {
    return { ...blank, reason: 'no project root supplied' };
  }
  if (!sessionId) {
    return { ...blank, reason: 'no session id — cannot scope a per-session measurement' };
  }

  let records;
  try {
    const read = typeof options.readEvents === 'function' ? options.readEvents : readEconomyEventsSync;
    records = read(economyEventsFile(root));
  } catch {
    return { ...blank, reason: 'economy-events ledger unreadable' };
  }

  const engineRows = (Array.isArray(records) ? records : []).filter((record) => record?.lever === CONTENT_FILL_LEVER);
  if (engineRows.length === 0) {
    return { ...blank, reason: 'no content-fill rows in the economy-events ledger (nothing measured yet)' };
  }

  // Per-session totals, in ledger (append) order so "the prior session" is the
  // most recent one that is not this one — no clock, no sort on a formatted date.
  const totalsBySession = new Map();
  for (const record of engineRows) {
    const rowSession = typeof record?.sessionId === 'string' ? record.sessionId : null;
    if (!rowSession) continue;
    totalsBySession.set(rowSession, (totalsBySession.get(rowSession) ?? 0) + observedTokens(record));
  }

  const sessions = [...totalsBySession.keys()];
  const priorSessions = sessions.filter((candidate) => candidate !== sessionId);
  const sessionTokens = totalsBySession.get(sessionId) ?? 0;
  if (priorSessions.length === 0) {
    return {
      available: false,
      sessionTokens,
      priorSessionTokens: null,
      sessionId,
      reason: 'no prior session in the ledger — a non-regression check needs a baseline',
    };
  }

  return {
    available: true,
    sessionTokens,
    priorSessionTokens: totalsBySession.get(priorSessions[priorSessions.length - 1]) ?? 0,
    sessionId,
    reason: null,
  };
}

/**
 * The kill-switch verdict. Pure, table-driven, deterministic — no I/O and no
 * model call. Refuses by default: every condition must hold for the engine to be
 * enabled, and the first failure names itself.
 *
 * Granularity is per-CONTEXT, not per-field (D3): per-field would need an
 * unmeasured number per field, while per-context is the unit the north-star
 * metric ("concluded work contexts per 1k tokens") and an artifact are both
 * written for.
 *
 * @param {{enabled?: boolean, tokenBudgetPerContext?: number}} config resolved
 *   `methodology.contentFill` block
 * @param {{available: boolean, sessionTokens: number|null,
 *   priorSessionTokens: number|null, reason?: string|null}} ledger a
 *   `readGovernanceTokenLedger` result
 * @param {{band?: string, status?: string}|null} [pressure] an injected
 *   `pressureScore` result; absent or `skipped` neither authorizes nor blocks
 * @returns {{enabled: boolean, reason: string, tripped: boolean}} `tripped`
 *   distinguishes "the guardrail fired on a real measurement" from "never armed"
 */
export function evaluateKillSwitch(config, ledger, pressure = null) {
  const budget = Number(config?.tokenBudgetPerContext);

  if (config?.enabled !== true) {
    return { enabled: false, reason: 'config.enabled=false (shipped default is off)', tripped: false };
  }
  if (!(budget > 0)) {
    return { enabled: false, reason: 'config.tokenBudgetPerContext=0 (no spend authorized)', tripped: false };
  }
  if (!ledger || ledger.available !== true) {
    return {
      enabled: false,
      reason: `governance-token measurement unavailable: ${ledger?.reason ?? 'not read'} (skipped, never a pass)`,
      tripped: false,
    };
  }

  // `available:true` is not the same as trustworthy. A non-finite or negative
  // total is an UNUSABLE measurement, and unusable is `skipped` — never a pass
  // (constitution §8). Without this guard both comparisons below are false for
  // NaN and the function falls through to "satisfied", i.e. a corrupt reading
  // would authorize spend. `readGovernanceTokenLedger` never emits one, but
  // `ledger` is a documented injected parameter and this function is exported.
  // Type-checked, never coerced: `Number(null)` is 0, so coercion would read a
  // MISSING measurement as "measured zero spend" and authorize the fill.
  const sessionTokens = ledger.sessionTokens;
  if (typeof sessionTokens !== 'number' || !Number.isFinite(sessionTokens) || sessionTokens < 0) {
    return {
      enabled: false,
      reason: `governance-token measurement unusable (skipped, never a pass): ${JSON.stringify(ledger.sessionTokens)}`,
      tripped: false,
    };
  }
  if (!Number.isFinite(budget)) {
    return {
      enabled: false,
      reason: `config.tokenBudgetPerContext is not a finite number: ${JSON.stringify(config?.tokenBudgetPerContext)}`,
      tripped: false,
    };
  }
  if (sessionTokens >= budget) {
    return {
      enabled: false,
      reason: `per-context token budget consumed (${sessionTokens} >= ${budget})`,
      tripped: true,
    };
  }
  // The guardrail proper: governance-tokens/session must NOT rise (ADR-0148 §13).
  // `null`/`undefined` legitimately mean "no baseline recorded yet"; anything
  // else that is not a finite number is a corrupt baseline, not an absent one.
  const priorRaw = ledger.priorSessionTokens;
  const priorTokens = priorRaw === null || priorRaw === undefined ? null : priorRaw;
  if (priorTokens !== null && (typeof priorTokens !== 'number' || !Number.isFinite(priorTokens))) {
    return {
      enabled: false,
      reason: `prior-session measurement unusable (skipped, never a pass): ${JSON.stringify(priorRaw)}`,
      tripped: false,
    };
  }
  if (priorTokens !== null && sessionTokens > priorTokens) {
    return {
      enabled: false,
      reason: `governance-tokens/session rising (${sessionTokens} > ${priorTokens}) — kill-switch tripped`,
      tripped: true,
    };
  }
  // Session pressure: an absent or skipped signal is UNKNOWN, so it does not
  // authorize and does not block (§8) — only a real hot/critical band switches off.
  const band = pressure?.status === 'skipped' ? null : pressure?.band ?? null;
  if (band && BLOCKING_PRESSURE_BANDS.includes(band)) {
    return { enabled: false, reason: `session pressure band=${band}`, tripped: true };
  }

  return { enabled: true, reason: 'guardrail satisfied', tripped: false };
}

/**
 * Records the engine's own token spend for one fill, which is what keeps the
 * guardrail measuring something real rather than reading an empty series.
 * Best-effort by design: a failed telemetry write must never fail a fill, so
 * `logEconomyEventSync` swallowing an error is the intended behavior here.
 *
 * @param {string} root project root
 * @param {{sessionId?: string|null, fieldKeys?: string[], observedTokens?: number,
 *   lifecycle?: string, reason?: string, now?: string}} spend the measurement
 * @returns {object|null} the recorded event, or `null` when nothing was written
 */
export function recordContentFillSpend(root, spend = {}) {
  const filled = Array.isArray(spend.fieldKeys) ? spend.fieldKeys.length : 0;
  return logEconomyEventSync(root, {
    lever: CONTENT_FILL_LEVER,
    lifecycle: spend.lifecycle ?? (filled > 0 ? 'applied' : 'skipped'),
    sessionId: spend.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null,
    reason: spend.reason ?? (filled > 0 ? `filled ${filled} reasoned field(s)` : 'no field filled'),
    observedTokens: typeof spend.observedTokens === 'number' ? spend.observedTokens : undefined,
    sourceLedger: 'methodology/content-fill',
    capturedAt: spend.now ?? null,
  });
}
