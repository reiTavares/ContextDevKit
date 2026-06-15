/**
 * cost-engine — EACP-05 / ADR-0079 panel E2 cost formulas.
 *
 * All money math: usd = tokens / 1e6 * pricePerMtok (prices in USD per MTok).
 *
 * E2 DECISION — VARIANT (b) for noCacheCost (pinned by orchestrator):
 *   noCacheCost = (freshInput + cacheRead + cacheWrite) × input_price
 *               + output × output_price
 *               + reasoning × reasoning_price
 * Rationale: in a cache-free world cacheWrite tokens (first-turn prefix) AND
 * cacheRead tokens (re-sent prefix on later turns) would be billed as fresh
 * input. Variant (a) drops cacheWrite, producing a NEGATIVE gross-cache-value
 * on realistic inputs — which is nonsense. Variant (b) yields a correct,
 * positive gross-cache-value. Frozen; changes require a new ADR.
 *
 * Constitution §8 (refuse-by-default):
 *   - Missing or non-usable entry → {usd: null, confidence: 'unknown'}.
 *     Never $0, never a fabricated figure.
 *   - billingMode === 'subscription': leadWithUsd = false; USD is an estimated
 *     API-equivalent (not actually billed).
 *   - 'inferred'/'unknown' confidence: isPriceUsable → false → usd null.
 *
 * Zero runtime dependencies: node:* or relative imports only.
 */

import { isPriceUsable } from './pricing/pricing-registry.mjs';
import { skipped } from './privacy.mjs';
import { priceForTier, loadPolicy } from '../model-policy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for cost result objects produced by this engine. */
export const COST_SCHEMA_VERSION = 'eacp-cost/1';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Orders confidence levels from strongest to weakest.
 * Returns the weakest confidence among all provided tiers.
 *
 * Ordering (strongest → weakest): direct > derived > inferred > unknown.
 * Any unrecognised tier maps to 'unknown'.
 *
 * @param {...string} tiers - Confidence strings from cost result objects.
 * @returns {'direct'|'derived'|'inferred'|'unknown'}
 */
function lowestConfidence(...tiers) {
  const ORDER = { direct: 0, derived: 1, inferred: 2, unknown: 3 };
  let worst = 0;
  for (const tier of tiers) {
    const rank = ORDER[tier] ?? 3;
    if (rank > worst) worst = rank;
  }
  return Object.keys(ORDER)[worst];
}

/**
 * Builds the null / unknown cost result returned when an entry is absent or
 * its confidence is not usable (constitution §8).
 *
 * @param {object|null|undefined} entry - Registry entry (may be absent).
 * @returns {{ usd: null, confidence: 'unknown', currency: string,
 *   billingMode: string, leadWithUsd: false }}
 */
function unknownResult(entry) {
  return {
    usd: null,
    confidence: 'unknown',
    currency: 'USD',
    billingMode: entry?.billingMode ?? 'unknown',
    leadWithUsd: false,
  };
}

// ---------------------------------------------------------------------------
// Cost formulas
// ---------------------------------------------------------------------------

/**
 * Computes the actual billed cost for a UsageBuckets against a registry entry.
 *
 * Each bucket is priced at its own rate:
 *   freshInput  × entry.input
 *   output      × entry.output
 *   reasoning   × (entry.reasoning ?? entry.output)
 *   cacheRead   × entry.cacheRead
 *   cacheWrite  × entry.cacheWriteByTtl.ttl5m  (default)
 *              OR entry.cacheWriteByTtl.ttl1h   (when opts.cacheTtl === '1h')
 *
 * @param {{ freshInput: number, output: number, cacheRead: number,
 *   cacheWrite: number, reasoning: number }} buckets - Token counts per category.
 * @param {object|null|undefined} entry - Registry entry from priceFor().
 * @param {{ cacheTtl?: '5m'|'1h' }} [opts] - Optional overrides.
 * @returns {{ usd: number|null, confidence: string, currency: string,
 *   billingMode: string, leadWithUsd: boolean }}
 */
