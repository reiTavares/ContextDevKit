/**
 * receipt-financial.mjs — Session Autonomy Receipt: FINANCIAL ACCOUNTING block.
 *
 * Assembles the receipt's financial block (spec §15, §16, §3.3, §3.4) over the
 * existing economics kernel (cost-engine + pricing-registry). It does NOT
 * introduce a parallel ledger — it NAMES and COMPOSES numbers the kernel already
 * produces, applying the receipt's honesty rules on top.
 *
 * Honesty invariants enforced here (spec §15/§16/§26):
 *  - SUBSCRIPTION (and `unknown`) mode → the block stays ALL NULL with costStatus
 *    'unavailable'. API prices are NOT a subscription-value proxy: a subscription
 *    seat is a flat fee, so "savings" against an API list price are fiction (#14,
 *    #15). We refuse to compute, never invent.
 *  - API / HYBRID → compute observed cost via the cost-source PRIORITY LADDER
 *    (spec §16): provider actual > official-snapshot estimate > user-supplied >
 *    unavailable. When BOTH a provider-actual and a snapshot-estimate exist we
 *    PRESERVE both (`actualCost` + `estimatedCost`); `observedCost` picks the
 *    actual (#22).
 *  - ALL overhead is in the total: compile, routing, validation, retries,
 *    escalation, fallback, aux models (#6, #7). Failed / retried work stays in
 *    the cost (#8) — `costPerAcceptedTask` divides the FULL cost by accepted
 *    tasks, never a "successful-calls-only" cost.
 *  - HYBRID covers the API portion only; we never present a partial API cost as
 *    the session total (spec §26). The caller scopes `executors` /
 *    `observedTokensByModel` to the API-billed slice before calling.
 *  - Unknown numbers are `null`, never `0` (#19). A non-usable price contributes
 *    nothing usable → the summed estimate is `null`, not `0`.
 *
 * Deterministic + zero-dep: no Date.now()/Math.random()/new Date; node:* or
 * relative imports only. Returned blocks are frozen.
 */

import {
  financialSavings,
  financialSavingsPercent,
  costEfficiencyMultiplier,
  costPerAcceptedTask,
} from './receipt-metrics.mjs';
import { emptyFinancialBlock, COST_STATUSES } from './receipt-schema.mjs';
import { actualCost } from '../cost-engine.mjs';
import { priceFor, isPriceUsable } from '../pricing/pricing-registry.mjs';

/** Modes whose financial block is intentionally all-null (no API billing). */
const NON_BILLED_MODES = new Set(['subscription', 'unknown']);

/** costSource labels, paired to a COST_STATUSES value by the priority ladder. */
const COST_SOURCES = Object.freeze({
  PROVIDER: 'provider-response',
  SNAPSHOT: 'pricing-snapshot',
  USER: 'user-supplied',
});

/** Returns true for a finite, non-negative number (rejects NaN/Infinity/null). */
function isUsableUsd(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Normalises a single executor's token buckets to the cost-engine shape.
 * Missing categories default to 0 tokens (a zero-token category costs $0 — that
 * is a true measured absence, distinct from an unknown PRICE which yields null).
 * @param {object} executor - May carry a `buckets` object or flat token fields.
 * @returns {{freshInput:number, output:number, cacheRead:number, cacheWrite:number, reasoning:number}}
 */
function bucketsOf(executor) {
  const raw = executor?.buckets ?? executor ?? {};
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    freshInput: num(raw.freshInput),
    output: num(raw.output),
    cacheRead: num(raw.cacheRead),
    cacheWrite: num(raw.cacheWrite),
    reasoning: num(raw.reasoning),
  };
}

/**
 * Sums the estimated USD across a list of executors using the offline pricing
 * registry. Each executor is one unit of billed work — a model call, a retry, a
 * routing/validation/escalation/fallback step (#6, #7). DETERMINISTIC executors
 * (no `model`, or `kind:'deterministic'`/`script`) contribute 0: they ran with
 * no model spend, which is a true zero, not an unknown.
 *
 * Refuse-by-default (constitution §8, #19): if NO executor yields a usable
 * dollar figure (registry absent, every model unpriced/inferred), the result is
 * `null` — never `0`. A `0` would falsely claim "we measured it and it was free".
 *
 * @param {Array<object>} executors - Billed work units, each with optional
 *   `model`/`modelId`, `kind`, and token `buckets`.
 * @param {object|null} pricingRegistry - Loaded registry (loadRegistry()), or null.
 * @returns {number|null} Summed estimated USD, or null when nothing is priceable.
 */
export function costFromExecutors(executors, pricingRegistry) {
  if (!Array.isArray(executors) || executors.length === 0) return null;

  let total = 0;
  let sawUsable = false;

  for (const executor of executors) {
    const kind = executor?.kind;
    const modelId = executor?.model ?? executor?.modelId ?? null;
    const isDeterministic = kind === 'deterministic' || kind === 'script' || !modelId;

    if (isDeterministic) {
      // True zero spend — does not, by itself, make the total "usable".
      continue;
    }

    const entry = pricingRegistry ? priceFor(pricingRegistry, modelId) : null;
    if (!entry || !isPriceUsable(entry)) {
      // Unknown price → cannot price this executor. Skip without faking $0.
      continue;
    }

    const costResult = actualCost(bucketsOf(executor), entry);
    if (isUsableUsd(costResult.usd)) {
      total += costResult.usd;
      sawUsable = true;
    }
  }

  return sawUsable ? total : null;
}

