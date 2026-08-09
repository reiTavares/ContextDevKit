/**
 * Bucket arithmetic & delta/cumulative normalization for EACP usage events (ADR-0078).
 *
 * WHY a separate module: the five orthogonal token categories (freshInput,
 * output, cacheRead, cacheWrite, reasoning) and their arithmetic form the
 * canonical contract that every downstream consumer (attribution lenses,
 * adapters, cost-projection, budget gate) must agree on. Separating bucket
 * semantics from event normalization decouples the schema evolution path.
 *
 * Key invariant (must hold on every event and is tested by bucketsClose):
 *   total === freshInput + output + cacheRead + cacheWrite + reasoning
 *
 * IMPORTANT TERMINOLOGY: bucket sums are TOKEN THROUGHPUT, not cost/spend.
 * Pricing requires a model-rate table that is outside this module's
 * responsibility (ADR-0079 Phase 2). Nothing here auto-labels a sum as spend.
 *
 * Zero runtime dependencies — plain Node.js ESM, node:* only.
 */

// ---------------------------------------------------------------------------
// Bucket keys (frozen so consumers can iterate without drift)
// ---------------------------------------------------------------------------

/**
 * The five orthogonal token categories the platform tracks. Mirrors the
 * Claude transcript fields plus a `reasoning` slot for models that expose it.
 *
 * - freshInput  : tokens NOT read from cache (billed at full input rate)
 * - output      : tokens the model generated
 * - cacheRead   : tokens served from the prompt cache (much cheaper than fresh)
 * - cacheWrite  : tokens written to the prompt cache (one-time write cost)
 * - reasoning   : extended-thinking / chain-of-thought tokens (where exposed)
 */
export const BUCKET_KEYS = Object.freeze([
  'freshInput',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
]);

// ---------------------------------------------------------------------------
// Bucket factories
// ---------------------------------------------------------------------------

/**
 * Returns a fresh zeroed bucket object.
 * Use this rather than object literals so callers don't accidentally miss a key.
 *
 * @returns {{freshInput: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number}}
 */
export function emptyBuckets() {
  return { freshInput: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

// ---------------------------------------------------------------------------
// Bucket math
// ---------------------------------------------------------------------------

/**
 * Sums all five bucket values and returns the token THROUGHPUT.
 *
 * IMPORTANT: This is token throughput, NOT cost/spend. Translating to spend
 * requires a per-model rate table which is outside this module (ADR-0079).
 * Never auto-label the return value as "cost".
 *
 * Missing or undefined bucket keys are treated as 0 to tolerate partial events
 * from adapters that haven't populated every slot yet.
 *
 * @param {Partial<{freshInput: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number}>} buckets
 * @returns {number} Non-negative integer (or 0 for empty/null input)
 */
export function throughput(buckets) {
  if (!buckets || typeof buckets !== 'object') return 0;
  let sum = 0;
  for (const key of BUCKET_KEYS) {
    const v = buckets[key];
    sum += (typeof v === 'number' && isFinite(v)) ? v : 0;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns true iff an event's buckets satisfy the platform invariant:
 *   - Every bucket value is a non-negative finite number.
 *   - When the event carries a numeric `total`, total === throughput(buckets).
 *
 * When no `total` is present, only the non-negative-finite check applies.
 * This is the consistency gate; use it in tests and after normalization.
 *
 * @param {{ buckets: Partial<{freshInput: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number}>, total?: number }} event
 * @returns {boolean}
 */
export function bucketsClose(event) {
  if (!event || typeof event !== 'object') return false;
  const { buckets, total } = event;
  if (!buckets || typeof buckets !== 'object') return false;

  for (const key of BUCKET_KEYS) {
    const v = buckets[key];
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return false;
  }

  if (typeof total === 'number') {
    return total === throughput(buckets);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Delta normalization
// ---------------------------------------------------------------------------

/**
 * Converts an ordered array of UsageEvents for ONE session from mixed
 * cumulative/delta form to all-delta form.
 *
 * WHY this guard exists: naive code sums all events in a session to get totals.
 * If an adapter emits cumulative running totals (event N = sum of turns 1..N),
 * summing events is double-counting. This function converts runs of cumulative
 * events to per-step increments (event N minus event N-1, clamped at 0 to
 * absorb session-reset noise) before the caller aggregates.
 *
 * Rules:
 *   - Events already marked 'delta' pass through unchanged.
 *   - A 'cumulative' event following another 'cumulative' event becomes
 *     (current − previous) per bucket, clamped at ≥ 0.
 *   - The first 'cumulative' event in a run is treated as if the previous
 *     event had all-zero buckets (its values ARE the delta for that step).
 *   - Returned events are stamped bucketMode:'delta' and total is recomputed.
 *
 * Pure function — does not mutate the input array or its event objects.
 *
 * @param {Array<{buckets: object, bucketMode: string, total: number}>} events - Ordered events for a single session
 * @returns {Array<{buckets: object, bucketMode: string, total: number}>} - New array, all events in bucketMode:'delta'
 */
export function toDelta(events) {
  if (!Array.isArray(events)) return [];

  const output = [];
  // Track the last cumulative baseline per BUCKET_KEYS to compute diffs
  let lastCumulativeBuckets = null;

  for (const event of events) {
    if (event.bucketMode === 'delta') {
      // Delta events reset the cumulative baseline — the stream switched modes
      lastCumulativeBuckets = null;
      output.push(event);
      continue;
    }

    // bucketMode === 'cumulative'
    const prev = lastCumulativeBuckets ?? emptyBuckets();
    const deltaBuckets = emptyBuckets();
    for (const key of BUCKET_KEYS) {
      const current = typeof event.buckets[key] === 'number' ? event.buckets[key] : 0;
      const previous = typeof prev[key] === 'number' ? prev[key] : 0;
      deltaBuckets[key] = Math.max(0, current - previous);
    }

    // Capture the current cumulative values as the baseline for the next event
    lastCumulativeBuckets = { ...event.buckets };

    const deltaTotal = throughput(deltaBuckets);
    output.push({
      ...event,
      buckets:    deltaBuckets,
      bucketMode: 'delta',
      total:      deltaTotal,
    });
  }

  return output;
}
