/**
 * Growth section validator for Business work contexts (BIZ-0001 / WF-0036 A3-T1).
 *
 * Enforces spec §10.4 rules for the `growth` block of a Business:
 *   (a) Causal chain: valueIntent → growthLever → KPI must all be present/non-empty.
 *   (b) KPI completeness: each KPI needs `metric`, `target`, `owner`, `cadence`.
 *   (c) Generic/unquantified claims: target must contain a number OR the sentinel
 *       literals `unknown` / `to-be-defined` / `n/a` — bare prose is rejected.
 *   (d) Baseline honesty: baseline === 'unknown' (or null / undefined) is ALLOWED
 *       and must NOT be flagged; a numeric baseline WITHOUT a `source` field is
 *       REJECTED (no invented baselines).
 *   (e) Returns explainable `errors` with stable `code` identifiers.
 *
 * Zero runtime dependencies — no npm packages; uses `node:*` via callers only.
 * Designed to be side-effect-free on import so selftests can import it anywhere.
 * Every export is a pure function; no module-level I/O.
 */

/**
 * Stable error codes for machine-readable error identification.
 * Consumers (test agents, orchestrators) key off these codes — do NOT rename.
 */
export const GROWTH_ERROR_CODES = Object.freeze({
  MISSING_VALUE_INTENT: 'MISSING_VALUE_INTENT',
  MISSING_GROWTH_LEVER: 'MISSING_GROWTH_LEVER',
  MISSING_KPI_LIST: 'MISSING_KPI_LIST',
  EMPTY_KPI_LIST: 'EMPTY_KPI_LIST',
  KPI_MISSING_FIELD: 'KPI_MISSING_FIELD',
  KPI_UNQUANTIFIED_TARGET: 'KPI_UNQUANTIFIED_TARGET',
  KPI_BASELINE_WITHOUT_SOURCE: 'KPI_BASELINE_WITHOUT_SOURCE',
  GROWTH_NOT_OBJECT: 'GROWTH_NOT_OBJECT',
  KPI_NOT_OBJECT: 'KPI_NOT_OBJECT',
});

/** Sentinel strings that are accepted in place of an actual numeric target. */
const ALLOWED_NON_NUMERIC_TARGETS = Object.freeze(['unknown', 'to-be-defined', 'n/a', 'tbd']);

/** Required fields every individual KPI entry must carry. */
const REQUIRED_KPI_FIELDS = Object.freeze(['metric', 'target', 'owner', 'cadence']);

/**
 * Tests whether a value is a non-empty string after trimming.
 *
 * @param {unknown} candidate - value to test.
 * @returns {boolean}
 */
