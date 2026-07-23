/**
 * Self-check — MODEL-TIER ROUTING POLICY (ADR-0052 Phase 2). Sibling runner of
 * selfcheck-templates/-source. Asserts the cost-tier policy is internally sound
 * AND agrees, agent-by-agent, with the host-enforced `model:` frontmatter — the
 * kit's single-source-via-test pattern, so a tier can't drift between the ADR
 * table, routing-policy.json and the agent files without a red gate. Also pins
 * the deterministic resolver's invariants (execute→cheap, floor, escalation).
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VALID_ALIASES = new Set(['haiku', 'sonnet', 'opus', 'inherit']);
const CURRENT_CODEX_MODELS = Object.freeze({
  fast: 'gpt-5.6-luna',
  powerful: 'gpt-5.6-terra',
  reasoning: 'gpt-5.6-sol',
});
const VALID_CODEX_MODELS = new Set([...Object.values(CURRENT_CODEX_MODELS), 'inherit']);

/** Reads each agent's `model:` alias from frontmatter → { agentName: alias }. */
async function frontmatterAliases(agentsDir) {
  const files = (await readdir(agentsDir).catch(() => [])).filter((f) => f.endsWith('.md') && f !== '_TEMPLATE.md');
  const map = {};
  for (const file of files) {
    const frontmatter = (await readFile(resolve(agentsDir, file), 'utf-8')).split('\n---')[0];
    const line = frontmatter.match(/^model:\s*(\S+)/m);
    if (line) map[file.replace('.md', '')] = line[1];
  }
  return map;
}

/** The alias the policy resolves for an agent at its static default (inherit agents → 'inherit'). */
function policyAlias(policy, agent) {
  if ((policy.inheritAgents ?? []).includes(agent)) return 'inherit';
  const tier = policy.agents?.[agent];
  return tier ? policy.tiers?.[tier]?.alias : undefined;
}

/**
 * Runs the routing-policy checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 */
