/**
 * Retention-window evaluation, purge, and cascade for EACP economic records
 * (ADR-0081 §retention).
 *
 * Pure module — no side effects, no I/O. `now` (epoch ms) is injected by the
 * caller for determinism. Provides:
 *   - withinRetention — single-record eligibility check.
 *   - purge           — filter an array and count removals.
 *   - purgePreview    — dry-run that reports what would be removed without mutating.
 *   - purgeWithReport — full purge with a structured report of removed records.
 *   - purgeCascade    — purge across a named set of derived artifact arrays and
 *                       report what was removed from each.
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

// ---------------------------------------------------------------------------
// Purge preview (dry-run)
// ---------------------------------------------------------------------------

/**
 * Dry-run preview: returns what would be purged without modifying anything.
 *
 * Use this before executing a purge to show the user what will be removed.
 * Identical logic to purge() but returns the expired records instead of
 * discarding them. This satisfies the "purge preview" acceptance requirement
 * (ADR-0081 §purge-command).
 *
 * @param {Array<{ts?: string|number}>} records - Usage records to inspect.
 * @param {number} now - Current time as epoch ms, injected for determinism.
 * @param {{retentionDays: number}} resolved - Resolved privacy config.
 * @returns {{ wouldKeep: Array<{ts?: string|number}>,
 *             wouldPurge: Array<{ts?: string|number}>,
 *             wouldPurgeCount: number }}
 */
export function purgePreview(records, now, resolved) {
  const safeRecords = Array.isArray(records) ? records : [];
  const wouldKeep = [];
  const wouldPurge = [];

  for (const record of safeRecords) {
    if (withinRetention(record, now, resolved)) {
      wouldKeep.push(record);
    } else {
      wouldPurge.push(record);
    }
  }

  return { wouldKeep, wouldPurge, wouldPurgeCount: wouldPurge.length };
}

// ---------------------------------------------------------------------------
// Purge with removal report
// ---------------------------------------------------------------------------

/**
 * Purges expired records and returns a structured removal report.
 *
 * The report contains exactly what was removed so callers can display or log
 * the result. Reports the count, the ts values of removed records, and whether
 * any records had unparseable/missing ts (which are treated as expired per the
 * fail-closed posture of withinRetention).
 *
 * @param {Array<{ts?: string|number}>} records - Usage records to purge.
 * @param {number} now - Current time as epoch ms, injected for determinism.
 * @param {{retentionDays: number}} resolved - Resolved privacy config.
 * @returns {{ kept: Array<{ts?: string|number}>,
 *             purgedCount: number,
 *             removedTs: Array<string|number|undefined>,
 *             invalidTsCount: number }}
 */
export function purgeWithReport(records, now, resolved) {
  const safeRecords = Array.isArray(records) ? records : [];
  const kept = [];
  const removedTs = [];
  let invalidTsCount = 0;

  for (const record of safeRecords) {
    if (withinRetention(record, now, resolved)) {
      kept.push(record);
    } else {
      removedTs.push(record?.ts);
      if (record?.ts == null || !Number.isFinite(
        typeof record.ts === 'number' ? record.ts : Date.parse(record.ts)
      )) {
        invalidTsCount += 1;
      }
    }
  }

  return { kept, purgedCount: removedTs.length, removedTs, invalidTsCount };
}

// ---------------------------------------------------------------------------
// Cascade purge across derived artifact collections
// ---------------------------------------------------------------------------

/**
 * Purges expired records across a named collection of derived artifact arrays.
 *
 * The economics module produces multiple derived artifact types (e.g., usage
 * events, cost records, budget records, quota snapshots). A cascade purge
 * applies the same retention window to all of them in one operation and reports
 * exactly what was removed from each collection (ADR-0081 §purge-cascade).
 *
 * @param {Record<string, Array<{ts?: string|number}>>} artifacts - Named arrays
 *   of records to purge. Each key is the artifact collection name (e.g.,
 *   'usageEvents', 'costRecords', 'quotaSnapshots').
 * @param {number} now - Current time as epoch ms, injected for determinism.
 * @param {{retentionDays: number}} resolved - Resolved privacy config.
 * @returns {{ collections: Record<string, { kept: Array<unknown>,
 *             purgedCount: number, removedTs: Array<unknown>,
 *             invalidTsCount: number }>,
 *             totalPurged: number }}
 * @throws {TypeError} If artifacts is not a plain non-null object.
 */
export function purgeCascade(artifacts, now, resolved) {
  if (artifacts === null || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new TypeError(
      `purgeCascade: artifacts must be a plain non-null object mapping names to record arrays`
    );
  }
  const collections = {};
  let totalPurged = 0;

  for (const [name, records] of Object.entries(artifacts)) {
    const result = purgeWithReport(records, now, resolved);
    collections[name] = result;
    totalPurged += result.purgedCount;
  }

  return { collections, totalPurged };
}
