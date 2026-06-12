#!/usr/bin/env node
/**
 * Shows or changes the ContextDevKit activation level FROM INSIDE a project —
 * no need for the kit repo to be present. Updates `contextkit/config.json`
 * `level` AND recomposes installed host hook wiring.
 *
 * Usage:
 *   node contextkit/tools/scripts/context-level.mjs        # show current level
 *   node contextkit/tools/scripts/context-level.mjs 3      # move to Level 3
 *
 * After changing level, restart Claude Code so it reloads the hooks.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, chmod, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { composeSettings } from '../../runtime/config/settings-compose.mjs';
import { composeAgentHooks } from '../../runtime/config/agent-hooks-compose.mjs';
import { composeCodexHooks } from '../../runtime/config/codex-hooks-compose.mjs';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { LEVEL_LABELS as LABELS, MAX_LEVEL, MIN_LEVEL, isValidLevel } from '../../runtime/config/levels.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const PATHS = pathsFor(ROOT);
const CONFIG = PATHS.config;
const SETTINGS = resolve(ROOT, '.claude/settings.json');
const AGY_HOOKS = resolve(PATHS.antigravity, 'hooks.json');
const CODEX_HOOKS = resolve(PATHS.codex, 'hooks.json');

async function installGitHooks() {
  const hooksDir = resolve(ROOT, '.git/hooks');
  if (!existsSync(resolve(ROOT, '.git'))) return false;
  await mkdir(hooksDir, { recursive: true });
  const wrappers = {
    'pre-commit': '#!/bin/sh\nnode contextkit/runtime/git-hooks/pre-commit.mjs\n',
    'commit-msg': '#!/bin/sh\nnode contextkit/runtime/git-hooks/commit-msg.mjs "$1"\n',
    'pre-push': '#!/bin/sh\nnode contextkit/runtime/git-hooks/pre-push.mjs\n',
  };
  for (const [name, body] of Object.entries(wrappers)) {
    const p = resolve(hooksDir, name);
    // Back up a pre-existing non-ours hook (husky/lint-staged) before replacing it.
    if (existsSync(p) && !(await readFile(p, 'utf-8').catch(() => '')).includes('contextkit/runtime/git-hooks')) {
      const backup = `${p}.bak`;
      if (!existsSync(backup)) await rename(p, backup);
    }
    await writeFile(p, body, 'utf-8');
    await chmod(p, 0o755).catch(() => {});
  }
  return true;
}

async function main() {
  const current = loadConfigSync(ROOT).level;
  const arg = process.argv[2];

  if (!arg) {
    console.log(`Current ContextDevKit level: L${current}\n`);
    for (const [k, v] of Object.entries(LABELS)) console.log(`${Number(k) <= current ? '✓' : ' '} ${v}`);
    console.log(`\nChange with:  node contextkit/tools/scripts/context-level.mjs <${MIN_LEVEL}-${MAX_LEVEL}>`);
    return;
  }

  const level = Number(arg);
  if (!isValidLevel(level)) {
    console.error(`Level must be an integer ${MIN_LEVEL}–${MAX_LEVEL}.`);
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

  // 2b. agy hooks.json — only when the Antigravity host is installed [ADR-0049].
  if (existsSync(PATHS.antigravity)) {
    let agyExisting = null;
    try {
      agyExisting = JSON.parse((await readFile(AGY_HOOKS, 'utf-8')).replace(/^﻿/, ''));
    } catch {
      /* fresh */
    }
    await writeFile(AGY_HOOKS, JSON.stringify(composeAgentHooks(agyExisting, level), null, 2) + '\n', 'utf-8');
  }

  // 2c. Codex hooks.json — only when the Codex host is installed.
  if (existsSync(PATHS.codex)) {
    let codexExisting = null;
    try {
      codexExisting = JSON.parse((await readFile(CODEX_HOOKS, 'utf-8')).replace(/^\uFEFF/, ''));
    } catch {
      /* fresh */
    }
    await mkdir(dirname(CODEX_HOOKS), { recursive: true });
    await writeFile(CODEX_HOOKS, JSON.stringify(composeCodexHooks(codexExisting, level), null, 2) + '\n', 'utf-8');
  }

  // 3. git hooks at L >= 3
  if (level >= 3) await installGitHooks();

  console.log(`✅ ContextDevKit moved from L${current} → L${level}.`);
  if (level >= 4 && !existsSync(resolve(ROOT, '.claude/agents'))) {
    console.log('ℹ️  Level 4 uses sub-agents. Copy them with the kit installer or add your own to .claude/agents/.');
  }
  console.log('↻  Restart your host (Claude Code, Antigravity, or Codex) to load the new hook wiring.');
}

main().catch((err) => {
  console.error('❌ context-level failed:', err);
  process.exit(1);
});
