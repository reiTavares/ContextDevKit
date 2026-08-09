/**
 * Attribution lenses — five ways to slice a session's usage events (EACP-01, ADR-0078).
 *
 * WHY lenses instead of a single aggregation: attribution is inherently
 * contextual. "How much did this session cost?" (inclusive), "which model bore
 * the load?" (byModel), and "was the fan-out expensive?" (byAgent) are different
 * questions that require different groupings of the same events. A lens never
 * mutates events; it folds them into a view.
 *
 * Confidence tiers flow through each lens honestly:
 *   direct   — the host API reported each bucket value explicitly
 *   derived  — computed from direct signals (e.g. exclusive-by-skill isolation)
 *   inferred — at least one event in the slice had incomplete signal
 *   unknown  — provenance unclear
 *
 * Zero runtime dependencies — plain Node.js ESM, node:* only.
 */

import { emptyBuckets, BUCKET_KEYS } from './usage-buckets.mjs';

// ---------------------------------------------------------------------------
// Confidence constants
// ---------------------------------------------------------------------------

/**
 * Canonical confidence tier identifiers.
 * Frozen so callers can do `CONFIDENCE.DIRECT` without string literals.
 *
 * @type {{ DIRECT: 'direct', DERIVED: 'derived', INFERRED: 'inferred', UNKNOWN: 'unknown' }}
 */
export const CONFIDENCE = Object.freeze({
  DIRECT:   'direct',
  DERIVED:  'derived',
  INFERRED: 'inferred',
  UNKNOWN:  'unknown',
});

// ---------------------------------------------------------------------------
// Private fold helper
// ---------------------------------------------------------------------------

/**
 * Accumulates `sourceBuckets` into `targetBuckets` in place (private).
 * Skips undefined/non-numeric values (treat as 0) for defensive tolerance.
 *
 * @param {import('./usage-event.mjs').UsageBuckets} targetBuckets - mutated in place
 * @param {Partial<import('./usage-event.mjs').UsageBuckets>} sourceBuckets
 * @returns {void}
 */
function fold(targetBuckets, sourceBuckets) {
  for (const key of BUCKET_KEYS) {
    const v = sourceBuckets?.[key];
    targetBuckets[key] += (typeof v === 'number' && isFinite(v)) ? v : 0;
  }
}

// ---------------------------------------------------------------------------
// Lens: inclusive
// ---------------------------------------------------------------------------

/**
 * Sums all events in the slice without further grouping.
 *
 * This is the default session-level lens and the most honest starting point:
 * it is inclusive of ALL turn context, including cached prefixes from earlier
 * in the session. Callers that want to understand a specific command's
 * footprint should use `exclusiveBySkill` instead.
 *
 * @param {import('./usage-event.mjs').UsageEvent[]} events
 * @returns {{ confidence: 'direct', buckets: import('./usage-event.mjs').UsageBuckets }}
 */
export function inclusive(events) {
  const buckets = emptyBuckets();
  for (const event of events || []) {
    fold(buckets, event.buckets);
  }
  return { confidence: CONFIDENCE.DIRECT, buckets };
}

// ---------------------------------------------------------------------------
// Lens: byAgent
// ---------------------------------------------------------------------------

/**
 * Splits events by `agentScope` ('main' vs 'subagent').
 *
 * The main/subagent split answers "how much of this session went to fan-out?"
 * which is the primary scalar the budget gate (ADR-0045) reads. Both keys
 * are always present even when one has all-zero buckets.
 *
 * @param {import('./usage-event.mjs').UsageEvent[]} events
 * @returns {{ confidence: 'direct', main: import('./usage-event.mjs').UsageBuckets, subagent: import('./usage-event.mjs').UsageBuckets }}
 */
export function byAgent(events) {
  const main    = emptyBuckets();
  const subagent = emptyBuckets();
  for (const event of events || []) {
    fold(event.agentScope === 'subagent' ? subagent : main, event.buckets);
  }
  return { confidence: CONFIDENCE.DIRECT, main, subagent };
}

