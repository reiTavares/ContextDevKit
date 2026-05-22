#!/usr/bin/env node
/**
 * VibeDevKit installer.
 *
 * Bootstraps the AI-assisted development platform into ANY project — greenfield
 * or existing, any stack. Idempotent: re-run it to change level or pull engine
 * updates. It never clobbers your own content (CLAUDE.md, memory, config
 * overrides); it only overwrites the kit's own engine code and slash commands.
 *
 * Usage:
 *   node install.mjs                         # interactive, installs into CWD
 *   node install.mjs --target ../my-app      # install into another folder
 *   node install.mjs --level 3 --yes         # non-interactive at Level 3
 *   node install.mjs --name "Acme API" --mode existing --yes
 *   node install.mjs --rewire --level 5      # only recompose settings.json
 *
 * Flags:
 *   --target <path>   destination project root (default: process.cwd())
 *   --level <1-5>     activation level (default: prompt, else 2)
 *   --name <string>   project name for the CLAUDE.md header
 *   --mode <m>        greenfield | existing (default: auto-detect)
 *   --yes             non-interactive; use flags/defaults, no prompts
 *   --rewire          only recompose .claude/settings.json for the level
 *   --force           overwrite CLAUDE.md / memory seeds if they exist
 */
import { cp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { composeSettings } from './templates/vibekit/runtime/config/settings-compose.mjs';

const KIT_ROOT = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(KIT_ROOT, 'templates');

// ── arg parsing ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { yes: false, rewire: false, force: false, uninstall: false, help: false, version: false, purge: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--rewire') args.rewire = true;
    else if (a === '--force') args.force = true;
    else if (a === '--uninstall') args.uninstall = true;
    else if (a === '--purge') args.purge = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--level') args.level = Number(argv[++i]);
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
  }
  return args;
}

const HELP = `
🌀 VibeDevKit installer

Usage:
  node install.mjs [--target <path>] [--level <1-5>] [--name <str>]
                   [--mode greenfield|existing] [--yes] [--force]
  node install.mjs --rewire --level <1-5>     only recompose .claude/settings.json
  node install.mjs --uninstall [--purge]      unwire hooks (--purge also removes engine)
  node install.mjs --help | --version

Flags:
  --target <path>   destination project root (default: current directory)
  --level <1-5>     activation level (default: prompt, else 2)
  --name <string>   project name for the CLAUDE.md header
  --mode <m>        greenfield | existing (default: auto-detect)
  --yes, -y         non-interactive (use flags/defaults, no prompts)
  --force           overwrite CLAUDE.md / memory seeds if they exist
  --rewire          only recompose settings.json for the given --level
  --uninstall       remove VibeDevKit hook wiring + git hooks (keeps memory)
  --purge           with --uninstall, also delete vibekit/ engine + commands/agents
  --help, -h        show this help
  --version, -v     print the kit version

After installing, open the project in Claude Code and run /setupvibedevkit.
`;

// ── small fs helpers ────────────────────────────────────────────────────────
async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}
async function writeIfMissing(path, content, force) {
  if (existsSync(path) && !force) return false;
  await ensureDir(dirname(path));
  await writeFile(path, content, 'utf-8');
  return true;
}
async function overwrite(path, content) {
  await ensureDir(dirname(path));
  await writeFile(path, content, 'utf-8');
}
async function copyTree(src, dest) {
  if (!existsSync(src)) return;
  await cp(src, dest, { recursive: true, force: true });
}
async function read(path) {
  // Strip a leading UTF-8 BOM so JSON.parse never trips on Windows-written files.
  return (await readFile(path, 'utf-8')).replace(/^﻿/, '');
}

// ── stack detection (for the CLAUDE.md header on existing projects) ──────────
async function detectStack(target) {
  const hints = [];
  const pkgPath = join(target, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await read(pkgPath));
      const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      const known = ['react', 'next', 'expo', 'react-native', 'vue', 'svelte', 'hono', 'express', 'fastify', 'nestjs', 'vite', 'astro', 'drizzle-orm', 'prisma', 'typescript'];
      const found = known.filter((k) => deps.includes(k));
      hints.push(`Node/TypeScript project. Detected: ${found.length ? found.join(', ') : 'no well-known frameworks'}.`);
    } catch {
      hints.push('Node project (package.json present).');
    }
  }
  for (const [f, label] of [['pyproject.toml', 'Python'], ['go.mod', 'Go'], ['Cargo.toml', 'Rust'], ['pom.xml', 'Java/Maven'], ['Gemfile', 'Ruby']]) {
    if (existsSync(join(target, f))) hints.push(`${label} (${f}).`);
  }
  return hints.length ? hints.join(' ') : '_TBD — fill in your stack._';
}

