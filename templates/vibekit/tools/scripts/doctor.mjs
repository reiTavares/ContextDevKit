#!/usr/bin/env node
/**
 * VibeDevKit doctor — diagnoses an installed project's setup.
 *
 * Checks node version, config validity + level, that `.claude/settings.json`
 * hook wiring matches the configured level, git-hook presence (L≥3), memory
 * scaffolding, onboarding state, and optional zod. Prints a report and exits
 * non-zero if any CRITICAL (✗) problem is found, with a suggested fix per item.
 *
 * Run:  node vibekit/tools/scripts/doctor.mjs   (or /vibe-doctor)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeSettings } from '../../runtime/config/settings-compose.mjs';
import { getLevel, loadConfigSync } from '../../runtime/config/load.mjs';

const ROOT = process.cwd();
let crit = 0;
let warn = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m, fix) => {
  console.error(`  ✗ ${m}${fix ? `\n      → ${fix}` : ''}`);
  crit++;
};
const note = (m, fix) => {
  console.log(`  ⚠ ${m}${fix ? `\n      → ${fix}` : ''}`);
  warn++;
};

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? pass(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old`, 'install Node >= 18');
}

function checkConfig() {
  if (!existsSync(resolve(ROOT, 'vibekit/config.json'))) {
    fail('vibekit/config.json missing', 're-run the installer');
    return null;
  }
  const raw = readJson('vibekit/config.json');
  if (!raw) {
    fail('vibekit/config.json is not valid JSON', 'fix the JSON or re-run the installer');
    return null;
  }
  const level = getLevel(ROOT);
  level >= 1 && level <= 6 ? pass(`config valid — level L${level}`) : note('config.level out of range', 'use /vibe-level <1-6>');
  return level;
}

function checkWiring(level) {
  const settings = readJson('.claude/settings.json');
  if (!settings) {
    fail('.claude/settings.json missing or invalid', 'run /vibe-level ' + (level ?? 2));
    return;
  }
  const expected = Object.keys(composeSettings(null, level ?? 2).hooks || {}).sort();
  const actual = Object.keys(settings.hooks || {})
    .filter((evt) => (settings.hooks[evt] || []).some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('vibekit/runtime/hooks'))))
    .sort();
  JSON.stringify(expected) === JSON.stringify(actual)
    ? pass(`hook wiring matches L${level}: ${actual.join(', ') || '(none)'}`)
    : fail(`hook wiring (${actual.join(', ') || 'none'}) does not match L${level} (${expected.join(', ')})`, `run /vibe-level ${level} and restart Claude Code`);
}

function checkGitHooks(level) {
  if ((level ?? 0) < 3) return;
  if (!existsSync(resolve(ROOT, '.git'))) {
    note('Level ≥ 3 but no .git directory', 'git init, then re-run the installer to add git hooks');
    return;
  }
  for (const h of ['pre-commit', 'commit-msg']) {
    existsSync(resolve(ROOT, '.git/hooks', h)) ? pass(`git hook ${h} installed`) : note(`git hook ${h} missing`, 're-run the installer');
  }
}

function checkMemory() {
  existsSync(resolve(ROOT, 'vibekit/memory/sessions')) ? pass('memory/sessions present') : note('memory/sessions missing', 're-run the installer');
  existsSync(resolve(ROOT, 'docs/CHANGELOG.md')) ? pass('docs/CHANGELOG.md present') : note('CHANGELOG missing', 're-run the installer');
}

function checkSetup() {
  const completed = loadConfigSync(ROOT)?.setup?.completed === true;
  completed ? pass('onboarding complete') : note('onboarding not run', 'run /setupvibedevkit');
}

function checkZod(level) {
  if ((level ?? 0) < 5) return;
  const hasZod = existsSync(resolve(ROOT, 'node_modules/zod'));
  hasZod ? pass('zod present (strict /vibe-config validation enabled)') : note('zod not installed (optional)', 'add zod for strict config validation, or ignore');
}

console.log('\n🩺 VibeDevKit doctor\n');
checkNode();
const level = checkConfig();
checkWiring(level);
checkGitHooks(level);
checkMemory();
checkSetup();
checkZod(level);
console.log(
  crit === 0
    ? `\n✅ Healthy${warn ? ` (${warn} advisory note${warn > 1 ? 's' : ''})` : ''}.\n`
    : `\n❌ ${crit} critical issue${crit > 1 ? 's' : ''}${warn ? ` + ${warn} note(s)` : ''}.\n`,
);
process.exit(crit === 0 ? 0 : 1);
