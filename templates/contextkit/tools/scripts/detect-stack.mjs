#!/usr/bin/env node
/**
 * Read-only project analyzer for `/setupcontextdevkit`.
 *
 * Inspects the project root and prints a JSON report: languages, package
 * manager, frameworks, monorepo flag, likely source dirs, README summary, and
 * SUGGESTED `ledger` path lists + `l5.highRiskPaths` tuned to the detected
 * stack. It writes nothing — the slash command decides what to apply.
 *
 * Usage:  node contextkit/tools/scripts/detect-stack.mjs   (prints JSON)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();

const read = (rel) => {
  try {
    return readFileSync(resolve(ROOT, rel), 'utf-8').replace(/^﻿/, '');
  } catch {
    return null;
  }
};
const has = (rel) => existsSync(resolve(ROOT, rel));
const isDir = (rel) => {
  try {
    return statSync(resolve(ROOT, rel)).isDirectory();
  } catch {
    return false;
  }
};

function detectPackageManager() {
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb')) return 'bun';
  if (has('package-lock.json')) return 'npm';
  const pkg = readJson('package.json');
  if (pkg?.packageManager) return String(pkg.packageManager).split('@')[0];
  return has('package.json') ? 'npm' : null;
}

function readJson(rel) {
  const raw = read(rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectLanguages() {
  const langs = new Set();
  if (has('package.json')) langs.add('javascript');
  if (has('tsconfig.json') || has('tsconfig.base.json')) langs.add('typescript');
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) langs.add('python');
  if (has('go.mod')) langs.add('go');
  if (has('Cargo.toml')) langs.add('rust');
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) langs.add('java/kotlin');
  if (has('Gemfile')) langs.add('ruby');
  if (has('composer.json')) langs.add('php');
  return [...langs];
}

function detectFrameworks() {
  const pkg = readJson('package.json');
  const deps = pkg ? Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }) : [];
  const known = ['next', 'react', 'react-native', 'expo', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'astro', 'solid-js', 'angular', 'hono', 'express', 'fastify', '@nestjs/core', 'koa', 'drizzle-orm', 'prisma', '@prisma/client', 'typeorm', 'mongoose', 'vite', 'webpack', 'electron', 'tauri', '@tanstack/start', '@tanstack/react-router', '@tanstack/react-query', '@tanstack/react-table', '@tanstack/react-form', '@tanstack/react-virtual', '@tanstack/solid-query', '@tanstack/vue-query'];
  const found = known.filter((k) => deps.includes(k));
  if (has('manage.py')) found.push('django');
  if (read('requirements.txt')?.match(/flask/i) || read('pyproject.toml')?.match(/flask/i)) found.push('flask');
  if (read('pyproject.toml')?.match(/fastapi/i) || read('requirements.txt')?.match(/fastapi/i)) found.push('fastapi');
  return found;
}

function detectTestRunner() {
  const pkg = readJson('package.json');
  const deps = pkg ? Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }) : [];
  for (const t of ['vitest', 'jest', 'mocha', 'ava', 'playwright', '@playwright/test', 'cypress']) if (deps.includes(t)) return t;
  if (has('pytest.ini') || read('pyproject.toml')?.match(/pytest/i)) return 'pytest';
  return null;
}

const CODE_DIR_CANDIDATES = ['src', 'app', 'apps', 'packages', 'lib', 'components', 'pages', 'server', 'client', 'cmd', 'internal', 'pkg', 'tests', 'test', 'spec', 'api', 'core', 'modules'];

function detectSourceDirs() {
  return CODE_DIR_CANDIDATES.filter((d) => isDir(d)).map((d) => `${d}/`);
}

function detectMonorepo() {
  if (has('pnpm-workspace.yaml') || has('lerna.json') || has('turbo.json') || has('nx.json')) return true;
  const pkg = readJson('package.json');
  return Boolean(pkg?.workspaces);
}

function suggestHighRiskPaths() {
  const out = new Set();
  const candidates = [
    'prisma/schema.prisma', 'db/schema.ts', 'src/db/schema.ts', 'packages/db/src/schema.ts', 'drizzle/', 'migrations/', 'db/migrations/',
    'src/auth/', 'auth/', 'src/middleware/auth.ts', 'src/lib/auth/',
    'openapi.yaml', 'openapi.json', 'schema.graphql', 'src/schema.graphql',
    'packages/shared-types/', 'packages/shared/', 'src/contracts/', 'src/types/',
    'wrangler.toml', 'serverless.yml', 'Dockerfile', '.github/workflows/',
  ];
  for (const c of candidates) if (has(c)) out.add(c.endsWith('/') ? c : c);
  // any *.proto at root-ish
  return [...out];
}

function suggestLedger(sourceDirs, languages) {
  const important = new Set([...sourceDirs, 'contextkit/', '.claude/', '.github/', 'CLAUDE.md']);
  for (const m of ['package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'Gemfile', 'composer.json', 'pnpm-workspace.yaml', 'turbo.json', 'wrangler.toml']) {
    if (has(m)) important.add(m);
  }
  const irrelevant = new Set(['node_modules/', '.git/', '.context-snapshot.md', '.claude/.sessions/', '.claude/.workspace/']);
  for (const d of ['dist/', 'build/', 'out/', '.next/', '.turbo/', '.expo/', '.svelte-kit/', 'coverage/', '__pycache__/', '.pytest_cache/', 'target/', 'vendor/', '.venv/', 'venv/', 'bin/', 'obj/']) {
    if (isDir(d.replace(/\/$/, '')) || ['node_modules/', 'dist/', 'build/'].includes(d)) irrelevant.add(d);
  }
  return { important: [...important], irrelevant: [...irrelevant] };
}

function readmeSummary() {
  for (const name of ['README.md', 'readme.md', 'README.MD', 'Readme.md']) {
    const raw = read(name);
    if (raw) {
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8);
      return lines.join(' ').slice(0, 600);
    }
  }
  return null;
}

function rootEntries() {
  try {
    return readdirSync(ROOT).filter((e) => !e.startsWith('.tmp')).slice(0, 60);
  } catch {
    return [];
  }
}

const sourceDirs = detectSourceDirs();
const languages = detectLanguages();
const report = {
  root: ROOT,
  languages,
  packageManager: detectPackageManager(),
  frameworks: detectFrameworks(),
  testRunner: detectTestRunner(),
  monorepo: detectMonorepo(),
  sourceDirs,
  hasReadme: Boolean(readmeSummary()),
  readmeSummary: readmeSummary(),
  rootEntries: rootEntries(),
  greenfield: sourceDirs.length === 0 && languages.length === 0,
  suggested: {
    ledger: suggestLedger(sourceDirs, languages),
    highRiskPaths: suggestHighRiskPaths(),
    qaCriticalPaths: suggestHighRiskPaths(),
    recommendedLevel: sourceDirs.length === 0 ? 1 : 2,
  },
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
