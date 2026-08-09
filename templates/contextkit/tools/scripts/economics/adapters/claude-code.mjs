/**
 * Claude Code transcript adapter — maps raw transcript entries to canonical
 * UsageEvents (EACP-01, ADR-0078).
 *
 * WHY a dedicated adapter module: each host (claude-code, cursor, vscode, …)
 * exposes usage in a different shape. Isolating the mapping here means
 * attribution lenses and cost projections never need to know about transcript
 * internals; they operate purely on UsageEvent objects. The adapter contract
 * is: parse what the host gives you honestly, leave fields undefined when the
 * transcript doesn't provide them (NO false parity), and return null for
 * usage-less entries rather than throwing.
 *
 * Claude Code transcript usage semantics:
 *   - Values are PER-MESSAGE DELTAS (not cumulative running totals). Each
 *     entry's `message.usage` reflects only that turn's token consumption.
 *   - Quota / rate-limit information is NOT exposed in the transcript. It
 *     must be captured through a separate mechanism (future card).
 *   - The `cache_read_input_tokens` and `cache_creation_input_tokens` fields
 *     may be absent on older transcript formats; both default to 0.
 *
 * Zero runtime dependencies — plain Node.js ESM, node:* only.
 */

import { normalizeEvent } from '../usage-event.mjs';

// ---------------------------------------------------------------------------
// Adapter identity
// ---------------------------------------------------------------------------

/**
 * Stable identifier for this adapter. Stored on every UsageEvent's
 * `source.adapter` field so the lineage of each event is traceable.
 *
 * @type {'claude-code'}
 */
export const ADAPTER = 'claude-code';

// ---------------------------------------------------------------------------
// Capability declaration
// ---------------------------------------------------------------------------

/**
 * Returns an adapter capability descriptor describing what this adapter
 * can and cannot provide.
 *
 * WHY a descriptor: consumers that need to decide whether to trust a field
 * (e.g. a cost-projection that needs quota data) can inspect the descriptor
 * rather than guessing. `quotaAvailable: false` means the caller must arrange
 * quota capture through the Claude Code settings UI or another mechanism —
 * this adapter cannot fill that gap from transcript data alone.
 *
 * @returns {{
 *   adapter:          'claude-code',
 *   provider:         'anthropic',
 *   bucketMode:       'delta',
 *   bucketsProvided:  string[],
 *   modelField:       string,
 *   sessionField:     string,
 *   quotaAvailable:   false,
 *   confidence:       'direct',
 *   limitations:      string[]
 * }}
 */
export function declares() {
  return {
    adapter:         ADAPTER,
    provider:        'anthropic',
    bucketMode:      'delta',
    bucketsProvided: ['freshInput', 'output', 'cacheRead', 'cacheWrite'],
    modelField:      'message.model',
    sessionField:    'sessionId',
    quotaAvailable:  false,
    confidence:      'direct',
    limitations: [
      'reasoning bucket always 0 — transcript does not expose extended-thinking tokens separately',
      'quota / rate-limit data not available in transcript; must be captured manually',
      'model field may be absent in older transcript formats; falls back to unknown',
    ],
  };
}

// ---------------------------------------------------------------------------
// Adapter core
// ---------------------------------------------------------------------------

/**
 * Maps a single raw Claude Code transcript entry to a canonical UsageEvent.
 *
 * Returns `null` when `entry.message.usage` is absent — this mirrors the
 * `if (!usage) continue` tolerance in token-attribution.mjs and means the
 * adapter never throws on a usage-less transcript line (tool-result entries,
 * human turns, and system messages carry no usage).
 *
 * Field mapping:
 *   freshInput  ← input_tokens                   (tokens NOT from cache)
 *   output      ← output_tokens
 *   cacheRead   ← cache_read_input_tokens         (default 0 if absent)
 *   cacheWrite  ← cache_creation_input_tokens     (default 0 if absent)
 *   reasoning   ← 0  (not exposed by Claude Code transcripts)
 *
 * NO false parity: fields the transcript does not provide are left
 * undefined or 'unknown' rather than invented. `runId`, `taskId`, `phase`,
 * and `source.raw_ref` are only set when present in the entry.
 *
 * @param {{
 *   message?:         { usage?: object, model?: string },
 *   isSidechain?:     boolean,
 *   attributionSkill?: string,
 *   sessionId?:       string,
 *   timestamp?:       number,
 *   runId?:           string,
 *   taskId?:          string,
 *   phase?:           string,
 *   raw_ref?:         string
 * }} entry - Raw transcript entry object
 * @returns {import('../usage-event.mjs').UsageEvent|null}
 *   Canonical UsageEvent, or null if this entry carries no usage data
 */
export function adapt(entry) {
  const usage = entry?.message?.usage;
  // Explicitly tolerate usage-less lines (tool results, human turns, etc.)
  if (!usage) return null;

  const sourceRef = { adapter: ADAPTER };
  if (entry.raw_ref !== undefined) {
    sourceRef.raw_ref = entry.raw_ref;
  }

  const rawEvent = {
    host:             'claude-code',
    provider:         'anthropic',
    sessionId:        entry.sessionId,
    modelRequested:   (typeof entry.message?.model === 'string' && entry.message.model)
                        ? entry.message.model
                        : 'unknown',
    modelEffective:   (typeof entry.message?.model === 'string' && entry.message.model)
                        ? entry.message.model
                        : 'unknown',
    fallbackUsed:     false,
    agentScope:       entry.isSidechain ? 'subagent' : 'main',
    attributionSkill: entry.attributionSkill,
    buckets: {
      freshInput: usage.input_tokens                   ?? 0,
      output:     usage.output_tokens                  ?? 0,
      cacheRead:  usage.cache_read_input_tokens        ?? 0,
      cacheWrite: usage.cache_creation_input_tokens    ?? 0,
      reasoning:  0,
    },
    bucketMode:  'delta',
    confidence:  'direct',
    ts:          typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    source:      sourceRef,
  };

  // Only set optional fields when the entry actually provides them
  if (entry.runId  !== undefined) rawEvent.runId  = entry.runId;
  if (entry.taskId !== undefined) rawEvent.taskId = entry.taskId;
  if (entry.phase  !== undefined) rawEvent.phase  = entry.phase;

  return normalizeEvent(rawEvent);
}
