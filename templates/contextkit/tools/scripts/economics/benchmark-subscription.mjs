/**
 * Subscription-mode benchmark — EACP / card #254 (EACP-19), ADR-0104.
 *
 * A benchmark variant for SUBSCRIPTION hosts (e.g. Claude Code Max), where there
 * is no per-task USD bill. Instead of denominating the Autonomy Multiplier by
 * estimated API dollars (the #242/#243 path, which still needs metered/API spend),
 * this path denominates by an OBSERVABLE usage unit so an A-vs-C pilot can run
 * entirely through the subscription CLI with no API key and no metered spend:
 *
 *   1. effective-MTok (PRIMARY) — total tokens consumed (input+output+cache),
 *      read straight from the transcripts the kit already parses. Deterministic,
 *      zero manual steps. On a subscription window cache-reads STILL consume the
 *      rate-limit budget (unlike USD, where they are discounted), so they ARE
 *      counted here — that is the honest difference from the USD cost engine.
 *   2. quota-pct delta (CORROBORATION) — optional, from a pair of manual quota
 *      snapshots (before/after). Closer to "plan pain" but needs a manual reading.
 *
 * Honesty (ADR-0080 / ADR-0104):
 *   - `claim` is ALWAYS null. A real observed ratio is fine; a *claim* is not,
 *     until a powered run + human elevation (same gate as #243).
 *   - `baselineMeasured` is ALWAYS false pre-benchmark.
 *   - effective-MTok is a SUBSTITUTE unit → confidence never better than 'inferred'.
 *   - A single-session feasibility run sets `pilotSmoke: true`; it cannot satisfy
 *     arm isolation / independence / blinding and must NEVER back a causal claim.
 *   - Missing/invalid signals → skipped(); a result never half-forms (constitution §8).
 * DETERMINISTIC: no Date.now() / Math.random() / new Date(). Zero runtime deps.
 */

import { skipped } from './privacy.mjs';
import { autonomyMultiplier, countUseful, AUTONOMY_TARGETS } from './autonomy-multiplier.mjs';
import { CONTROLS_HELD_EQUAL } from './benchmark-design.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for subscription-pilot result objects. */
export const SUBSCRIPTION_SCHEMA_VERSION = 'eacp-benchmark-subscription/1';

/**
 * Denominator units in priority order. Index 0 ('effective-mtok') is PRIMARY.
 * Both are substitutes for true quota → confidence is never better than 'inferred'.
 * @type {Readonly<string[]>}
 */
export const SUBSCRIPTION_UNITS = Object.freeze(['effective-mtok', 'quota-pct']);

const SUBSCRIPTION_NOTE =
  'Subscription multiplier denominated by an observable usage unit (effective-MTok ' +
  'primary; quota-% optional). Observed ratio is real but UNBENCHMARKED: claim is ' +
  'null until a powered, arm-isolated, independently-evaluated run is elevated by a ' +
  'human (ADR-0080/0104). A single-session smoke cannot isolate arm A from a ' +
  'kit-loaded host — treat pilotSmoke results as plumbing validation, not evidence.';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Finite number > 0 → value; else null. */
function pos(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value > 0) ? value : null;
}

/** Finite number in [0,100] → value; else null. */
function pct(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) ? value : null;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Computes effective tokens (in MTok) consumed by an arm from its token classes.
 *
 * effective-MTok = (input + output + cacheCreate + cacheRead × cacheReadWeight) / 1e6
 *
 * `cacheReadWeight` defaults to 1.0: on a subscription rate-limit window every
 * token class — including cache reads — consumes the window, so none is free.
 * Callers may lower the weight to model a discount, but never below 0.
 *
 * @param {{ input?: number, output?: number, cacheRead?: number, cacheCreate?: number }} tokens
 * @param {{ cacheReadWeight?: number }} [opts]
 * @returns {number|null} effective MTok (> 0), or null when no positive token total.
 */
