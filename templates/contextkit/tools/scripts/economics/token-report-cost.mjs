/**
 * token-report-cost — financial enrichment seam for token-report.mjs.
 * EACP-06 / ADR-0079 Wave 2, card #235.
 *
 * Responsibility: consume attribution.byModel from the token-report aggregator,
 * map each model bucket to UsageBuckets, price via the cost engine, and return
 * a structured financial summary that token-report.mjs adds additively to its
 * --json output. Kept as a separate module so token-report.mjs stays lean and
 * the financial layer is independently testable.
 *
 * Constitution §8 (refuse-by-default):
 *   - Registry absent → skipped() marker (never fabricated $0).
 *   - Unpriced model → usd null for that model; disclosed in unpricedModels.
 *   - billingMode === 'subscription': the USD figure is an estimated
 *     API-equivalent (not actually billed). billingModeNote communicates this
 *     to the consumer — never lead with USD as a billing statement.
 *
 * Zero runtime dependencies: node:* or relative imports only.
 */

import { loadRegistry, priceFor, isPriceUsable } from './pricing/pricing-registry.mjs';
import { actualCost, grossCacheValue, COST_SCHEMA_VERSION } from './cost-engine.mjs';
import { skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for the enriched token-report JSON output. */
export const REPORT_SCHEMA_VERSION = 'eacp-token-report/2';

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Maps a token-report byModel bucket to a UsageBuckets object expected by the
 * cost engine. The byModel bucket uses `cacheCreate` (creation tokens from the
 * transcript) which maps to `cacheWrite` in the cost engine's UsageBuckets.
 *
 * @param {{ input: number, output: number, cacheRead: number,
 *   cacheCreate: number, turns: number }} modelBucket - Bucket from attribution.byModel.
 * @returns {{ freshInput: number, output: number, cacheRead: number,
 *   cacheWrite: number, reasoning: number }} UsageBuckets for the cost engine.
 */
export function modelBucketsToUsage(modelBucket) {
  return {
    freshInput: modelBucket.input ?? 0,
    output: modelBucket.output ?? 0,
    cacheRead: modelBucket.cacheRead ?? 0,
    cacheWrite: modelBucket.cacheCreate ?? 0,
    reasoning: 0,
  };
}

// ---------------------------------------------------------------------------
// Internal aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Derives the overall confidence grade from a collection of per-model confidence
 * strings. Follows the spec: 'direct' only when every priced model is 'direct';
 * 'inferred' when at least one priced; 'unknown' when none priced.
 *
 * @param {number} pricedCount - Number of models with a usable price.
 * @param {boolean} allDirect - True only when every priced model had confidence 'direct'.
 * @returns {'direct'|'inferred'|'unknown'}
 */
function overallConfidence(pricedCount, allDirect) {
  if (pricedCount === 0) return 'unknown';
  return allDirect ? 'direct' : 'inferred';
}

// ---------------------------------------------------------------------------
// Core export
// ---------------------------------------------------------------------------

/**
 * Computes a structured financial summary over the token-report attribution.
 *
 * Steps:
 *   1. Load the pricing registry (or accept an injected one from opts.registry).
 *   2. If registry is absent, return a skipped() marker immediately.
 *   3. Price each model in attribution.byModel via actualCost + grossCacheValue.
 *   4. Aggregate totals, tracking unpriced models separately — never treat
 *      unpriced as $0.
 *   5. Return the structured summary object (see return type below).
 *
 * @param {{ byModel: Record<string, { input: number, output: number,
 *   cacheRead: number, cacheCreate: number, turns: number }> }} attribution
 *   - The attribution object produced by token-report.mjs's aggregate().
 * @param {{ registry?: object|null }} [opts]
 *   - Optional override: pass a pre-loaded registry (or null) to skip disk I/O.
 *     When opts.registry is undefined, loadRegistry() is called.
 * @returns {{ schemaVersion: string, costSchemaVersion: string, currency: string,
 *   billingModeNote: string, confidence: string,
 *   totals: { actualUsd: number|null, grossCacheValueUsd: number|null },
 *   unpricedModels: number,
 *   perModel: Array<{ model: string, turns: number, actualUsd: number|null,
 *     actualConfidence: string, grossCacheValueUsd: number|null }>,
 *   note?: string }
 *   | Readonly<{ status: 'skipped', reason: string }>}
 */
export function financialSummary(attribution, opts) {
  const registry = opts?.registry !== undefined ? opts.registry : loadRegistry();

  if (registry == null) {
    return skipped('pricing registry not installed — financial summary unavailable');
  }

  const byModel = attribution?.byModel ?? {};
  const perModel = [];

  let totalActualUsd = null;   // null until at least one priced model contributes
  let totalGrossUsd = null;    // null until at least one priced model contributes
  let unpricedModels = 0;
  let pricedCount = 0;
  let allDirect = true;        // innocent until proven otherwise

  for (const [modelId, bucket] of Object.entries(byModel)) {
    const usageBuckets = modelBucketsToUsage(bucket);
    const entry = priceFor(registry, modelId);
    const actualResult = actualCost(usageBuckets, entry);
    const grossResult = grossCacheValue(usageBuckets, entry);
    const priced = isPriceUsable(entry);

    if (priced && actualResult.usd !== null) {
      pricedCount += 1;
      if (entry.confidence !== 'direct') allDirect = false;
      totalActualUsd = (totalActualUsd ?? 0) + actualResult.usd;
      if (grossResult.usd !== null) {
        totalGrossUsd = (totalGrossUsd ?? 0) + grossResult.usd;
      }
    } else {
      unpricedModels += 1;
    }

    perModel.push({
      model: modelId,
      turns: bucket.turns ?? 0,
      actualUsd: actualResult.usd,
      actualConfidence: actualResult.confidence,
      grossCacheValueUsd: grossResult.usd,
    });
  }

  const confidence = overallConfidence(pricedCount, allDirect);

  /** @type {object} */
  const summary = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    costSchemaVersion: COST_SCHEMA_VERSION,
    currency: 'USD',
    billingModeNote:
      'Subscription hosts: marginal USD ~0 until quota wall; USD is estimated API-equivalent, not billed.',
    confidence,
    totals: {
      actualUsd: totalActualUsd,
      grossCacheValueUsd: totalGrossUsd,
    },
    unpricedModels,
    perModel,
  };

  if (unpricedModels > 0) {
    summary.note =
      'Some models have no verified price (rendered unknown, not $0).';
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Display helper
// ---------------------------------------------------------------------------

/**
 * Produces a short multi-line display string for the table (non-JSON) view of
 * the token report. Called by token-report.mjs after printAttribution().
 *
 * Respects the billingMode contract: when all observed models are subscription,
 * the USD figures are presented as estimated API-equivalents with an explicit
 * note — never as billing amounts. Numbers are formatted to 4 decimal places;
 * 'unknown' is shown when the value is null.
 *
 * @param {ReturnType<typeof financialSummary>} summary - Output of financialSummary().
 * @returns {string} Human-readable financial summary for console display.
 */
export function presentFinancial(summary) {
  if (summary?.status === 'skipped') {
    return `Financial summary: skipped (${summary.reason})`;
  }

  const fmt = (usd) => (usd === null ? 'unknown' : `$${usd.toFixed(4)}`);

  const actualLine =
    `Estimated cost (est. API-equivalent, not billed): ${fmt(summary.totals?.actualUsd)}`;
  const grossLine =
    `Gross cache value (provider feature, not kit savings): ${fmt(summary.totals?.grossCacheValueUsd)}`;
  const confLine = `Confidence: ${summary.confidence ?? 'unknown'}`;

  const unpricedCount = summary.unpricedModels ?? 0;
  const unpricedLine =
    unpricedCount > 0
      ? `  (${unpricedCount} model(s) unpriced → unknown)`
      : '';

  return [actualLine, grossLine, confLine, unpricedLine].filter(Boolean).join('\n');
}
