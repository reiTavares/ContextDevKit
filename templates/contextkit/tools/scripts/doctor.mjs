#!/usr/bin/env node
/**
 * ContextDevKit doctor — diagnoses an installed project's setup.
 *
 * Checks node version, config validity + level, that `.claude/settings.json`
 * hook wiring matches the configured level, git-hook presence (L≥3), memory
 * scaffolding, onboarding state, and optional zod. Prints a report and exits
 * non-zero if any CRITICAL (✗) problem is found, with a suggested fix per item.
 *
 * Run:  node contextkit/tools/scripts/doctor.mjs   (or /context-doctor)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeSettings } from '../../runtime/config/settings-compose.mjs';
import { getLevel, loadConfigSync } from '../../runtime/config/load.mjs';
import { MAX_LEVEL, MIN_LEVEL, isValidLevel } from '../../runtime/config/levels.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { readJsonSafe } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);
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

const readJson = (rel) => readJsonSafe(resolve(ROOT, rel));

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? pass(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old`, 'install Node >= 18');
}

function checkConfig() {
  if (!existsSync(P.config)) {
    fail('contextkit/config.json missing', 're-run the installer');
    return null;
  }
  const raw = readJson('contextkit/config.json');
  if (!raw) {
    fail('contextkit/config.json is not valid JSON', 'fix the JSON or re-run the installer');
    return null;
  }
  const level = getLevel(ROOT);
  isValidLevel(level) ? pass(`config valid — level L${level}`) : note('config.level out of range', `use /context-level <${MIN_LEVEL}-${MAX_LEVEL}>`);
  return level;
}

function checkWiring(level) {
  const settings = readJson('.claude/settings.json');
  if (!settings) {
    fail('.claude/settings.json missing or invalid', 'run /context-level ' + (level ?? 2));
    return;
  }
  const expected = Object.keys(composeSettings(null, level ?? 2).hooks || {}).sort();
  const actual = Object.keys(settings.hooks || {})
    .filter((evt) => (settings.hooks[evt] || []).some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('contextkit/runtime/hooks'))))
    .sort();
  JSON.stringify(expected) === JSON.stringify(actual)
    ? pass(`hook wiring matches L${level}: ${actual.join(', ') || '(none)'}`)
    : fail(`hook wiring (${actual.join(', ') || 'none'}) does not match L${level} (${expected.join(', ')})`, `run /context-level ${level} and restart Claude Code`);
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
  existsSync(P.sessions) ? pass('memory/sessions present') : note('memory/sessions missing', 're-run the installer');
  existsSync(resolve(ROOT, 'docs/CHANGELOG.md')) ? pass('docs/CHANGELOG.md present') : note('CHANGELOG missing', 're-run the installer');
}

function checkSetup() {
  const completed = loadConfigSync(ROOT)?.setup?.completed === true;
  completed ? pass('onboarding complete') : note('onboarding not run', 'run /setupcontextdevkit');
}

function checkRoadmap() {
  const p = P.roadmap;
  let defined = false;
  try {
    const t = readFileSync(p, 'utf-8');
    defined = !t.includes('ROADMAP-NOT-DEFINED') && t.trim().length > 0;
  } catch {
    /* missing */
  }
  defined ? pass('product roadmap defined') : note('product roadmap not defined', 'run /roadmap to create it (with you)');
}