export function actualCost(buckets, entry, opts = {}) {
  if (!entry || !isPriceUsable(entry)) return unknownResult(entry);

  const cacheWritePrice = opts.cacheTtl === '1h'
    ? entry.cacheWriteByTtl.ttl1h
    : entry.cacheWriteByTtl.ttl5m;

  const usd =
    (buckets.freshInput / 1e6) * entry.input +
    (buckets.output     / 1e6) * entry.output +
    (buckets.reasoning  / 1e6) * (entry.reasoning ?? entry.output) +
    (buckets.cacheRead  / 1e6) * entry.cacheRead +
    (buckets.cacheWrite / 1e6) * cacheWritePrice;

  return {
    usd,
    confidence: entry.confidence,
    currency: entry.currency ?? 'USD',
    billingMode: entry.billingMode,
    leadWithUsd: entry.billingMode !== 'subscription',
  };
}

/**
 * Estimates the cost that would have been incurred WITHOUT prompt caching
 * (VARIANT b — see file header).
 *
 * All cached token categories (freshInput, cacheRead, cacheWrite) are billed
 * at the full input rate; output and reasoning keep their own rates.
 *
 * @param {{ freshInput: number, output: number, cacheRead: number,
 *   cacheWrite: number, reasoning: number }} buckets - Token counts per category.
 * @param {object|null|undefined} entry - Registry entry from priceFor().
 * @param {{ cacheTtl?: '5m'|'1h' }} [opts] - Reserved for future parity with actualCost.
 * @returns {{ usd: number|null, confidence: string, currency: string,
 *   billingMode: string, leadWithUsd: boolean }}
 */
export function noCacheCost(buckets, entry, opts = {}) {   // eslint-disable-line no-unused-vars
  if (!entry || !isPriceUsable(entry)) return unknownResult(entry);

  const usd =
    ((buckets.freshInput + buckets.cacheRead + buckets.cacheWrite) / 1e6) * entry.input +
    (buckets.output    / 1e6) * entry.output +
    (buckets.reasoning / 1e6) * (entry.reasoning ?? entry.output);

  return {
    usd,
    confidence: entry.confidence,
    currency: entry.currency ?? 'USD',
    billingMode: entry.billingMode,
    leadWithUsd: entry.billingMode !== 'subscription',
  };
}

/**
 * Computes the gross cache value: the difference between what would have been
 * spent without caching versus what was actually spent.
 *
 * IMPORTANT: this measures a provider feature (prompt cache), NOT a ContextDevKit
 * contribution. The label field makes this explicit to prevent mis-attribution.
 * A positive value means caching saved money; negative is impossible under
 * variant (b) with well-formed buckets.
 *
 * @param {{ freshInput: number, output: number, cacheRead: number,
 *   cacheWrite: number, reasoning: number }} buckets - Token counts per category.
 * @param {object|null|undefined} entry - Registry entry from priceFor().
 * @param {{ cacheTtl?: '5m'|'1h' }} [opts] - Forwarded to both cost functions.
 * @returns {{ usd: number|null, confidence: string, currency: string,
 *   label: string, leadWithUsd: boolean }}
 */
export function grossCacheValue(buckets, entry, opts = {}) {
  const noCache = noCacheCost(buckets, entry, opts);
  const actual  = actualCost(buckets, entry, opts);

  const usd = (noCache.usd !== null && actual.usd !== null)
    ? noCache.usd - actual.usd
    : null;

  return {
    usd,
    confidence: usd !== null ? actual.confidence : 'unknown',
    currency: actual.currency,
    label: 'gross cache value (provider feature, NOT kit contribution)',
    leadWithUsd: actual.leadWithUsd,
  };
}

