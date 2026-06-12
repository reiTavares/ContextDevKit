#!/usr/bin/env node
/**
 * ContextDevKit integration test — Codex host.
 *
 * Installs the kit into a throwaway project and verifies the Codex-specific
 * surfaces: AGENTS.md, `.codex/` hooks/subagents, `source-command-*` skills,
 * and the `cdx.mjs` command runner alias.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

  const reviewer = readFileSync(join(proj, '.codex', 'agents', 'code-reviewer.toml'), 'utf-8');
  /AGENTS\.md/.test(reviewer) && !/CLAUDE\.md/.test(reviewer)
    ? ok('Codex subagents are adapted to AGENTS.md')
    : bad('Codex subagent still references CLAUDE.md');

  const hooks = JSON.parse(readFileSync(join(proj, '.codex', 'hooks.json'), 'utf-8'));
  (hooks.PreToolUse ?? hooks.hooks?.PreToolUse)?.some((entry) =>
    (entry.hooks ?? []).some((hook) => /simulate-gate\.mjs --host codex/.test(hook.command ?? '')),
  )
    ? ok('.codex/hooks.json wires the L5 simulate gate with the Codex host flag')
    : bad('.codex/hooks.json missing the Codex simulate gate host flag');

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

  writeFileSync(join(proj, 'codex-owned.txt'), 'hello\n');
  run([join(proj, 'contextkit', 'runtime', 'hooks', 'track-edits.mjs'), '--host', 'codex'], {
    cwd: proj,
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(proj, 'codex-owned.txt') } }),
  });
  const ledger = JSON.parse(readFileSync(join(proj, '.claude', '.sessions', 'codex_local.json'), 'utf-8'));
  ledger.modifications?.some((entry) => entry.path === 'codex-owned.txt')
    ? ok('Codex hooks share one stable session ledger without session_id')
    : bad('Codex track-edits did not reuse the SessionStart ledger');

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
  const update = run([join(KIT, 'install.mjs'), '--target', proj, '--update']);
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
