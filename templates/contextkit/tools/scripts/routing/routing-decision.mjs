/**
 * Routing decision + total-cost / over-orchestration guard (ADR-0094 §4, §6).
 *
 * Turns a classification (from `task-classifier.mjs`) plus an execution context
 * into a concrete policy route: `{ executor, model, policyWouldApply, applied,
 * mode, reasons, estimate, escalation }`. It enforces the mandatory
 * anti-over-orchestration policy:
 *   - **runner-first**: ≤ N simple deterministic commands run DIRECT, no subagent;
 *   - policy only recommends delegation when total-chain cost favours it;
 *   - `applied` remains false until an execution acknowledgement is reconciled.
 *
 * It composes existing engines, never forks them: tier→model via
 * `model-policy.aliasForTier` (ADR-0052), and the USD enrichment path via
 * `economics/cost-engine` + `model-policy.priceForTier` (EACP). Pure + never
 * throws — pricing/policy failures degrade to the tier alias and a heuristic.
 */

import { aliasForTier, priceForTier } from '../model-policy.mjs';
import { actualCost, routingSavings } from '../economics/cost-engine.mjs';

/** Rough relative per-token cost weights (order-of-magnitude, NOT USD). */
const TIER_WEIGHT = Object.freeze({ runner: 0, haiku: 1, sonnet: 4, opus: 20, fable: 60 });
/** One delegation's fixed orchestration overhead (spawn + handoff), in weight units. */
const ORCH_OVERHEAD = 1;
/** Expected review cost as a fraction of a premium pass, per risk band. */
const REVIEW_FRACTION = Object.freeze({ low: 0, medium: 0.3, high: 0.7, critical: 1 });

