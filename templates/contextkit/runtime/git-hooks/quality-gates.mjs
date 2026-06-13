#!/usr/bin/env node
/**
 * quality-gates.mjs (Level >= minLevel) — multi-language pre-push quality gate.
 *
 * Detects the project stack (10 languages + generic) and runs the appropriate
 * lint / format / typecheck / build / test, scoped to the monorepo packages the
 * push actually touches. A zero-dependency port of nolrm/contextkit's bash
 * `pre-push` (ADR-0062): `node:*` + `node:child_process` only, no bash-isms.
 *
 * Called BY the pre-push wrapper AFTER its conflict pre-check, and is also
 * standalone-runnable (reads the git pre-push stdin: `local-ref local-sha
 * remote-ref remote-sha`, exits 0/1).
 *
 * Warn-first contract (reconciles "on-by-level" with rule 2 "hooks never break
 * work"): below `minLevel` or `enabled:false` → silent exit 0. At
 * `minLevel <= level < strictLevel` → run gates, print failures, but EXIT 0
 * (warn). At `level >= strictLevel` → a failing gate EXITS 1 (block). A missing
 * tool is reported SKIPPED, never counted as a failure (rule 8: never a
 * false-negative). A gate key in `disabled[]` is skipped silently.
 *
 * COHESION NOTE: this slightly exceeds the soft line budget because the 10-stack
 * gate matrix is one indivisible detection→dispatch unit — splitting per-stack
 * runners into siblings would scatter a single cohesive table and add import
 * noise for no second consumer. The stack runners share `runGate`/`skipGate`
 * closures bound to one accumulator, so they cannot be hoisted independently.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigSync } from '../config/load.mjs';

const ROOT = process.cwd();

/** Read a file as UTF-8, BOM-stripped; '' on any error (defensive I/O). */
const readText = (rel) => {
  try {
    return readFileSync(join(ROOT, rel), 'utf-8').replace(/^﻿/, '');
  } catch {
    return '';
  }
};
const hasFile = (rel) => existsSync(join(ROOT, rel));

/** A tool is "present" when it resolves on PATH (cross-platform `--version` probe). */
const hasCmd = (cmd) => {
  try {
    const probe = spawnSync(cmd, ['--version'], { cwd: ROOT, stdio: 'ignore', timeout: 10_000, shell: process.platform === 'win32' });
    return probe.status === 0 || probe.status === 1; // some tools exit 1 on --version but exist
  } catch {
    return false;
  }
};

