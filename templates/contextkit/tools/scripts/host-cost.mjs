#!/usr/bin/env node
/**
 * host-cost — per-host financial cost + cache advisory consumer. CDK-063.
 *
 * Projects per-HOST financial cost over an array of NORMALIZED multi-host
 * usage events (the output of telemetry/normalize). Adds the multi-host
 * (claude+codex) per-host view that EACP's token-report-cost cannot provide
 * because it only processes the claude-only token-report byModel output.
 *
 * This module is a thin advisory consumer — it does NO new cost math and makes
 * ZERO writes under economics/. All pricing logic lives in cost-engine.mjs and
 * pricing-registry.mjs.
 *
 * Constitution §8 (refuse-by-default):
 *   - Registry absent  → skipped() — never fabricate a dollar figure.
 *   - Empty events     → skipped() — no data to price.
 *   - Unpriced model   → usd null for that model/host; counted in unpricedModels.
 *   - billingMode 'subscription': leadWithUsd false; note warns consumer.
 *
 * DETERMINISTIC: no Date.now(), no Math.random().
 * Zero runtime dependencies beyond node:* and relative imports.
 */

import { pathToFileURL } from 'node:url';

import { loadRegistry, priceFor, isPriceUsable } from './economics/pricing/pricing-registry.mjs';
import { actualCost, grossCacheValue, COST_SCHEMA_VERSION } from './economics/cost-engine.mjs';
import { emptyBuckets, BUCKET_KEYS } from './economics/usage-buckets.mjs';
import { skipped } from './economics/privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for objects produced by hostCostSummary(). */
export const HOST_COST_SCHEMA_VERSION = 'cdk-host-cost/1';

// ---------------------------------------------------------------------------
// Internal aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Derives the overall confidence grade for a single host from per-model
 * pricing results. Mirrors token-report-cost.mjs overallConfidence.
 *
 * Rule: 'direct' only when ALL priced models are 'direct'; 'inferred' when at
 * least one is priced but not all 'direct'; 'unknown' when none is priced.
 *
 * @param {number} pricedCount - Models with a usable (non-null) price.
 * @param {boolean} allDirect - True only when every priced model had confidence 'direct'.
 * @returns {'direct'|'inferred'|'unknown'}
 */
function hostConfidence(pricedCount, allDirect) {
  if (pricedCount === 0) return 'unknown';
  return allDirect ? 'direct' : 'inferred';
}

/**
 * Folds the buckets of all events for a (host, modelEffective) pair into one
 * accumulated UsageBuckets object. Mutates accumulator in-place for performance.
 *
 * @param {{ [key: string]: number }} accumulator - Zeroed bucket from emptyBuckets().
 * @param {{ [key: string]: number }} eventBuckets - Buckets from one UsageEvent.
 * @returns {void}
 */
function foldBuckets(accumulator, eventBuckets) {
  for (const key of BUCKET_KEYS) {
    const value = eventBuckets[key];
    if (typeof value === 'number' && isFinite(value)) {
      accumulator[key] += value;
    }
  }
}

// ---------------------------------------------------------------------------
// Core export
// ---------------------------------------------------------------------------

/**
 * Prices normalized multi-host usage events, grouped by host (and by
 * modelEffective within each host).
 *
 * Algorithm:
 *   1. Resolve registry (injected or loaded from disk). Absent → skipped().
 *   2. Guard empty events array → skipped().
 *   3. Group events by host; within each host, fold buckets per modelEffective.
 *   4. For each (host, model) bucket: price via actualCost + grossCacheValue.
 *   5. Roll per-model results into per-host totals; roll host totals into overall.
 *   6. Return structured summary.
 *
 * @param {Array<{host: string, modelEffective: string,
 *   buckets: {freshInput: number, output: number, cacheRead: number,
 *   cacheWrite: number, reasoning: number}, confidence: string}>} events
 *   - Normalized usage events from telemetry/normalize output.
 * @param {{ registry?: object|null }} [opts]
 *   - Inject a pre-loaded pricing registry; when undefined, loadRegistry() is
 *     called. Pass null to force skipped() without disk I/O (useful in tests).
 * @returns {{ schemaVersion: string, costSchemaVersion: string, currency: string,
 *   billingModeNote: string, confidence: string,
 *   perHost: Array<{ host: string, actualUsd: number|null,
 *     grossCacheValueUsd: number|null, confidence: string,
 *     unpricedModels: number, turns?: number }>,
 *   totals: { actualUsd: number|null, grossCacheValueUsd: number|null },
 *   unpricedModels: number }
 *   | Readonly<{status: 'skipped', reason: string}>}
 */
