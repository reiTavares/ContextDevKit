#!/usr/bin/env node
/**
 * Stack-aware QA planner and starter-test scaffolder.
 *
 * The QA squad needs deterministic stack context before it writes real project
 * tests. This script reads local manifests, proposes stack-specific test slices,
 * and can create minimal runner harness tests only when `--write` is explicit.
 *
 * Usage:
 *   node contextkit/tools/scripts/scaffold-tests.mjs plan [scope] [--json] [--stack node]
 *   node contextkit/tools/scripts/scaffold-tests.mjs scaffold [scope] [--write] [--json]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const STACK_ALIASES = {
  js: 'node',
  javascript: 'node',
  typescript: 'node',
  nodejs: 'node',
  py: 'python',
  golang: 'go',
  cargo: 'rust',
  composer: 'php',
};

const has = (relativePath) => existsSync(resolve(ROOT, relativePath));
const readText = (relativePath) => {
  try {
    return readFileSync(resolve(ROOT, relativePath), 'utf-8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
};
const readJson = (relativePath) => {
  try {
    return JSON.parse(readText(relativePath));
  } catch {
    return null;
  }
};

/** Parse a small flag set without pulling a dependency into the kit. */
function parseArgs(argv) {
  const positionals = [];
  const flags = new Set();
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return {
    command: positionals[0] || 'plan',
    scope: positionals.slice(1).join(' ') || 'project',
    json: flags.has('json'),
    write: flags.has('write'),
    stack: normalizeStack(values.stack || ''),
    runner: values.runner || null,
  };
}

function normalizeStack(stackName) {
  const cleanName = String(stackName || '').toLowerCase();
  return STACK_ALIASES[cleanName] || cleanName || null;
}

function packageManager(pkg) {
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  if (pkg?.packageManager) return String(pkg.packageManager).split('@')[0];
  return has('package-lock.json') || has('package.json') ? 'npm' : null;
}

function depsFrom(manifest) {
  return Object.keys({ ...(manifest?.dependencies || {}), ...(manifest?.devDependencies || {}) });
}

function nodeRunner(pkg, runnerOverride) {
  const deps = depsFrom(pkg);
  if (runnerOverride) return runnerOverride;
  if (deps.includes('vitest')) return 'vitest';
  if (deps.includes('jest')) return 'jest';
  if (deps.includes('mocha')) return 'mocha';
  if (deps.includes('ava')) return 'ava';
  if (deps.includes('@playwright/test')) return 'playwright';
  if (deps.includes('cypress')) return 'cypress';
  if (String(pkg?.scripts?.test || '').includes('node --test')) return 'node:test';
  return 'node:test';
}

function nodeCommand(pkg, runner, manager) {
  const testScript = String(pkg?.scripts?.test || '');
  const packageTest = manager === 'yarn' ? 'yarn test' : `${manager || 'npm'} test`;
  if (runner === 'node:test' && testScript.includes('node --test')) return packageTest;
  if (runner !== 'node:test' && testScript.includes(runner.replace(/^@/, ''))) return packageTest;
  if (runner === 'vitest') return 'npx vitest run tests/stack-smoke.test.js';
  if (runner === 'jest') return 'npx jest tests/stack-smoke.test.js';
  if (runner === 'mocha') return 'npx mocha tests/stack-smoke.test.js';
  if (runner === 'ava') return 'npx ava tests/stack-smoke.test.js';
  if (runner === 'playwright') return 'npx playwright test';
  if (runner === 'cypress') return 'npx cypress run';
  return 'node --test tests/stack-smoke.test.js';
}

function nodeContent(runner) {
  if (runner === 'vitest') {
    return "import { describe, expect, it } from 'vitest';\n\ndescribe('stack smoke', () => {\n  it('runs the test harness', () => {\n    expect(2 + 2).toBe(4);\n  });\n});\n";
  }
  if (runner === 'jest') {
    return "describe('stack smoke', () => {\n  test('runs the test harness', () => {\n    expect(2 + 2).toBe(4);\n  });\n});\n";
  }
  if (runner === 'mocha') {
    return "import assert from 'node:assert/strict';\n\ndescribe('stack smoke', () => {\n  it('runs the test harness', () => {\n    assert.equal(2 + 2, 4);\n  });\n});\n";
  }
  if (runner === 'ava') {
    return "import test from 'ava';\n\ntest('stack smoke: test harness runs', (t) => {\n  t.is(2 + 2, 4);\n});\n";
  }
  return "import test from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('stack smoke: test harness runs', () => {\n  assert.equal(2 + 2, 4);\n});\n";
}

