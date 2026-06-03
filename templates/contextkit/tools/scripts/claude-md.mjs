#!/usr/bin/env node
/**
 * Modular CLAUDE.md scaffolder.
 *
 * Like the source platform (root CLAUDE.md + apps/api/CLAUDE.md +
 * apps/mobile/CLAUDE.md), each app / independent module should carry its OWN
 * scoped CLAUDE.md so Claude Code loads the closest, most relevant rules. This
 * detects module roots and ensures each has one.
 *
 * A "module root" is a directory that looks independently buildable: under a
 * monorepo group (apps/ packages/ modules/ services/ libs/ apps-*), OR a
 * conventional split dir (backend/ frontend/ client/ server/ api/ web/ mobile/
 * desktop/ functions/ worker/), AND it contains a manifest or a src/.
 *
 * Usage:
 *   node contextkit/tools/scripts/claude-md.mjs find [--json]
 *   node contextkit/tools/scripts/claude-md.mjs scaffold   # create missing (stub) CLAUDE.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
// Installed at <project>/contextkit/tools/scripts/ → the seeded template is at <project>/contextkit/.
const TPL = resolve(dirname(fileURLToPath(import.meta.url)), '../../CLAUDE.child.md.tpl');

const GROUPS = ['apps', 'packages', 'modules', 'services', 'libs', 'plugins'];
const SPLITS = ['backend', 'frontend', 'client', 'server', 'api', 'web', 'mobile', 'desktop', 'functions', 'worker', 'workers', 'app'];
const MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'tsconfig.json', 'composer.json', 'Gemfile', 'pom.xml'];

function looksBuildable(absDir) {
  if (MANIFESTS.some((m) => existsSync(join(absDir, m)))) return true;
  return existsSync(join(absDir, 'src'));
}

function dirsIn(absDir) {
  try {
    return readdirSync(absDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Detect module roots (depth 1 splits + depth 2 monorepo group children). */
function detectModuleRoots() {
  const roots = new Set();
  for (const name of SPLITS) {
    const abs = resolve(ROOT, name);
    if (existsSync(abs) && looksBuildable(abs)) roots.add(name);
  }
  for (const group of GROUPS) {
    const groupAbs = resolve(ROOT, group);
    if (!existsSync(groupAbs)) continue;
    for (const child of dirsIn(groupAbs)) {
      const abs = join(groupAbs, child);
      if (looksBuildable(abs)) roots.add(`${group}/${child}`);
    }
  }
  return [...roots].sort();
}

function moduleStack(absDir) {
  if (existsSync(join(absDir, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(absDir, 'package.json'), 'utf-8').replace(/^﻿/, ''));
      const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      const known = ['react', 'next', 'expo', 'react-native', 'vue', 'svelte', 'hono', 'express', 'fastify', '@nestjs/core', 'drizzle-orm', 'prisma', 'vite'];
      const found = known.filter((k) => deps.includes(k));
      return `Node/TypeScript. ${found.length ? 'Detected: ' + found.join(', ') + '.' : '_TODO: fill in._'}`;
    } catch {
      /* ignore */
    }
  }
  for (const [f, label] of [['pyproject.toml', 'Python'], ['go.mod', 'Go'], ['Cargo.toml', 'Rust']]) {
    if (existsSync(join(absDir, f))) return `${label} (${f}).`;
  }
  return '_TODO: fill in this module\'s stack._';
}

function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}

const cmd = process.argv[2];
const roots = detectModuleRoots();
const status = roots.map((r) => ({ module: r, hasClaudeMd: existsSync(resolve(ROOT, r, 'CLAUDE.md')) }));

if (cmd === 'find') {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ moduleRoots: status }, null, 2));
  } else if (status.length === 0) {
    console.log('No app/module roots detected (single-package project — root CLAUDE.md is enough).');
  } else {
    console.log('Module roots:');
    for (const s of status) console.log(`  ${s.hasClaudeMd ? '✓' : '✗'} ${s.module}/CLAUDE.md`);
    const missing = status.filter((s) => !s.hasClaudeMd).length;
    if (missing) console.log(`\n${missing} module(s) missing CLAUDE.md — run \`claude-md.mjs scaffold\` (or /claude-md).`);
  }
} else if (cmd === 'scaffold') {
  if (!existsSync(TPL)) {
    console.error(`Child template not found at ${TPL}.`);
    process.exit(1);
  }
  const tpl = readFileSync(TPL, 'utf-8');
  let created = 0;
  for (const s of status) {
    if (s.hasClaudeMd) continue;
    const abs = resolve(ROOT, s.module);
    const content = render(tpl, {
      MODULE_NAME: s.module,
      MODULE_PATH: s.module,
      DATE: new Date().toISOString().slice(0, 10),
      MODULE_STACK: moduleStack(abs),
    });
    writeFileSync(resolve(abs, 'CLAUDE.md'), content, 'utf-8');
    created++;
    console.log(`✓ created ${s.module}/CLAUDE.md`);
  }
  console.log(created === 0 ? 'All module roots already have a CLAUDE.md.' : `\n✅ Scaffolded ${created} scoped CLAUDE.md. Fill in the TODOs (or let /claude-md do it).`);
} else {
  console.error('Usage: claude-md.mjs <find|scaffold> [--json]');
  process.exit(1);
}
