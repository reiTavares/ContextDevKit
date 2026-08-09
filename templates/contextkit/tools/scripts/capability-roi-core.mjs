/**
 * capability-roi-core — pure byCapability lens (CDK-066 split, cohesion note).
 *
 * COHESION REASON FOR SPLIT: capability-roi.mjs exceeded 308 lines because it
 * holds both (a) the pure fold lens (byCapability + alias-index builder) and
 * (b) the pricing consumer (capabilityRoi + presentRoi). The split is along
 * the only real seam: pure token aggregation (no pricing deps, testable in
 * isolation) vs priced ROI computation (depends on pricing-registry + cost-engine).
 * capability-roi.mjs imports this core and re-exports CAPABILITY_ROI_SCHEMA_VERSION
 * so external callers need only one import.
 *
 * Zero runtime dependencies — node:* and relative imports only.
 */

import { emptyBuckets, BUCKET_KEYS } from './economics/usage-buckets.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for summaries produced by the ROI module. */
export const CAPABILITY_ROI_SCHEMA_VERSION = 'cdk-capability-roi/1';

/** Sentinel key for events that match no registered capability. */
export const UNATTRIBUTED_KEY = 'unattributed';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Accumulates `sourceBuckets` into `targetBuckets` in place.
 * Skips undefined/non-numeric values (treated as 0) for defensive tolerance.
 *
 * @param {object} targetBuckets - Mutable zeroed bucket object (mutated).
 * @param {object|undefined} sourceBuckets - Source token counts.
 * @returns {void}
 */
function foldBuckets(targetBuckets, sourceBuckets) {
  for (const key of BUCKET_KEYS) {
    const v = sourceBuckets?.[key];
    targetBuckets[key] += (typeof v === 'number' && isFinite(v)) ? v : 0;
  }
}

/**
 * Builds the alias→capabilityId index from a capability registry.
 * Only the `aliases.claude` field is the join key (matches event.attributionSkill
 * which records the `/command` form). Defensive: skips entries with
 * missing/non-string id or aliases.claude.
 *
 * @param {object} capabilityRegistry - Registry with `.capabilities` array.
 * @returns {Map<string, string>} Map of aliases.claude → capability id.
 */
export function buildAliasIndex(capabilityRegistry) {
  const index = new Map();
  const capabilities = Array.isArray(capabilityRegistry?.capabilities)
    ? capabilityRegistry.capabilities
    : [];

  for (const cap of capabilities) {
    if (typeof cap?.id !== 'string' || !cap.id) continue;
    const claudeAlias = cap.aliases?.claude;
    if (typeof claudeAlias === 'string' && claudeAlias) {
      index.set(claudeAlias, cap.id);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Lens: byCapability
// ---------------------------------------------------------------------------

/**
 * NEW LENS: fold usage events into per-capability buckets.
 *
 * Maps each event.attributionSkill -> capability id via aliases.claude. Builds
 * the alias->id index ONCE. Events whose attributionSkill matches no capability
 * (or is absent) fold under the 'unattributed' key (NEVER dropped).
 *
 * Confidence is 'derived': the skill->capability join is computed from the
 * registry — it is not a signal the host emits directly. This mirrors the
 * rationale of exclusiveBySkill (attribution-lenses.mjs line 168).
 *
 * @param {object[]} events - Normalized UsageEvent array.
 * @param {object} capabilityRegistry - Registry with { capabilities:[{id,aliases:{claude}}] }.
 * @returns {{ confidence: 'derived',
 *   byCapability: Record<string, { buckets: object, byModel: Record<string, object> }> }}
 */
export function byCapability(events, capabilityRegistry) {
  const aliasIndex = buildAliasIndex(capabilityRegistry);

  /** @type {Record<string, { buckets: object, byModel: Record<string, object> }>} */
  const groups = {};

  /**
   * Lazily initialise a group entry for `capId`.
   * @param {string} capId
   */
  function ensureGroup(capId) {
    if (!groups[capId]) {
      groups[capId] = { buckets: emptyBuckets(), byModel: {} };
    }
  }

  for (const event of (Array.isArray(events) ? events : [])) {
    const skill = event?.attributionSkill;
    const capId = (typeof skill === 'string' && skill)
      ? (aliasIndex.get(skill) ?? UNATTRIBUTED_KEY)
      : UNATTRIBUTED_KEY;

    ensureGroup(capId);
    foldBuckets(groups[capId].buckets, event?.buckets);

    // Accumulate into the per-model sub-bucket for pricing granularity.
    const modelKey = (typeof event?.modelEffective === 'string' && event.modelEffective)
      ? event.modelEffective
      : 'unknown';

    if (!groups[capId].byModel[modelKey]) {
      groups[capId].byModel[modelKey] = emptyBuckets();
    }
    foldBuckets(groups[capId].byModel[modelKey], event?.buckets);
  }

  return { confidence: 'derived', byCapability: groups };
}
