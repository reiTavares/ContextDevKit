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
 *   model-policy.mjs resolve --agent qa-unit --task execute [--budget-exhausted] [--qa-failures N] [--host claude|codex|agy]
 *   model-policy.mjs tier powerful [--budget-exhausted] [--host claude|codex|agy]   # tier-based dispatch (the swarm path)
 *   model-policy.mjs table [--json]      # the full resolved roster — the audit view
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = resolve(HERE, '..', '..', 'policy', 'routing-policy.json');
const ROUTER = resolve(HERE, '..', '..', 'squads', 'agent-forge', 'lib', 'router.mjs');

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

/**
 * Resolves one dispatch to a concrete model alias. Deterministic — same inputs,
 * same answer; no LLM-judge (ADR-0012 §5). Order is contractual: task class →
 * escalation → de-escalation → FLOOR LAST, so the floor beats a budget downgrade
 * (ADR-0052 §5 "floor beats de-escalation").
 *
 * @param {string} agent agent archetype name (e.g. "qa-unit")
 * @param {{ task?: 'think'|'execute'|'ambiguous', budgetExhausted?: boolean, qaFailures?: number, host?: string, policy?: object }} opts
 * @returns {{ model: string|null, tier: string|null, reasons: string[], agent: string }}
 */
export function resolveModel(agent, opts = {}) {
  const policy = opts.policy ?? loadPolicy();
  const host = opts.host ?? 'claude';
  const hostGap = hostGapReason(policy, host);
  if (hostGap) {
    return { model: null, tier: null, reasons: [hostGap], agent };
  }
  if ((policy.inheritAgents ?? []).includes(agent)) {
    return { model: modelForTier(policy, 'inherit', host), tier: null, reasons: ['dispatcher-inherits-session'], agent };
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
  return { model: modelForTier(policy, tier, host), tier, reasons, agent };
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
 * @param {{ budgetExhausted?: boolean, host?: string, policy?: object }} opts
 * @returns {{ model: string|null, tier: string|null, reasons: string[] }}
 */
export function aliasForTier(tier, opts = {}) {
  const policy = opts.policy ?? loadPolicy();
  const host = opts.host ?? 'claude';
  const hostGap = hostGapReason(policy, host);
  if (hostGap) return { model: null, tier: null, reasons: [hostGap] };
  if (!policy.tiers?.[tier]) return { model: null, tier: null, reasons: [`unknown-tier(${tier})`] };
  const reasons = [`tier(${tier})`];
  let resolved = tier;
  if (opts.budgetExhausted) {
    const down = shift(policy.ladder, resolved, -1);
    if (down !== resolved) { resolved = down; reasons.push('budget-downgrade(-1)'); }
  }
  return { model: modelForTier(policy, resolved, host), tier: resolved, reasons };
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
      if (!agent) { console.error('Usage: model-policy.mjs resolve --agent <name> [--task think|execute|ambiguous] [--budget-exhausted] [--qa-failures N] [--host claude|codex|agy]'); process.exit(1); }
      const out = resolveModel(agent, {
        task: flag('task') ?? 'ambiguous',
        budgetExhausted: has('budget-exhausted'),
        qaFailures: Number(flag('qa-failures')) || 0,
        host: flag('host') ?? 'claude',
      });
      console.log(JSON.stringify(out));
    } else if (verb === 'tier') {
      const tier = argv[1] && !argv[1].startsWith('--') ? argv[1] : flag('tier');
      if (!tier) { console.error('Usage: model-policy.mjs tier <fast|powerful|reasoning> [--budget-exhausted] [--host claude|codex|agy]'); process.exit(1); }
      console.log(JSON.stringify(aliasForTier(tier, { budgetExhausted: has('budget-exhausted'), host: flag('host') ?? 'claude' })));
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
