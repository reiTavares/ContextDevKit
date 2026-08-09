/**
 * Quota snapshots — EACP Wave 8 / card #240 (EACP-11).
 *
 * Advisory quota observations per host stored as append-only JSONL. Callers
 * inject `now` (epoch ms) — no Date.now() / Math.random() / new Date() here.
 * Missing pct fields → null + confidence 'unknown'; no fabricated numbers.
 * Invalid/missing host → skipped(); skipped markers never reach disk.
 * Zero runtime dependencies — node:crypto, relative imports only.
 *
 * Persistence layer (serializeSnapshot, appendSnapshot, readSnapshots) lives in
 * ./quota-store.mjs and is re-exported below to preserve the public surface.
 *
 * Privacy contract (ADR-0081):
 *   - appendSnapshot (in quota-store.mjs) calls assertNoTranscriptContent before
 *     every write. No transcript content may appear in any quota record.
 *   - assertNoForbiddenFields deferred until quota fields are registered in
 *     privacy-field-policy.mjs (tracked: field policy update, Wave 8 follow-on).
 *
 * Idempotent retry: same (host, windowStart, captureMethod, usedPct, remainingPct)
 * tuple produces the same fingerprint; appendSnapshot is a no-op when the
 * fingerprint already exists in the file (safe retry, no duplicates).
 */

import { createHash } from 'node:crypto';
import { skipped } from './privacy.mjs';

// Re-export persistence layer so existing importers keep resolving.
export { serializeSnapshot, appendSnapshot, readSnapshots } from './quota-store.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for quota-snapshot record objects. */
export const QUOTA_SNAPSHOT_SCHEMA_VERSION = 'eacp-quota-snapshot/1';

/**
 * Allowed capture methods. 'api' → direct confidence; others → inferred.
 * @type {Readonly<string[]>}
 */
