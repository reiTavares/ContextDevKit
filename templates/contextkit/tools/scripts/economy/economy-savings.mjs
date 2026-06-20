/**
 * economy-savings.mjs — OBSERVED-economy savings ledger for Economy Runtime
 * (WF0020, CDK-266). Captures how many tokens each lever (boot-delta, run-compact,
 * project-map, routing) actually avoided, as an append-only JSONL event stream.
 *
 * Invariants: no Date.now/Math.random/new Date (inject `opts.now`); skipped markers
 * never reach disk; NO `claim` field (observed events, not a causal vs-no-kit claim
 * — ADR-0082/#243); records frozen; fail-open read (missing → [], never throws).
 * Zero runtime deps — node:fs/path only. @module economy-savings
 */

import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Canonical schema identifier stamped on every savings record.
 * Bump the version suffix when the shape changes in a breaking way.
 * @type {string}
 */
export const ECONOMY_SAVINGS_SCHEMA_VERSION = 'cdk-economy-savings/1';

/**
 * Valid economy levers that may generate savings observations.
 * Extending this list requires an ADR — each lever has its own activation path.
 * @type {Readonly<string[]>}
 */
export const LEVERS = Object.freeze([
  'boot-delta',
  'run-compact',
  'project-map',
  'routing',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when value is a finite number >= 0 (valid token count).
 * @param {unknown} v
 * @returns {boolean}
 */
function isValidTokenCount(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// ---------------------------------------------------------------------------
// recordSaving
// ---------------------------------------------------------------------------

/**
 * Builds a frozen savings record from raw input.
 *
 * Returns a skipped marker when:
 *   - `lever` is not one of the four canonical LEVERS, or
 *   - `savedTokens` is not a finite number >= 0 (negative/NaN rejected).
 *
 * `capturedAt` is `opts.now` (epoch ms) when a finite number, else `null` —
 * deterministic and safe in test environments.
 *
 * There is intentionally NO `claim` field: a savings record is an observation
 * that a lever fired, not a causal claim vs a no-kit baseline (see #243).
 *
 * @param {{
 *   lever: string,
 *   savedTokens: number,
 *   kind?: string,
 *   sessionId?: string,
 *   note?: string
 * }} input
 * @param {{ now?: number }} [opts] — epoch ms injected by caller; never Date.now().
 * @returns {Readonly<{
 *   schemaVersion: string, lever: string, savedTokens: number,
 *   kind: string|null, sessionId: string|null, capturedAt: number|null,
 *   note: string|null
 * }> | Readonly<{ status: 'skipped', reason: string }>}
 */
export function recordSaving({ lever, savedTokens, kind, sessionId, note }, opts = {}) {
  if (!LEVERS.includes(lever)) {
    return Object.freeze({ status: 'skipped', reason: `unknown lever: ${lever}` });
  }
  if (!isValidTokenCount(savedTokens)) {
    return Object.freeze({
      status: 'skipped',
      reason: `savedTokens must be a finite number >= 0, got: ${savedTokens}`,
    });
  }

  const nowVal = opts?.now;
  const capturedAt = (typeof nowVal === 'number' && Number.isFinite(nowVal)) ? nowVal : null;

  return Object.freeze({
    schemaVersion: ECONOMY_SAVINGS_SCHEMA_VERSION,
    lever,
    savedTokens,
    kind:      (typeof kind      === 'string' && kind.length      > 0) ? kind      : null,
    sessionId: (typeof sessionId === 'string' && sessionId.length > 0) ? sessionId : null,
    capturedAt,
    note:      (typeof note      === 'string' && note.length      > 0) ? note      : null,
  });
}

// ---------------------------------------------------------------------------
// appendSaving
// ---------------------------------------------------------------------------

/**
 * Appends a savings record to the JSONL file (the mutator).
 *
 * Creates parent directories as needed. Refuses to persist a skipped marker —
 * throws TypeError when called with one. Best-effort mirror of
 * quota-snapshots.mjs's appendSnapshot pattern.
 *
 * @param {object} record — Frozen savings record (not a skipped marker).
 * @param {string} file   — Path to the JSONL savings log.
 * @returns {Promise<string>} The file path (for caller confirmation).
 * @throws {TypeError} When record carries `status: 'skipped'` or file is invalid.
 */
export async function appendSaving(record, file) {
  if (record?.status === 'skipped') {
    throw new TypeError('appendSaving: refuse to persist a skipped marker');
  }
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new TypeError('appendSaving: file must be a non-empty string');
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
  return file;
}

// ---------------------------------------------------------------------------
// readSavings
// ---------------------------------------------------------------------------

/**
 * Reads all savings records from a JSONL file.
 *
 * Missing or unreadable file returns `[]`. Blank and malformed JSON lines are
 * silently skipped. Never throws — callers never need a try/catch.
 *
 * @param {string} file — Path to the JSONL savings log.
 * @returns {Promise<object[]>} Parsed records (may be empty).
 */
export async function readSavings(file) {
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
 * Synchronous variant of readSavings for hot/sync callers (e.g. the token report).
 * Missing/unreadable file → []; malformed lines skipped; never throws.
 * @param {string} file
 * @returns {object[]}
 */
export function readSavingsSync(file) {
  let raw;
  try { raw = readFileSync(file, 'utf-8'); } catch { return []; }
  const records = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { records.push(JSON.parse(trimmed)); } catch { /* skip bad JSONL line */ }
  }
  return records;
}

// ---------------------------------------------------------------------------
// savingsSummary
// ---------------------------------------------------------------------------

/**
 * Reduces an array of savings records into a frozen summary object.
 *
 * Non-array input returns a zeroed summary (degrade-to-false-negative prevention:
 * missing data → zeros, not invented values).
 *
 * @param {object[]} records
 * @returns {Readonly<{
 *   schemaVersion: string,
 *   totalSaved: number,
 *   byLever: Readonly<{ 'boot-delta': number, 'run-compact': number, 'project-map': number, 'routing': number }>,
 *   entries: number,
 *   sessions: number
 * }>}
 */
export function savingsSummary(records) {
  /** @type {Record<string, number>} */
  const byLever = {};
  for (const lever of LEVERS) byLever[lever] = 0;

  if (!Array.isArray(records) || records.length === 0) {
    return Object.freeze({
      schemaVersion: ECONOMY_SAVINGS_SCHEMA_VERSION,
      totalSaved: 0,
      byLever: Object.freeze({ ...byLever }),
      entries:  0,
      sessions: 0,
    });
  }

  let totalSaved = 0;
  const sessionSet = new Set();

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const { lever, savedTokens, sessionId } = rec;

    if (LEVERS.includes(lever) && isValidTokenCount(savedTokens)) {
      byLever[lever] += savedTokens;
      totalSaved     += savedTokens;
    }
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      sessionSet.add(sessionId);
    }
  }

  return Object.freeze({
    schemaVersion: ECONOMY_SAVINGS_SCHEMA_VERSION,
    totalSaved,
    byLever: Object.freeze({ ...byLever }),
    entries:  records.length,
    sessions: sessionSet.size,
  });
}

// ---------------------------------------------------------------------------
// presentSavings
// ---------------------------------------------------------------------------

/**
 * Renders a savings summary as a human-readable multi-line string.
 *
 * When `totalSaved` is 0: single-line advisory noting no savings observed yet.
 * When populated: one line per lever showing summed token count; levers at 0
 * are marked '(dormant — lever not firing yet)'.
 *
 * The header includes a caution that this is an *observed* signal, NOT a causal
 * claim vs a no-kit baseline — deliberate alignment with the economy ADR.
 *
 * @param {ReturnType<typeof savingsSummary>} summary
 * @returns {string}
 */
export function presentSavings(summary) {
  if (!summary || summary.totalSaved === 0) {
    return '💸 Economy in effect: none observed yet (levers advisory/opt-in)';
  }

  const lines = [
    '💸 Economy in effect (observed — NOT a causal claim vs no-kit; see #243)',
  ];

  for (const lever of LEVERS) {
    const tokens = summary.byLever?.[lever] ?? 0;
    if (tokens === 0) {
      lines.push(`  ${lever}: 0  (dormant — lever not firing yet)`);
    } else {
      lines.push(`  ${lever}: ${tokens} tokens saved`);
    }
  }

  return lines.join('\n');
}

/** Canonical ledger path under a project root. */
export function savingsFile(root) {
  return join(root, 'contextkit', 'memory', 'economy-savings.jsonl');
}

/**
 * Best-effort SYNCHRONOUS logger for hot paths (hooks / short-lived CLIs that exit
 * before an async write would flush). Records + sync-appends; never throws; returns
 * the record or null. No-ops on an invalid root or a skipped record.
 * @param {string} root @param {object} input @param {{ now?: number }} [opts]
 */
export function logSavingSync(root, input, opts = {}) {
  if (typeof root !== 'string' || root.length === 0) return null;
  const rec = recordSaving(input, opts);
  if (rec.status === 'skipped') return null;
  try {
    const file = savingsFile(root);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
    return rec;
  } catch { return null; }
}
