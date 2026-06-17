/**
 * Quota store — persistence layer for quota snapshots (EACP Wave 8 / #240).
 *
 * Owns the three fs-touching functions split from quota-snapshots.mjs to keep
 * that file within the 308-line budget. Responsible for exactly one concern:
 * reading and writing the append-only JSONL quota log on disk.
 *
 * Privacy contract (ADR-0081):
 *   - appendSnapshot calls assertNoTranscriptContent before every write.
 *   - No transcript content may appear in any quota record.
 *
 * Idempotent retry: appendSnapshot skips the write when the record's fingerprint
 * already exists in the file — safe to retry, never duplicates.
 *
 * Zero runtime dependencies — node:fs, node:path, relative imports only.
 */

import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertNoTranscriptContent } from './privacy-field-policy.mjs';

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Serialises a snapshot record to a single-line JSON string.
 *
 * @param {object} record - Frozen snapshot (not a skipped marker).
 * @returns {string} Single-line JSON suitable for JSONL append.
 * @throws {TypeError} When record is null, non-object, or carries status 'skipped'.
 */
export function serializeSnapshot(record) {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('serializeSnapshot: record must be a non-null object');
  }
  if (record.status === 'skipped') {
    throw new TypeError(
      'serializeSnapshot: refuse to serialise a skipped marker — only capture records are allowed'
    );
  }
  return JSON.stringify(record);
}

/**
 * Reads all snapshot records from a JSONL file. Missing/unreadable file → [].
 * Blank and malformed JSON lines are silently skipped. Never throws.
 *
 * @param {string} file - Path to the JSONL quota-snapshots log.
 * @returns {object[]} Parsed records (may be empty).
 */
export function readSnapshots(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines — JSONL is append-only; bad lines must not crash.
    }
  }
  return records;
}

/**
 * Appends a snapshot record to the JSONL file (the mutator). Creates parent
 * directories as needed. Refuses to persist a skipped marker.
 *
 * Privacy contract (ADR-0081): assertNoTranscriptContent is called before every
 * write to ensure no transcript content leaks into the quota log.
 *
 * Idempotent: when the record's fingerprint already exists in the file (same
 * host + windowStart + captureMethod + pcts), the append is skipped and the
 * file path is returned unchanged. Safe to retry — never duplicates.
 *
 * @param {object} record - Frozen snapshot (not a skipped marker).
 * @param {string} file - Path to the JSONL log file (non-empty string).
 * @returns {string} The file path (for caller confirmation).
 * @throws {TypeError} When record carries status 'skipped' or file is invalid.
 * @throws {TypeError} When record contains transcript-content fields (ADR-0081).
 */
export function appendSnapshot(record, file) {
  if (record?.status === 'skipped') {
    throw new TypeError('appendSnapshot: refuse to persist a skipped marker');
  }
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new TypeError('appendSnapshot: file must be a non-empty string');
  }

  // Privacy contract: reject any transcript content field before touching disk.
  assertNoTranscriptContent(record);

  // Idempotent: skip if this fingerprint already exists in the log.
  const fp = typeof record.fingerprint === 'string' ? record.fingerprint : null;
  if (fp) {
    const existing = readSnapshots(file);
    if (existing.some(r => r.fingerprint === fp)) return file;
  }

  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, serializeSnapshot(record) + '\n', 'utf-8');
  return file;
}