// ── git hooks (Level >= 3) ───────────────────────────────────────────────────
async function installGitHooks(target) {
  const gitDir = join(target, '.git');
  if (!existsSync(gitDir)) return false;
  const hooksDir = join(gitDir, 'hooks');
  await ensureDir(hooksDir);
  const wrappers = {
    'pre-commit': '#!/bin/sh\nnode vibekit/runtime/git-hooks/pre-commit.mjs\n',
    'commit-msg': '#!/bin/sh\nnode vibekit/runtime/git-hooks/commit-msg.mjs "$1"\n',
  };
  for (const [name, body] of Object.entries(wrappers)) {
    const p = join(hooksDir, name);
    await writeFile(p, body, 'utf-8');
    await chmod(p, 0o755).catch(() => {});
  }
  return true;
}

// ── .gitignore block ─────────────────────────────────────────────────────────
const GITIGNORE_BLOCK = [
  '',
  '# VibeDevKit — local runtime state (do not commit)',
  '.claude/.sessions/',
  '.claude/.workspace/',
  '.context-snapshot.md',
  '.distillation-proposal.md',
].join('\n');

async function patchGitignore(target) {
  const p = join(target, '.gitignore');
  let current = '';
  if (existsSync(p)) current = await read(p);
  if (current.includes('VibeDevKit — local runtime state')) return false;
  await writeFile(p, current + (current.endsWith('\n') || current === '' ? '' : '\n') + GITIGNORE_BLOCK + '\n', 'utf-8');
  return true;
}

async function patchGitattributes(target) {
  const tplPath = join(TPL, 'gitattributes');
  if (!existsSync(tplPath)) return false;
  const block = await read(tplPath);
  const p = join(target, '.gitattributes');
  let current = '';
  if (existsSync(p)) current = await read(p);
  if (current.includes('VibeDevKit — keep engine scripts')) return false;
  await writeFile(p, current + (current.endsWith('\n') || current === '' ? '' : '\n') + block, 'utf-8');
  return true;
}

// ── uninstall ────────────────────────────────────────────────────────────────
async function uninstall(target, purge) {
  const report = [];
  // 1. Strip VibeDevKit hook entries from settings.json (keep the user's own).
  const settingsPath = join(target, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(await read(settingsPath));
      const hooks = settings.hooks || {};
      for (const evt of Object.keys(hooks)) {
        if (!Array.isArray(hooks[evt])) continue;
        hooks[evt] = hooks[evt]
          .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('vibekit/runtime/hooks')) }))
          .filter((g) => (g.hooks || []).length > 0);
        if (hooks[evt].length === 0) delete hooks[evt];
      }
      settings.hooks = hooks;
      await overwrite(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      report.push('✓ removed VibeDevKit hook wiring from .claude/settings.json');
    } catch {
      report.push('⚠️  could not parse .claude/settings.json — left untouched');
    }
  }
  // 2. Remove the git hook wrappers we installed.
  for (const h of ['pre-commit', 'commit-msg']) {
    const p = join(target, '.git', 'hooks', h);
    if (existsSync(p)) {
      await rm(p, { force: true });
      report.push(`✓ removed git hook ${h}`);
    }
  }
  // 3. With --purge, delete the engine + commands/agents (KEEP memory).
  if (purge) {
    for (const rel of ['vibekit/runtime', 'vibekit/tools', '.claude/commands', '.claude/agents']) {
      const p = join(target, rel);
      if (existsSync(p)) {
        await rm(p, { recursive: true, force: true });
        report.push(`✓ purged ${rel}`);
      }
    }
    report.push('ℹ️  kept vibekit/memory/ (your ADRs + session history) and CLAUDE.md');
  }
  console.log('\n' + report.join('\n'));
  console.log('\n✅ VibeDevKit uninstalled.' + (purge ? '' : ' Engine files kept; re-run without --uninstall to re-enable.'));
}

// ── render templates ─────────────────────────────────────────────────────────
function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}

// ── prompts ──────────────────────────────────────────────────────────────────
async function prompt(rl, q, def) {
  const a = (await rl.question(`${q}${def ? ` (${def})` : ''}: `)).trim();
  return a || def || '';
}

