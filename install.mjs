#!/usr/bin/env node
/**
 * VibeDevKit installer — entry point + orchestration.
 *
 * Bootstraps the AI-assisted development platform into ANY project (greenfield
 * or existing, any stack). Idempotent: re-run it to change level or pull engine
 * updates. It never clobbers your own content (CLAUDE.md, memory, config
 * overrides); it only overwrites the kit's own engine code and slash commands.
 *
 * The mechanics live in focused modules under `tools/install/` (cli, fs,
 * project, git, uninstall); this file just wires the steps together.
 * Run `node install.mjs --help` for usage and the full flag list.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { composeSettings } from './templates/vibekit/runtime/config/settings-compose.mjs';
import { applyPreset, listPresets } from './templates/vibekit/runtime/config/presets.mjs';
import { ensureDir, read, writeIfMissing, overwrite, copyTree, copyTreeIfMissing, render } from './tools/install/fs.mjs';
import { detectStack, requireBasename, looksGreenfield } from './tools/install/project.mjs';
import { installGitHooks, patchGitignore, patchGitattributes } from './tools/install/git.mjs';
import { uninstall } from './tools/install/uninstall.mjs';
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
    console.log(`vibedevkit ${await kitVersion()}`);
    return;
  }

  const target = resolve(args.target || process.cwd());
  await ensureDir(target);

  if (args.uninstall) {
    await uninstall(target, args.purge);
    return;
  }

  const interactive = !args.yes && process.stdout.isTTY;
  let level = Number.isInteger(args.level) ? args.level : undefined;
  let name = args.name;
  let mode = args.mode;

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n🌀 VibeDevKit installer\n');
    console.log(`Target: ${target}\n`);
    if (!name) name = await prompt(rl, 'Project name', requireBasename(target));
    if (!mode) {
      const auto = looksGreenfield(target) ? 'greenfield' : 'existing';
      mode = await prompt(rl, 'Mode (greenfield/existing)', auto);
    }
    if (!level) {
      console.log('\nLevels:');
      for (const [k, v] of Object.entries(LEVEL_LABELS)) console.log(`  ${k}. ${v}`);
      level = Number(await prompt(rl, '\nStart at level', '2'));
    }
    rl.close();
  }

  // Safe re-run / update: if no explicit --level, preserve the project's current
  // level (read from config) instead of silently downgrading to the default.
  if (!(Number.isInteger(level) && level >= 1 && level <= 6)) {
    try {
      const existingCfg = JSON.parse(await read(join(target, 'vibekit', 'config.json')));
      if (Number.isInteger(existingCfg.level)) level = existingCfg.level;
    } catch {
      /* no config yet */
    }
  }
  level = Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2;
  name = name || requireBasename(target);
  mode = mode === 'greenfield' || mode === 'existing' ? mode : looksGreenfield(target) ? 'greenfield' : 'existing';

  const report = [];

  // 1. settings.json (always — this is the wiring).
  const settingsPath = join(target, '.claude', 'settings.json');
  let existingSettings = null;
  if (existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(await read(settingsPath));
    } catch {
      report.push('⚠️  existing .claude/settings.json was malformed — recreated');
    }
  }
  await overwrite(settingsPath, JSON.stringify(composeSettings(existingSettings, level), null, 2) + '\n');
  report.push(`✓ .claude/settings.json wired for L${level}`);

  if (args.rewire) {
    console.log(report.join('\n'));
    console.log(`\n✅ Rewired to Level ${level}. Restart Claude Code to load the new hooks.`);
    return;
  }

  // 2. Engine: always overwrite (kit code; updates should propagate).
  await copyTree(join(TPL, 'vibekit', 'runtime'), join(target, 'vibekit', 'runtime'));
  await copyTree(join(TPL, 'vibekit', 'tools'), join(target, 'vibekit', 'tools'));
  report.push('✓ engine installed (vibekit/runtime, vibekit/tools)');

  // 3. Slash commands: always overwrite.
  await copyTree(join(TPL, 'claude', 'commands'), join(target, '.claude', 'commands'));
  report.push('✓ slash commands installed (.claude/commands)');

  // 4. Agents: only at L >= 4.
  if (level >= 4) {
    await copyTree(join(TPL, 'claude', 'agents'), join(target, '.claude', 'agents'));
    report.push('✓ agent archetypes installed (.claude/agents)');
  }

  // 5. Memory seeds: write only if missing.
  for (const rel of ['memory/SESSIONS.md', 'memory/WORKSPACE.md', 'memory/GLOSSARY.md', 'memory/roadmap.md', 'memory/decisions/_TEMPLATE.md', 'memory/decisions/0000-record-architecture-decisions.md', 'memory/business-rules/_TEMPLATE.md', 'memory/predictions/.gitkeep', 'memory/sessions/.gitkeep', 'README.md', 'instrucoes.md', 'best-practices.md', 'CLAUDE.child.md.tpl', 'squads/README.md', 'squads/_BRIEFING.md.tpl']) {
    const src = join(TPL, 'vibekit', rel);
    if (!existsSync(src)) continue;
    const wrote = await writeIfMissing(join(target, 'vibekit', rel), await read(src), args.force);
    if (wrote) report.push(`✓ seeded vibekit/${rel}`);
  }
  // Ensure memory dirs exist even if a packager stripped the .gitkeep seed.
  await ensureDir(join(target, 'vibekit', 'memory', 'sessions'));
  await ensureDir(join(target, 'vibekit', 'memory', 'decisions'));
  await ensureDir(join(target, 'vibekit', 'memory', 'business-rules'));
  await ensureDir(join(target, 'vibekit', 'memory', 'predictions'));
  // DevPipeline scaffolding (write-if-missing so existing tasks survive re-install).
  const pipeCount = await copyTreeIfMissing(join(TPL, 'vibekit', 'pipeline'), join(target, 'vibekit', 'pipeline'));
  if (pipeCount > 0) report.push(`✓ seeded vibekit/pipeline (${pipeCount} file(s))`);
  for (const s of ['backlog', 'testing', 'conclusion']) await ensureDir(join(target, 'vibekit', 'pipeline', s));
  // Workflow guides (L1–L6) + reusable playbooks (write-if-missing so customizations survive).
  const wfCount = await copyTreeIfMissing(join(TPL, 'vibekit', 'workflows'), join(target, 'vibekit', 'workflows'));
  if (wfCount > 0) report.push(`✓ seeded vibekit/workflows (${wfCount} file(s))`);

  // 6. config.json: create with level + first-run flag, or update level
  //    (preserving an already-completed setup so re-installs don't re-trigger).
  const cfgPath = join(target, 'vibekit', 'config.json');
  const preset = args.preset && listPresets().includes(args.preset) ? args.preset : null;
  if (args.preset && !preset) report.push(`⚠️  unknown --preset "${args.preset}" (have: ${listPresets().join(', ')}) — ignored`);
  if (existsSync(cfgPath)) {
    try {
      let cfg = JSON.parse(await read(cfgPath));
      cfg.level = level;
      if (cfg.setup?.completed !== true) cfg.setup = { completed: false, installedAt: new Date().toISOString() };
      if (preset) cfg = applyPreset(cfg, preset);
      await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      report.push(`✓ updated vibekit/config.json level → ${level}${preset ? ` (+preset ${preset})` : ''}`);
    } catch {
      /* leave malformed file for the user */
    }
  } else {
    let cfg = JSON.parse(await read(join(TPL, 'vibekit', 'config.json')));
    cfg.level = level;
    cfg.setup = { completed: false, installedAt: new Date().toISOString() };
    if (preset) cfg = applyPreset(cfg, preset);
    await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    report.push(`✓ created vibekit/config.json (level ${level}, first-run pending${preset ? `, preset ${preset}` : ''})`);
  }

  // 7. CLAUDE.md: render if missing; else drop a side file to merge.
  //    On --update we NEVER touch CLAUDE.md (it's user-owned content).
  const claudePath = join(target, 'CLAUDE.md');
  if (args.update && existsSync(claudePath)) {
    /* update: leave the user's CLAUDE.md untouched */
  } else {
    const claudeTpl = await read(join(TPL, 'CLAUDE.md.tpl'));
    const claudeOut = render(claudeTpl, {
      PROJECT_NAME: name,
      DATE: new Date().toISOString().slice(0, 10),
      LEVEL: String(level),
      MODE: mode,
      STACK_NOTES: mode === 'existing' ? await detectStack(target) : 'Greenfield — define the stack as the first architectural decision (`/new-adr`).',
    });
    if (!existsSync(claudePath) || args.force) {
      await overwrite(claudePath, claudeOut);
      report.push('✓ CLAUDE.md created');
    } else {
      await overwrite(join(target, 'CLAUDE.vibedevkit.md'), claudeOut);
      report.push('⚠️  CLAUDE.md exists — wrote CLAUDE.vibedevkit.md to merge by hand');
    }
  }

  // 8. CHANGELOG: render if missing.
  const changelogPath = join(target, 'docs', 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    const clTpl = await read(join(TPL, 'docs', 'CHANGELOG.md.tpl'));
    await overwrite(changelogPath, render(clTpl, { PROJECT_NAME: name, DATE: new Date().toISOString().slice(0, 10) }));
    report.push('✓ docs/CHANGELOG.md created');
  }

  // 9. .gitignore + .gitattributes + GitHub templates + git hooks.
  if (await patchGitignore(target)) report.push('✓ .gitignore patched');
  if (await patchGitattributes(target, TPL)) report.push('✓ .gitattributes patched (LF for engine scripts)');
  const ghCount = await copyTreeIfMissing(join(TPL, 'github'), join(target, '.github'));
  if (ghCount > 0) report.push(`✓ ${ghCount} GitHub template(s) added to .github/`);
  if (level >= 3) {
    if (await installGitHooks(target)) report.push('✓ git hooks installed (pre-commit, commit-msg, pre-push)');
    else report.push('ℹ️  no .git found — run `git init` then re-run to install git hooks');
  }
  // Version-control hint: suggest connecting a remote if there isn't one.
  if (!existsSync(join(target, '.git')) || !(await read(join(target, '.git', 'config')).catch(() => '')).includes('[remote "origin"]')) {
    report.push('ℹ️  no git remote — run /git setup-remote to connect GitHub/GitLab/other (+ CLI)');
  }

  // ── summary ──
  console.log('\n' + report.join('\n'));
  if (args.update) {
    console.log(`\n✅ VibeDevKit UPDATED to v${await kitVersion()} (Level ${level} preserved) in ${target}`);
    console.log('   Refreshed: engine + slash commands + hook wiring. Untouched: CLAUDE.md, config,');
    console.log('   memory (ADRs/sessions/roadmap), pipeline tasks, scoped module CLAUDE.md files.');
    console.log('   Restart Claude Code to load the refreshed hooks.');
    console.log('');
    return;
  }
  console.log(`\n✅ VibeDevKit installed at Level ${level} into ${target}`);
  console.log('\nNext steps:');
  console.log('  1. Open the project in Claude Code (it reads .claude/ + CLAUDE.md).');
  console.log('  2. Approve the hooks on first run (one-time per hook).');
  console.log('  3. ⭐ Run  /setupvibedevkit  — it fits the kit to THIS project');
  console.log('     (detects stack, tunes config, fills CLAUDE.md, flags risks).');
  console.log('     The first-run trigger will remind you automatically.');
  console.log('  4. Then work normally. /log-session at the end.');
  if (level < 5) console.log(`  5. Level up later:  /vibe-level ${Math.min(level + 1, 5)}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ VibeDevKit install failed:', err?.stack || err);
  process.exit(1);
});