function checkModuleClaudeMd() {
  const groups = ['apps', 'packages', 'modules', 'services', 'libs'];
  const splits = ['backend', 'frontend', 'client', 'server', 'api', 'web', 'mobile', 'functions', 'worker'];
  const manifests = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'tsconfig.json'];
  const buildable = (d) => manifests.some((m) => existsSync(resolve(d, m))) || existsSync(resolve(d, 'src'));
  const roots = new Set();
  for (const s of splits) {
    const abs = resolve(ROOT, s);
    if (existsSync(abs) && buildable(abs)) roots.add(s);
  }
  for (const g of groups) {
    const gAbs = resolve(ROOT, g);
    if (!existsSync(gAbs)) continue;
    let children = [];
    try {
      children = readdirSync(gAbs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch {
      /* skip */
    }
    for (const c of children) if (buildable(resolve(gAbs, c))) roots.add(`${g}/${c}`);
  }
  if (roots.size === 0) return; // single-package — root CLAUDE.md is enough
  const missing = [...roots].filter((r) => !existsSync(resolve(ROOT, r, 'CLAUDE.md')));
  missing.length === 0
    ? pass(`all ${roots.size} module(s) have a scoped CLAUDE.md`)
    : note(`${missing.length} module(s) missing CLAUDE.md: ${missing.join(', ')}`, 'run /claude-md to scaffold + fill them');
}

function checkRemote() {
  if (!existsSync(resolve(ROOT, '.git'))) return; // not a git repo — /git can init
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    url ? pass(`git remote: ${url}`) : note('no git remote', 'run /git setup-remote (GitHub/GitLab/other)');
  } catch {
    note('no git remote configured', 'run /git setup-remote to connect GitHub/GitLab/other + CLI');
  }
}

function checkZod(level) {
  if ((level ?? 0) < 5) return;
  const hasZod = existsSync(resolve(ROOT, 'node_modules/zod'));
  hasZod ? pass('zod present (strict /context-config validation enabled)') : note('zod not installed (optional)', 'add zod for strict config validation, or ignore');
}

/**
 * Antigravity host health (ticket 086). Advisory only — the second host is
 * optional, so a Claude-only project never fails doctor over it. Verifies the
 * ctx.mjs runner, the package.json shortcuts, the four .antigravity asset
 * trees, INSTRUCTIONS.md, and that no {{TOKEN}} placeholder survived rendering.
 */
function checkAntigravityHost() {
  if (!existsSync(resolve(ROOT, '.antigravity'))) {
    note('Antigravity host not installed (.antigravity/ missing)', 'npx contextdevkit --update installs it alongside .claude/');
    return;
  }
  existsSync(resolve(ROOT, 'ctx.mjs')) ? pass('ctx.mjs runner present') : note('ctx.mjs runner missing', 're-run the installer (npx contextdevkit --update)');

  const pkg = readJson('package.json');
  if (pkg) {
    pkg?.scripts?.agy === 'node ctx.mjs' && pkg?.scripts?.ctx === 'node ctx.mjs'
      ? pass('package.json has the ctx/agy script shortcuts')
      : note('package.json missing the ctx/agy script shortcuts', 're-run the installer to patch them');
  }

  const emptyTrees = ['skills', 'agents', 'playbooks', 'workflows'].filter((d) => {
    try {
      return readdirSync(resolve(ROOT, '.antigravity', d)).filter((f) => f.endsWith('.md')).length === 0;
    } catch {
      return true;
    }
  });
  emptyTrees.length === 0
    ? pass('.antigravity asset trees populated (skills, agents, playbooks, workflows)')
    : note(`.antigravity tree(s) empty or missing: ${emptyTrees.join(', ')}`, 're-run the installer (npx contextdevkit --update)');

  try {
    const instructions = readFileSync(resolve(ROOT, 'INSTRUCTIONS.md'), 'utf-8');
    const leftover = instructions.match(/\{\{[A-Z_]+\}\}/g);
    !leftover
      ? pass('INSTRUCTIONS.md present, fully rendered')
      : note(`INSTRUCTIONS.md has unrendered placeholder(s): ${[...new Set(leftover)].join(', ')}`, 'regenerate it (delete + npx contextdevkit --update) or fill them in');
  } catch {
    note('INSTRUCTIONS.md missing (Antigravity boot context)', 're-run the installer');
  }
}

console.log('\n🩺 ContextDevKit doctor\n');
checkNode();
const level = checkConfig();
checkWiring(level);
checkGitHooks(level);
checkMemory();
checkSetup();
checkRoadmap();
checkModuleClaudeMd();
checkRemote();
checkZod(level);
checkAntigravityHost();
console.log(
  crit === 0
    ? `\n✅ Healthy${warn ? ` (${warn} advisory note${warn > 1 ? 's' : ''})` : ''}.\n`
    : `\n❌ ${crit} critical issue${crit > 1 ? 's' : ''}${warn ? ` + ${warn} note(s)` : ''}.\n`,
);
process.exit(crit === 0 ? 0 : 1);
