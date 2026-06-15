#!/usr/bin/env node
/**
 * ContextDevKit doctor — diagnoses an installed project's setup.
 *
 * Checks node version, config validity + level, hook wiring vs level, git-hook
 * presence (L≥3), memory scaffolding, onboarding, install mode (local-only vs
 * tracked), and optional zod. Prints a report and exits non-zero on any CRITICAL
 * (✗) problem, with a suggested fix per item.
 * Cohesion note: this CLI stays in the 280+10% zone so every host advisory
 * shares one report, severity counter, and exit decision.
 *
 * Run:  node contextkit/tools/scripts/doctor.mjs   (or /context-doctor)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeSettings } from '../../runtime/config/settings-compose.mjs';
import { composeCodexHooks } from '../../runtime/config/codex-hooks-compose.mjs';
import { getLevel, loadConfigSync } from '../../runtime/config/load.mjs';
import { MAX_LEVEL, MIN_LEVEL, isValidLevel } from '../../runtime/config/levels.mjs';
import { pathsFor, ANTIGRAVITY_DIR, ANTIGRAVITY_LEGACY_DIR, CODEX_DIR } from '../../runtime/config/paths.mjs';
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

/**
 * Config path-rot guard (ticket 145). A renamed platform dir / moved file leaves
 * config.json pointing at dead paths, and consumers fail SILENTLY. Registration
 * rot is CRITICAL (breaks an L2 contract); the gate/QA lists are advisory (L4/L5).
 */
function checkConfigPathRot() {
  const cfg = loadConfigSync(ROOT);
  const probe = (entries, label, report) => {
    const missing = (entries ?? []).filter((p) => !existsSync(resolve(ROOT, p)));
    if (missing.length === 0) {
      if ((entries ?? []).length > 0) pass(`${label} paths all exist on disk`);
      return;
    }
    report(`${label} points at nonexistent path(s): ${missing.join(', ')}`, 'edit contextkit/config.json — was the platform dir or file renamed/moved? (e.g. a vibekit-era install)');
  };
  probe(cfg?.ledger?.registration, 'ledger.registration', fail);
  probe(cfg?.l5?.highRiskPaths, 'l5.highRiskPaths', note);
  probe(cfg?.qa?.criticalPaths, 'qa.criticalPaths', note);
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
    ? pass(`hook wiring matches L${level}: ${actual.join(', ') || '(none)'}`) : fail(`hook wiring (${actual.join(', ') || 'none'}) does not match L${level} (${expected.join(', ')})`, `run /context-level ${level} and restart Claude Code`);
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
  } catch { /* missing */ }
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
    } catch { /* skip */ }
    for (const c of children) if (buildable(resolve(gAbs, c))) roots.add(`${g}/${c}`);
  }
  if (roots.size === 0) return; // single-package — root CLAUDE.md is enough
  const missing = [...roots].filter((r) => !existsSync(resolve(ROOT, r, 'CLAUDE.md')));
  missing.length === 0
    ? pass(`all ${roots.size} module(s) have a scoped CLAUDE.md`) : note(`${missing.length} module(s) missing CLAUDE.md: ${missing.join(', ')}`, 'run /claude-md to scaffold + fill them');
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
 * Antigravity host health (ticket 086, ADR-0048). Advisory only — optional host.
 * Verifies ctx.mjs, package.json shortcuts, the four `.agents/` asset trees,
 * INSTRUCTIONS.md, no surviving {{TOKEN}}; flags a legacy `.antigravity/` tree.
 */
