/**
 * Codex transcript adapter — maps raw Codex usage entries to canonical
 * UsageEvents (CDK-062, PKG-06 multi-host telemetry).
 *
 * WHY a dedicated adapter: the Codex host (OpenAI Codex / codex-cli) exposes
 * usage in a different shape from Claude Code transcripts. Isolating the mapping
 * here means attribution lenses and cost projections operate on UsageEvent
 * objects and never need to know Codex internals.
 *
 * ASSUMPTION (documented, confidence: 'inferred'): the exact Codex transcript
 * schema is not publicly specified. This adapter accepts a generic shape that
 * mirrors common OpenAI-compatible usage responses:
 *
 *   {
 *     usage: {
 *       input?:       number,   // prompt tokens (not from cache)
 *       output?:      number,   // completion tokens
 *       cacheRead?:   number,   // tokens read from cache (if host exposes it)
 *       cacheWrite?:  number,   // tokens written to cache (if host exposes it)
 *     },
 *     model?:     string,
 *     sessionId?: string,
 *     ts?:        number,   // Unix ms
 *     runId?:     string,
 *     taskId?:    string,
 *     phase?:     string,
 *     raw_ref?:   string,
 *   }
 *
 * Unknown fields are left undefined (NO false parity). Returns null for
 * usage-less entries rather than throwing — matches the claude-code adapter
 * contract so the dispatch registry can treat all adapters uniformly.
 *
 * Zero runtime dependencies — plain Node.js ESM, node:* only.
 */

import { normalizeEvent } from '../../economics/usage-event.mjs';

// ---------------------------------------------------------------------------
// Adapter identity
// ---------------------------------------------------------------------------

/**
 * Stable identifier for this adapter. Stored on every UsageEvent's
 * `source.adapter` field so event lineage is traceable.
 *
 * @type {'codex'}
 */
export const ADAPTER = 'codex';

// ---------------------------------------------------------------------------
// Capability declaration
// ---------------------------------------------------------------------------

/**
 * Returns a capability descriptor for this adapter.
 *
 * WHY a descriptor: downstream consumers that need to decide whether to trust
 * a field (e.g. cost-projection needing quota data, or a lens needing cache
 * stats) can inspect the descriptor rather than guessing. `confidence:'inferred'`
 * signals that the field mapping is based on the observed common shape of
 * OpenAI-compatible completions, not a formally documented Codex transcript spec.
 *
 * @returns {{
 *   adapter:          'codex',
 *   provider:         'openai',
 *   bucketMode:       'delta',
 *   bucketsProvided:  string[],
 *   modelField:       string,
 *   sessionField:     string,
 *   quotaAvailable:   false,
 *   confidence:       'inferred',
 *   limitations:      string[]
 * }}
 */
export function declares() {
  return {
    adapter:         ADAPTER,
    provider:        'openai',
    bucketMode:      'delta',
    bucketsProvided: ['freshInput', 'output'],
    modelField:      'model',
    sessionField:    'sessionId',
    quotaAvailable:  false,
    confidence:      'inferred',
    limitations: [
      'schema is inferred from common OpenAI-compatible usage shapes — no formal Codex transcript spec was available at authoring time (CDK-062)',
      'cacheRead and cacheWrite mapped only when the host explicitly provides them; absent fields default to 0',
      'reasoning bucket always 0 — not exposed by Codex completions API surface',
      'quota / rate-limit data not available in transcript; must be captured separately',
      'model field may be absent; falls back to unknown',
    ],
  };
}

// ---------------------------------------------------------------------------
// Adapter core
// ---------------------------------------------------------------------------

/**
 * Maps a single raw Codex transcript entry to a canonical UsageEvent.
 *
 * Returns `null` when `entry.usage` is absent — matches the claude-code adapter
 * contract so the dispatch registry can treat adapters uniformly.
 *
 * Field mapping:
 *   freshInput  ← usage.input        (tokens NOT from cache; defaults to 0)
 *   output      ← usage.output       (completion tokens; defaults to 0)
 *   cacheRead   ← usage.cacheRead    (default 0 if absent)
 *   cacheWrite  ← usage.cacheWrite   (default 0 if absent)
 *   reasoning   ← 0                  (not exposed by Codex)
 *
 * NO false parity: fields the entry does not provide are left undefined or
 * set to 'unknown' rather than invented. `runId`, `taskId`, `phase`, and
 * `source.raw_ref` are only set when present in the entry.
 *
 * @param {{
 *   usage?:    { input?: number, output?: number, cacheRead?: number, cacheWrite?: number },
 *   model?:    string,
 *   sessionId?: string,
 *   ts?:       number,
 *   runId?:    string,
 *   taskId?:   string,
 *   phase?:    string,
 *   raw_ref?:  string,
 * }} entry - Raw Codex transcript entry object
 * @returns {import('../../economics/usage-event.mjs').UsageEvent|null}
 *   Canonical UsageEvent, or null if this entry carries no usage data
 */
export function adapt(entry) {
  const usage = entry?.usage;
  // Tolerate usage-less lines (system entries, non-completion messages, etc.)
  if (!usage) return null;

  const sourceRef = { adapter: ADAPTER };
  if (entry.raw_ref !== undefined) {
    sourceRef.raw_ref = entry.raw_ref;
  }

  const rawEvent = {
    host:           'codex',
    provider:       'openai',
    sessionId:      entry.sessionId,
    modelRequested: (typeof entry.model === 'string' && entry.model) ? entry.model : 'unknown',
    modelEffective: (typeof entry.model === 'string' && entry.model) ? entry.model : 'unknown',
    fallbackUsed:   false,
    agentScope:     'main',
    buckets: {
      freshInput: typeof usage.input      === 'number' ? usage.input      : 0,
      output:     typeof usage.output     === 'number' ? usage.output     : 0,
      cacheRead:  typeof usage.cacheRead  === 'number' ? usage.cacheRead  : 0,
      cacheWrite: typeof usage.cacheWrite === 'number' ? usage.cacheWrite : 0,
      reasoning:  0,
    },
    bucketMode:  'delta',
    confidence:  'inferred',
    ts:          typeof entry.ts === 'number' ? entry.ts : Date.now(),
    source:      sourceRef,
  };

  // Only set optional fields when the entry actually provides them
  if (entry.runId  !== undefined) rawEvent.runId  = entry.runId;
  if (entry.taskId !== undefined) rawEvent.taskId = entry.taskId;
  if (entry.phase  !== undefined) rawEvent.phase  = entry.phase;

  return normalizeEvent(rawEvent);
}
