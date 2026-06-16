/**
 * Benchmark run scaffold — EACP Wave 6 / card #242 (EACP-13).
 *
 * Executes the harness PLUMBING only. There is no real provider and no spend in
 * this wave: a deterministic MOCK provider exercises the run/record path so the
 * harness can be tested end-to-end, and every run is labeled `provider:'mock'`.
 *
 * Honesty gate (the #176 baseline is unbuilt — constitution §8):
 *   - A mock run is ALWAYS labeled and carries confidence 'mock' + claim null;
 *     it can never feed a benchmark claim.
 *   - A run with no provider, or a real provider with no baseline, → skipped().
 *   - No cost/score number is fabricated; mock metrics are seeded by the spec,
 *     never by Math.random(), and are clearly mock.
 * DETERMINISTIC: no Date.now() / Math.random() / new Date(). Zero runtime deps
 * (node:fs, node:path, relative imports only).
 */

import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { skipped } from './privacy.mjs';
import { BENCHMARK_SCHEMA_VERSION } from './benchmark-design.mjs';

/** Canonical schema identifier for benchmark run records. */
export const BENCHMARK_RUN_SCHEMA_VERSION = 'eacp-benchmark-run/1';

// ---------------------------------------------------------------------------
// Mock provider — deterministic, no spend
// ---------------------------------------------------------------------------

/**
 * Deterministic hash of a string → non-negative integer. Used only to make the
 * mock provider's stub metrics reproducible per (arm, task); NOT a measurement.
 * @param {string} text
 * @returns {number}
 */
function seedFrom(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

/**
 * The mock provider. `execute(spec, arm)` returns a deterministic stub outcome
 * for one arm — labeled mock, carrying no real economic value. It NEVER spends.
 * @type {Readonly<{ id: string, execute: (spec: object, arm: string) => object }>}
 */
export const MOCK_PROVIDER = Object.freeze({
  id: 'mock',
  /**
   * @param {object} spec - a frozen run spec from benchmark-design.buildRunSpec.
   * @param {string} arm  - the arm key being executed.
   * @returns {Readonly<object>} a deterministic, clearly-mock arm outcome.
   */
  execute(spec, arm) {
    const seed = seedFrom(`${spec?.task ?? ''}|${spec?.commit ?? ''}|${arm}`);
    return Object.freeze({
      provider: 'mock',
      arm,
      // Mock token/turn figures — reproducible, explicitly NOT a measurement.
      mockTokens: 1000 + (seed % 500),
      mockTurns:  3 + (seed % 4),
      // The harness cannot assert a QA outcome without #176 baseline + real run.
      qaOutcome: 'unknown',
    });
  },
});

// ---------------------------------------------------------------------------
// Run execution scaffold
// ---------------------------------------------------------------------------

/** True only for a frozen run spec (not a skipped marker / non-object). */
function isRunSpec(spec) {
  return spec !== null && typeof spec === 'object' && spec.status !== 'skipped' &&
    spec.schemaVersion === BENCHMARK_SCHEMA_VERSION && Array.isArray(spec.arms);
}

/**
 * Runs a single arm of a spec through the provider. With MOCK_PROVIDER this
 * produces a labeled mock run record (confidence 'mock', claim null). Without a
 * provider, or for an arm not in the spec, returns skipped().
 *
 * @param {object} spec - frozen run spec from buildRunSpec.
 * @param {string} arm  - arm key (must be present in spec.arms).
 * @param {{ provider?: object, now?: number, operator?: string }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function runArm(spec, arm, opts = {}) {
  if (!isRunSpec(spec)) return skipped('invalid or skipped run spec');
  if (!spec.arms.includes(arm)) return skipped(`arm "${arm}" not in spec.arms`);

  const provider = opts?.provider ?? null;
  if (provider === null || typeof provider.execute !== 'function') {
    return skipped('no provider — real benchmark runs are deferred (no #176 baseline)');
  }

  const outcome = provider.execute(spec, arm);
  const isMock = provider.id === 'mock' || outcome?.provider === 'mock';
  const nowVal = opts?.now;
  const capturedAt = (typeof nowVal === 'number' && Number.isFinite(nowVal)) ? nowVal : null;

  return Object.freeze({
    schemaVersion: BENCHMARK_RUN_SCHEMA_VERSION,
    task: spec.task,
    commit: spec.commit,
    arm,
    provider: outcome?.provider ?? provider.id ?? 'unknown',
    operator: (typeof opts?.operator === 'string' && opts.operator.trim()) ? opts.operator.trim() : null,
    // A mock run is real plumbing but not a real measurement → confidence 'mock'.
    confidence: isMock ? 'mock' : 'unknown',
    qaOutcome: outcome?.qaOutcome ?? 'unknown',
    metrics: Object.freeze({
      mockTokens: outcome?.mockTokens ?? null,
      mockTurns:  outcome?.mockTurns ?? null,
    }),
    claim: null,
    capturedAt,
  });
}

/**
 * Runs every arm of a spec. Returns skipped() when the spec is invalid; otherwise
 * an array of per-arm results (each itself may be a skipped marker).
 *
 * @param {object} spec - frozen run spec from buildRunSpec.
 * @param {{ provider?: object, now?: number, operator?: string }} [opts]
 * @returns {Readonly<object[]>|Readonly<{status:'skipped',reason:string}>}
 */
export function runPilot(spec, opts = {}) {
  if (!isRunSpec(spec)) return skipped('invalid or skipped run spec');
  return Object.freeze(spec.arms.map((arm) => runArm(spec, arm, opts)));
}

// ---------------------------------------------------------------------------
// Append-only JSONL persistence (mirrors quota-snapshots.mjs)
// ---------------------------------------------------------------------------

/**
 * Serialises a run record to a single JSON line. Refuses skipped markers — only
 * real run records reach disk (constitution §8: never persist a skip as data).
 * @param {object} record
 * @returns {string}
 * @throws {TypeError} when record is null/non-object or a skipped marker.
 */
export function serializeRun(record) {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('serializeRun: record must be a non-null object');
  }
  if (record.status === 'skipped') {
    throw new TypeError('serializeRun: refuse to serialise a skipped marker');
  }
  return JSON.stringify(record);
}

/**
 * Appends a run record to a JSONL ledger, creating parent dirs as needed.
 * @param {object} record - a run record (not a skipped marker).
 * @param {string} file - non-empty path to the JSONL file.
 * @returns {string} the file path (for caller confirmation).
 * @throws {TypeError} on a skipped marker or invalid file path.
 */
export function appendRun(record, file) {
  if (record?.status === 'skipped') {
    throw new TypeError('appendRun: refuse to persist a skipped marker');
  }
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new TypeError('appendRun: file must be a non-empty string');
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, serializeRun(record) + '\n', 'utf-8');
  return file;
}

/**
 * Reads all run records from a JSONL ledger. Missing/unreadable file → [].
 * Blank and malformed lines are skipped; never throws.
 * @param {string} file
 * @returns {object[]}
 */
export function readRuns(file) {
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