/** Deterministic 0–99 bucket from a task id (FNV-1a) — for canary sampling. */
function sampleBucket(taskId) {
  const str = String(taskId == null ? '' : taskId);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Heuristic relative cost of running the work directly vs via the chosen executor.
 * @param {string} executorTier - 'runner' | 'haiku' | 'sonnet' | 'opus'
 * @param {string} currentTier - the session's current tier (baseline; default opus)
 * @param {string} risk - risk band (drives review cost)
 * @returns {{ directRelative, delegatedRelative, recommendation, note }}
 */
function heuristicEstimate(executorTier, currentTier, risk) {
  const base = TIER_WEIGHT[currentTier] ?? TIER_WEIGHT.opus;
  const exec = TIER_WEIGHT[executorTier] ?? base;
  const reviewFrac = REVIEW_FRACTION[risk] ?? 0;
  const directRelative = base; // current tier does the work itself
  const delegatedRelative = executorTier === 'runner'
    ? 0 // direct deterministic execution, no model spend
    : exec + ORCH_OVERHEAD + reviewFrac * base;
  const recommendation = delegatedRelative < directRelative ? 'delegate' : 'direct';
  return {
    directRelative,
    delegatedRelative: Number(delegatedRelative.toFixed(2)),
    recommendation,
    note: executorTier === 'runner'
      ? 'runner-first: deterministic, no agent'
      : recommendation === 'direct'
        ? 'delegation not cheaper than direct — stay direct'
        : 'delegation reduces total estimated cost',
  };
}

/**
 * Decide the route for a classified task.
 *
 * @param {object} classification - from `classifyTask` ({ complexity, risk, executor, escalate, ... }).
 * @param {object} [context] - execution context.
 * @param {number} [context.commandCount] - explicit related command count (runner-first).
 * @param {string} [context.expectedOutput] - explicit 'short' | 'long'.
 * @param {boolean} [context.needsInterpretation] - explicit interpretation requirement.
 * @param {boolean} [context.batch] - explicit related mechanical batch fact.
 * @param {string} [context.taskId] - stable id for deterministic canary sampling.
 * @param {string} [context.currentTier] - session's current tier (baseline, default 'opus').
 * @param {boolean} [context.budgetExhausted] - pass-through to model-policy (ADR-0052).
 * @param {string} [context.host] - 'claude' | 'codex' | 'agy' (model-policy host map).
 * @param {object} [cfg] - resolved routing config (mode, canaryPct, runnerFirstMaxCommands, ...).
 * @returns {object} the frozen route decision.
 */
export function decideRoute(classification, context = {}, cfg = {}) {
  const cls = classification || {};
  const ctx = context || {};
  const mode = cfg.mode || 'shadow';
  const reasons = [];
  const reasonCodes = [];

  // 1. Runner-first guard (ADR-0094 §4 / mandatory §1): ≤ N simple deterministic
  //    commands with short output and no interpretation run DIRECT — no subagent.
  const maxRunner = Number(cfg.runnerFirstMaxCommands ?? 3);
  const has = (key) => Object.prototype.hasOwnProperty.call(ctx, key);
  const runnerFactsKnown = ['commandCount', 'expectedOutput', 'needsInterpretation', 'batch'].every(has);
  const commandCount = runnerFactsKnown ? Number(ctx.commandCount) : null;
  const runnerFactsValid = runnerFactsKnown
    && Number.isInteger(commandCount) && commandCount > 0
    && (ctx.expectedOutput === 'short' || ctx.expectedOutput === 'long')
    && typeof ctx.needsInterpretation === 'boolean'
    && typeof ctx.batch === 'boolean';
  const runnerEligible = cls.complexity === 'mechanical'
    && runnerFactsValid
    && commandCount <= maxRunner
    && ctx.expectedOutput === 'short'
    && ctx.needsInterpretation === false
    && ctx.batch === false;

  let executorTier = runnerEligible ? 'runner' : (cls.executor || 'sonnet');
  if (runnerEligible) {
    reasons.push(`runner-first: ${commandCount} ≤ ${maxRunner} simple cmd(s), direct`);
    reasonCodes.push('runner_eligible');
  } else if (cls.complexity === 'mechanical') {
    reasons.push('mechanical command facts absent/ineligible → operates tier (Haiku)');
    reasonCodes.push(!runnerFactsKnown ? 'runner_command_facts_missing'
      : !runnerFactsValid ? 'runner_command_facts_invalid' : 'runner_ineligible');
  }
  else reasons.push(`classified executor: ${executorTier}`);

  // Fable is never auto-selected (ADR-0052 / ADR-0094 §2) — defensive clamp.
  if (executorTier === 'fable' && cfg.allowAutomaticFable !== true) {
    executorTier = cfg.reasoningExecutor || 'opus';
    reasons.push('fable auto-selection blocked → reasoning tier');
    reasonCodes.push('fable_auto_blocked');
  } else if (executorTier === 'fable') {
    reasons.push('fable policy explicitly enabled; execution still requires manual acknowledgement');
    reasonCodes.push('fable_policy_explicit');
  }

  // 2. Concrete model for the tier (compose ADR-0052; degrade gracefully).
  let model = null;
  if (executorTier !== 'runner') {
    try {
      const resolved = aliasForTier(executorTier, { budgetExhausted: ctx.budgetExhausted, host: ctx.host });
      model = resolved?.model ?? null;
    } catch {
      model = null; // policy unavailable — keep the tier alias as the route
    }
  }

  // 3. Total-cost estimate (heuristic, synchronous, deterministic).
  const estimate = heuristicEstimate(executorTier, ctx.currentTier || 'opus', cls.risk || 'low');

  // 4. Policy gate by mode. This is recommendation truth only: execution
  //    `applied` requires a later correlated acknowledgement.
  let eligible = false;
  let policyWouldApply = false;
  let sampled = null;
  if (mode === 'active') {
    eligible = executorTier === 'runner' || estimate.recommendation === 'delegate';
    policyWouldApply = eligible;
    reasons.push(policyWouldApply ? 'active: policy selected route (execution unacknowledged)' : 'active: kept direct (no benefit)');
    reasonCodes.push(policyWouldApply ? 'active_policy_selected' : 'active_no_net_benefit');
  } else if (mode === 'canary') {
    const lowRiskMechanical = ['mechanical', 'simple'].includes(cls.complexity) && cls.risk === 'low';
    sampled = sampleBucket(ctx.taskId) < Number(cfg.canaryPct ?? 0);
    eligible = lowRiskMechanical;
    policyWouldApply = lowRiskMechanical && sampled;
    reasons.push(policyWouldApply ? `canary: policy selected ${cfg.canaryPct}% sample` : 'canary: not sampled / not eligible');
    reasonCodes.push(policyWouldApply ? 'canary_policy_selected'
      : lowRiskMechanical ? 'canary_not_sampled' : 'canary_ineligible');
  } else {
    eligible = executorTier === 'runner' || estimate.recommendation === 'delegate';
    policyWouldApply = eligible;
    reasons.push('shadow: recommend + measure only (executor unchanged)');
    reasonCodes.push('shadow_mode');
  }

  return Object.freeze({
    executor: executorTier,
    model,
    evaluated: true,
    eligible,
    recommended: true,
    directed: false,
    attempted: false,
    applied: false,
    skipped: mode === 'shadow',
    failed: false,
    status: mode === 'shadow' ? 'skipped' : 'recommended',
    policyWouldApply,
    mode,
    runnerFirst: runnerEligible,
    runnerFactsKnown,
    sampled,
    needsAuthorization: !!cls.needsAuthorization,
    escalation: Object.freeze({
      enabled: cfg.escalationEnabled !== false,
      suggested: !!cls.escalate && cfg.escalationEnabled !== false,
      order: ['haiku', 'sonnet', 'opus'],
    }),
    estimate: Object.freeze(estimate),
    classification: Object.freeze({ complexity: cls.complexity, risk: cls.risk, confidence: cls.confidence }),
    reasons,
    reasonCodes: Object.freeze(reasonCodes),
  });
}

/**
 * Async USD enrichment for a decision (EACP), used by telemetry/token-report.
 * Best-effort: returns `{ status: 'skipped' }` when pricing is unavailable rather
 * than guessing — graceful degradation reports skipped, never a false figure.
 *
 * @param {object} decision - a route from `decideRoute`.
 * @param {object} [opts]
 * @param {object} [opts.buckets] - token buckets for the unit of work.
 * @param {string} [opts.baselineTier] - tier the work would run on without routing (default 'opus').
 * @param {boolean} [opts.qualityEquivalent] - did the routed run pass the same QA bar?
 * @returns {Promise<object>} `{ routedUsd, baselineUsd, savings }` or `{ status: 'skipped' }`.
 */
export async function estimateRouteCostUsd(decision, opts = {}) {
  const buckets = opts.buckets;
  if (!buckets || decision?.executor === 'runner') return { status: 'skipped', reason: 'no buckets / runner' };
  try {
    const routedPrice = await priceForTier(decision.executor, undefined);
    const baselinePrice = await priceForTier(opts.baselineTier || 'opus', undefined);
    if (!routedPrice || !baselinePrice) return { status: 'skipped', reason: 'pricing unavailable' };
    const routedUsd = actualCost(buckets, { input: routedPrice.input, output: routedPrice.output });
    const baselineUsd = actualCost(buckets, { input: baselinePrice.input, output: baselinePrice.output });
    const savings = routingSavings(baselineUsd, routedUsd, opts.qualityEquivalent === true);
    return Object.freeze({ routedUsd, baselineUsd, savings });
  } catch {
    return { status: 'skipped', reason: 'estimate failed' };
  }
}