export function hostCostSummary(events, opts) {
  const registry = opts?.registry !== undefined ? opts.registry : loadRegistry();

  if (registry == null) {
    return skipped('pricing registry not installed — host cost unavailable');
  }

  if (!Array.isArray(events) || events.length === 0) {
    return skipped('no telemetry events — host cost unavailable');
  }

  // -------------------------------------------------------------------------
  // Group events: hostMap[host][modelEffective] = accumulated UsageBuckets
  // -------------------------------------------------------------------------

  /** @type {Map<string, Map<string, {freshInput:number,output:number,cacheRead:number,cacheWrite:number,reasoning:number}>>} */
  const hostMap = new Map();

  for (const event of events) {
    const host = typeof event?.host === 'string' ? event.host : 'unknown';
    const model = typeof event?.modelEffective === 'string' ? event.modelEffective : 'unknown';

    if (!hostMap.has(host)) hostMap.set(host, new Map());
    const modelMap = hostMap.get(host);

    if (!modelMap.has(model)) modelMap.set(model, emptyBuckets());
    if (event?.buckets && typeof event.buckets === 'object') {
      foldBuckets(modelMap.get(model), event.buckets);
    }
  }

  // -------------------------------------------------------------------------
  // Price each (host, model) pair; accumulate per-host and overall totals
  // -------------------------------------------------------------------------

  const perHost = [];
  let overallActualUsd = null;
  let overallGrossUsd = null;
  let overallUnpricedModels = 0;
  let overallPricedCount = 0;
  let overallAllDirect = true;

  for (const [host, modelMap] of hostMap) {
    let hostActualUsd = null;
    let hostGrossUsd = null;
    let hostUnpriced = 0;
    let hostPricedCount = 0;
    let hostAllDirect = true;

    for (const [model, foldedBuckets] of modelMap) {
      const entry = priceFor(registry, model);
      const actualResult = actualCost(foldedBuckets, entry);
      const grossResult = grossCacheValue(foldedBuckets, entry);
      const priced = isPriceUsable(entry);

      if (priced && actualResult.usd !== null) {
        hostPricedCount += 1;
        if (entry.confidence !== 'direct') hostAllDirect = false;
        hostActualUsd = (hostActualUsd ?? 0) + actualResult.usd;
        if (grossResult.usd !== null) {
          hostGrossUsd = (hostGrossUsd ?? 0) + grossResult.usd;
        }
      } else {
        hostUnpriced += 1;
      }
    }

    // Roll host into overall
    overallUnpricedModels += hostUnpriced;
    if (hostPricedCount > 0) {
      overallPricedCount += hostPricedCount;
      if (!hostAllDirect) overallAllDirect = false;
      overallActualUsd = (overallActualUsd ?? 0) + (hostActualUsd ?? 0);
      if (hostGrossUsd !== null) {
        overallGrossUsd = (overallGrossUsd ?? 0) + hostGrossUsd;
      }
    }

    perHost.push({
      host,
      actualUsd: hostActualUsd,
      grossCacheValueUsd: hostGrossUsd,
      confidence: hostConfidence(hostPricedCount, hostAllDirect),
      unpricedModels: hostUnpriced,
    });
  }

  return {
    schemaVersion: HOST_COST_SCHEMA_VERSION,
    costSchemaVersion: COST_SCHEMA_VERSION,
    currency: 'USD',
    billingModeNote:
      'Subscription hosts: marginal USD ~0 until quota wall; USD is estimated API-equivalent, not billed.',
    confidence: hostConfidence(overallPricedCount, overallAllDirect),
    perHost,
    totals: {
      actualUsd: overallActualUsd,
      grossCacheValueUsd: overallGrossUsd,
    },
    unpricedModels: overallUnpricedModels,
  };
}

// ---------------------------------------------------------------------------
// Display helper
// ---------------------------------------------------------------------------

/**
 * Produces a multi-line human-readable table for the per-host cost summary.
 * Handles the skipped() marker gracefully.
 *
 * Format (non-JSON console output):
 *   Host cost summary (cdk-host-cost/1):
 *     claude-code   actual: $0.0012   gross cache: $0.0003   confidence: direct
 *     codex         actual: unknown   gross cache: unknown   confidence: unknown
 *   Totals: actual $0.0012 | gross cache $0.0003
 *   Overall confidence: direct | Unpriced models: 0
 *   <billingModeNote if any subscription host>
 *
 * @param {ReturnType<typeof hostCostSummary>} summary - Output of hostCostSummary().
 * @returns {string} Human-readable display string.
 */
export function presentHostCost(summary) {
  if (summary?.status === 'skipped') {
    return `Host cost summary: skipped (${summary.reason})`;
  }

  const fmt = (usd) => (usd === null ? 'unknown' : `$${usd.toFixed(4)}`);

  const header = `Host cost summary (${summary.schemaVersion}):`;

  const hostLines = (summary.perHost ?? []).map((row) => {
    const hostPad = row.host.padEnd(16);
    return (
      `  ${hostPad}` +
      `actual: ${fmt(row.actualUsd).padEnd(12)}` +
      `gross cache: ${fmt(row.grossCacheValueUsd).padEnd(12)}` +
      `confidence: ${row.confidence}` +
      (row.unpricedModels > 0 ? `  (${row.unpricedModels} unpriced)` : '')
    );
  });

  const totalsLine =
    `Totals: actual ${fmt(summary.totals?.actualUsd)} | ` +
    `gross cache ${fmt(summary.totals?.grossCacheValueUsd)}`;

  const confLine =
    `Overall confidence: ${summary.confidence ?? 'unknown'} | ` +
    `Unpriced models: ${summary.unpricedModels ?? 0}`;

  const noteLines = summary.billingModeNote
    ? [`Note: ${summary.billingModeNote}`]
    : [];

  return [header, ...hostLines, totalsLine, confLine, ...noteLines].join('\n');
}

// ---------------------------------------------------------------------------
// Thin CLI (library-safe guard)
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Smoke-check: run with an empty events list so the skipped() path is
  // exercised, then show the display string. No real registry required.
  const demo = hostCostSummary([], { registry: null });
  console.log(presentHostCost(demo));
  console.log('host-cost.mjs loaded OK.');
}