export function effectiveMtok(tokens, opts = {}) {
  if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : 0;
  const rawWeight = opts?.cacheReadWeight;
  const weight = (typeof rawWeight === 'number' && Number.isFinite(rawWeight) && rawWeight >= 0) ? rawWeight : 1.0;
  const total = num(tokens.input) + num(tokens.output) + num(tokens.cacheCreate) + num(tokens.cacheRead) * weight;
  return total > 0 ? total / 1e6 : null;
}

/**
 * Computes consumed quota percentage between two snapshot records (before→after).
 *
 * Prefers remainingPct (before.remainingPct − after.remainingPct); falls back to
 * usedPct (after.usedPct − before.usedPct). A non-positive or uncomputable delta
 * → skipped(). Confidence is 'inferred' (manual quota readings are never direct).
 *
 * @param {{ remainingPct?: number, usedPct?: number }} before
 * @param {{ remainingPct?: number, usedPct?: number }} after
 * @returns {Readonly<{ consumedPct: number, confidence: string, method: string }>
 *   |Readonly<{status:'skipped',reason:string}>}
 */
export function quotaDelta(before, after) {
  if (before === null || typeof before !== 'object' || after === null || typeof after !== 'object') {
    return skipped('quotaDelta: before/after must both be objects');
  }
  const rBefore = pct(before.remainingPct), rAfter = pct(after.remainingPct);
  if (rBefore !== null && rAfter !== null) {
    const consumedPct = rBefore - rAfter;
    return pos(consumedPct) !== null
      ? Object.freeze({ consumedPct, confidence: 'inferred', method: 'remaining-delta' })
      : skipped('quotaDelta: remaining-delta not positive (no consumption observed)');
  }
  const uBefore = pct(before.usedPct), uAfter = pct(after.usedPct);
  if (uBefore !== null && uAfter !== null) {
    const consumedPct = uAfter - uBefore;
    return pos(consumedPct) !== null
      ? Object.freeze({ consumedPct, confidence: 'inferred', method: 'used-delta' })
      : skipped('quotaDelta: used-delta not positive (no consumption observed)');
  }
  return skipped('quotaDelta: insufficient pct fields on before/after');
}

/**
 * Reduces one arm observation to its rate inputs: QA-green count and denominator
 * units. Prefers effective-MTok (from `effectiveMtok` or pre-computed
 * `effectiveMtok` number); falls back to `quotaDeltaPct`. Returns skipped() when
 * neither a positive token total nor a positive quota delta is available.
 *
 * @param {{ tasks?: object[], tokens?: object, effectiveMtok?: number,
 *   quotaDeltaPct?: number }} arm
 * @param {{ cacheReadWeight?: number }} [opts]
 * @returns {Readonly<{ qaGreen: number, total: number, units: number, unit: string }>
 *   |Readonly<{status:'skipped',reason:string}>}
 */
export function armRate(arm, opts = {}) {
  if (arm === null || typeof arm !== 'object' || Array.isArray(arm)) {
    return skipped('armRate: arm must be an object');
  }
  const useful = countUseful(Array.isArray(arm.tasks) ? arm.tasks : []);

  const mtok = pos(arm.effectiveMtok) ?? effectiveMtok(arm.tokens, opts);
  if (pos(mtok) !== null) {
    return Object.freeze({ qaGreen: useful.greenCount, total: useful.total, units: mtok, unit: 'effective-mtok' });
  }
  const qDelta = pos(arm.quotaDeltaPct);
  if (qDelta !== null) {
    return Object.freeze({ qaGreen: useful.greenCount, total: useful.total, units: qDelta, unit: 'quota-pct' });
  }
  return skipped('armRate: no positive effective-MTok or quota-pct denominator');
}

