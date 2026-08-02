#!/usr/bin/env node
/**
 * model-policy — the deterministic tier → concrete model resolver (ADR-0052 Phase 2).
 *
 * Layer-3 of cost-tiered routing made executable: every dispatching skill
 * (`/ship`, `/swarm`, `/advise`, `/debate`, QA) calls this BEFORE spawning a
 * subagent so the `model:` it passes to the Agent tool is decided by policy, not
 * by the orchestrator's goodwill. Without it, an omitted `model` silently
 * inherits the (premium) session model — the most expensive path is the default.
 *
 * Pure + zero-dep on the hot path (rule 1): the core resolver reads only
 * `policy/routing-policy.json`. Price enrichment reuses `loadMatrix` from the
 * agent-forge router, but via an OPTIONAL dynamic import — the matrix ships only
 * at L>=4/Claude, so its absence degrades to "no price", never an error (rule 8).
 *
 * Library + thin CLI:
 *   model-policy.mjs resolve --agent qa-unit --task execute [--task-kind search] [--complexity M] [--risk high] [--budget-exhausted] [--qa-failures N] [--host claude|codex|agy]
 *   model-policy.mjs tier powerful [--task-kind search] [--complexity M] [--risk high] [--budget-exhausted] [--host claude|codex|agy]   # tier-based dispatch (the swarm path)
 *   model-policy.mjs table [--json]      # the full resolved roster — the audit view
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = resolve(HERE, '..', '..', 'policy', 'routing-policy.json');
const ROUTER = resolve(HERE, '..', '..', 'squads', 'agent-forge', 'lib', 'router.mjs');

const CODEX_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const CODEX_COMPLEXITIES = Object.freeze(['low', 'moderate', 'high', 'xhigh', 'critical']);
const CODEX_RISKS = Object.freeze(['low', 'moderate', 'high', 'xhigh', 'critical']);

/** Converts human/card vocabulary into a stable selector token. */
function selectorToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Normalizes a Codex task kind. Unknown values return null so the caller can
 * refuse an effort override instead of guessing a route.
 *
 * @param {unknown} value raw task-kind/card/title value.
 * @returns {'search'|'research'|'exploration'|'simple-action'|'simple-code'|null}
 */
export function normalizeCodexTaskKind(value) {
  const token = selectorToken(value);
  if (!token) return null;
  if (token.includes('research')) return 'research';
  if (token.includes('search') || token.includes('busca')) return 'search';
  if (token.includes('explor')) return 'exploration';
  if (token.includes('simple') && token.includes('action')) return 'simple-action';
  if (token.includes('simple') && (token.includes('code') || token.includes('coding'))) return 'simple-code';
  if (token === 'action' || token === 'acao') return 'simple-action';
  if (token === 'code' || token === 'coding' || token === 'codigo') return 'simple-code';
  return null;
}

/**
 * Normalizes complexity aliases used by cards and human requests.
 *
 * @param {unknown} value raw complexity selector.
 * @returns {'low'|'moderate'|'high'|'xhigh'|'critical'|null}
 */
export function normalizeCodexComplexity(value) {
  const token = selectorToken(value);
  if (!token) return null;
  if (['s', 'small', 'low', 'trivial', 'simple', 'baixa', 'baixo'].includes(token)) return 'low';
  if (['m', 'medium', 'moderate', 'feature', 'moderada', 'moderado'].includes(token)) return 'moderate';
  if (['l', 'large', 'high', 'complex', 'architectural', 'alta', 'alto'].includes(token)) return 'high';
  if (['xhigh', 'xl', 'x-large', 'very-high', 'veryhigh', 'extra-high', 'very-complex', 'muito-alta', 'muito-alto'].includes(token)) return 'xhigh';
  if (['critical', 'critica', 'critico'].includes(token)) return 'critical';
  return null;
}

/**
 * Normalizes risk aliases used by cards and human requests.
 *
 * @param {unknown} value raw risk/severity selector.
 * @returns {'low'|'moderate'|'high'|'xhigh'|'critical'|null}
 */