const LEVEL_LABELS = {
  1: 'L1 Memory — boot context, session log, ADRs, changelog',
  2: 'L2 Ledger — + drift detection (recommended start)',
  3: 'L3 Multi — + claims, worktrees, derived indices, git hooks',
  4: 'L4 Squads — + specialized sub-agents',
  5: 'L5 Proactive — + simulate-impact gate, tech-debt sweep',
};

// ── main ─────────────────────────────────────────────────────────────────────
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
    if (!name) name = await prompt(rl, 'Project name', require_basename(target));
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

  level = Number.isInteger(level) && level >= 1 && level <= 5 ? level : 2;
  name = name || require_basename(target);
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
  for (const rel of ['memory/SESSIONS.md', 'memory/WORKSPACE.md', 'memory/GLOSSARY.md', 'memory/decisions/_TEMPLATE.md', 'memory/decisions/0000-record-architecture-decisions.md', 'memory/sessions/.gitkeep', 'README.md']) {
    const src = join(TPL, 'vibekit', rel);
    if (!existsSync(src)) continue;
    const wrote = await writeIfMissing(join(target, 'vibekit', rel), await read(src), args.force);
    if (wrote) report.push(`✓ seeded vibekit/${rel}`);
  }

  // 6. config.json: create with level + first-run flag, or update level
  //    (preserving an already-completed setup so re-installs don't re-trigger).
  const cfgPath = join(target, 'vibekit', 'config.json');
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(await read(cfgPath));
      cfg.level = level;
      if (cfg.setup?.completed !== true) cfg.setup = { completed: false, installedAt: new Date().toISOString() };
      await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      report.push(`✓ updated vibekit/config.json level → ${level}`);
    } catch {
      /* leave malformed file for the user */
    }
  } else {
    const cfg = JSON.parse(await read(join(TPL, 'vibekit', 'config.json')));
    cfg.level = level;
    cfg.setup = { completed: false, installedAt: new Date().toISOString() };
    await overwrite(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    report.push(`✓ created vibekit/config.json (level ${level}, first-run pending)`);
  }

  // 7. CLAUDE.md: render if missing; else drop a side file to merge.
  const claudeTpl = await read(join(TPL, 'CLAUDE.md.tpl'));
  const claudeOut = render(claudeTpl, {
    PROJECT_NAME: name,
    DATE: new Date().toISOString().slice(0, 10),
    LEVEL: String(level),
    MODE: mode,
    STACK_NOTES: mode === 'existing' ? await detectStack(target) : 'Greenfield — define the stack as the first architectural decision (`/new-adr`).',
  });
  const claudePath = join(target, 'CLAUDE.md');
  if (!existsSync(claudePath) || args.force) {
    await overwrite(claudePath, claudeOut);
    report.push('✓ CLAUDE.md created');
  } else {
    await overwrite(join(target, 'CLAUDE.vibedevkit.md'), claudeOut);
    report.push('⚠️  CLAUDE.md exists — wrote CLAUDE.vibedevkit.md to merge by hand');
  }

  // 8. CHANGELOG: render if missing.
  const changelogPath = join(target, 'docs', 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    const clTpl = await read(join(TPL, 'docs', 'CHANGELOG.md.tpl'));
    await overwrite(changelogPath, render(clTpl, { PROJECT_NAME: name, DATE: new Date().toISOString().slice(0, 10) }));
    report.push('✓ docs/CHANGELOG.md created');
  }

  // 9. .gitignore + .gitattributes + git hooks.
  if (await patchGitignore(target)) report.push('✓ .gitignore patched');
  if (await patchGitattributes(target)) report.push('✓ .gitattributes patched (LF for engine scripts)');
  if (level >= 3) {
    if (await installGitHooks(target)) report.push('✓ git hooks installed (pre-commit, commit-msg)');
    else report.push('ℹ️  no .git found — run `git init` then re-run to install git hooks');
  }

  // ── summary ──
  console.log('\n' + report.join('\n'));
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

function require_basename(p) {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'project';
}
function looksGreenfield(target) {
  try {
    const entries = existsSync(target) ? readdirSyncSafe(target) : [];
    const meaningful = entries.filter((e) => !['.git', '.gitignore', 'README.md', 'LICENSE', '.claude', 'vibekit'].includes(e));
    return meaningful.length === 0;
  } catch {
    return true;
  }
}
function readdirSyncSafe(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

main().catch((err) => {
  console.error('\n❌ VibeDevKit install failed:', err?.stack || err);
  process.exit(1);
});
