#!/usr/bin/env node
/**
 * ContextDevKit integration test — Codex host.
 *
 * Installs the kit into a throwaway project and verifies the Codex-specific
 * surfaces: AGENTS.md, `.codex/` hooks/subagents, `source-command-*` skills,
 * and the `cdx.mjs` command runner alias.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { KIT, run, reporter, installFixture } from './it-helpers.mjs';
import { isSkippedForCodex } from '../templates/contextkit/runtime/codex/convert-core.mjs';
import {
  cleanupLegacyGlobalCodexRouting,
  removeLegacyProjectRoutingSection,
} from './install/codex.mjs';

/** Recursively lists Markdown files so host parity never depends on a stale count. */
function listMarkdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath);
  }
  return files;
}

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — Codex host\n');
const fx = installFixture(rep);
const { proj } = fx;
const cdx = (...args) => run([join(proj, 'cdx.mjs'), ...args], { cwd: proj });

try {
  existsSync(join(proj, '.codex', 'agents')) &&
    existsSync(join(proj, '.codex', 'hooks.json')) &&
    existsSync(join(proj, 'AGENTS.md')) &&
    existsSync(join(proj, 'cdx.mjs'))
    ? ok('Codex assets installed (.codex + AGENTS.md + cdx.mjs)')
    : bad('Codex assets not installed by the installer');

  existsSync(join(proj, '.agents', 'skills', 'source-command-state', 'SKILL.md'))
    ? ok('Codex source-command skills installed under .agents/skills')
    : bad('Codex source-command skill missing');
  const installedClaudeCommandsRoot = join(proj, '.claude', 'commands');
  const expectedCodexCommandCount = listMarkdownFiles(installedClaudeCommandsRoot)
    .map((path) => relative(installedClaudeCommandsRoot, path).replaceAll('\\', '/'))
    .filter((path) => path !== 'README.md' && !isSkippedForCodex(path))
    .length;
  const installedCodexCommandCount = readdirSync(join(proj, '.agents', 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('source-command-'))
    .length;
  installedCodexCommandCount === expectedCodexCommandCount
    ? ok(`Codex installs all ${expectedCodexCommandCount} canonical command projections (zero silent skips)`)
    : bad(`Codex command projection count does not match Claude (${installedCodexCommandCount}/${expectedCodexCommandCount})`);

  const reviewer = readFileSync(join(proj, '.codex', 'agents', 'code-reviewer.toml'), 'utf-8');
  /AGENTS\.md/.test(reviewer) && !/CLAUDE\.md/.test(reviewer)
    ? ok('Codex subagents are adapted to AGENTS.md')
    : bad('Codex subagent still references CLAUDE.md');
  const installedCodexAgents = readdirSync(join(proj, '.codex', 'agents'))
    .filter((name) => name.endsWith('.toml') && name !== '_TEMPLATE.toml')
    .map((name) => name.replace(/\.toml$/, ''))
    .sort();
  const installedRegistryAgents = JSON.parse(readFileSync(join(proj, 'contextkit', 'policy', 'agent-capability-registry.json'), 'utf-8'))
    .agents.map((entry) => entry.agent)
    .sort();
  const missingInstalledRegistry = installedCodexAgents.filter((name) => !installedRegistryAgents.includes(name));
  const extraInstalledRegistry = installedRegistryAgents.filter((name) => !installedCodexAgents.includes(name));
  missingInstalledRegistry.length === 0 && extraInstalledRegistry.length === 0
    ? ok(`Codex installed agents match the capability registry (${installedCodexAgents.length}/${installedRegistryAgents.length})`)
    : bad(`Codex installed agent/registry drift: missing=[${missingInstalledRegistry.join(',')}] extra=[${extraInstalledRegistry.join(',')}]`);
  const architectAgent = readFileSync(join(proj, '.codex', 'agents', 'architect.toml'), 'utf-8');
  const qaUnitAgent = readFileSync(join(proj, '.codex', 'agents', 'qa-unit.toml'), 'utf-8');
  const qaOrchestratorAgent = readFileSync(join(proj, '.codex', 'agents', 'qa-orchestrator.toml'), 'utf-8');
  /model = "gpt-5\.6-sol"/.test(architectAgent) &&
  /model = "gpt-5\.6-luna"/.test(qaUnitAgent) &&
  !/^model = /m.test(qaOrchestratorAgent)
    ? ok('Codex subagents carry host-resolved models and preserve inherit')
    : bad('Codex subagent model projection is wrong');

  const codexModel = run([join(proj, 'contextkit', 'tools', 'scripts', 'model-policy.mjs'), 'resolve', '--agent', 'qa-unit', '--task', 'execute', '--host', 'codex', '--complexity', 'low', '--risk', 'low'], { cwd: proj });
  (() => { try { const dispatch = JSON.parse(codexModel.stdout); return dispatch.decision === 'recommend' && dispatch.recommendedModel === 'gpt-5.6-luna' && dispatch.recommendedEffort === 'low' && dispatch.continuation?.allowed === true; } catch { return false; } })()
    ? ok('Codex model policy recommends gpt-5.6-luna@low without dispatch authority')
    : bad(`Codex model policy did not resolve: ${(codexModel.stdout + codexModel.stderr).slice(0, 200)}`);
  const codexSearch = run([
    join(proj, 'contextkit', 'tools', 'scripts', 'model-policy.mjs'), 'tier', 'powerful',
    '--host', 'codex', '--task-kind', 'research', '--complexity', 'S', '--risk', 'low',
  ], { cwd: proj });
  (() => {
    try {
      const dispatch = JSON.parse(codexSearch.stdout);
      return dispatch.decision === 'recommend' && dispatch.recommendedModel === 'gpt-5.6-luna' && dispatch.recommendedEffort === 'low' && dispatch.ruleId === 'codex-low-low-luna-low';
    } catch { return false; }
  })()
    ? ok('Codex complete dimensions outrank research task kind')
    : bad(`Codex effort policy did not resolve research: ${(codexSearch.stdout + codexSearch.stderr).slice(0, 300)}`);
  const installedSwarmSkill = readFileSync(join(proj, '.agents', 'skills', 'source-command-pipeline-swarm', 'SKILL.md'), 'utf-8');
  /current work contract/.test(installedSwarmSkill)
    && /do not cancel a swarm/.test(installedSwarmSkill)
    && !/decision:\"dispatch\"/.test(installedSwarmSkill)
    ? ok('Codex swarm is conditionally required without routing admission control')
    : bad('Codex swarm lost its conditional trigger or still treats routing as dispatch authority');
  const installedDebateSkill = readFileSync(join(proj, '.agents', 'skills', 'source-command-debate', 'SKILL.md'), 'utf-8');
  /needsDebate: true/.test(installedDebateSkill)
    && /does not block the council or make the requirement disappear/.test(installedDebateSkill)
    ? ok('Codex debate preserves governed requirements across routing degradation')
    : bad('Codex debate no longer honors the governed conditional requirement');
  const installedHostContract = readFileSync(join(proj, 'AGENTS.md'), 'utf-8');
  /conditional-coordination/.test(installedHostContract)
    && /never authorizes or denies the invocation/.test(installedHostContract)
    && /become required when/.test(installedHostContract)
    && /legacy\s+`decision`, `model`, `effort`, or `ruleId` fields/.test(installedHostContract)
    ? ok('Codex host contract separates conditional coordination from legacy routing receipts')
    : bad('Codex host contract collapses conditional coordination into optional routing');

  const legacyProjectInstructions = [
    '# Project instructions',
    '',
    '### Codex-only mandatory subagent routing',
    '',
    'Spawn only when the JSON receipt contains decision:"dispatch".',
    '',
    '## Project rules',
    '',
    'Keep this user rule.',
    '',
  ].join('\n');
  const cleanedProjectInstructions = removeLegacyProjectRoutingSection(legacyProjectInstructions);
  cleanedProjectInstructions.changed
    && !/mandatory subagent routing|decision:"dispatch"/.test(cleanedProjectInstructions.text)
    && /Keep this user rule\./.test(cleanedProjectInstructions.text)
    ? ok('Codex update removes only the legacy project routing gate')
    : bad('Codex project routing cleanup removed user content or kept the old gate');
  const cleanedTrailingGate = removeLegacyProjectRoutingSection([
    '# User instructions',
    '',
    '### Codex-only mandatory subagent routing',
    '',
    'Old gate at end of file.',
    '',
  ].join('\n'));
  cleanedTrailingGate.changed && cleanedTrailingGate.text.trim() === '# User instructions'
    ? ok('Codex project routing cleanup also handles a trailing legacy gate')
    : bad('Codex project routing cleanup left a trailing legacy gate');

  const legacyCodexHome = join(proj, '.legacy-codex-home');
  mkdirSync(join(legacyCodexHome, 'harness'), { recursive: true });
  writeFileSync(join(legacyCodexHome, 'AGENTS.md'), [
    '# User global instruction',
    '',
    '<!-- contextdevkit:codex-global-routing:start -->',
    '# Global Codex subagent routing',
    'Spawn only with decision: dispatch.',
    '<!-- contextdevkit:codex-global-routing:end -->',
    '',
  ].join('\n'));
  for (const filename of ['resolve-subagent-route.mjs', 'resolve-subagent-route.selftest.mjs', 'subagent-routing-policy.json']) {
    writeFileSync(join(legacyCodexHome, 'harness', filename), 'legacy');
  }
  const cleanupReceipt = await cleanupLegacyGlobalCodexRouting(legacyCodexHome, []);
  const cleanedGlobalInstructions = readFileSync(join(legacyCodexHome, 'AGENTS.md'), 'utf-8');
  cleanupReceipt.removedBlock
    && cleanupReceipt.removedHarnessFiles === 3
    && /User global instruction/.test(cleanedGlobalInstructions)
    && !/Global Codex subagent routing/.test(cleanedGlobalInstructions)
    && !existsSync(join(legacyCodexHome, 'harness'))
    ? ok('Codex update removes the managed global v3 routing harness and preserves user prose')
    : bad('Codex global routing cleanup is incomplete or destructive');

  const hooks = JSON.parse(readFileSync(join(proj, '.codex', 'hooks.json'), 'utf-8'));
  const expectedHook = {
    SessionStart: 'governance-session-context.mjs',
    PostToolUse: 'governance-postflight.mjs',
    Stop: 'governance-completion.mjs',
    PreToolUse: 'governance-write-preflight.mjs',
    UserPromptSubmit: 'governance-prompt-preflight.mjs',
    PreCompact: 'governance-session-context.mjs',
    SubagentStart: 'governance-session-context.mjs',
  };
  const hostCommands = Object.fromEntries(Object.entries(expectedHook).map(([eventName]) => [
    eventName,
    (hooks.hooks?.[eventName] ?? []).flatMap((entry) => entry.hooks ?? [])
      .map((hook) => String(hook.command ?? ''))
      .filter((command) => command.includes('contextkit/runtime/hooks/')),
  ]));
  Object.entries(expectedHook).every(([eventName, script]) =>
    hostCommands[eventName]?.length === 1 && hostCommands[eventName][0].includes(script))
    ? ok('.codex/hooks.json installs one v4 dispatcher per governed host event')
    : bad(`.codex/hooks.json dispatcher parity failed: ${JSON.stringify(hostCommands)}`);
  const serializedHooks = JSON.stringify(hooks);
  !/execution-contract|track-edits|session-start|completion-gate|simulate-gate|subagent-gate/.test(serializedHooks)
    ? ok('.codex/hooks.json contains no legacy hook registration')
    : bad('.codex/hooks.json still registers a legacy hook');

  const agentsMd = readFileSync(join(proj, 'AGENTS.md'), 'utf-8');
  /contextdevkit:host-contract:start/.test(agentsMd) &&
  /mutation-only-intake/.test(agentsMd) &&
  /canonical-json-state/.test(agentsMd) &&
  /identical for Claude, Codex, and Antigravity/.test(agentsMd)
    ? ok('AGENTS.md carries the canonical v4 cross-host contract')
    : bad('AGENTS.md missing the canonical v4 cross-host contract');

  const noOp = run([join(proj, 'contextkit', 'runtime', 'hooks', 'governance-prompt-preflight.mjs'), '--host', 'codex'], {
    cwd: proj,
    input: JSON.stringify({
      session_id: 'codex_local',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'How does the workflow store work? Do not change anything.',
    }),
  });
  noOp.status === 0 && !existsSync(join(proj, '.claude', '.sessions', 'codex_local.json'))
    ? ok('Codex read-only exploration exits cleanly with no legacy ledger/task creation')
    : bad(`Codex no-op dispatcher persisted state: ${(noOp.stdout + noOp.stderr).slice(0, 300)}`);

  mkdirSync(join(proj, 'apps', 'codex-module'), { recursive: true });
  writeFileSync(join(proj, 'apps', 'codex-module', 'package.json'), '{"name":"codex-module"}');
  const scopedGuide = run([
    join(proj, 'contextkit', 'tools', 'scripts', 'claude-md.mjs'),
    'scaffold',
    '--host',
    'codex',
  ], { cwd: proj });
  existsSync(join(proj, 'apps', 'codex-module', 'AGENTS.md')) &&
  /Scaffolded 1 scoped AGENTS\.md/.test(scopedGuide.stdout)
    ? ok('Codex modular-instructions skill scaffolds scoped AGENTS.md')
    : bad(`Codex scoped AGENTS.md scaffolding failed: ${(scopedGuide.stdout + scopedGuide.stderr).slice(0, 300)}`);

  const menu = cdx('help');
  menu.status === 0 && /Command Runner \(Codex\)/.test(menu.stdout)
    ? ok('cdx help uses Codex branding')
    : bad(`cdx help branding wrong: ${(menu.stdout + menu.stderr).slice(0, 200)}`);

  const helpOne = cdx('help', 'doctor');
  helpOne.status === 0 && /Run: node cdx\.mjs doctor/.test(helpOne.stdout)
    ? ok('cdx help <command> prints Codex invocation')
    : bad(`cdx help doctor failed: ${(helpOne.stdout + helpOne.stderr).slice(0, 200)}`);

  const doctor = cdx('doctor');
  /cdx\.mjs runner present/.test(doctor.stdout) && /AGENTS\.md present, fully rendered/.test(doctor.stdout)
    ? ok('doctor verifies the Codex host on a fresh install')
    : bad(`doctor missing Codex checks: ${doctor.stdout.slice(-500)}`);

  writeFileSync(join(proj, 'AGENTS.md'), '# Custom Codex instructions\n');
  const update = run([join(KIT, 'install.mjs'), '--target', proj, '--update'], {
    env: { ...process.env, CODEX_HOME: join(proj, '.update-codex-home') },
  });
  const refreshedAgents = readFileSync(join(proj, 'AGENTS.contextdevkit.md'), 'utf-8');
  update.status === 0 && /contextdevkit:host-contract:start/.test(refreshedAgents)
    ? ok('--update preserves AGENTS.md and writes refreshed AGENTS.contextdevkit.md')
    : bad(`Codex update sidecar missing: ${(update.stdout + update.stderr).slice(-500)}`);

  writeFileSync(join(proj, 'AGENTS.md'), '# {{PROJECT_NAME}}\nbroken render\n');
  const stale = cdx('doctor');
  /AGENTS\.md has unrendered placeholder/.test(stale.stdout)
    ? ok('doctor flags leftover AGENTS.md placeholders')
    : bad('doctor did not flag the unrendered AGENTS.md placeholder');
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (Codex host)');
