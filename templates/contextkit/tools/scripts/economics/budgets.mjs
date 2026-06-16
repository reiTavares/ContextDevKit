/**
 * Budget guards & cost advisories — EACP Wave 4 / card #238 (§E budgets).
 *
 * Advisory-only: evaluates current spend against configured budget limits and
 * produces a mode classification (observe → warn → downgrade → split → block)
 * with an actionable recommendation. Never blocks execution; surfaces the
 * `budgetExhausted` boolean that the existing autonomy resolver (ADR-0044 D3)
 * already consumes at grade 4. This module IS NOT a new enforcement gate.
 *
 * Responsibility split (mirrors cost-engine.mjs → token-report-cost.mjs): this
 * file is the evaluation ENGINE (evaluate → recommend → audit). The human-facing
 * surface (bypass + present) lives in the sibling `budgets-report.mjs`.
 *
 * Constitution §8 (refuse-by-default): skipped() is returned whenever required
 * inputs are missing or unusable — never a false "within budget" or "$0" result.
 *
 * DETERMINISTIC: no Date.now(), no Math.random(), no new Date(). Timestamps come
 * from context.ts (null when absent).
 *
 * Zero runtime dependencies: node:* or relative imports only.
 */

import { skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Monotonic schema identifier — bump on breaking result-shape changes. */
export const BUDGET_SCHEMA_VERSION = 'eacp-budget/1';

/**
 * Canonical budget scopes. The scope names the time/resource boundary being
 * metered. Must be present in budget.scope for evaluateBudget to proceed.
 * @type {Readonly<string[]>}
 */
export const BUDGET_SCOPES = Object.freeze([
  'call', 'turn', 'task', 'session', 'workflow', 'run',
  'day', 'week', 'month', 'agent', 'squad', 'model', 'provider',
]);

/**
 * Canonical escalation ladder (low → high). Modes are assigned by threshold,
 * then may be escalated by pressure band, then clamped by the ceiling.
 * @type {Readonly<string[]>}
 */
export const BUDGET_MODES = Object.freeze([
  'observe', 'warn', 'ask', 'downgrade', 'split', 'block',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the index of a mode in BUDGET_MODES. -1 if not found.
 * @param {string} mode
 * @returns {number}
 */
function modeIndex(mode) {
  return BUDGET_MODES.indexOf(mode);
}

/** Rounds a number to N decimal places. @param {number} value @param {number} decimals @returns {number} */
function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Looks up the next-cheaper approved model for a given tier from the policy
 * ladder. Respects the floor when the caller marks a criticalTask.
 *
 * @param {string} currentTier - The tier currently in use (e.g. 'powerful').
 * @param {object} policy - Policy object with `ladder`, `floorTier`, and `tiers`.
 * @param {{ criticalTask?: boolean }} [opts]
 * @returns {{ tier: string, model: string|null, atFloor: boolean, alreadyLowest: boolean } | null}
 *   null when policy is missing, ladder is not an array, or currentTier is unknown.
 */
export function recommendCheaperModel(currentTier, policy, opts = {}) {
  const ladder = policy?.ladder;
  if (!Array.isArray(ladder)) return null;

  const at = ladder.indexOf(currentTier);
  if (at < 0) return null;

  let targetIdx;
  if (opts.criticalTask === true && policy.floorTier) {
    const floorIdx = ladder.indexOf(policy.floorTier);
    targetIdx = Math.max(at - 1, floorIdx >= 0 ? floorIdx : 0);
  } else {
    targetIdx = Math.max(at - 1, 0);
  }

  const tier = ladder[targetIdx];
  const atFloor = policy.floorTier ? tier === policy.floorTier : false;
  const model = policy.tiers?.[tier]?.alias ?? null;

  return { tier, model, atFloor, alreadyLowest: targetIdx === at };
}

/**
 * Builds an append-only audit record for a budget evaluation event.
 * Timestamps come exclusively from context.ts — never from Date.now().
 *
 * @param {{ scope?: string, mode?: string, ratio?: number, spend?: number,
 *   limit?: number, budgetExhausted?: boolean, criticalTask?: boolean }} fields
 * @param {{ ts?: number }} [context]
 * @returns {Readonly<{ scope: string|null, mode: string|null, ratio: number|null,
 *   spend: number|null, limit: number|null, budgetExhausted: boolean,
 *   criticalTask: boolean, bypass: null, ts: number|null }>}
 */
export function auditRecord(fields, context = {}) {
  return Object.freeze({
    scope:           fields.scope          ?? null,
    mode:            fields.mode           ?? null,
    ratio:           Number.isFinite(fields.ratio)  ? fields.ratio  : null,
    spend:           Number.isFinite(fields.spend)  ? fields.spend  : null,
    limit:           Number.isFinite(fields.limit)  ? fields.limit  : null,
    budgetExhausted: fields.budgetExhausted === true,
    criticalTask:    fields.criticalTask   === true,
    bypass:          null,
    ts:              Number.isFinite(context.ts) ? context.ts : null,
  });
}

/**
 * Core budget evaluator. Compares current spend against a budget configuration
 * and returns an advisory object with mode, recommendation, and audit record.
 *
 * Degrades to skipped() on any missing or unusable input — never fabricates a
 * false "within budget" result (constitution §8).
 *
 * @param {{ usd?: number, tokens?: number }} spend - Current spend metrics.
 * @param {{ scope: string, limit: number, hardCap?: number, warnAtPct?: number,
 *   ceilingMode?: string, unit?: 'usd'|'tokens' }} budget - Budget configuration.
 * @param {{ pressureBand?: 'healthy'|'elevated'|'hot'|'critical',
 *   criticalTask?: boolean, ts?: number,
 *   currentTier?: string, policy?: object }} [context]
 * @returns {Readonly<{ schemaVersion: string, scope: string, unit: string,
 *   mode: string, ratio: number, spend: number, limit: number,
 *   hardCap: number|null, budgetExhausted: boolean, floorPreserved: boolean,
 *   recommendation: string, confidence: 'derived', audit: object }>
 *   | Readonly<{ status: 'skipped', reason: string }>}
 */
export function evaluateBudget(spend, budget, context = {}) {
  // 1. Validate budget object and scope.
  if (budget === null || budget === undefined) {
    return skipped('budget undefined or limit<=0');
  }
  if (!BUDGET_SCOPES.includes(budget.scope)) {
    return skipped('budget undefined or limit<=0');
  }
  if (!Number.isFinite(budget.limit) || budget.limit <= 0) {
    return skipped('budget undefined or limit<=0');
  }

  // 2. Determine unit and extract metric.
  const unit = budget.unit === 'usd' ? 'usd' : 'tokens';
  const metric = unit === 'usd' ? spend?.usd : spend?.tokens;
  if (!Number.isFinite(metric) || metric < 0) {
    return skipped('spend metric (' + unit + ') unavailable');
  }

  // 3. Warn threshold.
  const limit = budget.limit;
  const warnPct = Number.isFinite(budget.warnAtPct) ? budget.warnAtPct : 80;
  const warnLine = limit * warnPct / 100;

  // 4. Spend ratio, stable 4-decimal output.
  const ratio = round(metric / limit, 4);

  // 5. Natural mode from thresholds.
  const hardCap = Number.isFinite(budget.hardCap) && budget.hardCap > 0
    ? budget.hardCap
    : null;

  let naturalMode;
  if (hardCap !== null && metric >= hardCap) {
    naturalMode = 'block';
  } else if (metric >= limit) {
    naturalMode = 'downgrade';
  } else if (metric >= warnLine) {
    naturalMode = 'warn';
  } else {
    naturalMode = 'observe';
  }

  // 6. Pressure escalation (Wave 3 #236 signal).
  const pressureBand = context.pressureBand;
  let escalatedMode = naturalMode;
  if (
    (pressureBand === 'hot' || pressureBand === 'critical') &&
    modeIndex(naturalMode) >= modeIndex('warn') &&
    modeIndex(naturalMode) < modeIndex('block')
  ) {
    escalatedMode = 'split';
  }

  // 7. Ceiling clamp.
  const ceilingMode = BUDGET_MODES.includes(budget.ceilingMode)
    ? budget.ceilingMode
    : 'block';
  const mode = BUDGET_MODES[Math.min(modeIndex(escalatedMode), modeIndex(ceilingMode))];

  // 8. Budget exhausted signal for autonomy resolver (ADR-0044 D3).
  const budgetExhausted = ['downgrade', 'split', 'block'].includes(mode);

  // 9. Floor preservation for critical tasks.
  const floorPreserved = context.criticalTask === true;

  // 10. Recommendation string.
  let recommendation;
  if (mode === 'observe') {
    recommendation = 'within budget (observe)';
  } else if (mode === 'warn' || mode === 'ask') {
    if (context.policy && context.currentTier) {
      const rec = recommendCheaperModel(
        context.currentTier,
        context.policy,
        { criticalTask: context.criticalTask },
      );
      if (rec) {
        recommendation =
          'approaching budget — consider cheaper approved model: ' +
          rec.tier +
          (rec.atFloor ? ' (at floor)' : '');
      } else {
        recommendation = 'approaching budget — consider a cheaper approved model';
      }
    } else {
      recommendation = 'approaching budget — consider a cheaper approved model';
    }
  } else if (mode === 'downgrade') {
    recommendation =
      'over budget — downgrade autonomy/model' +
      (floorPreserved ? '; critical task: preserve model floor' : '');
  } else if (mode === 'split') {
    recommendation =
      'high session pressure (' + pressureBand + ') — recommend session/fan-out split';
  } else {
    // block
    recommendation = 'hard cap exceeded — new fan-out blocked unless a human approves';
  }

  // 11. Confidence is always 'derived': computed from a real spend metric.
  const confidence = 'derived';

  // 12. Audit record.
  const audit = auditRecord(
    { scope: budget.scope, mode, ratio, spend: metric, limit, budgetExhausted, criticalTask: floorPreserved },
    context,
  );

  // 13. Return frozen advisory object.
  return Object.freeze({
    schemaVersion: BUDGET_SCHEMA_VERSION,
    scope:          budget.scope,
    unit,
    mode,
    ratio,
    spend:          metric,
    limit,
    hardCap,
    budgetExhausted,
    floorPreserved,
    recommendation,
    confidence,
    audit,
  });
}
