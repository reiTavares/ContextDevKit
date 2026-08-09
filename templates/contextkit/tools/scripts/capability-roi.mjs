#!/usr/bin/env node
/**
 * capability-roi — ROI (cost) per capability, 6th attribution lens (CDK-066).
 *
 * WHY this lens exists: EACP's attribution-lenses.mjs slices usage by
 * agent / model / phase / skill but has no concept of CAPABILITY. Capabilities
 * are THIS program's asset (Canonical Capability Registry, CDK-020). Joining
 * events to capabilities via their `aliases.claude` field lets operators ask
 * "how much did /state cost this week?" across all models used.
 *
 * Design decisions:
 *   - THIN CONSUMER: no new cost math, zero writes under economics/. All money
 *     logic delegates to cost-engine.mjs and pricing-registry.mjs (ADR-0079).
 *   - REFUSE-BY-DEFAULT (constitution §8): skipped / usd null, never $0.
 *   - DETERMINISTIC: no Date.now() / Math.random(). Outputs sorted by id.
 *   - Confidence always 'derived': skill→capability join is computed, not
 *     directly observed from the host (mirrors exclusiveBySkill rationale).
 *   - Split: pure fold lens lives in capability-roi-core.mjs (SRP seam between
 *     token aggregation and priced ROI computation; see core file header).
 *
 * Zero runtime dependencies — node:* and relative imports only.
 */

import {
  loadRegistry as loadPricingRegistry,
  priceFor,
  isPriceUsable,
} from './economics/pricing/pricing-registry.mjs';
import { actualCost, COST_SCHEMA_VERSION } from './economics/cost-engine.mjs';
import { skipped } from './economics/privacy.mjs';
import {
  loadRegistry as loadCapabilityRegistry,
  DEFAULT_REGISTRY as DEFAULT_CAPABILITY_REGISTRY,
} from '../../runtime/capabilities/resolve-capabilities.mjs';
import {
  CAPABILITY_ROI_SCHEMA_VERSION,
  UNATTRIBUTED_KEY,
  byCapability,
} from './capability-roi-core.mjs';

// Re-export the schema version and lens so callers need only one import.
export { CAPABILITY_ROI_SCHEMA_VERSION, byCapability };

// ---------------------------------------------------------------------------
// ROI summary: capabilityRoi
// ---------------------------------------------------------------------------

/**
 * Prices each capability group via the pricing registry → ROI per capability.
 *
 * Guards (constitution §8 refuse-by-default):
 *   - pricingRegistry null → skipped().
 *   - events not a non-empty array → skipped().
 *
 * For each capability (excluding 'unattributed'), iterates its byModel
 * sub-buckets, prices each via priceFor + actualCost, sums priced USD (null
 * until the first priced model), counts unpriced models. 'unattributed' USD
 * is surfaced as a top-level `unattributedUsd` field. perCapability excludes
 * 'unattributed'. Overall confidence is 'derived' when ≥1 model was priced,
 * 'unknown' otherwise.
 *
 * @param {object[]} events - Normalized UsageEvent array.
 * @param {{ capabilityRegistry?: object, pricingRegistry?: object|null }} [opts]
 *   defaults: capabilityRegistry = loadCapabilityRegistry() (falls back to
 *   DEFAULT_CAPABILITY_REGISTRY on I/O error), pricingRegistry = loadPricingRegistry().
 * @returns {{ schemaVersion: string, costSchemaVersion: string, currency: string,
 *   confidence: string,
 *   perCapability: Array<{ id: string, actualUsd: number|null, turns: number,
 *     confidence: string, unpricedModels: number }>,
 *   unattributedUsd: number|null,
 *   totals: { actualUsd: number|null } }
 *   | Readonly<{ status: 'skipped', reason: string }>}
 */
