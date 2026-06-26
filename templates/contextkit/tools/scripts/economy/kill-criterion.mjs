#!/usr/bin/env node
/**
 * kill-criterion.mjs — economy governance meter (OP-0001 / WF-0039 / ADR-0117,
 * extends the ADR-0082 honesty fence).
 *
 * Three governance reads over the two ledgers, all PURE (rows in → verdict out):
 *   1. meterLevers      — per-lever observed saving vs a measurement-cost proxy,
 *                         with a kill-criterion verdict (retire a lever that fires
 *                         repeatedly while never saving).
 *   2. sessionAuditLine — the one-line per-session economy audit record.
 *   3. estimatedLane    — the ESTIMATED token total, kept in its own lane and
 *                         NEVER summed with observed savings (ADR-0082/#243).
 *
 * Honesty: `cost` is an explicit fire-count PROXY — the true token cost of
 * measurement is not yet metered, so it is labelled as a proxy and never
 * silently treated as tokens. `fable_auto` is always false (Fable is never
 * auto-selected — ADR-0052).
 *
 * Zero runtime dependencies — node:* and sibling economy modules only.
 * @module economy/kill-criterion
 */
import { ECONOMY_LEVERS } from './registry.mjs';

/** A lever is retired to advisory once it fires this many times having saved 0. */
export const ZERO_SAVING_KILL_STREAK = 5;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const leverOf = (row) => (row && typeof row.lever === 'string' ? row.lever : null);

/**
 * Meters each measurable lever from the raw ledger rows.
 *
 * @param {Array<{lever?:string, savedTokens?:number}>} savingsRows
 * @param {Array<{lever?:string, estimated?:number}>} eventRows
 * @returns {Array<{name:string, saving:number, costProxy:number, fires:number, verdict:'keep'|'retire-to-advisory'}>}
 */
export function meterLevers(savingsRows = [], eventRows = []) {
  return ECONOMY_LEVERS.map((name) => {
    const saving = savingsRows.filter((r) => leverOf(r) === name).reduce((s, r) => s + num(r.savedTokens), 0);
    const fires = eventRows.filter((r) => leverOf(r) === name).length;
    // cost proxy: one unit per measurement event recorded for the lever.
    const costProxy = fires;
    const verdict = (fires >= ZERO_SAVING_KILL_STREAK && saving === 0) ? 'retire-to-advisory' : 'keep';
    return { name, saving, costProxy, fires, verdict };
  });
}

/**
 * Builds the per-session economy audit line.
 *
 * @param {{ sessionId?: string|null, savingsRows?: any[], eventRows?: any[], mode?: string }} params
 * @returns {{ sessionId:string|null, levers:Array<{name:string,state:string,cost:number,saving:number}>,
 *   net:number, fable_auto:false, mode:string }}
 */
export function sessionAuditLine({ sessionId = null, savingsRows = [], eventRows = [], mode = 'advisory' } = {}) {
  const metered = meterLevers(savingsRows, eventRows);
  const levers = metered.map((l) => ({ name: l.name, state: l.verdict, cost: l.costProxy, saving: l.saving }));
  // net is OBSERVED tokens saved only — the cost proxy is not tokens, so it is
  // never subtracted here (that would invent a token figure).
  const net = metered.reduce((s, l) => s + l.saving, 0);
  return { sessionId, levers, net, fable_auto: false, mode };
}

/**
 * Sums ESTIMATED tokens from the events ledger into its own lane. Estimated is
 * NEVER folded into observed savings — this is the explicit separation.
 *
 * @param {Array<{lever?:string, estimated?:number}>} eventRows
 * @returns {{ estimatedTokens:number, byLever:Record<string,number>, label:string }}
 */
export function estimatedLane(eventRows = []) {
  const byLever = {};
  let estimatedTokens = 0;
  for (const row of eventRows) {
    const value = num(row?.estimated);
    if (value === 0) continue;
    const lever = leverOf(row) ?? 'unknown';
    byLever[lever] = (byLever[lever] ?? 0) + value;
    estimatedTokens += value;
  }
  return { estimatedTokens, byLever, label: 'estimated — NOT observed; never summed with savings (ADR-0082)' };
}

/** Renders the estimated lane as a clearly-labelled block (or a one-liner when empty). */
export function presentEstimatedLane(lane) {
  if (!lane || lane.estimatedTokens === 0) return 'Estimated lane: none (no estimated-token events recorded).';
  const rows = Object.entries(lane.byLever).map(([k, v]) => `  - ${k}: ~${v}`).join('\n');
  return `Estimated lane (${lane.label}):\n  total ≈ ${lane.estimatedTokens} estimated tokens\n${rows}`;
}

/** Renders the per-session audit line as a compact human block. */
export function presentSessionAudit(audit) {
  const retire = audit.levers.filter((l) => l.state === 'retire-to-advisory').map((l) => l.name);
  const tail = retire.length ? ` · retire→advisory: ${retire.join(', ')}` : '';
  return `Economy audit [${audit.mode}] session=${audit.sessionId ?? '—'}: net observed ${audit.net} tokens · fable_auto=${audit.fable_auto}${tail}`;
}

/**
 * Self-check: kill verdict fires on the zero-saving streak; estimated stays in
 * its own lane; net is observed-only.
 * @param {string} _root @returns {{name,pass,detail}[]}
 */
export function econCheckKillCriterion(_root) {
  const out = [];
  const savings = [{ lever: 'project-map', savedTokens: 600 }];
  const events = [
    ...Array.from({ length: 5 }, () => ({ lever: 'routing' })),
    { lever: 'project-map', estimated: 1200 },
  ];
  const metered = meterLevers(savings, events);
  const routing = metered.find((l) => l.name === 'routing');
  const projectMap = metered.find((l) => l.name === 'project-map');
  out.push({ name: 'kill-criterion: 5 fires + 0 saving → retire-to-advisory', pass: routing?.verdict === 'retire-to-advisory', detail: `routing verdict=${routing?.verdict}` });
  out.push({ name: 'kill-criterion: a saving lever is kept', pass: projectMap?.verdict === 'keep' && projectMap?.saving === 600, detail: `project-map saving=${projectMap?.saving}` });

  const lane = estimatedLane(events);
  out.push({ name: 'estimated lane: estimated tokens NOT in observed net', pass: lane.estimatedTokens === 1200, detail: `estimated=${lane.estimatedTokens}` });

  const audit = sessionAuditLine({ sessionId: 's1', savingsRows: savings, eventRows: events, mode: 'advisory' });
  out.push({ name: 'audit line: net is observed-only + fable_auto false', pass: audit.net === 600 && audit.fable_auto === false, detail: `net=${audit.net} fable_auto=${audit.fable_auto}` });
  return out;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('kill-criterion.mjs')) {
  const { readSavingsSync, savingsFile } = await import('./economy-savings.mjs');
  const { readEconomyEventsSync, economyEventsFile } = await import('./economy-events.mjs');
  const root = process.cwd();
  const savingsRows = readSavingsSync(savingsFile(root));
  const eventRows = readEconomyEventsSync(economyEventsFile(root));
  const audit = sessionAuditLine({ sessionId: process.env.CLAUDE_CODE_SESSION_ID ?? null, savingsRows, eventRows, mode: 'advisory' });
  process.stdout.write(`${presentSessionAudit(audit)}\n\n${presentEstimatedLane(estimatedLane(eventRows))}\n`);
}
