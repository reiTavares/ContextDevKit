#!/usr/bin/env node
/**
 * ContextDevKit integration test - QA tooling scripts.
 *
 * Keeps stack-aware test scaffolding checks out of the general tooling suite so
 * each file stays within the constitution's line budget and responsibility.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - QA tooling\n');
const fx = installFixture(rep);
const { proj, script } = fx;

try {
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'it', type: 'module', devDependencies: { vitest: '^1.0.0' } }, null, 2));
  writeFileSync(join(proj, 'pyproject.toml'), '[project]\nname = "it"\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
  writeFileSync(join(proj, 'go.mod'), 'module example.com/it\n\ngo 1.22\n');
  writeFileSync(join(proj, 'Cargo.toml'), '[package]\nname = "it"\nversion = "0.1.0"\nedition = "2021"\n');
  writeFileSync(join(proj, 'composer.json'), JSON.stringify({ require: {}, 'require-dev': { 'phpunit/phpunit': '^11.0' } }, null, 2));

  const qaPlan = script('scaffold-tests.mjs', 'plan', 'core boundaries', '--json');
  (() => {
    try {
      const parsed = JSON.parse(qaPlan.stdout);
      const stacks = parsed.detectedStacks.map((profile) => profile.stack);
      return ['node', 'python', 'go', 'rust', 'php'].every((stack) => stacks.includes(stack))
        && parsed.testPlan.some((testCase) => testCase.group === 'failure' && testCase.layer === 'fuzz');
    } catch {
      return false;
    }
  })()
    ? ok('scaffold-tests plan detects Node/Python/Go/Rust/PHP with layered cases')
    : bad(`scaffold-tests plan failed: ${qaPlan.stdout || qaPlan.stderr}`);

  const qaDryRun = JSON.parse(script('scaffold-tests.mjs', 'scaffold', 'core boundaries', '--json').stdout || '{}');
  qaDryRun.scaffold?.every((entry) => entry.status === 'dry-run')
    ? ok('scaffold-tests scaffold is dry-run by default')
    : bad(`scaffold-tests dry-run statuses wrong: ${JSON.stringify(qaDryRun.scaffold)}`);

  const qaWrite = script('scaffold-tests.mjs', 'scaffold', 'core boundaries', '--write', '--json');
  existsSync(join(proj, 'tests', 'stack-smoke.test.js')) &&
  existsSync(join(proj, 'tests', 'test_stack_smoke.py')) &&
  existsSync(join(proj, 'stack_smoke_test.go')) &&
  existsSync(join(proj, 'tests', 'stack_smoke.rs')) &&
  existsSync(join(proj, 'tests', 'StackSmokeTest.php')) &&
  JSON.parse(qaWrite.stdout || '{}').scaffold?.every((entry) => entry.status === 'written')
    ? ok('scaffold-tests --write creates starter harnesses for detected stacks')
    : bad(`scaffold-tests --write failed: ${qaWrite.stdout || qaWrite.stderr}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (QA tooling)');
