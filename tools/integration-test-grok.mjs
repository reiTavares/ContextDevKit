#!/usr/bin/env node
/** ContextDevKit 4 Grok installation and lifecycle integration test. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFixture, KIT, readJson, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - Grok v4 host\n');
const fixture = installFixture(rep);
const { proj } = fixture;
const hooksPath = join(proj, '.grok', 'hooks', 'contextdevkit.json');

const expectedScripts = Object.freeze({
  SessionStart: 'governance-session-context.mjs',
  UserPromptSubmit: 'governance-prompt-preflight.mjs',
  PreToolUse: 'governance-write-preflight.mjs',
  PostToolUse: 'governance-postflight.mjs',
  Stop: 'governance-completion.mjs',
});

/** @param {Record<string, any>} hooks @param {string} eventName */
function commandsFor(hooks, eventName) {
  return (hooks.hooks?.[eventName] || [])
    .flatMap((group) => group.hooks || [])
    .map((hook) => String(hook.command || ''));
}

try {
  const hooks = readJson(hooksPath);
  for (const [eventName, expectedScript] of Object.entries(expectedScripts)) {
    const commands = commandsFor(hooks, eventName);
    commands.length === 1
      && commands[0].includes(expectedScript)
      && commands[0].includes('--host grok')
      ? ok(`${eventName} starts exactly one Grok v4 process`)
      : bad(`${eventName} projection drifted: ${JSON.stringify(commands)}`);
  }

  const userHook = { hooks: [{ type: 'command', command: 'echo user-grok-hook' }] };
  hooks.hooks.Stop = [...(hooks.hooks.Stop || []), userHook];
  writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');
  const rewire = run([join(KIT, 'install.mjs'), '--target', proj, '--rewire', '--level', '5', '--yes'], { cwd: KIT });
  const rewired = readJson(hooksPath);
  rewire.status === 0 && commandsFor(rewired, 'Stop').includes('echo user-grok-hook')
    ? ok('Grok rewire preserves unrelated user hooks')
    : bad(`Grok rewire dropped user state: ${rewire.stderr}`);

  const rendererPath = join(proj, 'contextkit', 'runtime', 'mcp', 'render', 'render-grok.mjs');
  const { renderHost } = await import(`file://${rendererPath.replaceAll('\\', '/')}`);
  const registry = readJson(join(proj, 'contextkit', 'mcp', 'registry.json'));
  const artifact = renderHost({ version: 1, servers: [{ id: 'contextdevkit', referencedSecrets: [] }] }, registry.entries)[0];
  artifact.content.includes('[mcp_servers."contextdevkit"]')
    ? ok('Grok MCP renderer produces native TOML')
    : bad('Grok MCP renderer output drifted');

  existsSync(join(proj, '.grok')) && readFileSync(hooksPath, 'utf8').includes('governance-')
    ? ok('Grok project surfaces remain project-local and inspectable')
    : bad('Grok project surface missing');
} catch (error) {
  bad(`crashed: ${error?.stack || error}`);
} finally {
  fixture.cleanup();
}

rep.finish('Integration (Grok v4 host)');
