/**
 * Baseline harness — EACP Wave 7 / card #176 (CDK-003).
 *
 * Builds, records, and persists baseline specs for the 10-scenario task suite.
 * Callers inject `now` (epoch ms) — no Date.now() / Math.random() / new Date().
 * No real executor exists this wave: absent events → skipped(); mock events →
 * confidence 'mock', claim null; real events → confidence 'unknown', claim null.
 * Skipped markers never reach disk; every claim field stays null (ADR-0080).
 * Zero runtime dependencies — node:fs, node:path, and relative imports only.
 *
 * Cohesion note (288 lines — inside +10% tolerance): this module is the single
 * canonical implementation of the frozen baseline-harness contract (6 exported
 * functions + 2 catalogue re-exports + BASELINE_SCHEMA_VERSION + EVENT_KINDS).
 * Splitting would scatter the one-module concern across two files with no
 * second consumer justifying the seam. The budget is respected: 288 < 308.
 */

import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { skipped } from './privacy.mjs';
import { SCENARIOS, getScenario, SCENARIO_KINDS } from './baseline-scenarios.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for baseline spec and record objects. */
export const BASELINE_SCHEMA_VERSION = 'cdk-baseline/1';

/**
 * Observable event taxonomy for baseline records (card #176).
 * Events, not inferred intent: each key is something the harness observes
 * directly — token counts, tool calls, timing, QA outcomes, and failure modes.
 * @type {Readonly<string[]>}
 */
