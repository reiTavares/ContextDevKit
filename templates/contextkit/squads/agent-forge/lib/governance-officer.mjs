/**
 * governance-officer — the three-pillar enforcement layer (ADR-0012 §6 / best-practices §5).
 * Pure + zero-dep (rule 1). Takes the blueprint + router decision and produces the
 * cost / compliance / quality policy bundles + the fallback-chain + audit schema
 * already populated — no `{{TOKEN}}` placeholders left. `validateGovernance` is the
 * runtime gate: any pillar under-configured → the package does NOT ship.
 *
 * The governance-officer AGENT (.claude/agents/governance-officer.md) reviews the
 * generated bundle with the developer; this module supplies the deterministic
 * scaffold and the validator.
 */

const REQUIRED_COST = ['budgets', 'alerts', 'caching', 'rate_limiting', 'kill_switch'];
const REQUIRED_COMPLIANCE = ['pii', 'lgpd', 'data_residency', 'retention', 'audit', 'red_team'];
const REQUIRED_QUALITY = ['eval_gates', 'fallback_chain', 'kill_switch', 'retry', 'observability'];

/** Cost pillar — budgets/alerts/caching/rate-limit/kill-switch from blueprint.cost + volume. */
export function buildCostPolicy(blueprint) {
  const target = blueprint.cost?.target_usd_per_call ?? 0.015;
  const hardCap = blueprint.cost?.max_usd_per_call ?? 0.05;
  const monthly = blueprint.cost?.monthly_budget_usd ?? 500;
  return {
    budgets: {
      per_call_usd_target: target,
      per_call_usd_hard_cap: hardCap,
      monthly_usd_target: monthly,
      monthly_usd_hard_cap: Math.round(monthly * 1.5),
    },
    alerts: [
      { at_pct: 50, channels: ['log'] },
      { at_pct: 80, channels: ['log', 'email', 'slack'] },
      { at_pct: 100, channels: ['log', 'email', 'slack', 'pagerduty'], action: 'switch_to_cheap_path' },
    ],
    caching: { prompt_caching: 'required', semantic_response_cache: { enabled: true, ttl_minutes: 60, similarity_threshold: 0.95 } },
    rate_limiting: { per_user_qpm: 30, per_user_qpd: 1000, global_qps: 50, burst_multiplier: 1.5 },
    kill_switch: {
      enabled: true,
      triggers: [
        { condition: 'monthly_spend_exceeds_hard_cap', action: 'refuse_all_calls' },
        { condition: 'per_call_cost_exceeds_hard_cap_3x_in_5min', action: 'refuse_until_manual_reset' },
      ],
    },
  };
}

/** Compliance pillar — PII / LGPD / residency / retention / audit / red-team from blueprint.privacy. */
export function buildCompliancePolicy(blueprint) {
  const privacy = blueprint.privacy || {};
  const piiPresent = privacy.pii_present === true;
  const residency = privacy.data_residency || 'any';
  const allowCloud = privacy.allow_cloud_providers !== false;
  return {
    pii: {
      detection: { enabled: piiPresent, categories: ['cpf', 'cnpj', 'rg', 'email', 'phone', 'address', 'full_name', 'credit_card'], strategy: 'pre_call_redaction' },
      handling: { strategy: 'tokenize_then_send', detokenize_on_response: true },
    },
    lgpd: {
      basis: privacy.lgpd_basis || 'legitimate_interest',
      data_subject_rights: { log_access: true, support_deletion_request: true },
      dpo_contact: blueprint.author || 'dpo@example.com',
    },
    data_residency: {
      required: residency,
      allowed_providers: allowCloud ? ['anthropic', 'google', 'self-hosted'] : ['self-hosted'],
      denied_providers: piiPresent && residency === 'br-or-eu' ? ['deepseek'] : [],
    },
    retention: {
      zero_retention_required: privacy.require_zero_retention === true,
      audit_log_retention_days: 1825,
      user_data_retention_days: 0,
    },
    audit: {
      log_inputs: true, log_outputs: true, log_model_used: true,
      log_cost: true, log_fallback_triggered: true, log_pii_redactions: piiPresent,
      destination: `file://./audit/${blueprint.agent_name}.jsonl`,
      schema: '../audit.schema.json',
    },
    red_team: {
      prompt_injection_tests: 'required', jailbreak_tests: 'required',
      pii_leak_tests: piiPresent ? 'required' : 'optional',
      bias_tests: 'optional', run_before_each_release: true,
    },
  };
}

