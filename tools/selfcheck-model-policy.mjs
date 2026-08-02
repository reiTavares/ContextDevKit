/** Deterministic checks for ADR-0052 and ADR-0150 model routing. */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VALID_ALIASES = new Set(['haiku', 'sonnet', 'opus', 'inherit']);
const CURRENT_CODEX_MODELS = Object.freeze({
  fast: 'gpt-5.6-luna', powerful: 'gpt-5.6-terra', reasoning: 'gpt-5.6-sol',
});
const VALID_CODEX_MODELS = new Set([...Object.values(CURRENT_CODEX_MODELS), 'inherit']);

async function frontmatterAliases(agentsDir) {
  const files = (await readdir(agentsDir).catch(() => [])).filter((file) => file.endsWith('.md') && file !== '_TEMPLATE.md');
  const aliases = {};
  for (const file of files) {
    const frontmatter = (await readFile(resolve(agentsDir, file), 'utf8')).split('\n---')[0];
    const line = frontmatter.match(/^model:\s*(\S+)/m);
    if (line) aliases[file.replace('.md', '')] = line[1];
  }
  return aliases;
}

function policyAlias(policy, agent) {
  if ((policy.inheritAgents ?? []).includes(agent)) return 'inherit';
  const tier = policy.agents?.[agent];
  return tier ? policy.tiers?.[tier]?.alias : undefined;
}

const EXPECTED_CODEX_ROUTES = [
  ['low', 'low', 'gpt-5.6-luna', 'low', 'codex-low-low-luna-low'],
  ['low', 'moderate', 'gpt-5.6-luna', 'medium', 'codex-low-moderate-luna-medium'],
  ['low', 'high', 'gpt-5.6-luna', 'max', 'codex-low-high-luna-max'],
  ['low', 'xhigh', 'gpt-5.6-sol', 'high', 'codex-low-xhigh-sol-high'],
  ['moderate', 'low', 'gpt-5.6-luna', 'high', 'codex-moderate-low-luna-high'],
  ['moderate', 'moderate', 'gpt-5.6-luna', 'max', 'codex-moderate-moderate-luna-max'],
  ['moderate', 'high', 'gpt-5.6-luna', 'max', 'codex-moderate-high-luna-max'],
  ['moderate', 'xhigh', 'gpt-5.6-sol', 'high', 'codex-moderate-xhigh-sol-high'],
  ['high', 'low', 'gpt-5.6-luna', 'max', 'codex-high-low-luna-max'],
  ['high', 'moderate', 'gpt-5.6-luna', 'max', 'codex-high-moderate-luna-max'],
  ['high', 'high', 'gpt-5.6-sol', 'high', 'codex-high-high-sol-high'],
  ['high', 'xhigh', 'gpt-5.6-sol', 'xhigh', 'codex-high-xhigh-sol-xhigh'],
  ['xhigh', 'low', 'gpt-5.6-luna', 'max', 'codex-xhigh-low-luna-max'],
  ['xhigh', 'moderate', 'gpt-5.6-sol', 'high', 'codex-xhigh-moderate-sol-high'],
  ['xhigh', 'high', 'gpt-5.6-sol', 'xhigh', 'codex-xhigh-high-sol-xhigh'],
  ['xhigh', 'xhigh', 'gpt-5.6-sol', 'max', 'codex-xhigh-xhigh-sol-max'],
  ['critical', 'low', 'gpt-5.6-sol', 'xhigh', 'codex-critical-low-sol-xhigh'],
  ['critical', 'moderate', 'gpt-5.6-sol', 'xhigh', 'codex-critical-moderate-sol-xhigh'],
  ['critical', 'high', 'gpt-5.6-sol', 'xhigh', 'codex-critical-high-sol-xhigh'],
  ['critical', 'xhigh', 'gpt-5.6-sol', 'max', 'codex-critical-xhigh-sol-max'],
  ['critical', 'critical', 'gpt-5.6-sol', 'ultra', 'codex-critical-critical-sol-ultra'],
];

