#!/usr/bin/env node
/**
 * ContextDevKit integration test — Codex host.
 *
 * Installs the kit into a throwaway project and verifies the Codex-specific
 * surfaces: AGENTS.md, `.codex/` hooks/subagents, `source-command-*` skills,
 * and the `cdx.mjs` command runner alias.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, run, reporter, installFixture } from './it-helpers.mjs';

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
  readdirSync(join(proj, '.agents', 'skills')).filter((name) => name.startsWith('source-command-')).length === 81
    ? ok('Codex installs all 81 canonical command projections (zero silent skips)')
    : bad('Codex command projection count does not match Claude');

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
  /model = "gpt-5\.5"/.test(architectAgent) &&
  /model = "gpt-5\.4-mini"/.test(qaUnitAgent) &&
  !/^model = /m.test(qaOrchestratorAgent)
    ? ok('Codex subagents carry host-resolved models and preserve inherit')
    : bad('Codex subagent model projection is wrong');

  const codexModel = run([join(proj, 'contextkit', 'tools', 'scripts', 'model-policy.mjs'), 'resolve', '--agent', 'qa-unit', '--task', 'execute', '--host', 'codex'], { cwd: proj });
  (() => { try { return JSON.parse(codexModel.stdout).model === 'gpt-5.4-mini'; } catch { return false; } })()
    ? ok('Codex model policy resolves execute work to gpt-5.4-mini')
    : bad(`Codex model policy did not resolve: ${(codexModel.stdout + codexModel.stderr).slice(0, 200)}`);

  const hooks = JSON.parse(readFileSync(join(proj, '.codex', 'hooks.json'), 'utf-8'));
  (hooks.PreToolUse ?? hooks.hooks?.PreToolUse)?.some((entry) =>
    (entry.hooks ?? []).some((hook) => /simulate-gate\.mjs --host codex/.test(hook.command ?? '')),
  )
    ? ok('.codex/hooks.json wires the L5 simulate gate with the Codex host flag')
    : bad('.codex/hooks.json missing the Codex simulate gate host flag');
  ['UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'PreCompact'].every((event) => Array.isArray(hooks.hooks?.[event])) &&
  (hooks.hooks?.Stop ?? []).some((entry) => (entry.hooks ?? []).some((hook) => /completion-gate\.mjs --host codex/.test(hook.command ?? '')))
    ? ok('.codex/hooks.json wires Codex-native L5 contract/completion/subagent/compaction events')
    : bad('.codex/hooks.json is missing modern Codex L5 lifecycle hooks');

  const agentsMd = readFileSync(join(proj, 'AGENTS.md'), 'utf-8');
  /Complete Session Workflow \(Codex\)/.test(agentsMd) &&
  /node cdx\.mjs log-session/.test(agentsMd) &&
  /Collaborate across hosts/.test(agentsMd)
    ? ok('AGENTS.md carries Codex workflow and cross-host cooperation rules')
    : bad('AGENTS.md missing Codex workflow/cooperation rules');

  const boot = run([join(proj, 'contextkit', 'runtime', 'hooks', 'session-start.mjs'), '--host', 'codex'], { cwd: proj, input: '{}' });
  /Boot context.*\(codex\)/s.test(boot.stdout) && /node cdx\.mjs/.test(boot.stdout)
    ? ok('Codex SessionStart emits Codex-aware boot context')
    : bad(`Codex SessionStart output wrong: ${boot.stdout.slice(0, 300)}`);

  const contract = run([join(proj, 'contextkit', 'runtime', 'hooks', 'execution-contract-hook.mjs'), '--host', 'codex'], {
    cwd: proj,
    input: JSON.stringify({
      session_id: 'codex_local',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Implement a focused feature with tests and update the changelog.',
    }),
  });
  const contractLedger = JSON.parse(readFileSync(join(proj, '.claude', '.sessions', 'codex_local.json'), 'utf-8'));
  contract.status === 0 && typeof contractLedger.activeTask === 'string'
    ? ok('Codex UserPromptSubmit creates the shared execution contract')
    : bad(`Codex execution-contract hook failed: ${(contract.stdout + contract.stderr).slice(0, 300)}`);

  writeFileSync(join(proj, 'codex-owned.txt'), 'hello\n');
  run([join(proj, 'contextkit', 'runtime', 'hooks', 'track-edits.mjs'), '--host', 'codex'], {
    cwd: proj,
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(proj, 'codex-owned.txt') } }),
  });
  const ledger = JSON.parse(readFileSync(join(proj, '.claude', '.sessions', 'codex_local.json'), 'utf-8'));
  ledger.modifications?.some((entry) => entry.path === 'codex-owned.txt')
    ? ok('Codex hooks share one stable session ledger without session_id')
    : bad('Codex track-edits did not reuse the SessionStart ledger');

  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src', 'patched.js'), 'export const value = 2;\n');
  run([join(proj, 'contextkit', 'runtime', 'hooks', 'track-edits.mjs'), '--host', 'codex'], {
    cwd: proj,
    input: JSON.stringify({
      session_id: 'codex_local',
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { command: '*** Begin Patch\n*** Update File: src/patched.js\n@@\n-old\n+new\n*** End Patch\n' },
    }),
  });
  const patchedLedger = JSON.parse(readFileSync(join(proj, '.claude', '.sessions', 'codex_local.json'), 'utf-8'));
  patchedLedger.modifications?.some((entry) => entry.path === 'src/patched.js' && entry.tool === 'Write')
    ? ok('Codex apply_patch payload records every edited path through the shared adapter')
    : bad('Codex apply_patch path was invisible to track-edits');

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
  // --allow-active-sessions: a prior track-edits left a ledger in proj; opt out of the
  // 3.1.2 active-session guard (ADR-0099 P0-02) — this tests AGENTS.md handling.
  const update = run([join(KIT, 'install.mjs'), '--target', proj, '--update', '--allow-active-sessions']);
  const refreshedAgents = readFileSync(join(proj, 'AGENTS.contextdevkit.md'), 'utf-8');
  update.status === 0 && /Complete Session Workflow \(Codex\)/.test(refreshedAgents)
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