/** Quality pillar — eval gates + fallback + kill-switch + retry + observability. */
export function buildQualityPolicy(blueprint) {
  const piiPresent = blueprint.privacy?.pii_present === true;
  return {
    eval_gates: {
      pre_release: {
        golden_accuracy_min: 0.85,
        red_team_pass_rate_min: piiPresent ? 1.0 : 0.95,
        latency_p95_ms_max: blueprint.sla?.latency_p95_ms ?? 8000,
        cost_per_call_p95_usd_max: blueprint.cost?.max_usd_per_call ?? 0.05,
      },
      drift_monitoring: { enabled: true, sample_pct: 5, alert_on_accuracy_drop_pct: 5 },
    },
    fallback_chain: {
      triggers: [
        { http_5xx: 'retry_once_then_fallback' },
        { timeout: 'fallback_immediately' },
        { rate_limited: 'fallback_immediately' },
        { safety_blocked: 'do_not_fallback' },
        { cost_budget_breached: 'switch_to_cheap_path' },
      ],
    },
    kill_switch: {
      triggers: [
        { condition: 'golden_accuracy_below_threshold_2_runs', action: 'refuse_until_manual_reset' },
        { condition: 'red_team_pass_rate_drop_below_threshold', action: 'refuse_until_manual_reset' },
      ],
    },
    retry: { max_attempts: 3, backoff: 'exponential', base_ms: 500, max_ms: 8000, retry_on: ['5xx', 'timeout', 'rate_limit'], no_retry_on: ['4xx', 'safety_block'] },
    structured_output: { validation: 'required', on_invalid: 'retry_once_then_fail' },
    observability: { metrics_endpoint: 'prometheus', traces_endpoint: 'otlp', dashboards_provided: true },
  };
}

/** Build the ordered fallback chain from the router decision (primary + cross-provider fallback). */
export function buildFallbackChain(decision) {
  const [primaryProvider, primaryModel] = String(decision.primary || '').split('/');
  const chain = [];
  if (decision.fallback) {
    const [fp, fm] = decision.fallback.split('/');
    chain.push({ provider: fp, model: fm, condition: 'primary_5xx OR primary_timeout' });
  }
  if (decision.cheap_path) {
    const [cp, cm] = decision.cheap_path.split('/');
    chain.push({ provider: cp, model: cm, condition: 'cost_budget_breached' });
  }
  return { primary: { provider: primaryProvider, model: primaryModel }, chain, on_safety_block: 'do_not_fallback' };
}

function hasPlaceholders(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.includes('{{') && value.includes('}}');
  if (Array.isArray(value)) return value.some(hasPlaceholders);
  if (typeof value === 'object') return Object.values(value).some(hasPlaceholders);
  return false;
}

function missingKeys(obj, required) {
  return required.filter((key) => obj?.[key] == null);
}

/** Refuse when any pillar lacks required sections or carries unresolved `{{TOKEN}}` placeholders. */
export function validateGovernance(bundle) {
  const errors = [];
  const missingCost = missingKeys(bundle.cost, REQUIRED_COST);
  if (missingCost.length) errors.push(`cost.policy missing: ${missingCost.join(', ')}`);
  const missingCompliance = missingKeys(bundle.compliance, REQUIRED_COMPLIANCE);
  if (missingCompliance.length) errors.push(`compliance.policy missing: ${missingCompliance.join(', ')}`);
  const missingQuality = missingKeys(bundle.quality, REQUIRED_QUALITY);
  if (missingQuality.length) errors.push(`quality.policy missing: ${missingQuality.join(', ')}`);
  if (!bundle.fallback?.primary?.model) errors.push('fallback-chain missing primary model');
  for (const [pillar, value] of Object.entries(bundle)) {
    if (hasPlaceholders(value)) errors.push(`${pillar}.policy still has unresolved {{TOKEN}} placeholders`);
  }
  return { ok: errors.length === 0, errors };
}

/** One-stop: build all four artifacts + validate. Throws an actionable error if any pillar fails. */
export function attachGovernance(blueprint, decision) {
  const bundle = {
    cost: buildCostPolicy(blueprint),
    compliance: buildCompliancePolicy(blueprint),
    quality: buildQualityPolicy(blueprint),
    fallback: buildFallbackChain(decision),
  };
  const validation = validateGovernance(bundle);
  if (!validation.ok) {
    const err = new Error('agent-forge governance-officer refuses to ship — pillars under-configured:\n  - ' + validation.errors.join('\n  - '));
    err.validation = validation;
    throw err;
  }
  return bundle;
}
