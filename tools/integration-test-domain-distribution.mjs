#!/usr/bin/env node
/** ContextDevKit 4 Domain Engineering distribution integration test. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, installFixture, readJson, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - Domain Engineering v4 distribution\n');
const fixture = installFixture(rep);

try {
  const installed = (...parts) => join(fixture.proj, 'contextkit', ...parts);
  for (const [subtree, sentinel] of [
    ['domain-engineering', 'policy-manifest.json'],
    ['devteam', 'skills-registry.json'],
    ['domain-artifacts', 'artifact-schemas.json'],
  ]) {
    existsSync(installed('policy', subtree, sentinel))
      ? ok(`installer includes policy/${subtree}/${sentinel}`)
      : bad(`installer omitted policy/${subtree}/${sentinel}`);
  }

  const skills = ['senior-implementation', 'domain-modeling', 'modular-design', 'ddd-architecture-review', 'domain-test-strategy', 'implementation-review'];
  skills.every((skill) => existsSync(installed('skills', skill, 'SKILL.md')))
    ? ok('installer includes every canonical Domain Engineering skill')
    : bad('one or more Domain Engineering skills are missing');

  const settings = readJson(join(fixture.proj, '.claude', 'settings.json'));
  const commands = (eventName) => (settings.hooks?.[eventName] || [])
    .flatMap((group) => group.hooks || [])
    .map((hook) => String(hook.command || ''));
  commands('PreToolUse').length === 1 && commands('PreToolUse')[0].includes('governance-write-preflight.mjs')
    ? ok('DDD write evaluation is composed inside the single preflight process')
    : bad(`PreToolUse composition drifted: ${JSON.stringify(commands('PreToolUse'))}`);
  commands('PostToolUse').length === 1 && commands('PostToolUse')[0].includes('governance-postflight.mjs')
    ? ok('DDD observation is composed inside the single postflight process')
    : bad(`PostToolUse composition drifted: ${JSON.stringify(commands('PostToolUse'))}`);

  const config = readJson(join(fixture.proj, 'contextkit', 'config.json'));
  config.governance?.gates?.['ddd-invariants'] === 'guarded'
    ? ok('installed matrix guards only deterministic applicable DDD invariants')
    : bad('installed DDD gate mode is not guarded');

  const diagnostic = run([
    installed('tools', 'scripts', 'domain-inspect.mjs'),
    'add a field to the checkout aggregate',
    '--json',
  ], { cwd: fixture.proj });
  let view = null;
  try { view = JSON.parse(diagnostic.stdout); } catch { /* asserted below */ }
  diagnostic.status === 0 && typeof view?.block?.profile === 'string'
    ? ok('read-only domain diagnostic emits a classification view')
    : bad(`domain diagnostic failed: ${diagnostic.stdout || diagnostic.stderr}`);

  const manifestBefore = readFileSync(installed('policy', 'domain-engineering', 'policy-manifest.json'), 'utf8');
  const update = run([join(KIT, 'install.mjs'), '--target', fixture.proj, '--update', '--yes'], { cwd: KIT });
  let manifestAfter = null;
  try { manifestAfter = JSON.parse(readFileSync(installed('policy', 'domain-engineering', 'policy-manifest.json'), 'utf8')); } catch { /* asserted below */ }
  update.status === 0 && manifestAfter && typeof manifestAfter === 'object' && manifestBefore.length > 0
    ? ok('update preserves a valid Domain Engineering policy distribution')
    : bad(`update damaged the Domain Engineering policy: ${update.stderr}`);
} catch (error) {
  bad(`unexpected failure: ${error?.stack || error}`);
} finally {
  fixture.cleanup();
}

rep.finish('Domain Engineering v4 distribution');