export async function runModelPolicyChecks({ ok, bad }, { KIT }) {
  console.log('Checking model-tier routing policy (ADR-0052 Phase 2)...');
  const policyPath = resolve(KIT, 'templates/contextkit/policy/routing-policy.json');
  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/model-policy.mjs');

  let policy;
  try {
    policy = JSON.parse((await readFile(policyPath, 'utf-8')).replace(/^﻿/, ''));
    ok('routing-policy.json parses');
  } catch (err) {
    bad(`routing-policy.json missing/corrupt: ${err?.message}`);
    return;
  }

  // Structure + alias whitelist (ADR-0052 §1: exactly the three demand tiers).
  const tierKeys = Object.keys(policy.tiers ?? {});
  tierKeys.length === 3 && ['fast', 'powerful', 'reasoning'].every((t) => policy.tiers[t])
    ? ok('policy declares exactly the three demand tiers (fast/powerful/reasoning)')
    : bad(`policy tiers wrong: ${tierKeys.join(',')}`);
  Object.values(policy.tiers ?? {}).every((t) => VALID_ALIASES.has(t.alias))
    ? ok('every tier maps to a valid model alias') : bad('a tier maps to a non-alias model id (ADR-0052)');
  (policy.hostModels?.claude && policy.hostModels?.codex && Object.values(policy.hostModels.codex).every((model) => VALID_CODEX_MODELS.has(model)))
    ? ok('hostModels maps Codex tiers to supported GPT model overrides')
    : bad('hostModels.codex is missing or contains an unsupported Codex model');
  policy._codexModelReference === 'https://developers.openai.com/codex/models'
    ? ok('policy records the official Codex model reference')
    : bad('policy is missing the official Codex model reference');
  Object.entries(CURRENT_CODEX_MODELS).every(([tier, model]) => policy.hostModels?.codex?.[tier] === model)
    ? ok('Codex tiers map to the current GPT-5.6 Luna/Terra/Sol recommendations')
    : bad(`Codex tier mapping is stale: ${JSON.stringify(policy.hostModels?.codex ?? {})}`);

  // The core invariant: policy ↔ frontmatter agreement, both directions.
  const fmAliases = await frontmatterAliases(resolve(KIT, 'templates/claude/agents'));
  const allAgents = new Set([...Object.keys(fmAliases), ...Object.keys(policy.agents ?? {}), ...(policy.inheritAgents ?? [])]);
  let drift = 0;
  for (const agent of allAgents) {
    const fm = fmAliases[agent];
    const pol = policyAlias(policy, agent);
    if (!fm) { bad(`agent "${agent}" is in routing-policy.json but has no frontmatter (ADR-0052)`); drift++; continue; }
    if (!pol) { bad(`agent "${agent}" has frontmatter model:${fm} but is absent from routing-policy.json`); drift++; continue; }
    if (fm !== pol) { bad(`tier drift on "${agent}": frontmatter=${fm} vs policy=${pol} — reconcile via ADR-0052`); drift++; }
  }
  drift === 0 ? ok(`policy ↔ frontmatter agree across ${allAgents.size} agents (single-source-via-test)`) : bad(`${drift} agent(s) drift between policy and frontmatter`);

  // Floors are real agents and sit at/above the floor tier.
  const ladderIndex = (tier) => policy.ladder.indexOf(tier);
  (policy.floorAgents ?? []).every((a) => policy.agents?.[a] && ladderIndex(policy.agents[a]) >= ladderIndex(policy.floorTier))
    ? ok('floor agents exist and default at/above the floor tier') : bad('a floor agent is missing or below the floor tier');

  // Resolver invariants — import the deterministic resolver and pin its behavior.
  let mod;
  try { mod = await import(pathToFileURL(modPath).href); ok('model-policy.mjs imports cleanly'); }
  catch (err) { bad(`model-policy.mjs import failed: ${err?.message}`); return; }
  const { resolveModel, aliasForTier } = mod;
  const { resolveCodexDispatch, normalizeCodexComplexity, normalizeCodexRisk, normalizeCodexTaskKind } = mod;

  const exec = resolveModel('devops', { task: 'execute', policy });
  exec.model === policy.tiers.fast.alias ? ok('execute on a non-floor agent resolves to the cheap tier') : bad(`execute did not drop to cheap: ${JSON.stringify(exec)}`);

  const floored = resolveModel('security', { task: 'execute', budgetExhausted: true, policy });
  ladderIndex(floored.tier) >= ladderIndex(policy.floorTier) ? ok('a floor agent never resolves below the floor, even on execute+budget') : bad(`floor breached: ${JSON.stringify(floored)}`);

  const escalated = resolveModel('qa-unit', { qaFailures: 2, policy });
  escalated.tier === 'powerful' ? ok('qa-failures=2 escalates one tier up (fast→powerful)') : bad(`escalation wrong: ${JSON.stringify(escalated)}`);
  const capped = resolveModel('architect', { qaFailures: 2, policy });
  capped.tier === 'reasoning' ? ok('escalation caps at reasoning (no tier above opus)') : bad(`escalation cap wrong: ${JSON.stringify(capped)}`);

  aliasForTier('powerful', { policy }).model === policy.tiers.powerful.alias ? ok('tier-based dispatch (swarm path) resolves powerful→sonnet') : bad('aliasForTier(powerful) wrong');
  aliasForTier('powerful', { host: 'codex', policy }).model === policy.hostModels.codex.powerful ? ok('Codex tier-based dispatch resolves powerful→gpt-5.6-terra') : bad('Codex aliasForTier(powerful) wrong');
  resolveModel('qa-unit', { task: 'execute', host: 'codex', policy }).model === policy.hostModels.codex.fast ? ok('Codex execute dispatch resolves to the fast GPT model') : bad('Codex execute dispatch did not resolve to fast');
  resolveModel('architect', { host: 'codex', policy }).model === policy.hostModels.codex.reasoning ? ok('Codex reasoning agents resolve to gpt-5.6-sol') : bad('Codex reasoning mapping wrong');
  const codexDispatch = policy.codexDispatch;
  const effortSet = new Set(codexDispatch?.supportedEfforts ?? []);
  effortSet.size === 4 && ['low', 'medium', 'high', 'max'].every((effort) => effortSet.has(effort))
    ? ok('Codex effort policy allows low/medium/high/max') : bad('Codex effort allowlist is incomplete');
  const matrixKeys = (codexDispatch?.matrixRules ?? []).map((rule) => `${rule.complexity}|${rule.risk}`);
  new Set(matrixKeys).size === matrixKeys.length
    ? ok(`Codex effort matrix has ${matrixKeys.length} unique normalized selectors`)
    : bad('Codex effort matrix contains duplicate normalized selectors');
  const expectedCodexRules = [
    ['moderate', 'moderate', 'gpt-5.6-luna', 'max', 'codex-moderate-moderate-max'],
    ['moderate', 'high', 'gpt-5.6-luna', 'max', 'codex-moderate-high-max'],
    ['high', 'moderate', 'gpt-5.6-terra', 'high', 'codex-high-moderate-high'],
    ['high', 'very-high', 'gpt-5.6-sol', 'medium', 'codex-high-very-high-medium'],
    ['very-high', 'low', 'gpt-5.6-sol', 'high', 'codex-very-high-low-high'],
    ['very-high', 'moderate', 'gpt-5.6-sol', 'high', 'codex-very-high-moderate-high'],
    ['very-high', 'very-high', 'gpt-5.6-sol', 'max', 'codex-very-high-very-high-max'],
  ];
  for (const [complexity, risk, model, effort, ruleId] of expectedCodexRules) {
    const dispatch = resolveCodexDispatch({ complexity, risk, policy });
    dispatch.model === model && dispatch.effort === effort && dispatch.ruleId === ruleId
      ? ok(`Codex dispatch ${complexity}+${risk} -> ${model}@${effort}`)
      : bad(`Codex dispatch mismatch for ${complexity}+${risk}: ${JSON.stringify(dispatch)}`);
  }
  const exploration = resolveCodexDispatch({ taskKind: 'research', tierHint: 'powerful', policy });
  exploration.model === 'gpt-5.6-luna' && exploration.effort === 'low'
    ? ok('Codex search/research/exploration task kinds resolve Luna@low') : bad(`Codex exploration rule wrong: ${JSON.stringify(exploration)}`);
  const simple = aliasForTier('powerful', { host: 'codex', taskKind: 'simple-code', policy });
  simple.model === 'gpt-5.6-luna' && simple.effort === 'high'
    ? ok('Codex simple action/code resolves Luna@high') : bad(`Codex simple rule wrong: ${JSON.stringify(simple)}`);
  const unresolved = aliasForTier('powerful', { host: 'codex', complexity: 'low', risk: 'high', policy });
  unresolved.effort === null && unresolved.reasons.includes('codex-effort-no-explicit-rule')
    ? ok('Codex unmatched context refuses an effort override') : bad(`Codex unmatched context guessed an effort: ${JSON.stringify(unresolved)}`);
  normalizeCodexTaskKind('busca') === 'search' && normalizeCodexComplexity('XL') === 'very-high' && normalizeCodexRisk('critical') === 'very-high'
    ? ok('Codex routing normalizes bounded card/user aliases') : bad('Codex routing alias normalization is incomplete');
  const claudeEffort = aliasForTier('powerful', { host: 'claude', taskKind: 'search', policy });
  claudeEffort.model === 'sonnet' && claudeEffort.effort === null
    ? ok('Codex effort rules do not alter Claude routing') : bad(`Non-Codex routing was affected: ${JSON.stringify(claudeEffort)}`);
  resolveModel('qa-unit', { host: 'agy', policy }).model === null ? ok('agy host returns the documented gap (no invented mapping)') : bad('agy host gap not honored');

  let threw = false;
  try { resolveModel('does-not-exist', { policy }); } catch { threw = true; }
  threw ? ok('an unknown agent is refused (refuse-by-default)') : bad('unknown agent did not throw');
}
