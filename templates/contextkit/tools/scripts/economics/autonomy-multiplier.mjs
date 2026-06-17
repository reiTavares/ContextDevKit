/**
 * Autonomy Multiplier — EACP Wave 5 / card #241 (EACP-12).
 *
 * Measures "useful autonomy": tasks that met acceptance criteria, passed tests,
 * and reached QA green — without bypasses, rollbacks, or unlogged corrections.
 * The ratio of useful throughput WITH the kit vs. a baseline is the multiplier.
 *
 * Constitution §8: missing signals → skipped(reason); never a false pass.
 * Targets (1.30×/1.50×/1.70×) are targets, not claims; `claim` is always null
 * until card #242 benchmarks them. Goodhart guard: counts outcomes, not turns.
 * DETERMINISTIC: no Date.now() / Math.random() / new Date(). Zero runtime deps.
 */

import { skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier for autonomy-multiplier result objects. */
export const AUTONOMY_MULTIPLIER_SCHEMA_VERSION = 'eacp-autonomy-multiplier/1';

/**
 * Ordered substitute unit keys. Index 0 ('quota') is the PRIMARY unit.
 * @type {Readonly<string[]>}
 */
export const SUBSTITUTE_UNITS = Object.freeze([
  'quota', 'api-usd', 'effective-mtok', 'hour', 'host-snapshot',
]);

/**
 * Autonomy multiplier targets by programme phase (targets, not claims).
 * `claim` on every result is null until #242 benchmarks are complete.
 * @type {Readonly<{pilot: number, product: number, potential: number}>}
 */
export const AUTONOMY_TARGETS = Object.freeze({ pilot: 1.30, product: 1.50, potential: 1.70 });

const UNBENCHMARKED_NOTE =
  'Multiplier targets (pilot 1.30×, product 1.50×, potential 1.70×) are design ' +
  'targets, not measured claims. The observed multiplier is real but unbenchmarked ' +
  'until card #242 completes a controlled comparison. claim is null until then.';

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Returns true only when a task counts as "useful autonomy."
 * Goodhart guard: outcomes only — acceptance + tests + QA, never raw turns.
 * §13.2 independence gates: `externalCriteria` (independently-authored acceptance
 * criteria required) and `evaluatorNotOperator` (reviewer ≠ implementer required).
 * Missing fields are treated as false (most conservative interpretation).
 *
 * @param {{ acceptanceMet?: boolean, testsRun?: boolean, qaGreen?: boolean,
 *   externalCriteria?: boolean, evaluatorNotOperator?: boolean,
 *   criticalBypass?: boolean, immediateRollback?: boolean,
 *   materialErrorReopen?: boolean, humanIntervention?: boolean,
 *   humanInterventionLogged?: boolean }} task
 * @returns {boolean}
 */
export function usefulAutonomy(task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) return false;
  return (
    task.acceptanceMet        === true &&
    task.testsRun             === true &&
    task.qaGreen              === true &&
    task.externalCriteria     === true &&
    task.evaluatorNotOperator === true &&
    !task.criticalBypass  &&
    !task.immediateRollback &&
    !task.materialErrorReopen &&
    (!task.humanIntervention || task.humanInterventionLogged === true)
  );
}

/**
 * Returns specific exclusion reasons for a task. Empty array → task is useful.
 * Drives transparency: no silent caps, every criterion named individually.
 * §13.2: includes independence gates (externalCriteria, evaluatorNotOperator).
 *
 * @param {{ acceptanceMet?: boolean, testsRun?: boolean, qaGreen?: boolean,
 *   externalCriteria?: boolean, evaluatorNotOperator?: boolean,
 *   criticalBypass?: boolean, immediateRollback?: boolean,
 *   materialErrorReopen?: boolean, humanIntervention?: boolean,
 *   humanInterventionLogged?: boolean }} task
 * @returns {string[]}
 */