function isNonEmptyString(candidate) {
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

/**
 * Returns true when `target` is either a recognised sentinel or contains at
 * least one digit (the minimal evidence of quantification).
 *
 * @param {unknown} target - the raw `target` field value from a KPI.
 * @returns {boolean}
 */
function isQuantifiedTarget(target) {
  if (!isNonEmptyString(target)) return false;
  const normalised = target.trim().toLowerCase();
  if (ALLOWED_NON_NUMERIC_TARGETS.includes(normalised)) return true;
  // A number/unit anywhere in the string counts (e.g. "100%", ">= 95 ms", "0").
  return /\d/.test(target);
}

/**
 * Returns true when `baseline` is in the "unknown / absent" family that must
 * NOT be flagged.  Specifically: null, undefined, or the string 'unknown'.
 *
 * @param {unknown} baseline - the raw `baseline` field.
 * @returns {boolean}
 */
function isAllowedBaseline(baseline) {
  if (baseline === null || baseline === undefined) return true;
  if (typeof baseline === 'string' && baseline.trim().toLowerCase() === 'unknown') return true;
  return false;
}

/**
 * Returns true when `baseline` is a numeric value (number primitive OR a string
 * whose trimmed content starts with a digit or sign followed by digits).
 *
 * @param {unknown} baseline - the raw `baseline` field.
 * @returns {boolean}
 */
function isNumericBaseline(baseline) {
  if (typeof baseline === 'number' && !Number.isNaN(baseline)) return true;
  if (typeof baseline === 'string') {
    return /^[+-]?\d/.test(baseline.trim());
  }
  return false;
}

/**
 * Validates a single KPI object from the `growth.kpis` list.
 *
 * @param {unknown} kpi - the raw KPI entry.
 * @param {number} index - position in the kpis array (for error path).
 * @param {Array<{code:string,field:string,message:string}>} errors - sink.
 * @returns {void}
 */
function validateKpi(kpi, index, errors) {
  const path = `growth.kpis[${index}]`;

  if (!kpi || typeof kpi !== 'object' || Array.isArray(kpi)) {
    errors.push({
      code: GROWTH_ERROR_CODES.KPI_NOT_OBJECT,
      field: path,
      message: `${path}: each KPI must be a non-array object`,
    });
    return; // Cannot validate fields of a non-object.
  }

  // (b) KPI completeness: all four required fields must be non-empty strings.
  for (const fieldName of REQUIRED_KPI_FIELDS) {
    if (!isNonEmptyString(kpi[fieldName])) {
      errors.push({
        code: GROWTH_ERROR_CODES.KPI_MISSING_FIELD,
        field: `${path}.${fieldName}`,
        message: `${path}.${fieldName}: required non-empty string`,
      });
    }
  }

  // (c) Target quantification — only check when the field is present as a string.
  if ('target' in kpi && !isQuantifiedTarget(kpi.target)) {
    errors.push({
      code: GROWTH_ERROR_CODES.KPI_UNQUANTIFIED_TARGET,
      field: `${path}.target`,
      message:
        `${path}.target: generic/unquantified target "${kpi.target}" — ` +
        `supply a number+unit or use a sentinel ('unknown', 'to-be-defined', 'n/a')`,
    });
  }

  // (d) Baseline honesty: allowed if absent/null/'unknown'; forbidden if numeric+no source.
  const baseline = kpi.baseline;
  if (!isAllowedBaseline(baseline) && isNumericBaseline(baseline)) {
    if (!isNonEmptyString(kpi.source)) {
      errors.push({
        code: GROWTH_ERROR_CODES.KPI_BASELINE_WITHOUT_SOURCE,
        field: `${path}.baseline`,
        message:
          `${path}.baseline: numeric baseline "${baseline}" requires a ` +
          `non-empty "source" field — no invented baselines (spec §10.4)`,
      });
    }
  }
}

/**
 * Validates the `growth` block of a Business work context.
 *
 * The `growth` object passed in is only the `business.growth` sub-object, NOT
 * the full business document.  The `valueIntent` string is the business-level
 * `valueIntents.primary` field, which the caller must extract and pass in.
 *
 * Rules enforced:
 *   (a) Causal chain: `valueIntent` arg must be non-empty; `growth.primaryLever`
 *       must be non-empty; `growth.kpis` must exist and be non-empty.
 *   (b) KPI completeness: metric + target + owner + cadence.
 *   (c) Unquantified targets rejected.
 *   (d) Numeric baselines without source rejected; null/unknown baselines allowed.
 *
 * @param {{ growth: unknown, valueIntent?: unknown }} input
 *   - `growth`: the `business.growth` sub-object.
 *   - `valueIntent`: the business-level primary value intent string (may be
 *     omitted — the causal chain check then fails for MISSING_VALUE_INTENT).
 * @returns {{ ok: boolean, errors: Array<{code: string, field: string, message: string}> }}
 */
export function validateGrowth(input = {}) {
  // Defensive: a null/primitive/array arg must never throw — it yields ok:false.
  const { growth, valueIntent } = (input && typeof input === 'object' && !Array.isArray(input))
    ? input
    : {};
  const errors = [];

  // (a) Step 1 — check the caller-supplied valueIntent (the top of the causal chain).
  if (!isNonEmptyString(valueIntent)) {
    errors.push({
      code: GROWTH_ERROR_CODES.MISSING_VALUE_INTENT,
      field: 'valueIntents.primary',
      message: 'valueIntents.primary: required non-empty string — causal chain starts here',
    });
  }

  // Growth must be a non-array object.
  if (!growth || typeof growth !== 'object' || Array.isArray(growth)) {
    errors.push({
      code: GROWTH_ERROR_CODES.GROWTH_NOT_OBJECT,
      field: 'growth',
      message: 'growth: required non-array object',
    });
    // Cannot check sub-fields; return early.
    return { ok: errors.length === 0, errors };
  }

  // (a) Step 2 — growth lever.
  if (!isNonEmptyString(growth.primaryLever)) {
    errors.push({
      code: GROWTH_ERROR_CODES.MISSING_GROWTH_LEVER,
      field: 'growth.primaryLever',
      message: 'growth.primaryLever: required non-empty string — causal chain middle link',
    });
  }

  // (a) Step 3 — KPI list presence.
  if (!('kpis' in growth)) {
    errors.push({
      code: GROWTH_ERROR_CODES.MISSING_KPI_LIST,
      field: 'growth.kpis',
      message: 'growth.kpis: required — causal chain end requires at least one KPI',
    });
    return { ok: errors.length === 0, errors };
  }

  if (!Array.isArray(growth.kpis)) {
    errors.push({
      code: GROWTH_ERROR_CODES.MISSING_KPI_LIST,
      field: 'growth.kpis',
      message: 'growth.kpis: must be an array',
    });
    return { ok: errors.length === 0, errors };
  }

  if (growth.kpis.length === 0) {
    errors.push({
      code: GROWTH_ERROR_CODES.EMPTY_KPI_LIST,
      field: 'growth.kpis',
      message: 'growth.kpis: must contain at least one KPI',
    });
    return { ok: errors.length === 0, errors };
  }

  // (b, c, d) Validate each KPI entry.
  for (let idx = 0; idx < growth.kpis.length; idx += 1) {
    validateKpi(growth.kpis[idx], idx, errors);
  }

  return { ok: errors.length === 0, errors };
}