export function normalizeCodexRisk(value) {
  const token = selectorToken(value);
  if (!token) return null;
  if (['low', 'minor', 'baixa', 'baixo'].includes(token)) return 'low';
  if (['medium', 'moderate', 'normal', 'moderada', 'moderado', 'media', 'medio'].includes(token)) return 'moderate';
  if (['high', 'elevated', 'alta', 'alto'].includes(token)) return 'high';
  if (['xhigh', 'very-high', 'veryhigh', 'muito-alta', 'muito-alto'].includes(token)) return 'xhigh';
  if (['critical', 'critica', 'critico'].includes(token)) return 'critical';
  return null;
}

/**
 * Builds normalized Codex routing context from explicit fields, using title
 * only as a bounded task-kind hint. It never invents complexity or risk.
 *
 * @param {{ taskKind?: unknown, complexity?: unknown, risk?: unknown, title?: unknown }} context raw dispatch context.
 * @returns {{ taskKind: string|null, complexity: string|null, risk: string|null }} normalized context.
 */
export function normalizeCodexContext(context = {}) {
  return {
    taskKind: normalizeCodexTaskKind(context.taskKind) ?? normalizeCodexTaskKind(context.title),
    complexity: normalizeCodexComplexity(context.complexity),
    risk: normalizeCodexRisk(context.risk),
  };
}

/** Validates the Codex policy once at load time when the optional section exists. */
function validateCodexPolicy(policy) {
  const codexDispatch = policy.codexDispatch;
  if (!codexDispatch) return;
  if (!CODEX_EFFORTS.every((effort) => codexDispatch.supportedEfforts?.includes(effort))) {
    throw new Error('model-policy: codexDispatch.supportedEfforts is incomplete');
  }
  if (!CODEX_COMPLEXITIES.every((complexity) => codexDispatch.canonicalComplexities?.includes(complexity))) {
    throw new Error('model-policy: codexDispatch.canonicalComplexities is incomplete');
  }
  if (!CODEX_RISKS.every((risk) => codexDispatch.canonicalRisks?.includes(risk))) {
    throw new Error('model-policy: codexDispatch.canonicalRisks is incomplete');
  }
  const matrixKeys = new Set();
  for (const rule of codexDispatch.matrixRules ?? []) {
    const key = `${rule.complexity}|${rule.risk}`;
    if (matrixKeys.has(key)) throw new Error(`model-policy: duplicate Codex matrix rule ${key}`);
    matrixKeys.add(key);
    if (!CODEX_COMPLEXITIES.includes(rule.complexity) || !CODEX_RISKS.includes(rule.risk)) {
      throw new Error(`model-policy: invalid Codex matrix selector ${key}`);
    }
    if (!policy.tiers?.[rule.tier] || !codexDispatch.modelEfforts?.[rule.model]?.includes(rule.effort) || !rule.ruleId) {
      throw new Error(`model-policy: invalid Codex matrix rule ${rule.ruleId || key}`);
    }
    if ((rule.effort === 'ultra') !== (key === 'critical|critical' && rule.model === 'gpt-5.6-sol')) {
      throw new Error(`model-policy: Codex ultra invariant violated at ${key}`);
    }
  }
  const expectedKeys = [
    ...CODEX_COMPLEXITIES.filter((complexity) => complexity !== 'critical')
      .flatMap((complexity) => CODEX_RISKS.filter((risk) => risk !== 'critical').map((risk) => `${complexity}|${risk}`)),
    ...CODEX_RISKS.map((risk) => `critical|${risk}`),
  ];
  if (matrixKeys.size !== 21 || expectedKeys.some((key) => !matrixKeys.has(key))) {
    throw new Error('model-policy: Codex matrix must contain the exact 21 dispatch routes');
  }
}

/** Reads the routing policy — strips a BOM (rule 4), throws on a missing/corrupt file (fail-fast). */
export function loadPolicy(path = DEFAULT_POLICY) {
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`model-policy: routing policy not found at ${path} (ADR-0052 Phase 2 — run the installer or restore policy/routing-policy.json)`);
  }
  const policy = JSON.parse(raw.replace(/^﻿/, ''));
  if (!policy.tiers || !policy.hostModels || !Array.isArray(policy.ladder) || !policy.agents) {
    throw new Error('model-policy: routing-policy.json is malformed (need tiers, hostModels, ladder, agents)');
  }
  validateCodexPolicy(policy);
  return policy;
}