function phpRunner(composer, runnerOverride) {
  const deps = Object.keys({ ...(composer?.require || {}), ...(composer?.['require-dev'] || {}) });
  if (runnerOverride) return runnerOverride;
  if (deps.includes('pestphp/pest')) return 'pest';
  if (deps.includes('phpunit/phpunit')) return 'phpunit';
  return null;
}

function phpContent(runner) {
  if (runner === 'pest') return "<?php\n\ntest('stack smoke harness runs', function () {\n    expect(2 + 2)->toBe(4);\n});\n";
  return "<?php\n\nuse PHPUnit\\Framework\\TestCase;\n\nfinal class StackSmokeTest extends TestCase\n{\n    public function testHarnessRuns(): void\n    {\n        self::assertSame(4, 2 + 2);\n    }\n}\n";
}

function goPackageName() {
  for (const entryName of readdirSync(ROOT)) {
    if (!entryName.endsWith('.go') || entryName.endsWith('_test.go')) continue;
    const match = readText(entryName).match(/^package\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    if (match) return match[1];
  }
  const moduleName = readText('go.mod').match(/^module\s+(.+)$/m)?.[1] || '';
  const candidate = basename(moduleName).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '');
  return candidate || 'main';
}

function detectProfiles(runnerOverride) {
  const profiles = [];
  const pkg = readJson('package.json');
  if (pkg || has('tsconfig.json')) {
    const runner = nodeRunner(pkg || {}, runnerOverride);
    profiles.push({
      stack: 'node',
      label: 'Node/JavaScript',
      runner,
      command: nodeCommand(pkg || {}, runner, packageManager(pkg)),
      frameworks: depsFrom(pkg || {}).filter((dep) => ['react', 'next', 'express', 'fastify', 'hono', '@nestjs/core', 'vite', 'prisma', 'drizzle-orm'].includes(dep)),
    });
  }
  const pythonText = `${readText('pyproject.toml')}\n${readText('requirements.txt')}`;
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) {
    const runner = runnerOverride || (/pytest/i.test(pythonText) ? 'pytest' : 'unittest');
    profiles.push({ stack: 'python', label: 'Python', runner, command: runner === 'pytest' ? 'pytest tests' : 'python -m unittest discover -s tests', frameworks: ['fastapi', 'django', 'flask'].filter((name) => new RegExp(name, 'i').test(pythonText)) });
  }
  if (has('go.mod')) profiles.push({ stack: 'go', label: 'Go', runner: runnerOverride || 'go test', command: 'go test ./...', frameworks: [] });
  if (has('Cargo.toml')) profiles.push({ stack: 'rust', label: 'Rust', runner: runnerOverride || 'cargo test', command: 'cargo test', frameworks: [] });
  const composer = readJson('composer.json');
  if (composer) {
    const runner = phpRunner(composer, runnerOverride);
    profiles.push({ stack: 'php', label: 'PHP', runner, command: runner === 'pest' ? 'vendor/bin/pest' : 'vendor/bin/phpunit', frameworks: ['laravel/framework', 'symfony/framework-bundle'].filter((dep) => Object.keys({ ...(composer.require || {}), ...(composer['require-dev'] || {}) }).includes(dep)) });
  }
  return profiles;
}

function casesFor(profile, scope) {
  const frameworkHint = profile.frameworks.length ? ` Framework signals: ${profile.frameworks.join(', ')}.` : '';
  return [
    { group: 'happy', layer: 'unit', title: `${profile.label}: runner contract`, detail: `Verify the test runner starts and executes a focused harness for ${scope}. Command: ${profile.command}.` },
    { group: 'happy', layer: 'integration', title: `${profile.label}: primary boundary`, detail: `Exercise the real boundary this stack exposes: HTTP route, CLI command, package API, or job handler.${frameworkHint}` },
    { group: 'edge', layer: 'unit/fuzz', title: `${profile.label}: input edges`, detail: 'Cover empty values, max-size payloads, unicode paths/text, timezone-sensitive values, and off-by-one boundaries.' },
    { group: 'edge', layer: 'integration', title: `${profile.label}: state edges`, detail: 'Cover missing optional config, clean repository state, existing output files, and repeated idempotent runs.' },
    { group: 'failure', layer: 'integration', title: `${profile.label}: dependency failure`, detail: 'Force unavailable filesystem/network/process dependencies and assert skipped/refused states are explicit, not false passes.' },
    { group: 'failure', layer: 'fuzz', title: `${profile.label}: malformed input`, detail: 'Feed malformed manifests, invalid JSON/TOML/YAML-like text, bad paths, and unsupported runner names.' },
  ];
}