/**
 * Resolves the observed cost via the cost-source PRIORITY LADDER (spec §16):
 *   1. provider actual   → status 'actual',        source 'provider-response'
 *   2. snapshot estimate → status 'estimated',     source 'pricing-snapshot'
 *   3. user-supplied     → status 'user-supplied', source 'user-supplied'
 *   4. none usable       → status 'unavailable',   source null, usd null
 *
 * Actual ALWAYS beats estimate (#22). A `0` provider figure is a valid actual
 * (a genuinely free turn); only a non-number / negative / null is "absent".
 *
 * @param {{actualProviderCost?:number|null, snapshotCost?:number|null, userSuppliedCost?:number|null}} sources
 * @returns {{usd:number|null, status:string, source:string|null}} status ∈ COST_STATUSES.
 */
export function resolveObservedCost({ actualProviderCost, snapshotCost, userSuppliedCost } = {}) {
  if (isUsableUsd(actualProviderCost)) {
    return { usd: actualProviderCost, status: 'actual', source: COST_SOURCES.PROVIDER };
  }
  if (isUsableUsd(snapshotCost)) {
    return { usd: snapshotCost, status: 'estimated', source: COST_SOURCES.SNAPSHOT };
  }
  if (isUsableUsd(userSuppliedCost)) {
    return { usd: userSuppliedCost, status: 'user-supplied', source: COST_SOURCES.USER };
  }
  return { usd: null, status: 'unavailable', source: null };
}

/**
 * Builds the frozen financial block for a Session Autonomy Receipt.
 *
 * Per mode:
 *  - subscription / unknown → returns a FROZEN copy of emptyFinancialBlock()
 *    verbatim (all null, costStatus 'unavailable', costSource null). NO
 *    computation, NO invented savings (#14, #15).
 *  - api / hybrid → computes the snapshot estimate from `executors` (or accepts
 *    a pre-resolved snapshot via opts), resolves observedCost through the
 *    priority ladder, PRESERVES actualCost and estimatedCost separately, and
 *    fills the derived savings/efficiency/unit-cost metrics when a baseline is
 *    present. For hybrid, the caller MUST pre-scope inputs to the API slice
 *    (spec §26) — this function never widens them to the session total.
 *
 * @param {object} params
 * @param {string} params.mode - One of CONSUMPTION_MODES.
 * @param {Array<object>} [params.executors] - Billed work units (#6, #7) for the
 *   snapshot estimate. Includes retries/escalation/fallback/aux (#8).
 * @param {object} [params.observedTokensByModel] - Reserved for callers that
 *   pass aggregate token-by-model instead of executors (currently informational).
 * @param {number} [params.acceptedTasks] - Accepted-task count for unit economics.
 * @param {number|null} [params.baselineCost] - Estimated kit-free baseline USD.
 * @param {object|null} [params.pricingRegistry] - Loaded pricing registry.
 * @param {number|null} [params.actualProviderCost] - Provider-reported USD (highest priority).
 * @param {number|null} [params.userSuppliedCost] - User-supplied USD (lowest non-null tier).
 * @param {string|null} [params.pricingSnapshotId] - Id of the price snapshot used.
 * @returns {Readonly<object>} Frozen block matching emptyFinancialBlock() shape.
 */
export function buildFinancialBlock(params = {}) {
  const {
    mode,
    executors,
    acceptedTasks,
    baselineCost = null,
    pricingRegistry = null,
    actualProviderCost = null,
    userSuppliedCost = null,
    pricingSnapshotId = null,
  } = params;

  // Subscription / unknown / unrecognised → all-null, refuse to invent (#14).
  if (!mode || NON_BILLED_MODES.has(mode) || (mode !== 'api' && mode !== 'hybrid')) {
    return Object.freeze(emptyFinancialBlock());
  }

  // Snapshot estimate: prefer a caller-supplied snapshotCost, else derive from
  // executors against the offline registry. Either way it is an ESTIMATE.
  const snapshotCost = isUsableUsd(params.snapshotCost)
    ? params.snapshotCost
    : costFromExecutors(executors, pricingRegistry);

  const resolved = resolveObservedCost({
    actualProviderCost,
    snapshotCost,
    userSuppliedCost,
  });

  // Preserve BOTH lenses (#22): the provider-actual figure and the snapshot
  // estimate are recorded independently, regardless of which one `observedCost`
  // ended up selecting.
  const actualUsd = isUsableUsd(actualProviderCost) ? actualProviderCost : null;
  const estimatedUsd = isUsableUsd(snapshotCost) ? snapshotCost : null;
  const observedUsd = resolved.usd;

  const baseline = isUsableUsd(baselineCost) ? baselineCost : null;
  const hasBaseline = baseline !== null && observedUsd !== null;

  const block = {
    ...emptyFinancialBlock(),
    currency: 'USD',
    actualCost: actualUsd,
    estimatedCost: estimatedUsd,
    observedCost: observedUsd,
    estimatedBaselineCost: baseline,
    estimatedSavings: hasBaseline ? financialSavings(baseline, observedUsd) : null,
    estimatedSavingsPercent: hasBaseline ? financialSavingsPercent(baseline, observedUsd) : null,
    costEfficiencyMultiplier: hasBaseline ? costEfficiencyMultiplier(baseline, observedUsd) : null,
    // Full cost incl. failures/retries (#8) divided by ACCEPTED tasks.
    costPerAcceptedTask: observedUsd !== null
      ? costPerAcceptedTask(observedUsd, acceptedTasks)
      : null,
    costStatus: COST_STATUSES.includes(resolved.status) ? resolved.status : 'unavailable',
    costSource: resolved.source,
    pricingSnapshotId: pricingSnapshotId ?? null,
  };

  return Object.freeze(block);
}