function checkAntigravityHost() {
  if (existsSync(resolve(ROOT, ANTIGRAVITY_LEGACY_DIR))) {
    note(`legacy ${ANTIGRAVITY_LEGACY_DIR}/ tree found — agy reads ${ANTIGRAVITY_DIR}/ instead (ADR-0048)`, 'npx contextdevkit --update migrates and removes it');
  }
  if (!existsSync(P.antigravity)) {
    note(`Antigravity host not installed (${ANTIGRAVITY_DIR}/ missing)`, 'npx contextdevkit --update installs it alongside .claude/');
    return;
  }
  existsSync(resolve(ROOT, 'ctx.mjs')) ? pass('ctx.mjs runner present') : note('ctx.mjs runner missing', 're-run the installer (npx contextdevkit --update)');
  const pkg = readJson('package.json');
  if (pkg) {
    pkg?.scripts?.agy === 'node ctx.mjs' && pkg?.scripts?.ctx === 'node ctx.mjs'
      ? pass('package.json has the ctx/agy script shortcuts') : note('package.json missing the ctx/agy script shortcuts', 're-run the installer to patch them');
  }
  const emptyTrees = ['skills', 'agents', 'playbooks', 'workflows'].filter((d) => {
    try {
      return readdirSync(resolve(P.antigravity, d)).filter((f) => f.endsWith('.md')).length === 0;
    } catch {
      return true;
    }
  });
  emptyTrees.length === 0
    ? pass(`${ANTIGRAVITY_DIR} asset trees populated (skills, agents, playbooks, workflows)`) : note(`${ANTIGRAVITY_DIR} tree(s) empty or missing: ${emptyTrees.join(', ')}`, 're-run the installer (npx contextdevkit --update)');
  // agy lifecycle hooks [ADR-0049] — advisory: presence of the kit-owned group.
  const agyHooks = readJson(`${ANTIGRAVITY_DIR}/hooks.json`);
  agyHooks && agyHooks.contextdevkit && agyHooks.contextdevkit.enabled !== false
    ? pass(`${ANTIGRAVITY_DIR}/hooks.json carries the contextdevkit hook group (ADR-0049)`) : note(`${ANTIGRAVITY_DIR}/hooks.json missing the contextdevkit group`, 're-run the installer (npx contextdevkit --update) to wire agy lifecycle hooks');
  try {
    const instructions = readFileSync(resolve(ROOT, 'INSTRUCTIONS.md'), 'utf-8');
    const leftover = instructions.match(/\{\{[A-Z_]+\}\}/g);
    !leftover
      ? pass('INSTRUCTIONS.md present, fully rendered') : note(`INSTRUCTIONS.md has unrendered placeholder(s): ${[...new Set(leftover)].join(', ')}`, 'regenerate it (delete + npx contextdevkit --update) or fill them in');
  } catch {
    note('INSTRUCTIONS.md missing (Antigravity boot context)', 're-run the installer');
  }
}

/**
 * Codex host health. Advisory only (absent Codex never fails doctor). Verifies
 * AGENTS.md, `.codex/` hooks + subagents, cdx.mjs, generated source-command skills.
 */
function checkCodexHost(level) {
  if (!existsSync(P.codex)) {
    note(`Codex host not installed (${CODEX_DIR}/ missing)`, 'npx contextdevkit --update installs it alongside .claude/');
    return;
  }
  existsSync(resolve(ROOT, 'cdx.mjs')) ? pass('cdx.mjs runner present') : note('cdx.mjs runner missing', 're-run the installer (npx contextdevkit --update)');
  const pkg = readJson('package.json');
  if (pkg) {
    pkg?.scripts?.cdx === 'node cdx.mjs' ? pass('package.json has the cdx script shortcut') : note('package.json missing the cdx script shortcut', 're-run the installer to patch it');
  }
  if ((level ?? 0) >= 4) {
    try {
      const agents = readdirSync(resolve(P.codex, 'agents')).filter((f) => f.endsWith('.toml'));
      agents.length > 0 ? pass(`${CODEX_DIR}/agents populated (${agents.length} TOML subagents)`) : note(`${CODEX_DIR}/agents is empty`, 'run npm run build:codex in the kit, then update');
    } catch {
      note(`${CODEX_DIR}/agents missing`, 're-run the installer');
    }
  }
  try {
    const skills = readdirSync(P.codexSkills).filter((f) => f.startsWith('source-command-'));
    skills.length > 0 ? pass(`Codex source-command skills populated (${skills.length})`) : note('Codex source-command skills missing', 're-run the installer');
  } catch {
    note('Codex source-command skills directory missing', 're-run the installer');
  }
  const codexHooks = readJson(`${CODEX_DIR}/hooks.json`);
  const expected = Object.keys(composeCodexHooks(null, level ?? 2).hooks || {}).sort();
  const actual = Object.keys(codexHooks?.hooks || {})
    .filter((evt) => (codexHooks.hooks[evt] || []).some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('contextkit/runtime/hooks'))))
    .sort();
  JSON.stringify(expected) === JSON.stringify(actual)
    ? pass(`${CODEX_DIR}/hooks.json matches L${level}`) : note(`${CODEX_DIR}/hooks.json does not match L${level}`, `run /context-level ${level}`);
  try {
    const agentsMd = readFileSync(resolve(ROOT, 'AGENTS.md'), 'utf-8');
    const leftover = agentsMd.match(/\{\{[A-Z_]+\}\}/g);
    !leftover
      ? pass('AGENTS.md present, fully rendered') : note(`AGENTS.md has unrendered placeholder(s): ${[...new Set(leftover)].join(', ')}`, 'regenerate it (delete + npx contextdevkit --update) or fill them in');
  } catch {
    note('AGENTS.md missing (Codex boot context)', 're-run the installer');
  }
}

