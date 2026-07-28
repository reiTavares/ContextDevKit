#!/usr/bin/env node
/**
 * ContextDevKit integration test — Grok Build native host (OP-0014).
 *
 * Installs the kit into a throwaway project and verifies the complete Grok
 * surface: hook projection, user-hook preservation, camelCase lifecycle input,
 * shared session tracking, L5 deny output, MCP TOML projection, and safe
 * uninstall that leaves `.grok/config.toml` and user hooks intact.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { run, reporter, installFixture, readJson, cleanGitEnv, KIT } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — Grok Build host\n');
const fx = installFixture(rep);
const { proj } = fx;
const grokHooksPath = join(proj, '.grok', 'hooks', 'contextdevkit.json');
const grokConfigPath = join(proj, '.grok', 'config.toml');
const hook = (name, payload) => run([
  join(proj, 'contextkit', 'runtime', 'hooks', name), '--host', 'grok',
], { cwd: proj, input: JSON.stringify(payload) });

try {
  const hooks = readJson(grokHooksPath);
  existsSync(grokHooksPath) && hooks.hooks?.SessionStart && hooks.hooks?.PreToolUse
    ? ok('Grok hook projection installed at .grok/hooks/contextdevkit.json')
    : bad('Grok hook projection is missing required lifecycle events');

  const l5Commands = Object.values(hooks.hooks).flat().flatMap((group) =>
    (group.hooks || []).map((entry) => entry.command || '')
  );
  l5Commands.some((command) => command.includes('simulate-gate.mjs --host grok')) &&
  l5Commands.every((command) => !command.includes('contextkit/runtime/hooks') || command.endsWith('--host grok'))
    ? ok('Grok hook projection wires L5 controls with explicit host flags')
    : bad('Grok hook projection has missing or incorrect host flags');

  const executionMatcher = hooks.hooks.PreToolUse?.find((group) =>
    group.hooks?.some((entry) => String(entry.command || '').includes('execution-gate.mjs')),
  )?.matcher || '';
  const indirectMatcher = hooks.hooks.PostToolUse?.find((group) =>
    group.hooks?.some((entry) => String(entry.command || '').includes('indirect-write-reconcile.mjs')),
  )?.matcher || '';
  /MCPTool/.test(executionMatcher) && /__/.test(executionMatcher) &&
  /MCPTool/.test(indirectMatcher) && /__/.test(indirectMatcher)
    ? ok('Grok MCP tool matchers preserve Codex-equivalent L5 enforcement')
    : bad(`Grok MCP matchers do not cover qualified calls: execution=${executionMatcher}, indirect=${indirectMatcher}`);

  hooks.hooks.Stop = [
    ...(hooks.hooks.Stop || []),
    { hooks: [{ type: 'command', command: 'echo user-grok-hook' }] },
  ];
  writeFileSync(grokHooksPath, JSON.stringify(hooks, null, 2) + '\n', 'utf-8');
  const rewire = run([
    join(KIT, 'install.mjs'), '--target', proj, '--rewire', '--level', '5', '--yes',
  ], { cwd: KIT });
  const rewiredHooks = readJson(grokHooksPath);
  rewire.status === 0 && rewiredHooks.hooks.Stop.some((group) =>
    (group.hooks || []).some((entry) => entry.command === 'echo user-grok-hook')
  )
    ? ok('Grok rewire preserves unrelated user hooks')
    : bad(`Grok rewire failed or dropped the user hook: ${(rewire.stdout + rewire.stderr).slice(0, 300)}`);

  const session = hook('session-start.mjs', { sessionId: 'grok_it', hookEventName: 'SessionStart' });
  existsSync(join(proj, '.claude', '.sessions', '.grok-active.json')) && session.status === 0
    ? ok('Grok SessionStart persists a stable native session marker')
    : bad(`Grok SessionStart did not persist its marker: ${session.stdout + session.stderr}`);

  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src', 'grok.js'), 'export const grok = true;\n', 'utf-8');
  const tracked = hook('track-edits.mjs', {
    sessionId: 'grok_it',
    hookEventName: 'PostToolUse',
    toolName: 'Write',
    toolInput: { filePath: 'src/grok.js' },
  });
  const ledger = readJson(join(proj, '.claude', '.sessions', 'grok_it.json'));
  tracked.status === 0 && ledger.modifications?.some((entry) => entry.path === 'src/grok.js')
    ? ok('Grok camelCase PostToolUse records edits in the shared ledger')
    : bad(`Grok edit tracking failed: ${tracked.stdout + tracked.stderr}`);

  const configPath = join(proj, 'contextkit', 'config.json');
  const config = readJson(configPath);
  config.l5 = { ...(config.l5 || {}), highRiskPaths: ['src/'] };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  const gate = hook('simulate-gate.mjs', {
    sessionId: 'grok_it',
    hookEventName: 'PreToolUse',
    toolName: 'Write',
    toolInput: { filePath: 'src/secret.js' },
  });
  let gateVerdict = null;
  try { gateVerdict = JSON.parse(gate.stdout); } catch { /* defensive assertion below */ }
  gateVerdict?.decision === 'deny'
    ? ok('Grok L5 high-risk gate emits the native deny decision')
    : bad(`Grok L5 gate did not deny the high-risk write: ${gate.stdout}`);

  const rendererPath = join(proj, 'contextkit', 'runtime', 'mcp', 'render', 'render-grok.mjs');
  const { renderHost } = await import(`file://${rendererPath.replaceAll('\\', '/')}`);
  const registry = readJson(join(proj, 'contextkit', 'mcp', 'registry.json'));
  const mcpArtifact = renderHost({
    version: 1,
    servers: [{ id: 'contextdevkit', referencedSecrets: [] }],
  }, registry.entries)[0];
  writeFileSync(grokConfigPath, mcpArtifact.content, 'utf-8');
  existsSync(grokConfigPath) && mcpArtifact.content.includes('[mcp_servers."contextdevkit"]')
    ? ok('Grok MCP renderer produces project TOML configuration')
    : bad('Grok MCP renderer did not produce .grok/config.toml');

  const inspect = spawnSync('grok', ['inspect', '--json'], {
    cwd: proj,
    encoding: 'utf-8',
    env: { ...cleanGitEnv(), GROK_FOLDER_TRUST: '0' },
  });
  if (inspect.error?.code === 'ENOENT') {
    console.log('  · Grok CLI smoke skipped — official `grok` executable is not installed');
  } else {
    let inspection = null;
    try { inspection = JSON.parse(inspect.stdout || '{}'); } catch { /* assertion below */ }
    const discoveredHooks = Array.isArray(inspection?.hooks) ? inspection.hooks : [];
    const discoveredMcp = Array.isArray(inspection?.mcpServers) ? inspection.mcpServers : [];
    inspect.status === 0 && discoveredHooks.length > 0 &&
    discoveredMcp.some((server) => server.name === 'contextdevkit' || server.id === 'contextdevkit')
      ? ok('official Grok CLI inspect discovers ContextDevKit hooks and MCP')
      : bad(`official Grok CLI did not discover the installed ContextDevKit surfaces: ${(inspect.stdout + inspect.stderr).slice(0, 500)}`);

    const mcpDoctor = spawnSync('grok', ['mcp', 'doctor', 'contextdevkit', '--json'], {
      cwd: proj,
      encoding: 'utf-8',
      env: { ...cleanGitEnv(), GROK_FOLDER_TRUST: '0' },
    });
    mcpDoctor.status === 0
      ? ok('official Grok CLI MCP doctor reaches the native ContextDevKit server')
      : bad(`official Grok CLI MCP doctor failed for ContextDevKit: ${(mcpDoctor.stdout + mcpDoctor.stderr).slice(0, 500)}`);
  }

  const uninstall = run([
    join(KIT, 'install.mjs'), '--target', proj, '--uninstall', '--yes',
  ], { cwd: KIT });
  const remainingHooks = existsSync(grokHooksPath) ? readJson(grokHooksPath) : null;
  uninstall.status === 0 && existsSync(grokConfigPath) &&
  remainingHooks?.hooks?.Stop?.some((group) =>
    (group.hooks || []).some((entry) => entry.command === 'echo user-grok-hook')
  )
    ? ok('Grok uninstall removes only kit hooks and preserves user MCP config/hooks')
    : bad(`Grok uninstall damaged user-owned .grok content: ${(uninstall.stdout + uninstall.stderr).slice(0, 400)}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (Grok native host)');
