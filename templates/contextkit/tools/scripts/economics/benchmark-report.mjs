/**
 * Benchmark scoring + advisory report — EACP Wave 6 / card #242 (EACP-13).
 *
 * Independent QA scoring of a run, the matched-pair C-vs-A comparison, and the
 * advisory report. This wave ships NO claim: comparisons degrade to
 * confidence 'unknown' because the #176 baseline is unbuilt and runs are mock.
 *
 * QA independence (benchmark-plan §"QA independence", panel M7):
 *   - The evaluator MUST differ from the run operator; otherwise the verdict is
 *     'unknown' (agent-graded-own-work → not trustworthy).
 *   - Insufficient evidence (no acceptance result, no deterministic suite) →
 *     'unknown', never a default pass (constitution §8 false-negative trap).
 * Honesty: `claim` is ALWAYS null this wave (ADR-0080 evidence tier not met).
 * DETERMINISTIC: no Date.now() / Math.random() / new Date(). Zero runtime deps.
 */

import { skipped } from './privacy.mjs';
import { BENCHMARK_TARGETS } from './benchmark-design.mjs';

/** Canonical schema identifier for benchmark report objects. */
export const BENCHMARK_REPORT_SCHEMA_VERSION = 'eacp-benchmark-report/1';

/** Valid QA verdicts. 'unknown' is the conservative default, never a pass. */
export const QA_VERDICTS = Object.freeze(['pass', 'fail', 'unknown']);

// ---------------------------------------------------------------------------
// Independent QA scoring
// ---------------------------------------------------------------------------

/**
 * Scores one run against an externally-authored acceptance result.
 *
 * The verdict is 'unknown' unless ALL hold: the run is a real record (not a
 * skipped marker), the evaluator is named AND differs from the run operator,
 * and a boolean acceptance result is supplied. A mock run can be scored for
 * plumbing tests but yields verdict 'unknown' with reason 'mock run'.
 *
 * @param {object} run - a run record from benchmark-run.runArm.
 * @param {{ acceptancePass?: boolean, deterministicSuitePass?: boolean }} acceptance
 * @param {{ evaluator?: string }} [opts] - evaluator identity (≠ run.operator).
 * @returns {Readonly<{ schemaVersion: string, arm: string|null,
 *   verdict: string, reason: string, claim: null }>}
 */
export function scoreRun(run, acceptance, opts = {}) {
  const base = { schemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION, arm: null, claim: null };

  if (run === null || typeof run !== 'object' || run.status === 'skipped') {
    return Object.freeze({ ...base, verdict: 'unknown', reason: 'no scorable run' });
  }
  const arm = typeof run.arm === 'string' ? run.arm : null;

  const evaluator = (typeof opts?.evaluator === 'string' && opts.evaluator.trim()) ? opts.evaluator.trim() : null;
  if (evaluator === null) {
    return Object.freeze({ ...base, arm, verdict: 'unknown', reason: 'no independent evaluator named' });
  }
  if (run.operator !== null && evaluator === run.operator) {
    return Object.freeze({ ...base, arm, verdict: 'unknown', reason: 'evaluator equals run operator (not independent)' });
  }
  if (run.confidence === 'mock') {
    return Object.freeze({ ...base, arm, verdict: 'unknown', reason: 'mock run — not a real measurement' });
  }

  const accept = (acceptance !== null && typeof acceptance === 'object') ? acceptance : {};
  if (typeof accept.acceptancePass !== 'boolean') {
    return Object.freeze({ ...base, arm, verdict: 'unknown', reason: 'no acceptance result (insufficient evidence)' });
  }
  const suitePass = accept.deterministicSuitePass !== false; // absent → not a blocker, but acceptance must pass
  const verdict = (accept.acceptancePass && suitePass) ? 'pass' : 'fail';
  return Object.freeze({ ...base, arm, verdict, reason: 'scored against external acceptance' });
}

// ---------------------------------------------------------------------------
// Matched-pair comparison (C vs A)
// ---------------------------------------------------------------------------

