#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = resolve(HERE, '..', '..', 'policy', 'routing-policy.json');
const RUNTIME_DIR = resolve(HERE, '..', '..', 'runtime', 'codex', 'global-routing');
const START = '<!-- contextdevkit:codex-global-routing:start -->';
const END = '<!-- contextdevkit:codex-global-routing:end -->';

function tomlValue(value) { return typeof value === 'string' ? JSON.stringify(value) : String(value); }

/** Upserts known keys in one TOML table without reserializing unrelated content. */
export function upsertTomlTable(source, tableName, entries) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const header = `[${tableName}]`;
  let start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    if (lines.length > 0) lines.push('');
    start = lines.length;
    lines.push(header);
  }
  let end = lines.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]\s*$/.test(line));
  if (end < 0) end = lines.length;
  for (const [key, value] of Object.entries(entries)) {
    const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
    const at = lines.findIndex((line, index) => index > start && index < end && keyPattern.test(line));
    const rendered = `${key} = ${tomlValue(value)}`;
    if (at >= 0) lines[at] = rendered;
    else { lines.splice(end, 0, rendered); end += 1; }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function upsertMarkedContract(source, contract) {
  const existing = String(source ?? '').replace(/\r\n/g, '\n');
  const rendered = String(contract).replace(/\r\n/g, '\n').trim();
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start >= 0 && end >= start) return `${existing.slice(0, start)}${rendered}${existing.slice(end + END.length)}`.replace(/\n+$/, '') + '\n';
  const legacy = rendered.replace(`${START}\n`, '').replace(`\n${END}`, '').trim();
  if (existing.trim() === legacy) return `${rendered}\n`;
  const topLevelHeadings = existing.match(/^#\s+/gm) ?? [];
  if (!existing.includes(START) && existing.trim().startsWith('# Global Codex subagent routing') && topLevelHeadings.length === 1) {
    return `${rendered}\n`;
  }
  if (!existing.trim()) return `${rendered}\n`;
  return `${existing.replace(/\n+$/, '')}\n\n${rendered}\n`;
}

function snapshotFromPolicy(policy) {
  const dispatch = policy.codexDispatch;
  return {
    schemaVersion: 1,
    policyVersion: dispatch.policyVersion,
    canonicalComplexities: dispatch.canonicalComplexities,
    canonicalRisks: dispatch.canonicalRisks,
    models: dispatch.modelEfforts,
    matrix: Object.fromEntries(dispatch.matrixRules.map((rule) => [
      `${rule.complexity}|${rule.risk}`,
      { model: rule.model, effort: rule.effort, ruleId: rule.ruleId },
    ])),
    criticalRiskPolicy: dispatch.criticalRiskPolicy,
    ultraPolicy: dispatch.ultraPolicy,
  };
}

async function readIfPresent(path) { return existsSync(path) ? readFile(path, 'utf8') : ''; }

export async function installCodexGlobalRouting({ codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') } = {}) {
  const target = resolve(codexHome);
  const harness = join(target, 'harness');
  const configPath = join(target, 'config.toml');
  const agentsPath = join(target, 'AGENTS.md');
  await mkdir(harness, { recursive: true });

  const policy = JSON.parse((await readFile(POLICY_PATH, 'utf8')).replace(/^\uFEFF/, ''));
  const snapshot = snapshotFromPolicy(policy);
  if (Object.keys(snapshot.matrix).length !== 21) throw new Error('global routing install refused: canonical policy does not contain 21 routes');

  const currentConfig = await readIfPresent(configPath);
  let nextConfig = upsertTomlTable(currentConfig, 'features', { multi_agent: true, multi_agent_v2: true });
  nextConfig = upsertTomlTable(nextConfig, 'agents', {
    enabled: true,
    max_concurrent_threads_per_session: 15,
    default_subagent_model: 'gpt-5.6-luna',
    default_subagent_reasoning_effort: 'max',
  });
  let backup = null;
  if (currentConfig && currentConfig !== nextConfig) {
    backup = `${configPath}.bak-contextdevkit-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await writeFile(backup, currentConfig, 'utf8');
  }
  if (currentConfig !== nextConfig) await writeFile(configPath, nextConfig, 'utf8');

  const contractTemplate = await readFile(join(RUNTIME_DIR, 'AGENTS.md'), 'utf8');
  const contract = contractTemplate.replaceAll('{{CODEX_HOME}}', target.replaceAll('\\', '/'));
  const currentAgents = await readIfPresent(agentsPath);
  const nextAgents = upsertMarkedContract(currentAgents, contract);
  if (currentAgents !== nextAgents) await writeFile(agentsPath, nextAgents, 'utf8');

  await copyFile(join(RUNTIME_DIR, 'resolve-subagent-route.mjs'), join(harness, 'resolve-subagent-route.mjs'));
  await copyFile(join(RUNTIME_DIR, 'resolve-subagent-route.selftest.mjs'), join(harness, 'resolve-subagent-route.selftest.mjs'));
  await writeFile(join(harness, 'subagent-routing-policy.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  return { schemaVersion: 1, status: 'installed', codexHome: target, configPath, agentsPath, harness, backup, routes: Object.keys(snapshot.matrix).length };
}

function cliArgs(argv) {
  const at = argv.indexOf('--codex-home');
  return { codexHome: at >= 0 ? argv[at + 1] : undefined };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  installCodexGlobalRouting(cliArgs(process.argv.slice(2)))
    .then((receipt) => console.log(JSON.stringify(receipt)))
    .catch((error) => { console.error(`install-codex-global-routing: ${error?.message ?? error}`); process.exitCode = 1; });
}