export async function runModelPolicyChecks({ ok, bad }, { KIT }) {
  console.log('Checking model-tier routing policy (ADR-0052 / ADR-0150)...');
  const policyPath = resolve(KIT, 'templates/contextkit/policy/routing-policy.json');
  const modulePath = resolve(KIT, 'templates/contextkit/tools/scripts/model-policy.mjs');
  let policy;
  try {
    policy = JSON.parse((await readFile(policyPath, 'utf8')).replace(/^\uFEFF/, ''));
    ok('routing-policy.json parses');
  } catch (error) {
    bad(`routing-policy.json missing/corrupt: ${error?.message}`);
    return;
  }

  const tierKeys = Object.keys(policy.tiers ?? {});
  tierKeys.length === 3 && ['fast', 'powerful', 'reasoning'].every((tier) => policy.tiers[tier])
    ? ok('policy declares exactly the three demand tiers') : bad(`policy tiers wrong: ${tierKeys.join(',')}`);
  Object.values(policy.tiers ?? {}).every((tier) => VALID_ALIASES.has(tier.alias))
    ? ok('every tier maps to a valid model alias') : bad('a tier maps to an invalid alias');
  policy.hostModels?.claude && policy.hostModels?.codex && Object.values(policy.hostModels.codex).every((model) => VALID_CODEX_MODELS.has(model))
    ? ok('hostModels maps Codex tiers to supported GPT models') : bad('hostModels.codex is invalid');
  policy._codexModelReference === 'https://developers.openai.com/codex/models'
    ? ok('policy records the official Codex model reference') : bad('official Codex model reference is missing');
  Object.entries(CURRENT_CODEX_MODELS).every(([tier, model]) => policy.hostModels?.codex?.[tier] === model)
    ? ok('Codex tier catalog retains Luna/Terra/Sol') : bad('Codex tier catalog drifted');

  const frontmatter = await frontmatterAliases(resolve(KIT, 'templates/claude/agents'));
  const allAgents = new Set([...Object.keys(frontmatter), ...Object.keys(policy.agents ?? {}), ...(policy.inheritAgents ?? [])]);
  let drift = 0;
  for (const agent of allAgents) {
    const actual = frontmatter[agent];
    const expected = policyAlias(policy, agent);
    if (!actual || !expected || actual !== expected) {
      bad(`agent tier drift on ${agent}: frontmatter=${actual ?? 'missing'} policy=${expected ?? 'missing'}`);
      drift += 1;
    }
  }
  if (drift === 0) ok(`policy and frontmatter agree across ${allAgents.size} agents`);

  const ladderIndex = (tier) => policy.ladder.indexOf(tier);
  (policy.floorAgents ?? []).every((agent) => policy.agents?.[agent] && ladderIndex(policy.agents[agent]) >= ladderIndex(policy.floorTier))
    ? ok('floor agents exist at or above the floor') : bad('a floor agent is missing or below the floor');

  let mod;
  try { mod = await import(pathToFileURL(modulePath).href); ok('model-policy.mjs imports cleanly'); }
  catch (error) { bad(`model-policy.mjs import failed: ${error?.message}`); return; }
  const { resolveModel, aliasForTier, resolveCodexDispatch, normalizeCodexComplexity, normalizeCodexRisk, normalizeCodexTaskKind } = mod;

  const executed = resolveModel('devops', { task: 'execute', policy });
  executed.model === policy.tiers.fast.alias ? ok('non-Codex execute retains cheap-tier behavior') : bad(`execute routing failed: ${JSON.stringify(executed)}`);
  const floored = resolveModel('security', { task: 'execute', budgetExhausted: true, policy });
  ladderIndex(floored.tier) >= ladderIndex(policy.floorTier) ? ok('non-Codex security floor holds') : bad(`floor breached: ${JSON.stringify(floored)}`);
  resolveModel('qa-unit', { qaFailures: 2, policy }).tier === 'powerful' ? ok('non-Codex QA escalation holds') : bad('QA escalation failed');
  aliasForTier('powerful', { policy }).model === policy.tiers.powerful.alias ? ok('non-Codex tier dispatch holds') : bad('tier dispatch failed');

  const missing = aliasForTier('powerful', { host: 'codex', policy });
  missing.decision === 'refuse' && missing.model === null ? ok('Codex requires both dimensions') : bad(`missing dimensions were accepted: ${JSON.stringify(missing)}`);
  const efforts = new Set(policy.codexDispatch?.supportedEfforts ?? []);
  efforts.size === 6 && ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].every((effort) => efforts.has(effort))
    ? ok('Codex effort allowlist is complete') : bad('Codex effort allowlist is incomplete');
  const matrixKeys = (policy.codexDispatch?.matrixRules ?? []).map((rule) => `${rule.complexity}|${rule.risk}`);
  new Set(matrixKeys).size === 21 && matrixKeys.length === 21 ? ok('Codex matrix has exactly 21 routes') : bad(`Codex matrix route count is ${matrixKeys.length}`);

  for (const [complexity, risk, model, effort, ruleId] of EXPECTED_CODEX_ROUTES) {
    const dispatch = resolveCodexDispatch({ complexity, risk, policy });
    dispatch.decision === 'dispatch' && dispatch.model === model && dispatch.effort === effort && dispatch.ruleId === ruleId
      ? ok(`Codex ${complexity}+${risk} -> ${model}@${effort}`)
      : bad(`Codex route mismatch for ${complexity}+${risk}: ${JSON.stringify(dispatch)}`);
  }
  for (const complexity of ['low', 'moderate', 'high', 'xhigh']) {
    const refused = resolveCodexDispatch({ complexity, risk: 'critical', policy });
    refused.decision === 'refuse' && refused.model === null ? ok(`critical risk refused for ${complexity}`) : bad(`critical-risk refusal failed for ${complexity}`);
  }
  const taskKind = resolveCodexDispatch({ taskKind: 'research', complexity: 'high', risk: 'high', policy });
  taskKind.model === 'gpt-5.6-sol' && taskKind.effort === 'high' ? ok('dimensions outrank task kind') : bad('task kind overrode dimensions');
  const budget = aliasForTier('reasoning', { host: 'codex', complexity: 'low', risk: 'low', budgetExhausted: true, policy });
  budget.model === 'gpt-5.6-luna' && budget.effort === 'low' ? ok('dimensions outrank budget downgrade') : bad('budget overrode dimensions');
  normalizeCodexTaskKind('busca') === 'search' && normalizeCodexComplexity('very-high') === 'xhigh' && normalizeCodexRisk('critical') === 'critical'
    ? ok('Codex aliases normalize to canonical xhigh/critical') : bad('Codex alias normalization failed');

  const claude = aliasForTier('powerful', { host: 'claude', taskKind: 'search', policy });
  claude.model === 'sonnet' && claude.effort === null ? ok('Codex rules do not alter Claude') : bad('Claude routing changed');
  resolveModel('qa-unit', { host: 'agy', policy }).model === null ? ok('Antigravity host gap remains explicit') : bad('Antigravity gap changed');
  let threw = false;
  try { resolveModel('does-not-exist', { policy }); } catch { threw = true; }
  threw ? ok('unknown agent is refused') : bad('unknown agent was accepted');
}