/** Clamps `index + delta` into the ladder bounds — escalation caps at the top, de-escalation at the bottom. */
function shift(ladder, tier, delta) {
  const at = ladder.indexOf(tier);
  if (at < 0) return tier;
  return ladder[Math.max(0, Math.min(ladder.length - 1, at + delta))];
}

function hostGapReason(policy, host) {
  if (policy.hostGap?.[host]) return policy.hostGap[host];
  if (!policy.hostModels?.[host]) return `unknown-host(${host})`;
  return null;
}

function modelForTier(policy, tier, host) {
  return policy.hostModels?.[host]?.[tier] ?? policy.tiers?.[tier]?.alias ?? null;
}

/** Returns the legacy tier/model when Codex effort context cannot be resolved. */
function refusedCodexDispatch(policy, tierHint, context, reason) {
  return {
    decision: 'refuse',
    model: null,
    tier: null,
    effort: null,
    ruleId: null,
    context,
    reasons: [reason],
  };
}

/**
 * Resolves the mandatory Codex complexity-risk contract. Task kind is retained
 * only as audit metadata and never overrides complete dimensions.
 *
 * @param {{ taskKind?: unknown, complexity?: unknown, risk?: unknown, title?: unknown, tierHint?: string|null, policy?: object }} options raw context and legacy tier.
 * @returns {{ model: string|null, tier: string|null, effort: string|null, ruleId: string|null, context: object, reasons: string[] }}
 */
export function resolveCodexDispatch(options = {}) {
  const policy = options.policy ?? loadPolicy();
  const normalizedContext = normalizeCodexContext(options);
  const tierHint = policy.tiers?.[options.tierHint] ? options.tierHint : null;
  const codexDispatch = policy.codexDispatch;
  if (!codexDispatch) return refusedCodexDispatch(policy, tierHint, normalizedContext, 'codex-effort-policy-missing');

  const suppliedFields = [options.complexity, options.risk].filter((field) => field != null && String(field).trim() !== '');
  if (suppliedFields.length === 0) return refusedCodexDispatch(policy, tierHint, normalizedContext, 'codex-effort-context-missing');
  if (!normalizedContext.complexity || !normalizedContext.risk) {
    return refusedCodexDispatch(policy, tierHint, normalizedContext, 'codex-effort-context-incomplete-or-invalid');
  }

  const matches = (codexDispatch.matrixRules ?? []).filter((rule) =>
    rule.complexity === normalizedContext.complexity && rule.risk === normalizedContext.risk);
  if (matches.length === 0) return refusedCodexDispatch(policy, tierHint, normalizedContext, 'codex-effort-no-explicit-rule');
  if (matches.length > 1) throw new Error(`model-policy: duplicate normalized Codex dispatch rule for ${normalizedContext.complexity}|${normalizedContext.risk}`);
  const matrixRule = matches[0];
  return {
    decision: 'dispatch',
    model: matrixRule.model,
    tier: matrixRule.tier,
    effort: matrixRule.effort,
    ruleId: matrixRule.ruleId,
    context: normalizedContext,
    reasons: [`codex-rule(${matrixRule.ruleId})`],
  };
}

/**
 * Resolves one dispatch to a concrete model alias. Deterministic — same inputs,
 * same answer; no LLM-judge (ADR-0012 §5). Order is contractual: task class →
 * escalation → de-escalation → FLOOR LAST, so the floor beats a budget downgrade
 * (ADR-0052 §5 "floor beats de-escalation").
 *
 * @param {string} agent agent archetype name (e.g. "qa-unit")
 * @param {{ task?: 'think'|'execute'|'ambiguous', taskKind?: string, complexity?: string, risk?: string, title?: string, budgetExhausted?: boolean, qaFailures?: number, host?: string, policy?: object }} opts
 * @returns {{ model: string|null, tier: string|null, effort: string|null, ruleId: string|null, reasons: string[], agent: string }}
 */