/** True when any file matching `re` exists within `dir` up to `depth` levels. */
const findFile = (re, dir = '.', depth = 2) => {
  try {
    for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'vendor') continue;
      const rel = dir === '.' ? ent.name : `${dir}/${ent.name}`;
      if (ent.isFile() && re.test(ent.name)) return true;
      if (ent.isDirectory() && depth > 1 && findFile(re, rel, depth - 1)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
};

/** Mirror the bash detect_project_type order exactly. */
function detectProjectType() {
  if (hasFile('package.json')) return 'node';
  if (hasFile('pyproject.toml') || hasFile('requirements.txt') || hasFile('setup.py')) return 'python';
  if (hasFile('Cargo.toml')) return 'rust';
  if (hasFile('go.mod')) return 'go';
  if (hasFile('composer.json')) return 'php';
  if (hasFile('Gemfile')) return 'ruby';
  const gradle = readText('build.gradle') + readText('build.gradle.kts');
  if ((hasFile('build.gradle') || hasFile('build.gradle.kts')) && /kotlin|org\.jetbrains\.kotlin/.test(gradle)) return 'kotlin';
  if (hasFile('Package.swift') || findFile(/\.xcodeproj$/, '.', 1)) return 'swift';
  if (hasFile('pom.xml') || hasFile('build.gradle') || hasFile('build.gradle.kts')) return 'java';
  if (findFile(/\.(sln|csproj)$/, '.', 2)) return 'dotnet';
  return 'generic';
}

/** Detect the Node package manager from the committed lockfile. */
const detectPm = () => (hasFile('pnpm-lock.yaml') ? 'pnpm' : hasFile('yarn.lock') ? 'yarn' : hasFile('bun.lockb') || hasFile('bun.lock') ? 'bun' : 'npm');

// ── Gate accumulator + runners ───────────────────────────────────────────────

/** A failed gate pushes its label; a missing tool pushes a skip line. */
function makeAccumulator(disabled) {
  const state = { passed: 0, skipped: 0, failures: [] };
  const isDisabled = (key) => disabled.includes(key);
  const skip = (label, reason) => {
    state.skipped += 1;
    console.error(`  [skip] ${label} — ${reason}`);
  };
  /** Run a tool; a non-zero exit records a failure but never throws (rule 2). */
  const run = (label, cmd, args, opts = {}) => {
    console.error(`  [gate] ${label}`);
    try {
      execFileSync(cmd, args, { cwd: opts.cwd || ROOT, stdio: 'inherit', timeout: 600_000, shell: process.platform === 'win32' });
      state.passed += 1;
    } catch {
      state.failures.push(label);
    }
  };
  return { state, isDisabled, skip, run };
}

/** Node gates for one package dir (mirror run_node_gates_core). `acc` is shared. */
function runNodeGatesCore(acc, dir = ROOT) {
  const pkg = (() => {
    try {
      return readFileSync(join(dir, 'package.json'), 'utf-8').replace(/^﻿/, '');
    } catch {
      return '';
    }
  })();
  const hasScript = (name) => new RegExp(`"${name}"\\s*:`).test(pkg);
  const hasDep = (name) => new RegExp(`"${name}"\\s*:`).test(pkg);
  const pm = detectPm();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  if (!acc.isDisabled('typescript') && hasDep('typescript')) {
    hasCmd('npx') ? acc.run('TypeScript type check', npx, ['tsc', '--noEmit'], { cwd: dir }) : acc.skip('TypeScript type check', 'npx not found');
  }
  if (!acc.isDisabled('eslint') && hasDep('eslint') && !hasScript('lint')) {
    hasCmd('npx') ? acc.run('ESLint', npx, ['eslint', '.'], { cwd: dir }) : acc.skip('ESLint', 'npx not found');
  }
  if (!acc.isDisabled('format') && hasScript('format')) acc.run('Format', pm, ['run', 'format'], { cwd: dir });
  if (!acc.isDisabled('lint') && hasScript('lint')) acc.run('Lint', pm, ['run', 'lint'], { cwd: dir });
  if (!acc.isDisabled('build') && hasScript('build')) acc.run('Build', pm, ['run', 'build'], { cwd: dir });
  if (!acc.isDisabled('test') && hasScript('test')) acc.run('Tests', pm, pm === 'npm' ? ['test'] : ['test'], { cwd: dir });
  if (!acc.isDisabled('e2e') && hasScript('e2e')) acc.run('E2E tests', pm, ['run', 'e2e'], { cwd: dir });
}

/** Read workspace package globs from pnpm-workspace.yaml or package.json. */
function workspaceDirs() {
  const dirs = new Set();
  const expand = (pattern) => {
    const base = pattern.replace(/\/\*+$/, '');
    if (existsSync(join(ROOT, pattern)) && !pattern.includes('*')) {
      dirs.add(pattern);
      return;
    }
    try {
      for (const ent of readdirSync(join(ROOT, base), { withFileTypes: true })) {
        if (ent.isDirectory()) dirs.add(`${base}/${ent.name}`.replace(/^\.\//, ''));
      }
    } catch {
      /* ignore */
    }
  };
  if (hasFile('pnpm-workspace.yaml')) {
    for (const line of readText('pnpm-workspace.yaml').split('\n')) {
      const m = line.match(/^\s*-\s+['"]?([^'"#\s]+)/);
      if (m) expand(m[1]);
    }
  } else {
    try {
      const pkg = JSON.parse(readText('package.json') || '{}');
      const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || [];
      for (const pattern of ws) expand(pattern);
    } catch {
      /* ignore */
    }
  }
  return [...dirs].filter((d) => existsSync(join(ROOT, d)));
}

/** git diff --name-only across the push range (mirror get_push_changed_files). */
function pushChangedFiles(localSha, remoteSha) {
  const ZERO = '0'.repeat(40);
  if (!localSha || localSha === ZERO) return [];
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim();
    } catch {
      return '';
    }
  };
  let range;
  if (!remoteSha || remoteSha === ZERO) {
    const base =
      git(['merge-base', localSha, 'origin/HEAD']) || git(['merge-base', localSha, 'origin/main']) || git(['merge-base', localSha, 'origin/master']) || git(['rev-list', '--max-parents=0', localSha]).split('\n')[0];
    if (!base) return [];
    range = [base, localSha];
  } else {
    range = [remoteSha, localSha];
  }
  const out = git(['diff', '--name-only', ...range]);
  return out ? out.split('\n').filter(Boolean) : [];
}

/** Node dispatch with monorepo scoping (mirror run_node_gates). */
function runNodeGates(acc, sha) {
  const dirs = workspaceDirs();
  if (dirs.length && sha.local) {
    const changed = pushChangedFiles(sha.local, sha.remote);
    const affected = dirs.filter((d) => changed.some((f) => f.startsWith(`${d}/`)));
    const allInside = changed.length > 0 && changed.every((f) => dirs.some((d) => f.startsWith(`${d}/`)));
    if (affected.length && allInside) {
      console.error(`  Monorepo: scoping gates to affected packages: ${affected.join(' ')}`);
      for (const dir of affected) {
        if (existsSync(join(ROOT, dir, 'package.json'))) {
          console.error(`\n  → Package: ${dir}`);
          runNodeGatesCore(acc, join(ROOT, dir));
        }
      }
      return;
    }
  }
  runNodeGatesCore(acc, ROOT);
}

/** The remaining single-language runners (no monorepo scoping). */
function runOtherGates(type, acc) {
  const g = acc;
  const table = {
    python() {
      if (!g.isDisabled('lint')) hasCmd('ruff') ? g.run('Ruff lint', 'ruff', ['check', '.']) : hasCmd('flake8') ? g.run('Flake8 lint', 'flake8', ['.']) : g.skip('Linting', 'ruff/flake8 not found');
      if (!g.isDisabled('typecheck')) hasCmd('mypy') ? g.run('Mypy type check', 'mypy', ['.']) : g.skip('Type check', 'mypy not found');
      if (!g.isDisabled('format')) hasCmd('ruff') ? g.run('Ruff format check', 'ruff', ['format', '--check', '.']) : hasCmd('black') ? g.run('Black format check', 'black', ['--check', '.']) : g.skip('Format check', 'ruff/black not found');
      if (!g.isDisabled('test')) hasCmd('pytest') ? g.run('Pytest', 'pytest', []) : g.skip('Tests', 'pytest not found');
    },
    rust() {
      if (!hasCmd('cargo')) return g.skip('Rust checks', 'cargo not found');
      if (!g.isDisabled('cargo-check')) g.run('Cargo check', 'cargo', ['check']);
      if (!g.isDisabled('clippy')) hasCmd('cargo-clippy') ? g.run('Cargo clippy', 'cargo', ['clippy', '--', '-D', 'warnings']) : g.skip('Cargo clippy', 'clippy not installed');
      if (!g.isDisabled('cargo-test')) g.run('Cargo test', 'cargo', ['test']);
    },
    go() {
      if (!hasCmd('go')) return g.skip('Go checks', 'go not found');
      if (!findFile(/\.go$/, '.', 3)) return (g.skip('Go vet', 'no .go source files found'), g.skip('Go test', 'no .go source files found'));
      if (!g.isDisabled('go-vet')) g.run('Go vet', 'go', ['vet', './...']);
      if (!g.isDisabled('golangci-lint')) hasCmd('golangci-lint') ? g.run('golangci-lint', 'golangci-lint', ['run']) : g.skip('golangci-lint', 'not installed');
      if (!g.isDisabled('go-test')) g.run('Go test', 'go', ['test', './...']);
    },
    php() {
      if (!g.isDisabled('phpstan')) hasCmd('phpstan') ? g.run('PHPStan', 'phpstan', ['analyse']) : hasFile('vendor/bin/phpstan') ? g.run('PHPStan', join(ROOT, 'vendor/bin/phpstan'), ['analyse']) : g.skip('Static analysis', 'phpstan not found');
      if (!g.isDisabled('phpunit')) hasCmd('phpunit') ? g.run('PHPUnit', 'phpunit', []) : hasFile('vendor/bin/phpunit') ? g.run('PHPUnit', join(ROOT, 'vendor/bin/phpunit'), []) : g.skip('Tests', 'phpunit not found');
    },
    ruby() {
      if (!g.isDisabled('rubocop')) hasCmd('rubocop') ? g.run('RuboCop', 'rubocop', []) : g.skip('Linting', 'rubocop not found');
      if (!g.isDisabled('rspec')) hasCmd('rspec') ? g.run('RSpec', 'rspec', []) : g.skip('Tests', 'rspec not found');
    },
    java() {
      const hasSrc = findFile(/\.(java|kt)$/, '.', 3);
      if (hasFile('pom.xml')) {
        if (g.isDisabled('maven-verify')) return;
        return !hasCmd('mvn') ? g.skip('Maven verify', 'mvn not found') : !hasSrc ? g.skip('Maven verify', 'no source files found') : g.run('Maven verify', 'mvn', ['verify']);
      }
      const gradle = hasFile('gradlew') ? join(ROOT, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew') : hasCmd('gradle') ? 'gradle' : null;
      if (!g.isDisabled('gradle-check')) gradle ? g.run('Gradle check', gradle, ['check']) : g.skip('Gradle check', 'gradle/gradlew not found');
    },
    kotlin() {
      if (!g.isDisabled('ktlint')) hasCmd('ktlint') ? g.run('ktlint', 'ktlint', []) : g.skip('ktlint', 'ktlint not installed');
      const gradle = hasFile('gradlew') ? join(ROOT, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew') : hasCmd('gradle') ? 'gradle' : null;
      if (!g.isDisabled('kotlin-test')) gradle ? g.run('Kotlin test', gradle, ['test']) : g.skip('Kotlin test', 'gradle/gradlew not found');
    },
    swift() {
      if (!g.isDisabled('swiftlint')) hasCmd('swiftlint') ? g.run('SwiftLint', 'swiftlint', ['lint']) : g.skip('SwiftLint', 'swiftlint not installed');
      if (!g.isDisabled('swift-test')) hasCmd('swift') ? g.run('Swift test', 'swift', ['test']) : g.skip('Swift test', 'swift not found');
    },
    dotnet() {
      if (!hasCmd('dotnet')) return (g.skip('dotnet build', 'dotnet not found'), g.skip('dotnet test', 'dotnet not found'));
      if (!g.isDisabled('dotnet-build')) g.run('dotnet build', 'dotnet', ['build']);
      if (!g.isDisabled('dotnet-test')) g.run('dotnet test', 'dotnet', ['test']);
    },
  };
  (table[type] || (() => {}))();
}

/** Read the push range from git's pre-push stdin (best effort). */
function readPushRange() {
  let local = '';
  let remote = '';
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    if (raw) {
      const parts = raw.split('\n')[0].split(/\s+/);
      [, local, , remote] = parts;
    }
  } catch {
    /* no stdin — standalone run */
  }
  return { local: local || '', remote: remote || '' };
}

function main() {
  const cfg = loadConfigSync(ROOT);
  const level = Number(cfg.level) || 1;
  const gate = cfg.qualityGate || {};
  if (gate.enabled === false) process.exit(0);
  const minLevel = Number.isFinite(gate.minLevel) ? gate.minLevel : 3;
  const strictLevel = Number.isFinite(gate.strictLevel) ? gate.strictLevel : 4;
  if (level < minLevel) process.exit(0); // below entry → silent

  const sha = readPushRange();
  const type = detectProjectType();
  console.error('');
  console.error(`Quality Gates (${type}) — ${level >= strictLevel ? 'block' : 'warn'} mode`);

  if (type === 'generic') {
    console.error('  No framework detected — no automatic checks to run.');
    process.exit(0);
  }

  const acc = makeAccumulator(Array.isArray(gate.disabled) ? gate.disabled : []);
  if (type === 'node') runNodeGates(acc, sha);
  else runOtherGates(type, acc);

  const { passed, skipped, failures } = acc.state;
  console.error(`  ${passed} passed, ${skipped} skipped, ${failures.length} failed`);
  if (failures.length === 0) process.exit(0);

  console.error('');
  for (const f of failures) console.error(`  ✗ ${f}`);
  if (level >= strictLevel) {
    console.error('\n  ❌ Quality Gates FAILED — push blocked.');
    console.error('     Bypass (audited): CONTEXT_SKIP_QGATES=1 git push ...');
    process.exit(1);
  }
  console.error('\n  ⚠️  Quality Gates failed (warn mode — push allowed). Fix before raising the level.');
  process.exit(0);
}

if (process.env.CONTEXT_SKIP_QGATES === '1') process.exit(0);
try {
  main();
} catch (err) {
  process.stderr.write(`[quality-gates] ${err?.message ?? err}\n`);
  process.exit(0); // rule 2: never break a real push on our own bug
}