export function usefulReasons(task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    return ['not a valid task object'];
  }
  const reasons = [];
  if (task.acceptanceMet        !== true) reasons.push('acceptance criteria not met');
  if (task.testsRun             !== true) reasons.push('tests not run');
  if (task.qaGreen              !== true) reasons.push('QA not green');
  if (task.externalCriteria     !== true) reasons.push('acceptance criteria not independently authored');
  if (task.evaluatorNotOperator !== true) reasons.push('evaluator is the operator (not independent)');
  if (task.criticalBypass)                reasons.push('critical bypass present');
  if (task.immediateRollback)             reasons.push('immediate rollback');
  if (task.materialErrorReopen)           reasons.push('material-error reopen');
  if (task.humanIntervention && task.humanInterventionLogged !== true) {
    reasons.push('human intervention not logged');
  }
  return reasons;
}

/**
 * Counts useful tasks; lists excluded items with their index and reasons.
 * Non-array input degrades to empty result (constitution §8).
 *
 * @param {Array<object>} tasks
 * @returns {Readonly<{ greenCount: number, total: number,
 *   excluded: Array<{index: number, reasons: string[]}> }>}
 */
export function countUseful(tasks) {
  if (!Array.isArray(tasks)) {
    return Object.freeze({ greenCount: 0, total: 0, excluded: [] });
  }
  let greenCount = 0;
  const excluded = [];
  for (let index = 0; index < tasks.length; index++) {
    const reasons = usefulReasons(tasks[index]);
    if (reasons.length === 0) { greenCount++; }
    else { excluded.push({ index, reasons }); }
  }
  return Object.freeze({ greenCount, total: tasks.length, excluded });
}

/**
 * Selects the best available measurement unit for this host.
 * 'quota' is primary (directly observable, no pricing data needed).
 * Falls back to the first entry in `available` that is in SUBSTITUTE_UNITS
 * and is not 'quota'. Returns null when nothing qualifies.
 *
 * @param {boolean} quotaObservable
 * @param {string[]} [available]
 * @returns {string|null}
 */
export function selectUnit(quotaObservable, available = []) {
  if (quotaObservable === true) return 'quota';
  const substituteSet = new Set(SUBSTITUTE_UNITS);
  for (const candidate of available) {
    if (substituteSet.has(candidate) && candidate !== 'quota') return candidate;
  }
  return null;
}

/**
 * Computes the observed autonomy multiplier from two throughput measurements.
 *
 * multiplier = withKitRate / baselineRate
 *   where rate = qaGreen / units for each side.
 *
 * confidence: 'derived' for quota, 'inferred' for other recognised substitutes,
 * 'unknown' when unit is null or unrecognised.
 * `claim` is ALWAYS null — targets are not asserted until #242.
 * `baselineMeasured` is ALWAYS false pre-benchmark (card #242 pending).
 * `evidenceIds` lists external evidence IDs supplied by the caller (default []).
 * `reasonUnavailable` captures why a result cannot be more confident.
 *
 * @param {{ qaGreen: number, units: number }} withKit
 * @param {{ qaGreen: number, units: number }} baseline
 * @param {{ unit?: string, evidenceIds?: string[], reasonUnavailable?: string }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped', reason:string}>}
 */
