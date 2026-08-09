#!/usr/bin/env node
/** ContextDevKit 4 Antigravity installation and lifecycle integration test. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFixture, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - Antigravity v4 host\n');
const fixture = installFixture(rep);
const { proj } = fixture;
const ctx = (...args) => run([join(proj, 'ctx.mjs'), ...args], { cwd: proj });

const expectedScripts = Object.freeze({
  SessionStart: 'governance-session-context.mjs',
  UserPromptSubmit: 'governance-prompt-preflight.mjs',
  PreToolUse: 'governance-write-preflight.mjs',
  PostToolUse: 'governance-postflight.mjs',
  Stop: 'governance-completion.mjs',
});

try {
  existsSync(join(proj, '.agents', 'agents'))
    && existsSync(join(proj, '.agents', 'skills'))
    && existsSync(join(proj, 'ctx.mjs'))
    && existsSync(join(proj, 'INSTRUCTIONS.md'))
    ? ok('Antigravity assets install from canonical projections')
    : bad('Antigravity assets are incomplete');

  !existsSync(join(proj, '.antigravity'))
    ? ok('installer does not create the retired Antigravity directory')
    : bad('installer recreated the retired Antigravity directory');

  const hooksPath = join(proj, '.agents', 'hooks.json');
  const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
  const group = hooks.contextdevkit;
  for (const [eventName, expectedScript] of Object.entries(expectedScripts)) {
    const commands = (group?.[eventName] || [])
      .flatMap((entry) => entry.hooks || [])
      .map((hook) => String(hook.command || ''));
    const matchingCommands = commands.filter((command) => command.includes(expectedScript));
    matchingCommands.length > 0
      && commands.every((command) => command.includes('--host agy'))
      ? ok(`${eventName} projects only the v4 Antigravity process`)
      : bad(`${eventName} projection drifted: ${JSON.stringify(commands)}`);
  }

  const exact = ctx('doctor');
  exact.status === 0 && /ContextDevKit|doctor/i.test(exact.stdout + exact.stderr)
    ? ok('ctx.mjs dispatches an exact command')
    : bad(`ctx.mjs exact dispatch failed: ${exact.stderr}`);

  const typo = ctx('doctr');
  typo.status !== 0 && /Did you mean:.*doctor/i.test(typo.stderr)
    ? ok('ctx.mjs refuses fuzzy execution and offers a suggestion')
    : bad(`ctx.mjs typo handling drifted: ${typo.stderr}`);

  const traversal = ctx('../../runtime/hooks/probe');
  traversal.status !== 0 && /Unknown command/i.test(traversal.stderr)
    ? ok('ctx.mjs confines command dispatch to its registry')
    : bad('ctx.mjs accepted a path-shaped command');

  const commandCard = ctx('help', 'doctor');
  commandCard.status === 0 && /Run: node ctx\.mjs doctor/.test(commandCard.stdout)
    ? ok('Antigravity command help resolves from the projected skill catalog')
    : bad(`Antigravity command help failed: ${commandCard.stderr}`);
} catch (error) {
  bad(`crashed: ${error?.stack || error}`);
} finally {
  fixture.cleanup();
}

rep.finish('Integration (Antigravity v4 host)');