console.log('\n🩺 ContextDevKit doctor\n');
/**
 * Install-mode inspection (CDK-014). LOCAL-ONLY = kit hidden from git via the
 * ADR-0054 managed `.git/info/exclude` block (install default); TRACKED =
 * committed, visible to teammates/CI. Both valid; advisory only. Flags the one
 * real mismatch — local-only kit in a repo that HAS a remote — and names the safe
 * migration: `--tracked --update` only stops writing the exclude, never touches
 * the index. Worktree-safe: follows `commondir` to the shared exclude file.
 */
function checkInstallMode() {
  if (!existsSync(resolve(ROOT, '.git'))) return; // no git -> mode is N/A
  let common = resolve(ROOT, '.git');
  try {
    const m = readFileSync(common, 'utf-8').match(/^gitdir:\s*(.+)$/m); // worktree: .git is a FILE
    if (m) { const wt = resolve(ROOT, m[1].trim()), ptr = resolve(wt, 'commondir'); common = existsSync(ptr) ? resolve(wt, readFileSync(ptr, 'utf-8').trim()) : wt; }
  } catch { /* .git is a real dir */ }
  let block = '';
  try { block = readFileSync(resolve(common, 'info', 'exclude'), 'utf-8'); } catch { /* none */ }
  const managed = block.includes('ContextDevKit install (managed block, local-only)');
  const arts = ['contextkit', '.claude', 'CLAUDE.md', '.agents', '.codex', 'AGENTS.md', 'ctx.mjs', 'cdx.mjs'];
  const present = arts.filter((a) => existsSync(resolve(ROOT, a)));
  const gitOut = (a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const ls = present.length ? gitOut(['ls-files', '--', ...present]) : '';
  if (ls === null) { note('install mode: git unavailable -- cannot classify kit artifacts', 'run `git status` to inspect manually'); return; }
  const tracked = ls ? [...new Set(ls.split(String.fromCharCode(10)).map((f) => f.split('/')[0]))] : [];
  const localOnly = present.filter((a) => managed && block.includes(`/${a}`) && !tracked.includes(a));
  if (localOnly.length) pass(`install mode: LOCAL-ONLY -- ${localOnly.length} artifact(s) hidden from git via .git/info/exclude (${localOnly.join(', ')})`);
  if (tracked.length) pass(`install mode: TRACKED -- ${tracked.length} artifact(s) committed (${tracked.join(', ')})`);
  if (localOnly.length && !tracked.length && gitOut(['remote'])) {
    note('local-only kit in a repo WITH a remote -- teammates, other machines, and CI never see it',
      'team/multi-machine? migrate to tracked: `npx contextdevkit --target . --tracked --update` (stops writing the exclude; never touches the index -- you stage what you want), then `git add` the kit. Solo/experiment? local-only is fine.');
  }
}

checkNode();
const level = checkConfig();
checkConfigPathRot();
checkWiring(level);
checkGitHooks(level);
checkMemory();
checkSetup();
checkInstallMode();
checkRoadmap();
checkModuleClaudeMd();
checkRemote();
checkZod(level);
checkAntigravityHost();
checkCodexHost(level);
console.log(
  crit === 0 ? `\n✅ Healthy${warn ? ` (${warn} advisory note${warn > 1 ? 's' : ''})` : ''}.\n` : `\n❌ ${crit} critical issue${crit > 1 ? 's' : ''}${warn ? ` + ${warn} note(s)` : ''}.\n`,
);
process.exit(crit === 0 ? 0 : 1);
