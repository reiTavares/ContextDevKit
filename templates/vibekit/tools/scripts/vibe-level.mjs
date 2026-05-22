#!/usr/bin/env node
/**
 * Shows or changes the VibeDevKit activation level FROM INSIDE a project —
 * no need for the kit repo to be present. Updates `vibekit/config.json`
 * `level` AND recomposes `.claude/settings.json` hook wiring.
 *
 * Usage:
 *   node vibekit/tools/scripts/vibe-level.mjs        # show current level
 *   node vibekit/tools/scripts/vibe-level.mjs 3      # move to Level 3
 *
 * After changing level, restart Claude Code so it reloads the hooks.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { composeSettings } from '../../runtime/config/settings-compose.mjs';
import { loadConfigSync } from '../../runtime/config/load.mjs';

const ROOT = process.cwd();
const CONFIG = resolve(ROOT, 'vibekit/config.json');
const SETTINGS = resolve(ROOT, '.claude/settings.json');

const LABELS = {
  1: 'L1 Memory — boot context, session log, ADRs, changelog',
  2: 'L2 Ledger — + drift detection (PostToolUse + Stop nudge)',
  3: 'L3 Multi — + claims, worktrees, derived indices, git hooks',
  4: 'L4 Squads — + specialized sub-agents (.claude/agents)',
  5: 'L5 Proactive — + simulate-impact gate, tech-debt sweep, contract drift',
  6: 'L6 Autonomy & Insight — + /ship pipeline, /retro learning loop, metrics',
};

async function installGitHooks() {
  const hooksDir = resolve(ROOT, '.git/hooks');
  if (!existsSync(resolve(ROOT, '.git'))) return false;
  await mkdir(hooksDir, { recursive: true });
  const wrappers = {
    'pre-commit': '#!/bin/sh\nnode vibekit/runtime/git-hooks/pre-commit.mjs\n',
    'commit-msg': '#!/bin/sh\nnode vibekit/runtime/git-hooks/commit-msg.mjs "$1"\n',
  };
  for (const [name, body] of Object.entries(wrappers)) {
    const p = resolve(hooksDir, name);
    await writeFile(p, body, 'utf-8');
    await chmod(p, 0o755).catch(() => {});
  }
  return true;
}

async function main() {
  const current = loadConfigSync(ROOT).level;
  const arg = process.argv[2];

  if (!arg) {
    console.log(`Current VibeDevKit level: L${current}\n`);
    for (const [k, v] of Object.entries(LABELS)) console.log(`${Number(k) <= current ? '✓' : ' '} ${v}`);
    console.log('\nChange with:  node vibekit/tools/scripts/vibe-level.mjs <1-5>');
    return;
  }

  const level = Number(arg);
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    console.error('Level must be an integer 1–6.');
    process.exit(1);
  }

  // 1. config.json level
  let cfg = {};
  try {
    cfg = JSON.parse((await readFile(CONFIG, 'utf-8')).replace(/^﻿/, ''));
  } catch {
    /* will create */
  }
  cfg.level = level;
  await mkdir(dirname(CONFIG), { recursive: true });
  await writeFile(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');

  // 2. settings.json hooks
  let existing = null;
  try {
    existing = JSON.parse((await readFile(SETTINGS, 'utf-8')).replace(/^﻿/, ''));
  } catch {
    /* fresh */
  }
  await mkdir(dirname(SETTINGS), { recursive: true });
  await writeFile(SETTINGS, JSON.stringify(composeSettings(existing, level), null, 2) + '\n', 'utf-8');

  // 3. git hooks at L >= 3
  if (level >= 3) await installGitHooks();

  console.log(`✅ VibeDevKit moved from L${current} → L${level}.`);
  if (level >= 4 && !existsSync(resolve(ROOT, '.claude/agents'))) {
    console.log('ℹ️  Level 4 uses sub-agents. Copy them with the kit installer or add your own to .claude/agents/.');
  }
  console.log('↻  Restart Claude Code to load the new hook wiring.');
}

main().catch((err) => {
  console.error('❌ vibe-level failed:', err);
  process.exit(1);
});