export const CAPTURE_METHODS = Object.freeze(['api', 'manual', 'inferred']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Non-empty string → value; else null. */
function str(v) {
  return (typeof v === 'string' && v.trim().length > 0) ? v : null;
}

/** Finite number in [0,100] → value; else null. */
function pct(v) {
  return (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) ? v : null;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Computes a short deterministic fingerprint for a snapshot record.
 *
 * The fingerprint is derived from the fields that make a quota observation
 * logically unique: host, windowStart, captureMethod, usedPct, remainingPct.
 * Used by appendSnapshot to detect and reject duplicate retries.
 *
 * @param {object} record - A snapshot record (not a skipped marker).
 * @returns {string} 12-character lowercase hex fingerprint.
 */
export function fingerprintSnapshot(record) {
  const key = [
    record?.host ?? '',
    record?.windowStart ?? '',
    record?.captureMethod ?? '',
    String(record?.usedPct ?? ''),
    String(record?.remainingPct ?? ''),
  ].join('\0');
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * Builds a frozen quota snapshot record from raw input.
 * Returns skipped('host required') when host is missing/invalid.
 * Confidence: no valid pct → 'unknown'; api + valid pct → 'direct'; else 'inferred'.
 * capturedAt is null when opts.now is absent (deterministic/testable mode).
 *
 * Linkage fields (sessionId, runId, taskId) are included when provided; unknown
 * hosts (e.g., claude-code) must use captureMethod 'manual' — never 'api' unless
 * a real supported API is available for that host.
 *
 * @param {{ host: unknown, plan?: unknown, windowType?: unknown,
 *   windowStart?: unknown, resetAt?: unknown, remainingPct?: unknown,
 *   usedPct?: unknown, captureMethod?: unknown, source?: unknown,
 *   sessionId?: unknown, runId?: unknown, taskId?: unknown }} input
 * @param {{ now?: number }} [opts] - epoch ms injected by caller; never internal Date.
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function buildSnapshot(input, opts = {}) {
  const hostVal = str(input?.host);
  if (!hostVal) return skipped('host required');

  const rawMethod = str(input?.captureMethod);
  const captureMethod = CAPTURE_METHODS.includes(rawMethod) ? rawMethod : 'manual';

  const remainingPct = pct(input?.remainingPct);
  const usedPct      = pct(input?.usedPct);
  const hasValidPct  = remainingPct !== null || usedPct !== null;

  let confidence;
  if (!hasValidPct) {
    confidence = 'unknown';
  } else if (captureMethod === 'api') {
    confidence = 'direct';
  } else {
    confidence = 'inferred';
  }

  const nowVal = opts?.now;
  const capturedAt = (typeof nowVal === 'number' && Number.isFinite(nowVal)) ? nowVal : null;

  const record = {
    schemaVersion: QUOTA_SNAPSHOT_SCHEMA_VERSION,
    host:          hostVal,
    plan:          str(input?.plan),
    windowType:    str(input?.windowType),
    windowStart:   str(input?.windowStart),
    resetAt:       str(input?.resetAt),
    remainingPct,
    usedPct,
    captureMethod,
    confidence,
    capturedAt,
    source:        str(input?.source),
    sessionId:     str(input?.sessionId),
    runId:         str(input?.runId),
    taskId:        str(input?.taskId),
  };

  // Compute fingerprint after all identity fields are set.
  record.fingerprint = fingerprintSnapshot(record);

  return Object.freeze(record);
}

/**
 * Reduces snapshots to the latest record per host. Higher capturedAt wins;
 * null capturedAt uses array order (later index wins). Non-array → {}.
 *
 * @param {object[]} snapshots
 * @returns {{ [host: string]: object }} Plain object keyed by host.
 */
export function latestPerHost(snapshots) {
  if (!Array.isArray(snapshots)) return {};
  const seen = /** @type {{ [host: string]: { record: object, idx: number } }} */ ({});
  for (let idx = 0; idx < snapshots.length; idx++) {
    const rec = snapshots[idx];
    const host = rec?.host;
    if (typeof host !== 'string' || host.trim().length === 0) continue;
    const prev = seen[host];
    if (!prev) {
      seen[host] = { record: rec, idx };
      continue;
    }
    // Higher capturedAt wins; tie-break by array position (later = higher idx).
    const prevAt = typeof prev.record.capturedAt === 'number' ? prev.record.capturedAt : -Infinity;
    const curAt  = typeof rec.capturedAt === 'number'         ? rec.capturedAt         : -Infinity;
    if (curAt > prevAt || (curAt === prevAt && idx > prev.idx)) {
      seen[host] = { record: rec, idx };
    }
  }
  const result = {};
  for (const [host, { record }] of Object.entries(seen)) {
    result[host] = record;
  }
  return result;
}

/**
 * Aggregates snapshots into a frozen advisory summary. Returns skipped() when
 * input is empty or non-array. `latest` has one record per distinct host.
 *
 * @param {object[]} snapshots
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function quotaSummary(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return skipped('no quota snapshots');
  }
  const byHost = latestPerHost(snapshots);
  const hostKeys = Object.keys(byHost);
  if (hostKeys.length === 0) return skipped('no quota snapshots');

  return Object.freeze({
    schemaVersion: QUOTA_SNAPSHOT_SCHEMA_VERSION,
    hosts:  hostKeys.length,
    latest: hostKeys.map(h => byHost[h]),
  });
}

/**
 * Renders a quota summary as a multi-line advisory string (no trailing newline).
 * Null/skipped → single 'Quota snapshots: skipped (...)' line. Populated →
 * header + one indented line per host showing pct or 'unobservable'.
 *
 * @param {ReturnType<typeof quotaSummary>|null|undefined} summary
 * @returns {string}
 */
export function presentQuota(summary) {
  if (!summary) return 'Quota snapshots: skipped (no data)';
  if (summary.status === 'skipped') {
    return 'Quota snapshots: skipped (' + summary.reason + ')';
  }

  const lines = [
    'Quota snapshots (advisory): ' + summary.hosts + ' host(s)',
  ];

  for (const rec of summary.latest) {
    const hostLabel = rec.host ?? '(unknown)';
    let pctDisplay;
    if (rec.remainingPct !== null || rec.usedPct !== null) {
      const parts = [];
      if (rec.remainingPct !== null) parts.push('remaining=' + rec.remainingPct + '%');
      if (rec.usedPct      !== null) parts.push('used='      + rec.usedPct      + '%');
      pctDisplay = parts.join(' ');
    } else {
      pctDisplay = 'unobservable';
    }
    lines.push(
      '  ' + hostLabel + ': ' + pctDisplay +
      ' [method=' + rec.captureMethod + ' confidence=' + rec.confidence + ']'
    );
  }

  return lines.join('\n');
}
