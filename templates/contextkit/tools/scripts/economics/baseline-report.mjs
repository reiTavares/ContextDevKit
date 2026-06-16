/**
 * Baseline report — EACP Wave 7 / card #176 (CDK-003).
 *
 * Read-only status surface for the 10-scenario baseline ledger. Reads the
 * ledger through baseline-harness and summarises per-kind coverage, pending
 * state, and the primary cost-per-task metric — all advisory.
 * No Date.now() / Math.random() / new Date() — callers inject `now`.
 * Absent ledger → pending:true, recorded:0, claim:null (never throws).
 * claim is always null (ADR-0080: targets ≠ claims, no evidence-tier yet).
 * Zero runtime dependencies — node:fs, node:path, and relative imports only.
 */

import { skipped } from './privacy.mjs';
import { SCENARIOS } from './baseline-scenarios.mjs';
import { readBaselines, costPerCompletedTask } from './baseline-harness.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for baseline status report objects. */
export const BASELINE_REPORT_SCHEMA_VERSION = 'cdk-baseline-report/1';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the unique set of scenario kinds covered by a list of baseline records.
 * Skipped markers and records with no kind field are ignored.
 * @param {object[]} records
 * @returns {Set<string>}
 */
function coveredKinds(records) {
  const kinds = new Set();
  for (const rec of records) {
    if (
      rec !== null &&
      typeof rec === 'object' &&
      rec.status !== 'skipped' &&
      typeof rec.kind === 'string' &&
      rec.kind.trim().length > 0
    ) {
      kinds.add(rec.kind);
    }
  }
  return kinds;
}

/**
 * Counts distinct scenario ids with at least one record (skipped markers
 * excluded). A scenario is "recorded" when any arm has at least one entry.
 * @param {object[]} records
 * @returns {number}
 */
function countRecordedScenarios(records) {
  const ids = new Set();
  for (const rec of records) {
    if (
      rec !== null &&
      typeof rec === 'object' &&
      rec.status !== 'skipped' &&
      typeof rec.scenario === 'string' &&
      rec.scenario.trim().length > 0
    ) {
      ids.add(rec.scenario);
    }
  }
  return ids.size;
}

// ---------------------------------------------------------------------------
// baselineStatus
// ---------------------------------------------------------------------------

/**
 * Read-only status of the baseline ledger.
 *
 * Reads the ledger at `file`; an absent or unreadable file yields zero records
 * (pending:true). Never throws. claim is always null — ADR-0080 forbids
 * non-null claims until the evidence-tier (#176 baseline + #243 powered run)
 * exists. The `pending` flag is true whenever fewer than all 10 scenarios have
 * at least one non-mock record recorded.
 *
 * @param {string} file - Path to the JSONL baseline ledger.
 * @param {{ now?: number }} [opts] - epoch ms injected by caller (unused in
 *   computation but accepted for API parity with other economics reporters).
 * @returns {Readonly<{
 *   schemaVersion: string,
 *   scenariosTotal: number,
 *   recorded: number,
 *   covered: number,
 *   pending: boolean,
 *   confidence: string,
 *   claim: null,
 *   costPerTask: { value: number|null, unit: string, confidence: string, claim: null }
 * }>}
 */
export function baselineStatus(file, opts = {}) {
  const records = readBaselines(file);

  const recorded = countRecordedScenarios(records);
  const covered  = coveredKinds(records).size;
  const total    = SCENARIOS.length; // always 10 per baseline-scenarios contract

  // pending:true when at least one of the 10 scenarios has no recorded entry,
  // OR when no records exist at all (the normal pre-run state).
  const pending = recorded < total;

  // Confidence reflects the best we have in the ledger.
  // No records → 'unknown'. Any mock record present → 'mock'.
  // All records are 'unknown' → 'unknown'. (No 'direct' path this wave.)
  let confidence = 'unknown';
  if (records.length > 0) {
    const hasMock = records.some(
      (r) => r !== null && typeof r === 'object' && r.confidence === 'mock',
    );
    confidence = hasMock ? 'mock' : 'unknown';
  }

  const costPerTask = costPerCompletedTask(records);

  return Object.freeze({
    schemaVersion:   BASELINE_REPORT_SCHEMA_VERSION,
    scenariosTotal:  total,
    recorded,
    covered,
    pending,
    confidence,
    claim:           null,
    costPerTask:     Object.freeze(costPerTask),
  });
}

// ---------------------------------------------------------------------------
// presentBaseline
// ---------------------------------------------------------------------------

/**
 * Renders a baseline status object as a human-readable advisory string.
 *
 * Always states "baseline pending — no #176 run, claim null" when pending is
 * true. Output is informational only; callers must not parse it programmatically.
 *
 * @param {ReturnType<typeof baselineStatus>} status - Frozen status from
 *   baselineStatus().
 * @returns {string} Multi-line advisory text (no trailing newline).
 * @throws {TypeError} When status is null or not an object (caller mistake).
 */
export function presentBaseline(status) {
  if (status === null || typeof status !== 'object') {
    throw new TypeError('presentBaseline: status must be a non-null object');
  }

  const lines = [
    'Baseline status (advisory) — card #176 / CDK-003',
    '  schema:     ' + (status.schemaVersion ?? '(unknown)'),
    '  scenarios:  ' + (status.recorded ?? 0) + '/' + (status.scenariosTotal ?? 10) +
      ' recorded  (' + (status.covered ?? 0) + ' kind(s) covered)',
    '  pending:    ' + (status.pending ? 'YES — baseline pending — no #176 run, claim null' : 'no'),
    '  confidence: ' + (status.confidence ?? 'unknown'),
    '  claim:      null (evidence-tier not yet met: #176 baseline + #243 powered run required)',
  ];

  const cpt = status.costPerTask;
  if (cpt && cpt.value !== null && Number.isFinite(cpt.value)) {
    lines.push(
      '  cost/task:  ' + cpt.value.toFixed(6) + ' ' + (cpt.unit ?? 'USD/task') +
        ' [confidence=' + cpt.confidence + ']',
    );
  } else {
    lines.push('  cost/task:  null (no qa-green + cost records)');
  }

  return lines.join('\n');
}