/**
 * Computes the C-vs-A QA-green-per-unit ratio for a pilot. Returns confidence
 * 'unknown' (and claim null) unless BOTH arms are real (non-mock) runs with a
 * positive unit count and a non-negative qaGreen count. This wave never returns
 * a non-null claim — the #176 baseline is unbuilt.
 *
 * @param {{ A?: {qaGreen?: number, units?: number, mock?: boolean},
 *   C?: {qaGreen?: number, units?: number, mock?: boolean} }} arms
 * @returns {Readonly<object>}
 */
export function comparePilot(arms) {
  const base = {
    schemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION,
    ratio: null, confidence: 'unknown', claim: null, targets: BENCHMARK_TARGETS,
  };
  const source = (arms !== null && typeof arms === 'object') ? arms : {};
  const a = source.A;
  const c = source.C;

  const real = (x) => x !== null && typeof x === 'object' && x.mock !== true &&
    Number.isFinite(x.units) && x.units > 0 &&
    Number.isFinite(x.qaGreen) && x.qaGreen >= 0;

  if (!real(a) || !real(c)) {
    return Object.freeze({ ...base, reason: 'arms missing, mock, or non-positive units — comparison unknown' });
  }
  const aRate = a.qaGreen / a.units;
  const cRate = c.qaGreen / c.units;
  if (aRate <= 0) {
    return Object.freeze({ ...base, reason: 'baseline (A) rate <= 0 — ratio undefined' });
  }
  // Real, baseline-backed data could exist in a later wave; even then claim stays
  // null until #243's powered run clears the ADR-0080 evidence tier.
  return Object.freeze({
    ...base, ratio: cRate / aRate, confidence: 'measured-unbenchmarked',
    reason: 'real arms present, but claim remains null until #243 powered run',
  });
}

// ---------------------------------------------------------------------------
// Advisory report + presentation
// ---------------------------------------------------------------------------

/**
 * Builds an advisory benchmark report from run records + an optional comparison.
 * Never asserts a claim. Empty runs → a report flagged 'no runs'.
 *
 * @param {object[]} runs - run records (may include skipped markers; counted).
 * @param {ReturnType<typeof comparePilot>|null} [comparison]
 * @returns {Readonly<object>}
 */
export function benchmarkReport(runs, comparison = null) {
  const list = Array.isArray(runs) ? runs : [];
  let mock = 0;
  let real = 0;
  let skippedCount = 0;
  for (const run of list) {
    if (run?.status === 'skipped') { skippedCount++; }
    else if (run?.confidence === 'mock') { mock++; }
    else { real++; }
  }
  return Object.freeze({
    schemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION,
    runs: list.length,
    mockRuns: mock,
    realRuns: real,
    skippedRuns: skippedCount,
    comparison: comparison ?? comparePilot(null),
    claim: null,
    targets: BENCHMARK_TARGETS,
  });
}

/**
 * Renders an advisory report as a multi-line string (no trailing newline).
 * Null/empty → a single 'skipped' line.
 *
 * @param {ReturnType<typeof benchmarkReport>|null|undefined} report
 * @returns {string}
 */
export function presentBenchmark(report) {
  if (!report || typeof report !== 'object') return 'Benchmark: skipped (no report)';
  if (report.runs === 0) return 'Benchmark (advisory): no runs recorded yet';

  const cmp = report.comparison ?? {};
  const ratioStr = (cmp.ratio === null || cmp.ratio === undefined)
    ? 'unknown'
    : cmp.ratio.toFixed(4) + '\xD7';
  return [
    'Benchmark (advisory): ' + report.runs + ' run(s) — ' +
      report.realRuns + ' real, ' + report.mockRuns + ' mock, ' + report.skippedRuns + ' skipped',
    '  C-vs-A ratio: ' + ratioStr + ' [confidence: ' + (cmp.confidence ?? 'unknown') + ']',
    '  targets: pilot 1.30\xD7 \xB7 full 1.50\xD7 \xB7 potential 1.70\xD7 (targets, not claims)',
    '  claim: null (no causal claim before #176 baseline + #243 powered run — ADR-0080)',
  ].join('\n');
}