export function resolveModel(agent, opts = {}) {
  const policy = opts.policy ?? loadPolicy();
  const host = opts.host ?? 'claude';
  const hostGap = hostGapReason(policy, host);
  if (hostGap) {
    return { model: null, tier: null, effort: null, ruleId: null, reasons: [hostGap], agent };
  }
  if ((policy.inheritAgents ?? []).includes(agent)) {
    return { model: modelForTier(policy, 'inherit', host), tier: null, effort: null, ruleId: null, reasons: ['dispatcher-inherits-session'], agent };
  }
  const baseTier = policy.agents?.[agent];
  if (!baseTier) {
    throw new Error(`model-policy: unknown agent "${agent}" — not in routing-policy.json (refuse-by-default; add it to the ADR-0052 table first)`);
  }
  const ladder = policy.ladder;
  const reasons = [];
  let tier = baseTier;

  const task = opts.task ?? 'ambiguous';
  const taskRule = policy.taskClasses?.[task]?.rule;
  if (taskRule === 'fast' && tier !== 'fast') { tier = 'fast'; reasons.push(`${task}->fast`); }
  else reasons.push(`${task}->agent-tier(${baseTier})`);

  if (Number(opts.qaFailures) >= 2) {
    const up = shift(ladder, tier, +1);
    if (up !== tier) { tier = up; reasons.push('qa-escalate(+1)'); }
  }
  if (opts.budgetExhausted) {
    const down = shift(ladder, tier, -1);
    if (down !== tier) { tier = down; reasons.push('budget-downgrade(-1)'); }
  }
  // Floor LAST — security/privacy never resolve below the floor tier, even under budget pressure.
  if ((policy.floorAgents ?? []).includes(agent)) {
    const floor = policy.floorTier;
    if (ladder.indexOf(tier) < ladder.indexOf(floor)) { tier = floor; reasons.push(`floor(${floor})`); }
  }
  const legacy = { model: modelForTier(policy, tier, host), tier, effort: null, ruleId: null, reasons, agent };
  if (host !== 'codex') return legacy;

  const codexDispatch = resolveCodexDispatch({ ...opts, tierHint: tier, policy });
  return {
    decision: codexDispatch.decision,
    model: codexDispatch.model,
    tier: codexDispatch.tier,
    effort: codexDispatch.effort,
    ruleId: codexDispatch.ruleId,
    reasons: [...reasons, ...codexDispatch.reasons],
    agent,
  };
}

/**
 * Per-MTok price for a resolved tier, via the dated capability-matrix (supply
 * side). Optional: returns null when the agent-forge matrix is not installed
 * (L<4 / non-Claude host) — never an error (rule 8: skip, don't fail).
 *
 * @returns {Promise<{ input: number, output: number, modelId: string }|null>}
 */
export async function priceForTier(tier, policy) {
  const alias = policy.tiers?.[tier]?.alias;
  if (!alias) return null;
  try {
    const { loadMatrix } = await import('file://' + ROUTER.replaceAll('\\', '/'));
    const matrix = await loadMatrix();
    const model = matrix.models.find((m) => m.id.startsWith(`anthropic/claude-${alias}`));
    if (!model) return null;
    return { input: model.input_usd_per_mtok, output: model.output_usd_per_mtok, modelId: model.id };
  } catch {
    return null; // matrix absent — degrade to no price
  }
}

/**
 * Tier → model alias, the bridge for tier-based dispatchers (the swarm plans by
 * `tierHint`, not by a named agent). Applies budget de-escalation when asked;
 * floors don't apply here (a tier carries no agent identity). Returns null for a
 * host gap or an unknown tier (refuse-by-default).
 *
 * @param {string} tier one of the demand tiers (fast|powerful|reasoning)
 * @param {{ taskKind?: string, complexity?: string, risk?: string, title?: string, budgetExhausted?: boolean, host?: string, policy?: object }} opts
 * @returns {{ model: string|null, tier: string|null, effort: string|null, ruleId: string|null, reasons: string[] }}
 */
