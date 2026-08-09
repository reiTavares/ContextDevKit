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

/** Canonical non-breaking schema identifier. */
export const ECONOMY_SAVINGS_SCHEMA_VERSION = 'cdk-economy-savings/1';

/** Valid observed-savings levers; lifecycle-only levers live in economy-events. */
export const LEVERS = Object.freeze([
  'boot-delta',
  'run-compact',
  'project-map',
  'routing',
]);

/** True for a finite, non-negative observed token count. */
function isValidTokenCount(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Builds a frozen savings record from raw input.
 *
 * `capturedAt` is `opts.now` (epoch ms) when a finite number, else `null` —
 * deterministic and safe in test environments.
 *
 * There is intentionally NO `claim` field: a savings record is an observation
 * that a lever fired, not a causal claim vs a no-kit baseline (see #243).
 *
 * Optional lifecycle/mode evidence refuses recommended, shadow, skipped, or
 * failed records. Legacy callers without those fields remain compatible.
 * @param {object} input
 * @param {{ now?: number }} [opts] — epoch ms injected by caller; never Date.now().
 * @returns {Readonly<{
 *   schemaVersion: string, lever: string, savedTokens: number,
 *   kind: string|null, sessionId: string|null, capturedAt: number|null,
 *   note: string|null
 * }> | Readonly<{ status: 'skipped', reason: string }>}
 */
export function recordSaving(input = {}, opts = {}) {
  const { lever, savedTokens, kind, sessionId, note } = input;
  if (!LEVERS.includes(lever)) {
    return Object.freeze({ status: 'skipped', reason: `unknown lever: ${lever}` });
  }
  if (!isValidTokenCount(savedTokens)) {
    return Object.freeze({
      status: 'skipped',
      reason: `savedTokens must be a finite number >= 0, got: ${savedTokens}`,
    });
  }
  const lifecycle = input.lifecycle ?? input.status;
  if ((typeof lifecycle === 'string' && lifecycle !== 'applied') ||
      input.mode === 'shadow' || input.observed === false) {
    return Object.freeze({ status: 'skipped', reason: 'savings require an observed applied event' });
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
    observed: true,
    requestId: typeof input.requestId === 'string' && input.requestId ? input.requestId : null,
    decisionId: typeof input.decisionId === 'string' && input.decisionId ? input.decisionId : null,
    eventId: typeof input.eventId === 'string' && input.eventId ? input.eventId : null,
  });
}

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
  const observationsByLever = {};
  for (const lever of LEVERS) byLever[lever] = 0;

  if (!Array.isArray(records) || records.length === 0) {
    return Object.freeze({
      schemaVersion: ECONOMY_SAVINGS_SCHEMA_VERSION,
      totalSaved: 0,
      byLever: Object.freeze({ ...byLever }),
      observationsByLever: Object.freeze({}),
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
      observationsByLever[lever] = (observationsByLever[lever] ?? 0) + 1;
    }
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      sessionSet.add(sessionId);
    }
  }

  return Object.freeze({
    schemaVersion: ECONOMY_SAVINGS_SCHEMA_VERSION,
    totalSaved,
    byLever: Object.freeze({ ...byLever }),
    observationsByLever: Object.freeze({ ...observationsByLever }),
    entries:  records.length,
    sessions: sessionSet.size,
  });
}

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
  if (!summary || summary.entries === 0) {
    return '💸 Economy in effect: none observed yet (levers advisory/opt-in)';
  }

  const lines = [
    '💸 Economy in effect (observed — NOT a causal claim vs no-kit; see #243)',
  ];

  for (const lever of LEVERS) {
    const tokens = summary.byLever?.[lever] ?? 0;
    if ((summary.observationsByLever?.[lever] ?? 0) > 0) {
      lines.push(`  ${lever}: ${tokens} tokens saved`);
    } else {
      lines.push(`  ${lever}: dormant — no observed savings event`);
    }
  }

  return lines.join('\n');
}

/** JSON projection where absent and observed-zero are explicitly distinct. */
export function observedSavingsReport(summary) {
  if (!summary || summary.entries === 0) {
    return Object.freeze({
      schemaVersion: ECONOMY_SAVINGS_SCHEMA_VERSION,
      status: 'no-observations', reason: 'no observed savings events',
      byLever: Object.freeze({}),
    });
  }
  const byLever = {};
  for (const lever of LEVERS) {
    const samples = summary.observationsByLever?.[lever] ?? 0;
    if (samples > 0) byLever[lever] = Object.freeze({ savedTokens: summary.byLever[lever], samples });
  }
  return Object.freeze({
    schemaVersion: ECONOMY_SAVINGS_SCHEMA_VERSION,
    status: 'observed', totalSaved: summary.totalSaved,
    entries: summary.entries, sessions: summary.sessions,
    reason: summary.totalSaved === 0 ? 'observed events reported zero saved tokens' : null,
    byLever: Object.freeze(byLever),
  });
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