/**
 * Computes the savings from routing a task to a cheaper model, provided that
 * the caller asserts the cheaper model produced equivalent quality output.
 *
 * The quality equivalence assertion is mandatory — routing savings are only
 * meaningful when the output quality is the same. If the caller cannot assert
 * equivalence, this function refuses (constitution §8: refuse-by-default).
 *
 * @param {{ usd: number|null, confidence: string }} baselineCost - Cost from actualCost() at the baseline model.
 * @param {{ usd: number|null, confidence: string }} routedCost - Cost from actualCost() at the routed model.
 * @param {boolean} qualityEquivalent - The caller MUST pass true to unlock the USD figure.
 * @returns {{ usd: number|null, confidence: string, qualityGated: boolean, note?: string }}
 */
export function routingSavings(baselineCost, routedCost, qualityEquivalent) {
  if (qualityEquivalent !== true) {
    return {
      usd: null,
      confidence: 'unknown',
      qualityGated: true,
      note: 'routing savings only valid at equivalent quality',
    };
  }

  if (baselineCost.usd === null || routedCost.usd === null) {
    return {
      usd: null,
      confidence: 'unknown',
      qualityGated: true,
    };
  }

  return {
    usd: baselineCost.usd - routedCost.usd,
    confidence: lowestConfidence(baselineCost.confidence, routedCost.confidence),
    qualityGated: true,
  };
}

/**
 * Computes cost per QA-green task — the unit-economics view for the task
 * compiler (WF0021) and FinOps attribution (WF0022).
 *
 * Returns usd null / confidence 'unknown' when the denominator is zero or the
 * attributable cost is unknown (constitution §8: skipped-not-passed).
 *
 * @param {number|null} attributableUsd - Total USD attributable to the set of tasks.
 * @param {number} qaGreenCount - Number of tasks that reached QA-green.
 * @returns {{ usd: number|null, confidence: 'derived'|'unknown' }}
 */
export function costPerQaGreenTask(attributableUsd, qaGreenCount) {
  if (qaGreenCount <= 0 || attributableUsd == null) {
    return { usd: null, confidence: 'unknown' };
  }
  return { usd: attributableUsd / qaGreenCount, confidence: 'derived' };
}

/**
 * Estimates cost for a task tier using the illustrative forge matrix price
 * (model-policy.mjs#priceForTier). Because the matrix is ILLUSTRATIVE (not
 * authoritative), any derived price uses confidence:'inferred', which causes
 * actualCost to gate to usd null / unknown — this is intentional and honest.
 *
 * Degrades gracefully:
 *   - Matrix absent (L<4) → returns skipped() marker.
 *   - Tier not found in matrix → returns skipped() marker.
 *   - Matrix present but price is illustrative → returns {usd:null, confidence:'unknown'}.
 *
 * @param {string} tier - Demand tier (e.g. 'powerful', 'fast', 'reasoning').
 * @param {{ freshInput: number, output: number, cacheRead: number,
 *   cacheWrite: number, reasoning: number }} buckets - Token counts per category.
 * @param {{ policy?: object }} [opts] - Optional pre-loaded routing policy.
 * @returns {Promise<object>} Cost result or skipped() marker.
 */
export async function projectTierCost(tier, buckets, opts = {}) {
  const policy = opts.policy ?? loadPolicy();
  const matrixPrice = await priceForTier(tier, policy);

  if (!matrixPrice) return skipped('no matrix price for tier ' + tier);

  // Build a synthetic registry entry from the matrix price.
  // Confidence is forced to 'inferred' because the forge matrix is illustrative
  // (not an authoritative price source). isPriceUsable('inferred') → false, so
  // actualCost correctly returns usd null / unknown, keeping the result honest.
  const syntheticEntry = {
    input:   matrixPrice.input,
    output:  matrixPrice.output,
    reasoning: matrixPrice.output,           // matrix does not expose reasoning price
    cacheRead:          matrixPrice.input * 0.1,
    cacheWriteByTtl: {
      ttl5m: matrixPrice.input * 1.25,
      ttl1h: matrixPrice.input * 2,
    },
    billingMode: 'api',
    currency: 'USD',
    confidence: 'inferred',                  // forces usd null — matrix is illustrative
  };

  const result = actualCost(buckets, syntheticEntry, opts);
  return {
    ...result,
    note: 'matrix-derived (illustrative) — not authoritative',
  };
}
