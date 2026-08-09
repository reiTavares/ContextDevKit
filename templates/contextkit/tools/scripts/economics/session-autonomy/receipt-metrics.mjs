/**
 * receipt-metrics.mjs — Session Autonomy Receipt: pure metric formulas.
 *
 * The single source for the receipt's derived numbers and their human-readable
 * formatting. These are the formulas §3 of the spec mandates, kept as PURE
 * functions (constitution §2): no I/O, no Date.now()/Math.random(), zero deps.
 *
 * Honesty invariants (spec §30) enforced here:
 *  - Autonomy gain, token reduction, and cost efficiency are SEPARATE metrics
 *    (#4, #5) — three distinct functions, never collapsed into one number.
 *  - Invalid / missing inputs return `null`, never zero (#19) and never a
 *    fabricated value (constitution §8: refuse, don't false-pass).
 *  - Display formatting avoids false precision (#17): a multiplier renders as
 *    `1.40×`, never `1.398274633×`. Raw values stay in the JSON payload.
 *
 * There is deliberately NO exported default multiplier constant (#24): the
 * `1.3983×` benchmark lives only in a scoped calibration profile, never in code.
 */

/** Returns true for a finite number (rejects NaN, Infinity, non-numbers). */
function isFinitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Returns true for a finite, non-negative number. */
function isFiniteNonNeg(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Rounds to a fixed number of decimals, returning a Number (not a string).
 * @param {number} value
 * @param {number} [decimals=2]
 * @returns {number|null} null when value is not finite.
 */
export function roundTo(value, decimals = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Token-efficiency multiplier = baselineTokens / observedTokens.
 * Equivalent-accepted-work consumption ratio (spec §2). NOT the autonomy
 * multiplier when work output differs — see the estimator for that distinction.
 * @returns {number|null}
 */
export function tokenEfficiencyMultiplier(observedTokens, baselineTokens) {
  if (!isFinitePositive(observedTokens) || !isFinitePositive(baselineTokens)) return null;
  return baselineTokens / observedTokens;
}

/**
 * Equivalent token reduction percent = (1 - observed/baseline) × 100 (spec §3.2).
 * A 1.70× multiplier is ~41.2% fewer tokens — NEVER 70% (#16). Keep this and
 * `autonomyGainPercent` separate.
 * @returns {number|null}
 */
export function tokenSavingsPercent(observedTokens, baselineTokens) {
  if (!isFinitePositive(observedTokens) || !isFinitePositive(baselineTokens)) return null;
  return (1 - observedTokens / baselineTokens) * 100;
}

/**
 * Saved tokens = baseline - observed (spec §21 estimatedSavedTokens).
 * @returns {number|null}
 */
export function savedTokens(observedTokens, baselineTokens) {
  if (!isFiniteNonNeg(observedTokens) || !isFiniteNonNeg(baselineTokens)) return null;
  return baselineTokens - observedTokens;
}

/**
 * Additional autonomous capacity percent = (multiplier - 1) × 100 (spec §3.1).
 * This is the autonomy GAIN, distinct from token reduction (#4).
 * @returns {number|null}
 */
export function autonomyGainPercent(multiplier) {
  if (!isFinitePositive(multiplier)) return null;
  return (multiplier - 1) * 100;
}

/**
 * Financial savings = baselineCost - observedCost (spec §3.3). USD amounts.
 * @returns {number|null}
 */
export function financialSavings(baselineCost, observedCost) {
  if (!isFiniteNonNeg(baselineCost) || !isFiniteNonNeg(observedCost)) return null;
  return baselineCost - observedCost;
}

/**
 * Financial savings percent = (1 - observed/baseline) × 100 (spec §3.3).
 * @returns {number|null}
 */
export function financialSavingsPercent(baselineCost, observedCost) {
  if (!isFinitePositive(baselineCost) || !isFiniteNonNeg(observedCost)) return null;
  return (1 - observedCost / baselineCost) * 100;
}

/**
 * Cost-efficiency multiplier = baselineCost / observedCost (spec §3.3).
 * A THIRD distinct metric (#5): may differ from token efficiency because
 * routing/cache/deterministic execution change cost without changing tokens.
 * @returns {number|null}
 */
export function costEfficiencyMultiplier(baselineCost, observedCost) {
  if (!isFinitePositive(baselineCost) || !isFinitePositive(observedCost)) return null;
  return baselineCost / observedCost;
}

/**
 * Cost per accepted task = totalObservedCost / acceptedTasks (spec §3.4).
 * Failed/incomplete/retried work stays in the numerator (#8); the caller passes
 * the FULL observed cost, not just successful calls.
 * @returns {number|null} null when there are no accepted tasks (avoid /0).
 */
export function costPerAcceptedTask(totalObservedCost, acceptedTasks) {
  if (!isFiniteNonNeg(totalObservedCost)) return null;
  if (typeof acceptedTasks !== 'number' || !Number.isInteger(acceptedTasks) || acceptedTasks <= 0) {
    return null;
  }
  return totalObservedCost / acceptedTasks;
}

// ---------------------------------------------------------------------------
// Human-readable formatting — avoid false precision (#17).
// ---------------------------------------------------------------------------

/**
 * Formats a multiplier for terminal/markdown: `1.40×` (2 decimals + × sign).
 * @returns {string} 'unavailable' when value is not finite.
 */
export function formatMultiplier(value) {
  if (!isFinitePositive(value)) return 'unavailable';
  return value.toFixed(2) + '×';
}

/**
 * Formats a multiplier interval: `1.22×–1.43×` (spec §10.3 low-confidence band).
 * @returns {string}
 */
export function formatMultiplierRange(lower, upper) {
  if (!isFinitePositive(lower) || !isFinitePositive(upper)) return 'unavailable';
  return lower.toFixed(2) + '×–' + upper.toFixed(2) + '×';
}

/**
 * Formats a percent: `39.8%` (1 decimal by default).
 * @returns {string} 'unavailable' when value is not finite.
 */
export function formatPercent(value, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
  return value.toFixed(decimals) + '%';
}

/**
 * Formats a signed percent for gains: `+39.8%`.
 * @returns {string}
 */
export function formatSignedPercent(value, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(decimals) + '%';
}

/**
 * Formats a token count with thousands separators: `223,453`.
 * Deterministic (no locale dependency): manual grouping.
 * @returns {string} 'unavailable' when value is not a finite number.
 */
export function formatTokens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));
  let grouped = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits[i];
  }
  return sign + grouped;
}

/**
 * Formats a USD amount: `$1.84`. Two decimals.
 * @returns {string} 'unavailable' when value is not finite.
 */
export function formatUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
  const sign = value < 0 ? '-' : '';
  return sign + '$' + Math.abs(value).toFixed(2);
}