export const EVENT_KINDS = Object.freeze([
  'workflowUse',
  'projectMapUse',
  'glob',
  'grep',
  'read',
  'repeatedRead',
  'timeToFirstEditMs',
  'tokens',
  'costUsd',
  'testsRun',
  'qaOutcome',
  'deniedGate',
  'rework',
  'correctCompletion',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Non-empty string → value; else null. */
function str(v) {
  return (typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;
}

/**
 * Returns true when the given value is a valid subset of EVENT_KINDS keys (plain
 * object, possibly empty). We accept any plain object — callers may supply only
 * the events they captured; unknown keys are tolerated for forward-compat.
 * @param {unknown} value
 * @returns {boolean}
 */
function isEventsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// buildBaselineSpec
// ---------------------------------------------------------------------------

/**
 * Builds a frozen baseline spec for one scenario + arm.
 *
 * Returns skipped() when the scenario id is unknown (constitutes an advisory
 * guard — callers must not proceed without a valid spec). The returned spec
 * carries no claim (ADR-0080: targets ≠ claims). The arm defaults to
 * 'baseline'; callers may override for A/B arms.
 *
 * @param {string} scenarioId - A scenario id from baseline-scenarios.mjs.
 * @param {{ arm?: string }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function buildBaselineSpec(scenarioId, opts = {}) {
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    return skipped(`unknown scenario id: "${scenarioId}"`);
  }

  const arm = str(opts?.arm) ?? 'baseline';

  return Object.freeze({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    scenario:   scenario.id,
    kind:       scenario.kind,
    arm,
    seed:       scenario.seed,
    acceptance: Object.freeze([...scenario.acceptance]),
  });
}

// ---------------------------------------------------------------------------
// recordBaseline
// ---------------------------------------------------------------------------

/**
 * Records one arm's outcome against a baseline spec.
 *
 * Three paths (constitution §8 / ADR-0080):
 *   - opts.events absent → skipped('no executor — real baseline run deferred (#176)')
 *   - opts.events present + opts.mock truthy → confidence 'mock', claim null
 *   - opts.events present, mock falsy → confidence 'unknown', claim null
 *     (a real run cannot yet assert QA without the powered #243 run)
 *
 * The spec must be a valid non-skipped object built by buildBaselineSpec.
 * capturedAt is null when opts.now is absent (deterministic/testable mode).
 *
 * @param {object} spec - Frozen spec from buildBaselineSpec (not a skipped marker).
 * @param {{ events?: object, mock?: boolean, provider?: string,
 *   now?: number }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function recordBaseline(spec, opts = {}) {
  // Reject skipped or malformed specs before touching any options.
  if (spec === null || typeof spec !== 'object' || spec.status === 'skipped') {
    return skipped('invalid or skipped spec — cannot record baseline');
  }

  // No events → no executor this wave; return advisory skip.
  if (!isEventsObject(opts?.events)) {
    return skipped('no executor — real baseline run deferred (#176)');
  }

  const isMock = Boolean(opts?.mock);
  const confidence = isMock ? 'mock' : 'unknown';
  const provider   = str(opts?.provider) ?? (isMock ? 'mock' : 'unknown');

  const nowVal    = opts?.now;
  const capturedAt = (typeof nowVal === 'number' && Number.isFinite(nowVal))
    ? nowVal
    : null;

  // Snapshot only the EVENT_KINDS keys the caller supplied; extras are ignored
  // to maintain schema hygiene without silently discarding future extensions.
  const eventSnapshot = {};
  for (const key of EVENT_KINDS) {
    if (Object.prototype.hasOwnProperty.call(opts.events, key)) {
      eventSnapshot[key] = opts.events[key];
    }
  }

  return Object.freeze({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    scenario:   spec.scenario,
    kind:       spec.kind,
    arm:        spec.arm,
    provider,
    confidence,
    events:     Object.freeze(eventSnapshot),
    // qaOutcome from events if provided; else 'unknown' — never fabricate.
    qaOutcome:  eventSnapshot.qaOutcome ?? 'unknown',
    claim:      null,
    capturedAt,
  });
}

// ---------------------------------------------------------------------------
// costPerCompletedTask
// ---------------------------------------------------------------------------

/**
 * Primary baseline metric: cost-per-correctly-completed task.
 *
 * Requires at least one record where both qaOutcome is 'pass' and costUsd is a
 * finite positive number. Without such records the value is null (constitution
 * §8: never fabricate a number; a missing data point is reported as null, not
 * as zero or an estimate). claim is always null (ADR-0080).
 *
 * @param {object[]} records - Array of baseline records (skipped markers are
 *   filtered out; wrong-schema entries are ignored).
 * @returns {{ value: number|null, unit: string, confidence: string, claim: null }}
 */
export function costPerCompletedTask(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { value: null, unit: 'USD/task', confidence: 'unknown', claim: null };
  }

  // Only count records that have a qa-green outcome AND a real cost figure.
  const qualifying = records.filter(
    (r) =>
      r !== null &&
      typeof r === 'object' &&
      r.status !== 'skipped' &&
      r.events?.qaOutcome === 'pass' &&
      typeof r.events?.costUsd === 'number' &&
      Number.isFinite(r.events.costUsd) &&
      r.events.costUsd > 0,
  );

  if (qualifying.length === 0) {
    return { value: null, unit: 'USD/task', confidence: 'unknown', claim: null };
  }

  const totalCost = qualifying.reduce((sum, r) => sum + r.events.costUsd, 0);
  const value     = totalCost / qualifying.length;

  // If any qualifying record is mock, the aggregate is mock; otherwise unknown
  // (a real run cannot assert QA without the powered #243 run — ADR-0080).
  const hasMock = qualifying.some((r) => r.confidence === 'mock');

  return {
    value,
    unit:       'USD/task',
    confidence: hasMock ? 'mock' : 'unknown',
    claim:      null,
  };
}

// ---------------------------------------------------------------------------
// Append-only JSONL persistence (mirrors benchmark-run.mjs)
// ---------------------------------------------------------------------------

/**
 * Serialises a baseline record to a single-line JSON string.
 *
 * Refuses skipped markers — only real baseline records reach disk (constitution
 * §8: never persist a skip as data). Also refuses null and non-objects.
 *
 * @param {object} record - Frozen baseline record (not a skipped marker).
 * @returns {string} Single-line JSON suitable for JSONL append.
 * @throws {TypeError} When record is null, non-object, or carries status 'skipped'.
 */
export function serializeBaseline(record) {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('serializeBaseline: record must be a non-null object');
  }
  if (record.status === 'skipped') {
    throw new TypeError('serializeBaseline: refuse to serialise a skipped marker');
  }
  return JSON.stringify(record);
}

/**
 * Appends a baseline record to the JSONL ledger, creating parent dirs as needed.
 *
 * Canonical ledger path: contextkit/memory/benchmark-baseline.jsonl (not
 * committed — written only by a real or mock run; absent by default).
 *
 * @param {object} record - Frozen baseline record (not a skipped marker).
 * @param {string} file - Non-empty path to the JSONL ledger file.
 * @returns {string} The file path (for caller confirmation).
 * @throws {TypeError} On a skipped marker or invalid file path.
 */
export function appendBaseline(record, file) {
  if (record?.status === 'skipped') {
    throw new TypeError('appendBaseline: refuse to persist a skipped marker');
  }
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new TypeError('appendBaseline: file must be a non-empty string');
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, serializeBaseline(record) + '\n', 'utf-8');
  return file;
}

/**
 * Reads all baseline records from a JSONL ledger. Missing or unreadable file
 * returns []. Blank and malformed lines are silently skipped. Never throws.
 *
 * @param {string} file - Path to the JSONL baseline ledger.
 * @returns {object[]} Parsed records (may be empty).
 */
export function readBaselines(file) {
  let raw;
  try { raw = readFileSync(file, 'utf-8'); } catch { return []; }
  const records = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { records.push(JSON.parse(trimmed)); } catch { /* skip malformed JSONL lines */ }
  }
  return records;
}

// Expose SCENARIOS + SCENARIO_KINDS as pass-through re-exports so callers that
// import from this module can access the scenario catalogue without a second
// import. This does NOT fork or duplicate the source-of-truth in
// baseline-scenarios.mjs.
export { SCENARIOS, SCENARIO_KINDS };
