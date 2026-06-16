/**
 * Budget guard human-facing surface — EACP Wave 4 / card #238 (§E budgets).
 *
 * The presentation + human-bypass half of the budget pipeline (the evaluation
 * ENGINE lives in `budgets.mjs`). Mirrors the cluster split between cost-engine
 * and token-report-cost: math stays pure; this file renders and records the
 * human action.
 *
 * Constitution §8 (refuse-by-default): presentBudget surfaces skipped() markers
 * as "skipped (reason)", never as a false pass; applyBypass REFUSES a bypass
 * without provenance (a bypass without an owner is an explicit refusal).
 *
 * DETERMINISTIC: no Date.now(), no Math.random(), no new Date().
 * Zero runtime dependencies: relative imports only.
 */

/**
 * Applies a human bypass to a budget advisory, overriding the mode to 'observe'
 * and recording provenance. Refuses any bypass missing `by` or `reason` strings
 * (constitution §8 — a bypass without provenance is an explicit refusal).
 *
 * @param {object|null|undefined} advisory - Output of evaluateBudget().
 * @param {{ by: string, reason: string }} bypass - Human bypass provenance.
 * @returns {Readonly<object>} New frozen advisory with mode:'observe' and bypass
 *   recorded, or the original skipped advisory unchanged.
 * @throws {TypeError} When bypass is missing or lacks non-empty `by`/`reason`.
 */
export function applyBypass(advisory, bypass) {
  if (
    !bypass ||
    typeof bypass.by !== 'string' || bypass.by.trim() === '' ||
    typeof bypass.reason !== 'string' || bypass.reason.trim() === ''
  ) {
    throw new TypeError('applyBypass: bypass requires { by, reason }');
  }

  if (advisory?.status === 'skipped') return advisory;

  return Object.freeze({
    ...advisory,
    mode:           'observe',
    budgetExhausted: false,
    recommendation: 'human bypass — ' + bypass.reason,
    audit:          Object.freeze({
      ...advisory.audit,
      bypass: Object.freeze({ by: bypass.by, reason: bypass.reason }),
    }),
  });
}

/**
 * Renders a budget advisory as a human-readable multi-line string (no trailing
 * newline). Handles skipped markers gracefully — never surfaces a missing
 * advisory as a false pass (constitution §8).
 *
 * @param {object|null|undefined} advisory - Output of evaluateBudget() or applyBypass().
 * @returns {string} Multi-line display string.
 */
export function presentBudget(advisory) {
  if (advisory == null) {
    return 'Budget guard: skipped (no data)';
  }
  if (advisory.status === 'skipped') {
    return 'Budget guard: skipped (' + advisory.reason + ')';
  }

  const pct = Math.round(advisory.ratio * 100);
  const lines = [
    'Budget guard (advisory): ' + advisory.scope + ' ' + advisory.mode +
      ' — ' + pct + '% of limit',
    '  ' + advisory.recommendation,
  ];

  const bypassRecord = advisory.audit?.bypass;
  if (bypassRecord) {
    lines.push('  bypass: ' + bypassRecord.by + ' — ' + bypassRecord.reason);
  }

  return lines.join('\n');
}
