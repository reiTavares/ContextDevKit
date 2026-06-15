/**
 * Retention-window evaluation & purge for EACP economic records (ADR-0081).
 *
 * Pure module — no side effects. `now` (epoch ms) is injected for determinism.
 * Use this to evaluate whether records fall within a configured retention window
 * and to filter/purge records that have aged past retention.
 *
 * Zero runtime dependencies — plain Node.js ESM, node:* only.
 */

// ---------------------------------------------------------------------------
// Retention evaluation
// ---------------------------------------------------------------------------

/**
 * Determines whether a usage record falls within the configured retention window.
 *
 * Records with a missing, null, or unparseable `ts` field are treated as
 * EXPIRED and return false. This is a deliberate fail-closed posture: when we
 * cannot prove a record is within retention, we assume it is eligible for purge
 * rather than accidentally retaining data past its window.
 *
 * @param {{ ts?: string|number }} record - The usage record to test. `ts` must
 *   be an ISO 8601 date string or epoch-millisecond number.
 * @param {number} now - Current time as epoch ms, injected for determinism.
 *   Do NOT call Date.now() here — the caller owns the clock.
 * @param {{retentionDays: number}} resolved - Resolved privacy config with retentionDays.
 * @returns {boolean} True if the record is within the retention window.
 */
export function withinRetention(record, now, resolved) {
  const rawTs = record?.ts;
  if (rawTs == null) return false;

  const epochMs = typeof rawTs === 'number'
    ? rawTs
    : Date.parse(rawTs); // Date.parse is used here only for ISO-string parsing, not for "now"

  // NaN means Date.parse could not interpret the ts string — treat as expired.
  if (!Number.isFinite(epochMs)) return false;

  const retentionMs = resolved.retentionDays * 24 * 60 * 60 * 1000;
  return now - epochMs <= retentionMs;
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/**
 * Filters an array of usage records to those within the retention window.
 *
 * Pure function — does not mutate the input array. Records that fail the
 * withinRetention check (including those with missing/invalid ts) are counted
 * in purgedCount.
 *
 * @param {Array<{ts?: string|number}>} records - Usage records to filter.
 * @param {number} now - Current time as epoch ms, injected for determinism.
 * @param {{retentionDays: number}} resolved - Resolved privacy config with retentionDays.
 * @returns {{ kept: Array<{ts?: string|number}>, purgedCount: number }}
 */
export function purge(records, now, resolved) {
  const safeRecords = Array.isArray(records) ? records : [];
  const kept = [];
  let purgedCount = 0;

  for (const record of safeRecords) {
    if (withinRetention(record, now, resolved)) {
      kept.push(record);
    } else {
      purgedCount += 1;
    }
  }

  return { kept, purgedCount };
}
