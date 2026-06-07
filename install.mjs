#!/usr/bin/env node
/**
 * ContextDevKit installer — entry point + orchestration.
 *
 * Bootstraps the AI-assisted development platform into ANY project (greenfield
 * or existing, any stack). Idempotent: re-run it to change level or pull engine
 * updates. It never clobbers your own content (CLAUDE.md, memory, config
 * overrides); it only overwrites the kit's own engine code and slash commands.
 *
 * The mechanics live in focused modules under `tools/install/` (cli, fs,
 * project, git, uninstall); this file just wires the steps together.
 * Run `node install.mjs --help` for usage and the full flag list.
 *
 * Cohesion note (line budget): this file is intentionally a single linear
 * orchestrator — the ordered install steps (settings → engine → commands →
 * agents → memory seeds → GitHub → git hooks → config) share one `target` +
 * `report` and must run in sequence. Splitting the sequence into more modules
 * would scatter the one thing this file exists to express (the install order)
 * and add indirection without reducing real complexity. The heavy lifting is
 * already delegated to `tools/install/*`; what remains is the recipe.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { composeSettings } from './templates/contextkit/runtime/config/settings-compose.mjs';
import { applyPreset, listPresets } from './templates/contextkit/runtime/config/presets.mjs';
import { ensureDir, read, writeIfMissing, overwrite, copyTree, copyTreeIfMissing, render } from './tools/install/fs.mjs';
import { detectStack, requireBasename, looksGreenfield } from './tools/install/project.mjs';
import { installGitHooks, patchGitignore, patchGitattributes } from './tools/install/git.mjs';
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
  await copyTree(join(TPL, 'contextkit', 'runtime'), join(target, 'contextkit', 'runtime'));
  await copyTree(join(TPL, 'contextkit', 'tools'), join(target, 'contextkit', 'tools'));
  report.push('✓ engine installed (contextkit/runtime, contextkit/tools)');

  // 3. Slash commands: always overwrite.
  await copyTree(join(TPL, 'claude', 'commands'), join(target, '.claude', 'commands'));
  report.push('✓ slash commands installed (.claude/commands)');

  // 4. Agents + L4+ squads: only at L >= 4.
  if (level >= 4) {
    await copyTree(join(TPL, 'claude', 'agents'), join(target, '.claude', 'agents'));
    report.push('✓ agent archetypes installed (.claude/agents)');
    // agent-forge factory squad: engine code + matrix + APF templates (ADR-0012).
    // Always overwrite — engine kit code, not user-editable.
    await copyTree(join(TPL, 'contextkit', 'squads', 'agent-forge'), join(target, 'contextkit', 'squads', 'agent-forge'));
    report.push('✓ agent-forge squad installed (contextkit/squads/agent-forge)');
  }

  // 5. Memory seeds: write only if missing. `.env.example` is seeded here so the
  //    user's edits survive re-install (ADR-0024 — media-gen credentials template).
  for (const rel of ['memory/SESSIONS.md', 'memory/WORKSPACE.md', 'memory/GLOSSARY.md', 'memory/roadmap.md', 'memory/decisions/_TEMPLATE.md', 'memory/decisions/0000-record-architecture-decisions.md', 'memory/business-rules/_TEMPLATE.md', 'memory/predictions/.gitkeep', 'memory/sessions/.gitkeep', 'README.md', 'instrucoes.md', 'best-practices.md', 'review-protocol.md', 'behaviors.md', 'behaviors-examples.md', 'CLAUDE.child.md.tpl', 'squads/README.md', 'squads/_BRIEFING.md.tpl', 'policy/complexity-rubric.json', '.env.example']) {
    const src = join(TPL, 'contextkit', rel);
    if (!existsSync(src)) continue;
    const wrote = await writeIfMissing(join(target, 'contextkit', rel), await read(src), args.force);
    if (wrote) report.push(`✓ seeded contextkit/${rel}`);
  }
  // Ensure memory dirs exist even if a packager stripped the .gitkeep seed.
  await ensureDir(join(target, 'contextkit', 'memory', 'sessions'));
  await ensureDir(join(target, 'contextkit', 'memory', 'decisions'));
  await ensureDir(join(target, 'contextkit', 'memory', 'business-rules'));
  await ensureDir(join(target, 'contextkit', 'memory', 'predictions'));
  // DevPipeline scaffolding (write-if-missing so existing tasks survive re-install).
  const pipeCount = await copyTreeIfMissing(join(TPL, 'contextkit', 'pipeline'), join(target, 'contextkit', 'pipeline'));
  if (pipeCount > 0) report.push(`✓ seeded contextkit/pipeline (${pipeCount} file(s))`);
  for (const s of ['backlog', 'testing', 'conclusion']) await ensureDir(join(target, 'contextkit', 'pipeline', s));
  // Workflow guides (L1–L6) + reusable playbooks (write-if-missing so customizations survive).
  const wfCount = await copyTreeIfMissing(join(TPL, 'contextkit', 'workflows'), join(target, 'contextkit', 'workflows'));
  if (wfCount > 0) report.push(`✓ seeded contextkit/workflows (${wfCount} file(s))`);
  // Pluggable-detector seed (README + inert example) so the extension point is discoverable.
  const detCount = await copyTreeIfMissing(join(TPL, 'contextkit', 'detectors'), join(target, 'contextkit', 'detectors'));
  if (detCount > 0) report.push(`✓ seeded contextkit/detectors (${detCount} file(s))`);
  // Curated-stack starters (always overwrite — pure templates, no user edits expected here;
  // /aidevtool-from0 copies them OUT of contextkit/starters/ into the project root, not in-place).
  await copyTree(join(TPL, 'contextkit', 'starters'), join(target, 'contextkit', 'starters'));
  report.push('✓ curated-stack starters installed (contextkit/starters)');

  // 6. config.json: create with level + first-run flag, or update level
  //    (preserving an already-completed setup so re-installs don't re-trigger).
  const cfgPath = join(target, 'contextkit', 'config.json');
  const preset = args.preset && listPresets().includes(args.preset) ? args.preset : null;
  if (args.preset && !preset) report.push(`⚠️  unknown --preset "${args.preset}" (have: ${listPresets().join(', ')}) — ignored`);
  if (existsSync(cfgPath)) {
    try {
      let cfg = JSON.parse(await read(cfgPath));
      cfg.level = level;
      if (cfg.setup?.completed !== true) cfg.setup = { completed: false, installedAt: new Date().toISOString() };
      if (preset) cfg = applyPreset(cfg, preset);
      await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      report.push(`✓ updated contextkit/config.json level → ${level}${preset ? ` (+preset ${preset})` : ''}`);
    } catch {
      /* leave malformed file for the user */
    }
  } else {
    let cfg = JSON.parse(await read(join(TPL, 'contextkit', 'config.json')));
    cfg.level = level;
    cfg.setup = { completed: false, installedAt: new Date().toISOString() };
    if (preset) cfg = applyPreset(cfg, preset);
    await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    report.push(`✓ created contextkit/config.json (level ${level}, first-run pending${preset ? `, preset ${preset}` : ''})`);
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
      await overwrite(join(target, 'CLAUDE.contextdevkit.md'), claudeOut);
      report.push('⚠️  CLAUDE.md exists — wrote CLAUDE.contextdevkit.md to merge by hand');
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
    const gitHooks = await installGitHooks(target);
    if (gitHooks.installed) {
      report.push('✓ git hooks installed (pre-commit, commit-msg, pre-push)');
      if (gitHooks.backedUp.length) report.push(`  ↳ backed up your existing ${gitHooks.backedUp.join(', ')} hook(s) → *.bak`);
    } else report.push('ℹ️  no .git found — run `git init` then re-run to install git hooks');
  }
  // Version-control hint: suggest connecting a remote if there isn't one.
  if (!existsSync(join(target, '.git')) || !(await read(join(target, '.git', 'config')).catch(() => '')).includes('[remote "origin"]')) {
    report.push('ℹ️  no git remote — run /git setup-remote to connect GitHub/GitLab/other (+ CLI)');
  }

  // ── summary ──
  console.log('\n' + report.join('\n'));
  if (args.update) {
    console.log(`\n✅ ContextDevKit UPDATED to v${await kitVersion()} (Level ${level} preserved) in ${target}`);
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
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ ContextDevKit install failed:', err?.stack || err);
  process.exit(1);
});