// ---------------------------------------------------------------------------
// Lens: byModel
// ---------------------------------------------------------------------------

/**
 * Groups events by `modelEffective`, the model that actually responded.
 *
 * Using `modelEffective` (not `modelRequested`) answers "did the fan-out
 * actually run on the cheap model, or did fallback kick in?" — a distinction
 * that matters for cost-tiered routing analysis (ADR-0052 Phase 2). Events
 * without a model id are bucketed under 'unknown' rather than silently dropped.
 *
 * @param {import('./usage-event.mjs').UsageEvent[]} events
 * @returns {{ confidence: 'direct', byModel: Record<string, import('./usage-event.mjs').UsageBuckets> }}
 */
export function byModel(events) {
  /** @type {Record<string, import('./usage-event.mjs').UsageBuckets>} */
  const modelMap = {};
  for (const event of events || []) {
    const modelKey = (typeof event.modelEffective === 'string' && event.modelEffective)
      ? event.modelEffective
      : 'unknown';
    if (!modelMap[modelKey]) modelMap[modelKey] = emptyBuckets();
    fold(modelMap[modelKey], event.buckets);
  }
  return { confidence: CONFIDENCE.DIRECT, byModel: modelMap };
}

// ---------------------------------------------------------------------------
// Lens: byPhase
// ---------------------------------------------------------------------------

/**
 * Groups events by `phase` (workflow phase label).
 *
 * Confidence is 'direct' only when EVERY event in the slice carries a phase;
 * otherwise it degrades to 'inferred' because the unphased events are
 * bucketed under 'unknown', making the per-phase sums partial.
 *
 * @param {import('./usage-event.mjs').UsageEvent[]} events
 * @returns {{ confidence: 'direct'|'inferred', byPhase: Record<string, import('./usage-event.mjs').UsageBuckets> }}
 */
export function byPhase(events) {
  /** @type {Record<string, import('./usage-event.mjs').UsageBuckets>} */
  const phaseMap = {};
  let allHavePhase = true;

  for (const event of events || []) {
    const phaseKey = (typeof event.phase === 'string' && event.phase) ? event.phase : 'unknown';
    if (phaseKey === 'unknown') allHavePhase = false;
    if (!phaseMap[phaseKey]) phaseMap[phaseKey] = emptyBuckets();
    fold(phaseMap[phaseKey], event.buckets);
  }

  const confidence = allHavePhase ? CONFIDENCE.DIRECT : CONFIDENCE.INFERRED;
  return { confidence, byPhase: phaseMap };
}

// ---------------------------------------------------------------------------
// Lens: exclusiveBySkill
// ---------------------------------------------------------------------------

/**
 * Sums only events whose `attributionSkill` matches `skill`.
 *
 * PROJECT RULE — why this lens is 'derived', not 'direct':
 * Exclusive attribution isolates a command's OWN tokens by selecting only the
 * events tagged with its skill label. This is useful for understanding a
 * command's marginal footprint, but it is NOT directly observable from the
 * host — it is computed by filtering, making it a derived signal. As a
 * consequence, `dev-start` or `log-session` must NEVER be called "expensive"
 * merely because they ran inside a large session; their exclusive buckets only
 * reflect turns where they held the attribution context.
 *
 * When no events match `skill`, returns zero buckets (never null) so callers
 * can safely sum without a null guard.
 *
 * @param {import('./usage-event.mjs').UsageEvent[]} events
 * @param {string} skill - The attributionSkill value to isolate
 * @returns {{ confidence: 'derived', skill: string, buckets: import('./usage-event.mjs').UsageBuckets }}
 */
export function exclusiveBySkill(events, skill) {
  const buckets = emptyBuckets();
  for (const event of events || []) {
    if (event.attributionSkill === skill) {
      fold(buckets, event.buckets);
    }
  }
  return { confidence: CONFIDENCE.DERIVED, skill, buckets };
}
