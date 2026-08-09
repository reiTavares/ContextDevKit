#!/usr/bin/env node
/**
 * ContextDevKit 4 core install and governance-runtime integration test.
 *
 * The focused dispatcher and anti-loop suites prove the internal contracts.
 * This suite proves that a real installed project exposes exactly the same
 * single-process lifecycle and that read-only events create no session state.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installFixture, readJson, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - v4 core\n');

const fixture = installFixture(rep);
const { proj } = fixture;

const expectedLifecycle = Object.freeze({
  SessionStart: 'governance-session-context.mjs',
  UserPromptSubmit: 'governance-prompt-preflight.mjs',
  PreToolUse: 'governance-write-preflight.mjs',
  PostToolUse: 'governance-postflight.mjs',
  Stop: 'governance-completion.mjs',
});

/** @param {Record<string, any>} settings @param {string} eventName */
function commandsFor(settings, eventName) {
  return (settings.hooks?.[eventName] || [])
    .flatMap((group) => group.hooks || [])
    .map((hook) => String(hook.command || ''));
}

try {
  existsSync(join(proj, '.git', 'hooks', 'pre-push'))
    ? ok('installer writes the pre-push safety hook')
    : bad('pre-push safety hook missing');

  const settings = readJson(join(proj, '.claude', 'settings.json'));
  for (const [eventName, script] of Object.entries(expectedLifecycle)) {
    const commands = commandsFor(settings, eventName);
    commands.length === 1 && commands[0].includes(script)
      ? ok(`${eventName} starts exactly one v4 process`)
      : bad(`${eventName} commands drifted: ${JSON.stringify(commands)}`);
  }

  const hookDirectory = join(proj, 'contextkit', 'runtime', 'hooks');
  const installedGovernanceHooks = readdirSync(hookDirectory)
    .filter((name) => /^governance-(?:session-context|prompt-preflight|write-preflight|postflight|completion|host-io)\.mjs$/.test(name));
  installedGovernanceHooks.length === 6
    ? ok('installed runtime contains the complete v4 governance boundary')
    : bad(`installed governance hook set is incomplete: ${installedGovernanceHooks.join(', ')}`);

  const sessionStateRoot = join(proj, '.claude', '.sessions');
  const readOnlyEvent = run([
    join(hookDirectory, 'governance-prompt-preflight.mjs'),
  ], {
    cwd: proj,
    input: JSON.stringify({ session_id: 'read-only-probe', prompt: 'Explain the task store without changing files.' }),
  });
  readOnlyEvent.status === 0
    ? ok('conversation preflight exits successfully')
    : bad(`conversation preflight failed: ${readOnlyEvent.stderr}`);
  !existsSync(sessionStateRoot)
    ? ok('conversation preflight creates no durable session state')
    : bad('conversation preflight created a session-state directory');

  const { loadConfigSync } = await import(pathToFileURL(
    join(proj, 'contextkit', 'runtime', 'config', 'load.mjs'),
  ).href);
  const config = loadConfigSync(proj);
  const modes = config.governance?.gates || {};
  modes['qa-signoff'] === 'guarded'
    && modes['ddd-invariants'] === 'guarded'
    && modes['technical-debt'] === 'guarded'
    && modes['architecture-debt'] === 'canary'
    && modes['privacy-lgpd'] === 'shadow'
    ? ok('installed governance matrix has exactly the intended guarded/shadow defaults')
    : bad(`installed governance matrix drifted: ${JSON.stringify(modes)}`);

  existsSync(join(proj, 'contextkit', 'docs', 'work-lifecycle.md'))
    ? ok('v4 lifecycle documentation is installed')
    : bad('v4 lifecycle documentation missing');
} catch (error) {
  bad(`crashed: ${error?.stack || error}`);
} finally {
  fixture.cleanup();
}

rep.finish('Integration (v4 core)');