export function capabilityRoi(events, opts = {}) {
  const pricingRegistry = Object.prototype.hasOwnProperty.call(opts, 'pricingRegistry')
    ? opts.pricingRegistry
    : loadPricingRegistry();

  if (!pricingRegistry) {
    return skipped('pricing registry not installed — capability ROI unavailable');
  }

  if (!Array.isArray(events) || events.length === 0) {
    return skipped('no usage events — capability ROI unavailable');
  }

  const capabilityRegistry = opts.capabilityRegistry
    ?? (() => { try { return loadCapabilityRegistry(); } catch { return DEFAULT_CAPABILITY_REGISTRY; } })();

  const { byCapability: groups } = byCapability(events, capabilityRegistry);

  let totalUsd = null;
  let anyPriced = false;

  /** @type {Array<{ id: string, actualUsd: number|null, turns: number, confidence: string, unpricedModels: number }>} */
  const perCapability = [];

  const capabilityIds = Object.keys(groups)
    .filter(k => k !== UNATTRIBUTED_KEY)
    .sort((a, b) => a.localeCompare(b));

  for (const capId of capabilityIds) {
    const group = groups[capId];
    let capUsd = null;
    let unpricedModels = 0;

    for (const [modelKey, modelBuckets] of Object.entries(group.byModel)) {
      const entry = priceFor(pricingRegistry, modelKey);
      if (!entry || !isPriceUsable(entry)) { unpricedModels += 1; continue; }
      const result = actualCost(modelBuckets, entry);
      if (result.usd !== null) { capUsd = (capUsd ?? 0) + result.usd; anyPriced = true; }
      else { unpricedModels += 1; }
    }

    perCapability.push({
      id: capId,
      actualUsd: capUsd,
      turns: Object.keys(group.byModel).length,
      confidence: 'derived',
      unpricedModels,
    });

    if (capUsd !== null) totalUsd = (totalUsd ?? 0) + capUsd;
  }

  let unattributedUsd = null;
  if (groups[UNATTRIBUTED_KEY]) {
    for (const [modelKey, modelBuckets] of Object.entries(groups[UNATTRIBUTED_KEY].byModel)) {
      const entry = priceFor(pricingRegistry, modelKey);
      if (!entry || !isPriceUsable(entry)) continue;
      const result = actualCost(modelBuckets, entry);
      if (result.usd !== null) {
        unattributedUsd = (unattributedUsd ?? 0) + result.usd;
        anyPriced = true;
      }
    }
    if (unattributedUsd !== null) totalUsd = (totalUsd ?? 0) + unattributedUsd;
  }

  return {
    schemaVersion: CAPABILITY_ROI_SCHEMA_VERSION,
    costSchemaVersion: COST_SCHEMA_VERSION,
    currency: 'USD',
    confidence: anyPriced ? 'derived' : 'unknown',
    perCapability,
    unattributedUsd,
    totals: { actualUsd: totalUsd },
  };
}

// ---------------------------------------------------------------------------
// Presenter: presentRoi
// ---------------------------------------------------------------------------

/**
 * Human-readable multi-line table of capability ROI results.
 * Handles the skipped() marker gracefully. Sorts perCapability by id ASC
 * (the array is already sorted from capabilityRoi; re-sorted defensively).
 *
 * @param {ReturnType<typeof capabilityRoi>} summary - Output of capabilityRoi().
 * @returns {string} Formatted text table.
 */
export function presentRoi(summary) {
  if (!summary || summary.status === 'skipped') {
    return `capability ROI: skipped — ${summary?.reason ?? 'unknown reason'}`;
  }

  const lines = [
    `Capability ROI  (schema: ${summary.schemaVersion}  confidence: ${summary.confidence})`,
    `${'─'.repeat(72)}`,
    `${'Capability'.padEnd(28)} ${'USD'.padStart(12)}  ${'Models'.padStart(8)}  ${'Unpriced'.padStart(8)}`,
    `${'─'.repeat(72)}`,
  ];

  const sorted = [...(summary.perCapability ?? [])].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );

  for (const row of sorted) {
    const usdStr = row.actualUsd !== null ? `$${row.actualUsd.toFixed(6)}` : 'n/a';
    lines.push(
      `${String(row.id).padEnd(28)} ${usdStr.padStart(12)}  ${String(row.turns ?? 0).padStart(8)}  ${String(row.unpricedModels).padStart(8)}`,
    );
  }

  const unattribStr = summary.unattributedUsd !== null
    ? `$${summary.unattributedUsd.toFixed(6)}`
    : 'n/a';
  const totalStr = summary.totals?.actualUsd !== null && summary.totals?.actualUsd !== undefined
    ? `$${summary.totals.actualUsd.toFixed(6)}`
    : 'n/a';

  lines.push(`${'─'.repeat(72)}`);
  lines.push(`${'unattributed'.padEnd(28)} ${unattribStr.padStart(12)}`);
  lines.push(`${'─'.repeat(72)}`);
  lines.push(`${'TOTAL'.padEnd(28)} ${totalStr.padStart(12)}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Thin CLI (library-safe guard)
// ---------------------------------------------------------------------------

import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isMain = process.argv[1] &&
  pathResolve(process.argv[1]) === pathResolve(fileURLToPath(import.meta.url));

if (isMain) {
  const pricingReg = loadPricingRegistry();
  const demoEvents = [
    {
      attributionSkill: '/state',
      modelEffective: 'claude-sonnet-4-5',
      buckets: { freshInput: 1000, output: 500, cacheRead: 200, cacheWrite: 100, reasoning: 0 },
    },
  ];
  console.log(presentRoi(capabilityRoi(demoEvents, { pricingRegistry: pricingReg })));
}
