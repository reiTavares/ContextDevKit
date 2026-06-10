#!/usr/bin/env node
/**
 * ContextDevKit installer — entry point + orchestration.
 *
 * Bootstraps the AI-assisted development platform into ANY project (greenfield
 * or existing, any stack). Idempotent: re-run it to change level or pull engine
 * updates. It never clobbers your own content (CLAUDE.md, memory, config
 * overrides); it only overwrites the kit's own engine code and slash commands.
 *
 * This file is a THIN ORCHESTRATOR [ADR-0037]: it resolves the install context
 * (level / name / mode / --update), then calls the focused installers under
 * `tools/install/` — wireClaudeSettings + installClaudeHost (claude.mjs),
 * installEngine (engine.mjs), installAntigravityHost (antigravity.mjs), and
 * installVcsIntegration (git.mjs). It detects --update and owns the summary; the
 * per-file update guards live next to the writes they protect. Adding a third host
 * is a new module + one call here, not more interleaving.
 * Run `node install.mjs --help` for usage and the full flag list.
 */
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { ensureDir, read } from './tools/install/fs.mjs';
import { requireBasename, looksGreenfield } from './tools/install/project.mjs';
import { installVcsIntegration } from './tools/install/git.mjs';
import { installEngine } from './tools/install/engine.mjs';
import { wireClaudeSettings, installClaudeHost } from './tools/install/claude.mjs';
import { installAntigravityHost } from './tools/install/antigravity.mjs';
import { uninstall } from './tools/install/uninstall.mjs';
import { migrateLegacy } from './tools/install/migrate.mjs';
import { isValidLevel } from './templates/contextkit/runtime/config/levels.mjs';
import { parseArgs, HELP, prompt, LEVEL_LABELS } from './tools/install/cli.mjs';

const KIT_ROOT = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(KIT_ROOT, 'templates');

async function kitVersion() {
  try {
    return JSON.parse(await read(join(KIT_ROOT, 'package.json'))).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(`contextdevkit ${await kitVersion()}`);
    return;
  }

  const target = resolve(args.target || process.cwd());
  await ensureDir(target);

  if (args.uninstall) {
    await uninstall(target, args.purge);
    return;
  }

  // Standalone migration: carry a legacy vibekit/ install forward, then stop.
  if (args.migrate) {
    const { report } = await migrateLegacy(target, { dryRun: args.dryRun });
    console.log(report.length ? '\n' + report.join('\n') + '\n' : '\nℹ️  no legacy vibekit/ install found — nothing to migrate.\n');
    return;
  }

  // Auto-migration: before ANYTHING reads contextkit/ (config, settings), carry a
  // legacy vibekit/ install forward so `npx contextdevkit --update` just works.
  const migration = await migrateLegacy(target, { dryRun: false });
  if (migration.report.length) console.log('\n' + migration.report.join('\n') + '\n');

  const interactive = !args.yes && process.stdout.isTTY;
  let level = Number.isInteger(args.level) ? args.level : undefined;
  let name = args.name;
  let mode = args.mode;

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n🌀 ContextDevKit installer\n');
    console.log(`Target: ${target}\n`);
    if (!name) name = await prompt(rl, 'Project name', requireBasename(target));
    if (!mode) {
      const auto = looksGreenfield(target) ? 'greenfield' : 'existing';
      mode = await prompt(rl, 'Mode (greenfield/existing)', auto);
    }
    if (!level) {
      console.log('\nLevels:');
      for (const [k, v] of Object.entries(LEVEL_LABELS)) console.log(`  ${k}. ${v}`);
      level = Number(await prompt(rl, '\nStart at level', String(mode === 'greenfield' ? 3 : 7)));
    }
    rl.close();
  }

  // Recommended starting level by project type: L3 for greenfield, L7 for a project
  // that already has code (full toolkit; gates stay inert until configured). [ADR-0009]
  const effMode = mode === 'greenfield' || mode === 'existing' ? mode : looksGreenfield(target) ? 'greenfield' : 'existing';
  const recommended = effMode === 'greenfield' ? 3 : 7;

  // Safe re-run / update: if no explicit --level, preserve the project's current
  // level (read from config) instead of silently downgrading to the default.
  if (!isValidLevel(level)) {
    try {
      const existingCfg = JSON.parse(await read(join(target, 'contextkit', 'config.json')));
      if (Number.isInteger(existingCfg.level)) level = existingCfg.level;
    } catch {
      /* no config yet */
    }
  }
  level = isValidLevel(level) ? level : recommended;
  name = name || requireBasename(target);
  mode = effMode;

  const report = [];
  const version = await kitVersion();
  const ctx = { name, level, mode, version, args };

  // 1. Claude Code settings.json (the hook wiring). `--rewire` stops right after this.
  await wireClaudeSettings(target, level, report);
  if (args.rewire) {
    console.log(report.join('\n'));
    console.log(`\n✅ Rewired to Level ${level}. Restart Claude Code to load the new hooks.`);
    return;
  }

  // 2. Host-neutral engine + substrate (runtime, tools, seeds, config, changelog, docs).
  await installEngine(target, TPL, ctx, report);

  // 3. Antigravity host — second native host [ADR-0036].
  await installAntigravityHost(target, TPL, ctx, report);

  // 4. Claude Code host front-end (slash commands, agents/squads, CLAUDE.md).
  await installClaudeHost(target, TPL, ctx, report);

  // 5. VCS integration (.gitignore/.gitattributes, GitHub templates, git hooks, remote hint).
  await installVcsIntegration(target, TPL, level, report);

  // ── summary ──
  console.log('\n' + report.join('\n'));
  if (args.update) {
    console.log(`\n✅ ContextDevKit UPDATED to v${version} (Level ${level} preserved) in ${target}`);
    console.log('   Refreshed: engine + slash commands + hook wiring. Untouched: CLAUDE.md, config,');
    console.log('   memory (ADRs/sessions/roadmap), pipeline tasks, scoped module CLAUDE.md files.');
    console.log('   Restart Claude Code to load the refreshed hooks.');
    console.log('');
    return;
  }
  console.log(`\n✅ ContextDevKit installed at Level ${level} into ${target}`);
  console.log('\nNext steps:');
  console.log('  1. Open the project in Claude Code (it reads .claude/ + CLAUDE.md).');
  console.log('  2. Approve the hooks on first run (one-time per hook).');
  console.log('  3. ⭐ Run  /setupcontextdevkit  — it fits the kit to THIS project');
  console.log('     (detects stack, tunes config, fills CLAUDE.md, flags risks).');
  console.log('     The first-run trigger will remind you automatically.');
  console.log('  4. Then work normally. /log-session at the end.');
  if (level < 5) console.log(`  5. Level up later:  /context-level ${Math.min(level + 1, 5)}`);
  console.log('\n  Using Antigravity instead? Read INSTRUCTIONS.md, then run `node ctx.mjs`');
  console.log('  to list commands — or `node ctx.mjs session start` to begin a session.');
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ ContextDevKit install failed:', err?.stack || err);
  process.exit(1);
});
