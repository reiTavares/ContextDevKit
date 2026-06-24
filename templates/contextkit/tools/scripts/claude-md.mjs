#!/usr/bin/env node
/**
 * Modular host-instruction scaffolder.
 *
 * Claude Code reads scoped CLAUDE.md files; Codex reads scoped AGENTS.md files.
 * This script detects independently buildable module roots and creates the
 * host-correct guide without overwriting existing content.
 *
 * Usage:
 *   node contextkit/tools/scripts/claude-md.mjs find [--json] [--host claude|codex]
 *   node contextkit/tools/scripts/claude-md.mjs scaffold [--host claude|codex]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const TPL = resolve(dirname(fileURLToPath(import.meta.url)), '../../CLAUDE.child.md.tpl');
const hostAt = process.argv.indexOf('--host');
const HOST = hostAt >= 0 ? process.argv[hostAt + 1] : 'claude';
const GUIDE_FILE = HOST === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
const HOST_LABEL = HOST === 'codex' ? 'Codex' : 'Claude Code';

const GROUPS = ['apps', 'packages', 'modules', 'services', 'libs', 'plugins'];
const SPLITS = ['backend', 'frontend', 'client', 'server', 'api', 'web', 'mobile', 'desktop', 'functions', 'worker', 'workers', 'app'];
const MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'tsconfig.json', 'composer.json', 'Gemfile', 'pom.xml'];

function looksBuildable(absDir) {
  if (MANIFESTS.some((manifest) => existsSync(join(absDir, manifest)))) return true;
  return existsSync(join(absDir, 'src'));
}

function dirsIn(absDir) {
  try {
    return readdirSync(absDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

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
      const pkg = JSON.parse(readFileSync(join(absDir, 'package.json'), 'utf-8').replace(/^\uFEFF/, ''));
      const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      const known = ['react', 'next', 'expo', 'react-native', 'vue', 'svelte', 'hono', 'express', 'fastify', '@nestjs/core', 'drizzle-orm', 'prisma', 'vite'];
      const found = known.filter((name) => deps.includes(name));
      return `Node/TypeScript. ${found.length ? `Detected: ${found.join(', ')}.` : '_TODO: fill in._'}`;
    } catch {
      // Continue with the generic fallback below.
    }
  }
  for (const [file, label] of [['pyproject.toml', 'Python'], ['go.mod', 'Go'], ['Cargo.toml', 'Rust']]) {
    if (existsSync(join(absDir, file))) return `${label} (${file}).`;
  }
  return "_TODO: fill in this module's stack._";
}

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in vars ? vars[key] : `{{${key}}}`));
}

function hostTemplate() {
  const source = readFileSync(TPL, 'utf-8');
  if (HOST !== 'codex') return source;
  return source
    .replaceAll('CLAUDE.md', 'AGENTS.md')
    .replaceAll('Claude Code', 'Codex')
    .replace('local context for Claude', 'local context for Codex');
}

const command = process.argv[2];
const status = detectModuleRoots().map((module) => ({
  module,
  guideFile: GUIDE_FILE,
  hasGuide: existsSync(resolve(ROOT, module, GUIDE_FILE)),
}));

if (command === 'find') {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ host: HOST, guideFile: GUIDE_FILE, moduleRoots: status }, null, 2));
  } else if (status.length === 0) {
    console.log(`No app/module roots detected (single-package project - root ${GUIDE_FILE} is enough).`);
  } else {
    console.log('Module roots:');
    for (const item of status) console.log(`  ${item.hasGuide ? 'yes' : 'no'} ${item.module}/${GUIDE_FILE}`);
    const missing = status.filter((item) => !item.hasGuide).length;
    if (missing) console.log(`\n${missing} module(s) missing ${GUIDE_FILE} - run \`claude-md.mjs scaffold --host ${HOST}\`.`);
  }
} else if (command === 'scaffold') {
  if (!existsSync(TPL)) {
    console.error(`Child template not found at ${TPL}.`);
    process.exit(1);
  }
  const template = hostTemplate();
  let created = 0;
  for (const item of status) {
    if (item.hasGuide) continue;
    const abs = resolve(ROOT, item.module);
    const content = render(template, {
      MODULE_NAME: item.module,
      MODULE_PATH: item.module,
      DATE: new Date().toISOString().slice(0, 10),
      MODULE_STACK: moduleStack(abs),
    });
    writeFileSync(resolve(abs, GUIDE_FILE), content, 'utf-8');
    created += 1;
    console.log(`created ${item.module}/${GUIDE_FILE}`);
  }
  console.log(created === 0
    ? `All module roots already have ${GUIDE_FILE}.`
    : `\nScaffolded ${created} scoped ${GUIDE_FILE} for ${HOST_LABEL}. Fill in the TODOs.`);
} else {
  console.error('Usage: claude-md.mjs <find|scaffold> [--json] [--host claude|codex]');
  process.exit(1);
}