function scaffoldFor(profile) {
  if (profile.stack === 'node') return ready(profile, 'tests/stack-smoke.test.js', nodeContent(profile.runner));
  if (profile.stack === 'python') {
    const body = profile.runner === 'pytest'
      ? "def test_stack_smoke_harness_runs():\n    assert 2 + 2 == 4\n"
      : "import unittest\n\n\nclass StackSmokeTest(unittest.TestCase):\n    def test_harness_runs(self):\n        self.assertEqual(2 + 2, 4)\n\n\nif __name__ == '__main__':\n    unittest.main()\n";
    return ready(profile, 'tests/test_stack_smoke.py', body);
  }
  if (profile.stack === 'go') return ready(profile, 'stack_smoke_test.go', `package ${goPackageName()}\n\nimport \"testing\"\n\nfunc TestStackSmokeHarness(t *testing.T) {\n\tif 2+2 != 4 {\n\t\tt.Fatal(\"test harness arithmetic failed\")\n\t}\n}\n`);
  if (profile.stack === 'rust') return ready(profile, 'tests/stack_smoke.rs', "#[test]\nfn stack_smoke_harness_runs() {\n    assert_eq!(2 + 2, 4);\n}\n");
  if (profile.stack === 'php' && profile.runner) return ready(profile, 'tests/StackSmokeTest.php', phpContent(profile.runner));
  return { stack: profile.stack, runner: profile.runner, path: null, command: profile.command, status: 'skipped', reason: `${profile.label} has no supported test runner signal yet.` };
}

function ready(profile, relativePath, content) {
  return { stack: profile.stack, runner: profile.runner, path: relativePath, command: profile.command, status: 'ready', reason: 'starter harness can be created', content };
}

function applyEntries(entries, shouldWrite) {
  return entries.map((entry) => {
    if (entry.status !== 'ready') return publicEntry(entry);
    if (has(entry.path)) return publicEntry({ ...entry, status: 'exists', reason: 'file already exists; not overwritten' });
    if (!shouldWrite) return publicEntry({ ...entry, status: 'dry-run', reason: 'pass --write to create this file' });
    const absolutePath = resolve(ROOT, entry.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, entry.content, { encoding: 'utf-8', flag: 'wx' });
    return publicEntry({ ...entry, status: 'written', reason: 'file created' });
  });
}

function publicEntry(entry) {
  const { content, ...safeEntry } = entry;
  return safeEntry;
}

function buildReport(args) {
  const profiles = detectProfiles(args.runner).filter((profile) => !args.stack || profile.stack === args.stack);
  const scaffold = profiles.map(scaffoldFor);
  return {
    root: ROOT,
    scope: args.scope,
    detectedStacks: profiles.map(({ stack, label, runner, command, frameworks }) => ({ stack, label, runner, command, frameworks })),
    testPlan: profiles.flatMap((profile) => casesFor(profile, args.scope).map((testCase) => ({ stack: profile.stack, ...testCase }))),
    scaffold: args.command === 'scaffold' ? applyEntries(scaffold, args.write) : scaffold.map(publicEntry),
  };
}

function printReport(report, asJson) {
  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  console.log(`QA scaffold plan for ${report.scope}`);
  console.log(`Detected stacks: ${report.detectedStacks.map((profile) => `${profile.stack} (${profile.runner || 'no runner'})`).join(', ') || 'none'}`);
  for (const profile of report.detectedStacks) console.log(`- ${profile.label}: run ${profile.command}`);
  for (const group of ['happy', 'edge', 'failure']) {
    console.log(`\n${group.toUpperCase()}`);
    for (const testCase of report.testPlan.filter((item) => item.group === group)) console.log(`- [${testCase.stack}/${testCase.layer}] ${testCase.title}: ${testCase.detail}`);
  }
  if (report.scaffold.length) {
    console.log('\nScaffold');
    for (const entry of report.scaffold) console.log(`- [${entry.status}] ${entry.stack}: ${entry.path || 'no file'} (${entry.reason})`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['plan', 'scaffold'].includes(args.command)) {
    console.error('Usage: scaffold-tests.mjs <plan|scaffold> [scope] [--json] [--stack node|python|go|rust|php] [--runner name] [--write]');
    process.exit(1);
  }
  printReport(buildReport(args), args.json);
}

main();