/**
 * Runs a subscription-mode A-vs-C pilot: computes the Autonomy Multiplier
 * denominated by an observable usage unit. Both arms must reduce to the SAME unit
 * (no denominator-shopping — ADR-0080 panel M3); a unit mismatch → skipped().
 *
 * `claim` is ALWAYS null; `baselineMeasured` ALWAYS false. `pilotSmoke` (default
 * false) marks a single-session feasibility run that cannot isolate arm A.
 *
 * @param {object} armA - pure-host arm observation (see armRate).
 * @param {object} armC - ContextDevKit arm observation (see armRate).
 * @param {{ host?: string, cacheReadWeight?: number, pilotSmoke?: boolean,
 *   evidenceIds?: string[] }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function subscriptionPilot(armA, armC, opts = {}) {
  const rateA = armRate(armA, opts);
  if (rateA.status === 'skipped') return skipped('armA: ' + rateA.reason);
  const rateC = armRate(armC, opts);
  if (rateC.status === 'skipped') return skipped('armC: ' + rateC.reason);
  if (rateA.unit !== rateC.unit) {
    return skipped(`unit mismatch: armA "${rateA.unit}" vs armC "${rateC.unit}" (no denominator-shopping)`);
  }

  const unit = rateA.unit;
  const pilotSmoke = opts?.pilotSmoke === true;
  const reasonUnavailable = pilotSmoke
    ? 'single-session smoke: arm A not isolated from kit-loaded host; not powered'
    : 'baseline not yet powered/elevated (ADR-0104 gate)';

  const mult = autonomyMultiplier(
    { qaGreen: rateC.qaGreen, units: rateC.units },
    { qaGreen: rateA.qaGreen, units: rateA.units },
    { unit, evidenceIds: opts?.evidenceIds, reasonUnavailable },
  );
  if (mult.status === 'skipped') return skipped('multiplier: ' + mult.reason);

  return Object.freeze({
    schemaVersion: SUBSCRIPTION_SCHEMA_VERSION,
    host: (typeof opts?.host === 'string' && opts.host.trim()) ? opts.host.trim() : null,
    unit,
    pilotSmoke,
    armA: Object.freeze({ qaGreen: rateA.qaGreen, total: rateA.total, units: rateA.units }),
    armC: Object.freeze({ qaGreen: rateC.qaGreen, total: rateC.total, units: rateC.units }),
    multiplier: mult,
    targets: AUTONOMY_TARGETS,
    controlsHeldEqual: CONTROLS_HELD_EQUAL,
    baselineMeasured: false,
    claim: null,
    note: SUBSCRIPTION_NOTE,
  });
}

/**
 * Renders a subscription-pilot result as a plain advisory string (no trailing
 * newline). Handles null and skipped markers honestly.
 *
 * @param {ReturnType<typeof subscriptionPilot>|null|undefined} result
 * @returns {string}
 */
export function presentSubscription(result) {
  if (result == null) return 'Subscription pilot: skipped (no data)';
  if (result.status === 'skipped') return 'Subscription pilot: skipped (' + result.reason + ')';

  const m = result.multiplier;
  const lines = ['Subscription Autonomy Multiplier (advisory' + (result.pilotSmoke ? ', SMOKE' : '') + '):'];
  lines.push(
    '  ratio: ' + m.multiplier.toFixed(4) + '\xD7 (' + (m.multiplier * 100).toFixed(1) + '%)' +
    ' | unit: ' + result.unit + ' | confidence: ' + m.confidence,
  );
  lines.push('  arm A (host):  ' + result.armA.qaGreen + '/' + result.armA.total +
    ' QA-green over ' + result.armA.units + ' ' + result.unit);
  lines.push('  arm C (kit):   ' + result.armC.qaGreen + '/' + result.armC.total +
    ' QA-green over ' + result.armC.units + ' ' + result.unit);
  lines.push('  targets: pilot 1.30\xD7 \xB7 product 1.50\xD7 \xB7 potential 1.70\xD7 (targets, not measured claims)');
  lines.push('  claim: null (unbenchmarked — observed ratio is not a causal claim).');
  if (result.pilotSmoke) {
    lines.push('  ⚠ SMOKE: arm A not isolated from a kit-loaded host; plumbing validation only.');
  }
  return lines.join('\n');
}
