/**
 * Routing economics (EACP #239): factors, quality-gated ROI, decision analysis
 * and Fable audit. Deterministic, zero-dep, and refuse-to-invent.
 */

import { routingSavings, costPerQaGreenTask, projectTierCost } from './cost-engine.mjs';
import { priceFor } from './pricing/pricing-registry.mjs';
import { skipped } from './privacy.mjs';

export const ROUTING_SCHEMA_VERSION = 'eacp-routing-economics/1';

export const ROUTING_STRATEGIES = Object.freeze([
  'fixed', 'fallback', 'cost-optimized', 'latency-optimized',
  'quality-evaluated', 'local-first', 'privacy-constrained',
]);

function normalizeComplexity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  const MAP = { low: 0.2, medium: 0.5, high: 0.85 };
  return (typeof value === 'string' && value in MAP) ? MAP[value] : null;
}

export function routingFactors(context = {}) {
  const ctx = (context !== null && typeof context === 'object') ? context : {};
  const str = (v) => (typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  const bool = (v) => Boolean(v);
  return Object.freeze({
    taskType:         str(ctx.taskType),
    complexity:       normalizeComplexity(ctx.complexity),
    risk:             normalizeComplexity(ctx.risk),
    paths:            Array.isArray(ctx.paths) ? ctx.paths.map(String) : null,
    squad:            str(ctx.squad),
    phase:            str(ctx.phase),
    toolCalling:      bool(ctx.toolCalling),
    structuredOutput: bool(ctx.structuredOutput),
    privacySensitive: bool(ctx.privacySensitive),
    budgetExhausted:  bool(ctx.budgetExhausted),
    qaPassRate:       num(ctx.qaPassRate),
    retryRate:        num(ctx.retryRate),
    latencyMs:        num(ctx.latencyMs),
    latencySensitive: bool(ctx.latencySensitive),
    localPreferred:   bool(ctx.localPreferred),
    contextWindow:    num(ctx.contextWindow),
  });
}

/** Deterministic advisory strategy selector; first match wins. */
export function selectStrategy(factors) {
  if (factors == null) return { strategy: 'fixed', reasons: ['no factors → default fixed'] };
  const reasons = [];
  if (factors.privacySensitive) {
    reasons.push('privacySensitive → privacy-constrained');
    return { strategy: 'privacy-constrained', reasons };
  }
  if (factors.risk != null && factors.risk >= 0.8) {
    reasons.push(`risk=${factors.risk} ≥ 0.8 → quality-evaluated`);
    return { strategy: 'quality-evaluated', reasons };
  }
  if (factors.localPreferred) {
    reasons.push('localPreferred → local-first');
    return { strategy: 'local-first', reasons };
  }
  if (factors.latencySensitive) {
    reasons.push('latencySensitive → latency-optimized');
    return { strategy: 'latency-optimized', reasons };
  }
  if (factors.budgetExhausted) {
    reasons.push('budgetExhausted → cost-optimized');
    return { strategy: 'cost-optimized', reasons };
  }
  if (factors.toolCalling || factors.structuredOutput) {
    const sigs = [factors.toolCalling && 'toolCalling', factors.structuredOutput && 'structuredOutput']
      .filter(Boolean);
    reasons.push(`${sigs.join('+')} → fallback (capable model with safety net)`);
    return { strategy: 'fallback', reasons };
  }

  reasons.push('no constraining factor → default fixed');
  return { strategy: 'fixed', reasons };
}

/**
 * Computes routing ROI, quality-gated. When quality signals are absent,
 * qualityEquivalent is null and savings are withheld (constitution §8).
 *
 * @param {{ usd: number|null }} baseline
 * @param {{ usd: number|null }} routed
 * @param {{ tolerance?: number, baselinePassRate?: number, routedPassRate?: number }} [qaSignals]
 * @returns {Readonly<object>} Frozen ROI result or skipped() marker.
 */
export function routingROI(baseline, routed, qaSignals = {}) {
  if (!Number.isFinite(baseline?.usd) || !Number.isFinite(routed?.usd)) {
    return skipped('baseline/routed cost unavailable');
  }

  const tolerance = Number.isFinite(qaSignals.tolerance) ? qaSignals.tolerance : 0.05;
  let qualityEquivalent = null;
  if (Number.isFinite(qaSignals.baselinePassRate) && Number.isFinite(qaSignals.routedPassRate)) {
    qualityEquivalent = qaSignals.routedPassRate >= qaSignals.baselinePassRate - tolerance;
  }

  const savings    = routingSavings(baseline, routed, qualityEquivalent === true);
  const confidence = qualityEquivalent === true ? (savings.confidence ?? 'derived') : 'unknown';
  const note = qualityEquivalent === null
    ? 'quality not evaluated — savings withheld'
    : qualityEquivalent
      ? 'savings counted at equivalent quality'
      : 'routed quality below baseline — savings withheld';

  return Object.freeze({
    schemaVersion: ROUTING_SCHEMA_VERSION,
    savings: savings.usd,
    qualityEquivalent,
    qualityGated: true,
    confidence,
    note,
  });
}

/**
 * Cost per QA-green task. Thin composition over cost-engine — not a fork.
 * @param {number|null} attributableUsd
 * @param {number} qaGreenCount
 * @returns {{ usd: number|null, confidence: 'derived'|'unknown' }}
 */
export function costPerCorrectTask(attributableUsd, qaGreenCount) {
  return costPerQaGreenTask(attributableUsd, qaGreenCount);
}

/**
 * Estimates cost for a routing tier via the forge matrix (model-policy).
 * Wires priceForTier through cost-engine.projectTierCost.
 * Confidence stays 'inferred' — matrix prices are illustrative.
 *
 * @param {string} tier
 * @param {{ freshInput: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number }} buckets
 * @param {{ policy?: object }} [opts]
 * @returns {Promise<Readonly<object>>}
 */
export async function tierEconomics(tier, buckets, opts = {}) {
  const cost = await projectTierCost(tier, buckets, opts);
  if (cost?.status === 'skipped') return cost;
  return Object.freeze({
    schemaVersion: ROUTING_SCHEMA_VERSION,
    tier,
    usd:        cost.usd        ?? null,
    confidence: cost.confidence ?? 'inferred',
    modelId:    cost.modelId    ?? null,
  });
}

/**
 * Consumes real routing decision records (from routing-telemetry.decisionRecord),
 * distinguishing recommended / selected / applied / observed tiers.
 *
 * Use actual applied model ONLY when independently observed (opts.observedModel).
 * Savings eligible only when applied + observed — never from shadow-only records.
 * Enforces floor-agent protection: applied tier must be ≥ opts.floorTier.
 * Honest about host limitation: Claude Code UserPromptSubmit cannot switch the
 * in-session model → applied stays false → honestReason is host_does_not_support.
 *
 * @param {object[]} records - routing-telemetry decisionRecord[]
 * @param {{ floorTier?: string, observedModel?: string|null }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function analyzeDecisionRecords(records, opts = {}) {
  if (!Array.isArray(records) || records.length === 0) return skipped('no decision records');
  const RANK = { runner: 0, haiku: 1, sonnet: 2, opus: 3, fable: 4 };
  const floor = (typeof opts.floorTier === 'string') ? opts.floorTier : 'haiku';
  const obs = (typeof opts.observedModel === 'string' && opts.observedModel.trim())
    ? opts.observedModel.trim() : null;
  const recommendedOf = r => r.recommendedTier ?? r.executor ?? null;
  const appliedOf = r => r.actualTier ?? r.selectedTier ?? r.executor ?? null;
  const applied = records.filter(r => r.applied === true);
  const recTiers = [...new Set(records.map(recommendedOf).filter(Boolean))];
  const applTiers = [...new Set(applied.map(appliedOf).filter(Boolean))];
  const floorViol = applied.filter(r => (RANK[appliedOf(r)] ?? 99) < (RANK[floor] ?? 0));
  const hostLimit = applied.length === 0 && records.some(
    r => r.mode === 'shadow' || r.reason === 'host_does_not_support_in_session_model_switch',
  );
  const reasonCounts = {};
  for (const r of records) {
    const reasons = [
      ...(Array.isArray(r.reasonCodes) ? r.reasonCodes : []),
      ...(Array.isArray(r.reasons) ? r.reasons : []),
      r.reason,
    ];
    for (const reason of [...new Set(reasons.filter(Boolean))]) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }
  return Object.freeze({
    schemaVersion: ROUTING_SCHEMA_VERSION,
    total: records.length, appliedCount: applied.length,
    recommendedTiers: recTiers, appliedTiers: applTiers,
    selectedTier: applTiers[0] ?? null, observedModel: obs,
    decisionIds: [...new Set(records.map(r => r.decisionId).filter(Boolean))],
    requestIds: [...new Set(records.map(r => r.requestId).filter(Boolean))],
    reasons: Object.entries(reasonCounts).map(([reason, count]) => ({ reason, count })),
    hostLimitation: hostLimit,
    honestReason: hostLimit ? 'host_does_not_support_in_session_model_switch'
      : applied.length > 0 ? 'routing_applied' : 'shadow_recommendations_only',
    floorProtected: floorViol.length === 0,
    floorViolations: floorViol.length,
    savingsEligible: applied.length > 0 && obs !== null && floorViol.length === 0,
    providerCacheExcluded: true,
    note: 'routing decisions only; provider cache value remains a separate financial signal',
  });
}

/**
 * Fable-5 audit (§F). Returns a frozen advisory verdict on Fable-5 usage.
 * Detects accidental auto-routing to Fable (manual-only — ADR-0052).
 * Degrades to skipped() when fable-5 is absent from the registry.
 *
 * @param {object|null} registry - Loaded pricing registry.
 * @param {{ routedModels?: string[], qaRate?: number }} [opts]
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function fableAudit(registry, opts = {}) {
  const entry = priceFor(registry, 'fable-5');
  if (!entry) return skipped('fable-5 not in pricing registry');

  const accidentalRisk = Array.isArray(opts.routedModels) &&
    opts.routedModels.some(id => /fable/i.test(id)) ? 'detected' : 'none';

  return Object.freeze({
    schemaVersion: ROUTING_SCHEMA_VERSION,
    model:           entry.canonicalId,
    aliases:         Array.isArray(entry.aliases) ? [...entry.aliases] : [],
    price:           { input: entry.input, output: entry.output, currency: entry.currency },
    priceConfidence: entry.confidence ?? 'unknown',
    premium:         true,
    whatItIs: 'Claude Fable 5 — a deliberately expensive, capacity-limited premium tier (ADR-0052).',
    whenSelected: 'Manual only — one task via the /fable skill, explicit opt-in.',
    who:      'A human invoking /fable. Never an automatic router decision.',
    why:      'A single hard reasoning task where premium quality is worth the price.',
    qaRate:   Number.isFinite(opts.qaRate) ? opts.qaRate : null,
    alternatives: ['powerful (opus)', 'reasoning'],
    intentionalOnly: true,
    accidentalRisk,
    recommendation: 'Keep Fable manual-only; flag any automatic route to Fable as accidental.',
  });
}

/**
 * Aggregates a routing/economics advisory for token-report. Identifies premium
 * models (opus / fable / reasoning) and runs fableAudit when Fable is present.
 * Degrades to skipped() when byModel is absent or empty.
 *
 * @param {{ byModel?: Record<string,object>, registry?: object|null }} input
 * @returns {Readonly<object>|Readonly<{status:'skipped',reason:string}>}
 */
export function routingSummary(input) {
  const byModel = input?.byModel;
  if (!byModel || typeof byModel !== 'object' || Array.isArray(byModel) ||
      Object.keys(byModel).length === 0) {
    return skipped('no per-model usage');
  }

  const premiumPattern = /opus|fable|reasoning/i;
  const modelKeys     = Object.keys(byModel);
  const premiumModels = modelKeys.filter(id => premiumPattern.test(id));
  const hasFable      = modelKeys.some(id => /fable/i.test(id));
  const fable = (input.registry && hasFable)
    ? fableAudit(input.registry, { routedModels: modelKeys })
    : null;

  return Object.freeze({ schemaVersion: ROUTING_SCHEMA_VERSION, models: modelKeys.length, premiumModels, fable });
}

/**
 * Renders a routing-economics advisory block as a multi-line string (no
 * trailing newline). Handles skipped markers and null gracefully.
 *
 * @param {ReturnType<typeof routingSummary>|null|undefined} summary
 * @param {ReturnType<typeof analyzeDecisionRecords>|null|undefined} decisions
 * @returns {string}
 */
export function presentRouting(summary, decisions = null) {
  const lines = [];
  if (!summary || summary.status === 'skipped') {
    lines.push('Routing economics: skipped (' + (summary?.reason ?? 'no data') + ')');
  } else {
    lines.push('Routing economics (advisory): ' + summary.models + ' model(s), ' + summary.premiumModels.length + ' premium');
    if (summary.premiumModels.length > 0) lines.push('  premium: ' + summary.premiumModels.join(', '));
  }
  const fable = summary?.fable;
  if (fable && fable.status !== 'skipped') {
    lines.push(
      '  ⚠️ Fable-5 used — premium $' + fable.price.input + '/$' + fable.price.output +
      ' MTok; intentional? (' + fable.accidentalRisk + ')'
    );
  }
  if (decisions?.status === 'skipped') lines.push('  decision lifecycle: skipped (' + decisions.reason + ')');
  else if (decisions) {
    lines.push(`  decisions: evaluated ${decisions.total}; applied ${decisions.appliedCount}; savings eligible ${decisions.savingsEligible ? 'yes' : 'no'} (${decisions.honestReason})`);
    if (decisions.reasons?.length) {
      lines.push('  reasons: ' + decisions.reasons.map(r => `${r.reason} (${r.count})`).join(', '));
    }
    lines.push('  provider cache: excluded from kit-routing savings');
  }
  return lines.join('\n');
}