export function autonomyMultiplier(withKit, baseline, opts = {}) {
  if (withKit  === null || typeof withKit  !== 'object' || Array.isArray(withKit)) {
    return skipped('withKit is missing or not an object');
  }
  if (baseline === null || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return skipped('baseline is missing or not an object');
  }
  if (!Number.isFinite(withKit.units)   || withKit.units   <= 0) {
    return skipped('withKit.units must be a finite number > 0');
  }
  if (!Number.isFinite(baseline.units)  || baseline.units  <= 0) {
    return skipped('baseline.units must be a finite number > 0');
  }
  if (!Number.isFinite(withKit.qaGreen)  || withKit.qaGreen  < 0) {
    return skipped('withKit.qaGreen must be a finite number >= 0');
  }
  if (!Number.isFinite(baseline.qaGreen) || baseline.qaGreen < 0) {
    return skipped('baseline.qaGreen must be a finite number >= 0');
  }

  const withKitRate  = withKit.qaGreen  / withKit.units;
  const baselineRate = baseline.qaGreen / baseline.units;
  if (baselineRate <= 0) return skipped('baselineRate <= 0; cannot compute multiplier');

  const multiplier        = withKitRate / baselineRate;
  const unit              = opts.unit ?? null;
  const evidenceIds       = Array.isArray(opts.evidenceIds) ? [...opts.evidenceIds] : [];
  const reasonUnavailable = typeof opts.reasonUnavailable === 'string'
    ? opts.reasonUnavailable : 'baseline not yet measured (card #242 pending)';
  const confidence = unit === 'quota'                           ? 'derived'
    : (unit !== null && SUBSTITUTE_UNITS.includes(unit))       ? 'inferred'
    : 'unknown';

  return Object.freeze({
    schemaVersion: AUTONOMY_MULTIPLIER_SCHEMA_VERSION,
    unit, withKitRate, baselineRate, multiplier, confidence,
    evidenceIds,
    reasonUnavailable,
    baselineMeasured: false,
    targets: AUTONOMY_TARGETS,
    claim: null,
    note: UNBENCHMARKED_NOTE,
  });
}

/**
 * Aggregates autonomy signals for the token-report output.
 * Either the useful count or the rate multiplier may be skipped independently.
 * Returns skipped() only when BOTH tasks list is empty AND no rate data exists.
 *
 * @param {{ tasks?: object[], withKit?: object, baseline?: object,
 *   quotaObservable?: boolean, availableUnits?: string[] }} input
 * @returns {Readonly<object>|Readonly<{status:'skipped', reason:string}>}
 */
export function multiplierSummary(input) {
  const raw = (input !== null && typeof input === 'object') ? input : {};
  const useful = countUseful(raw.tasks ?? []);
  const unit   = selectUnit(
    Boolean(raw.quotaObservable),
    Array.isArray(raw.availableUnits) ? raw.availableUnits : [],
  );
  const mult = (raw.withKit != null && raw.baseline != null)
    ? autonomyMultiplier(raw.withKit, raw.baseline, { unit })
    : skipped('no baseline/with-kit unit measurements');

  if (useful.total === 0 && mult.status === 'skipped') {
    return skipped('insufficient autonomy signals');
  }
  return Object.freeze({
    schemaVersion: AUTONOMY_MULTIPLIER_SCHEMA_VERSION,
    useful: { greenCount: useful.greenCount, total: useful.total },
    multiplier: mult,
    targets: AUTONOMY_TARGETS,
    baselineMeasured: false,
  });
}

/**
 * Renders an autonomy-multiplier advisory block as a plain string (no trailing
 * newline). Handles null, skipped markers, and partially-skipped summaries.
 *
 * @param {ReturnType<typeof multiplierSummary>|null|undefined} summary
 * @returns {string}
 */
export function presentAutonomy(summary) {
  if (summary == null) return 'Autonomy multiplier: skipped (no data)';
  if (summary.status === 'skipped') {
    return 'Autonomy multiplier: skipped (' + summary.reason + ')';
  }

  const lines = ['Autonomy multiplier (advisory):'];
  const mult  = summary.multiplier;
  if (mult && mult.status !== 'skipped') {
    lines.push(
      '  ratio: ' + mult.multiplier.toFixed(4) + '\xD7 (' +
      (mult.multiplier * 100).toFixed(1) + '%) ' +
      '| unit: ' + (mult.unit ?? 'unknown') +
      ' | confidence: ' + mult.confidence,
    );
  } else {
    lines.push('  ratio: skipped (' + ((mult && mult.reason) ? mult.reason : 'no rate data') + ')');
  }

  const u = summary.useful;
  lines.push('  useful tasks: ' + u.greenCount + ' / ' + u.total + ' reached QA-green');
  lines.push('  targets: pilot 1.30\xD7 \xB7 product 1.50\xD7 \xB7 potential 1.70\xD7 (targets, not measured claims)');
  lines.push('  Goodhart guard: useful count is gated on outcome (acceptance+tests+QA), not raw actions/turns.');
  return lines.join('\n');
}