export function aliasForTier(tier, opts = {}) {
  const policy = opts.policy ?? loadPolicy();
  const host = opts.host ?? 'claude';
  const hostGap = hostGapReason(policy, host);
  if (hostGap) return { model: null, tier: null, effort: null, ruleId: null, reasons: [hostGap] };
  if (!policy.tiers?.[tier]) return { model: null, tier: null, effort: null, ruleId: null, reasons: [`unknown-tier(${tier})`] };
  const reasons = [`tier(${tier})`];
  let resolved = tier;
  if (opts.budgetExhausted) {
    const down = shift(policy.ladder, resolved, -1);
    if (down !== resolved) { resolved = down; reasons.push('budget-downgrade(-1)'); }
  }
  const legacy = { model: modelForTier(policy, resolved, host), tier: resolved, effort: null, ruleId: null, reasons };
  if (host !== 'codex') return legacy;
  const codexDispatch = resolveCodexDispatch({ ...opts, tierHint: resolved, policy });
  return {
    decision: codexDispatch.decision,
    model: codexDispatch.model,
    tier: codexDispatch.tier,
    effort: codexDispatch.effort,
    ruleId: codexDispatch.ruleId,
    reasons: [...reasons, ...codexDispatch.reasons],
  };
}

/** Builds the full resolved roster (every agent at its static default) — the audit view. */
export function resolveRoster(policy = loadPolicy()) {
  const rows = [];
  for (const agent of Object.keys(policy.agents)) rows.push(resolveModel(agent, { policy }));
  for (const agent of policy.inheritAgents ?? []) rows.push(resolveModel(agent, { policy }));
  return rows.sort((a, b) => a.agent.localeCompare(b.agent));
}

// ---------------------------------------------------------------- thin CLI
const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('model-policy.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const verb = argv[0];
  const flag = (name) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : null; };
  const has = (name) => argv.includes(`--${name}`);
  try {
    if (verb === 'resolve') {
      const agent = flag('agent');
      if (!agent) { console.error('Usage: model-policy.mjs resolve --agent <name> [--task think|execute|ambiguous] [--task-kind kind] [--complexity value] [--risk value] [--title text] [--budget-exhausted] [--qa-failures N] [--host claude|codex|agy]'); process.exit(1); }
      const out = resolveModel(agent, {
        task: flag('task') ?? 'ambiguous',
        taskKind: flag('task-kind'),
        complexity: flag('complexity'),
        risk: flag('risk'),
        title: flag('title'),
        budgetExhausted: has('budget-exhausted'),
        qaFailures: Number(flag('qa-failures')) || 0,
        host: flag('host') ?? 'claude',
      });
      console.log(JSON.stringify(out));
      if (out.decision === 'refuse') process.exitCode = 2;
    } else if (verb === 'tier') {
      const tier = argv[1] && !argv[1].startsWith('--') ? argv[1] : flag('tier');
      if (!tier) { console.error('Usage: model-policy.mjs tier <fast|powerful|reasoning> [--task-kind kind] [--complexity value] [--risk value] [--title text] [--budget-exhausted] [--host claude|codex|agy]'); process.exit(1); }
      const out = aliasForTier(tier, {
        taskKind: flag('task-kind'),
        complexity: flag('complexity'),
        risk: flag('risk'),
        title: flag('title'),
        budgetExhausted: has('budget-exhausted'),
        host: flag('host') ?? 'claude',
      });
      console.log(JSON.stringify(out));
      if (out.decision === 'refuse') process.exitCode = 2;
    } else if (verb === 'table') {
      const roster = resolveRoster();
      if (has('json')) { console.log(JSON.stringify(roster, null, 2)); }
      else for (const row of roster) console.log(`${(row.model ?? 'n/a').padEnd(8)} ${row.tier ?? '-'}\t${row.agent}`);
    } else {
      console.error('Usage: model-policy.mjs <resolve|tier|table> [...flags]');
      process.exit(1);
    }
  } catch (err) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}
