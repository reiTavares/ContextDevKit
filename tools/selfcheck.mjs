#!/usr/bin/env node
/**
 * VibeDevKit self-check — smoke test for the kit BEFORE you ship it.
 *
 * - Imports every library engine module to catch syntax / import errors.
 *   (Does NOT import the hook entrypoints — those self-execute `main()`.)
 * - Asserts `composeSettings` wires the right hooks per level.
 * - Asserts the zero-dep config loader returns sane defaults.
 * - Confirms the expected template files are present.
 *
 * Run:  node tools/selfcheck.mjs   (exit 0 = healthy)
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const RT = resolve(KIT, 'templates/vibekit/runtime');
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  console.error(`  ✗ ${m}`);
  failures++;
};

async function importLibs() {
  console.log('Loading engine library modules...');
  const libs = [
    'config/paths.mjs',
    'config/defaults.mjs',
    'config/load.mjs',
    'config/settings-compose.mjs',
    'hooks/path-classification.mjs',
    'hooks/boot-context-readers.mjs',
    'hooks/ledger.mjs',
  ];
  const mods = {};
  for (const rel of libs) {
    try {
      mods[rel] = await import('file://' + resolve(RT, rel).replaceAll('\\', '/'));
      ok(rel);
    } catch (err) {
      bad(`${rel} — ${err?.message ?? err}`);
    }
  }
  return mods;
}

function checkCompose(composeSettings) {
  console.log('Checking settings composition per level...');
  const events = (lvl) => Object.keys(composeSettings(null, lvl).hooks || {}).sort();
  const expect = {
    1: ['SessionStart'],
    2: ['PostToolUse', 'SessionStart', 'Stop'],
    3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    4: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    5: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    6: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
  };
  for (const [lvl, want] of Object.entries(expect)) {
    const got = events(Number(lvl));
    if (JSON.stringify(got) === JSON.stringify(want.sort())) ok(`L${lvl} → ${got.join(', ')}`);
    else bad(`L${lvl} expected [${want}] got [${got}]`);
  }
  // Idempotency: re-composing existing settings must not duplicate entries.
  const once = composeSettings(null, 5);
  const twice = composeSettings(structuredClone(once), 5);
  const dup = (twice.hooks.PostToolUse || []).length;
  if (dup === 1) ok('re-running installer is idempotent (no duplicate hooks)');
  else bad(`idempotency broken — PostToolUse has ${dup} groups after re-compose`);
}

function checkConfig(load) {
  console.log('Checking zero-dep config loader...');
  const cfg = load.loadConfigSync(KIT);
  if (Array.isArray(cfg?.ledger?.important) && cfg.ledger.important.length > 0) ok('defaults.ledger.important populated');
  else bad('config defaults missing ledger.important');
  if (Number.isInteger(load.getLevel(KIT))) ok(`getLevel() → L${load.getLevel(KIT)}`);
  else bad('getLevel() did not return an integer');
}

async function checkTemplates() {
  console.log('Checking template inventory...');
  const cmds = await readdir(resolve(KIT, 'templates/claude/commands')).catch(() => []);
  cmds.length >= 35 ? ok(`${cmds.length} slash commands present`) : bad(`only ${cmds.length} slash commands`);
  for (const c of ['setupvibedevkit.md', 'distill-sessions.md', 'distill-apply.md', 'vibe-doctor.md', 'vibe-config.md', 'test-plan.md', 'scaffold-tests.md', 'qa-signoff.md', 'audit.md', 'ship.md', 'retro.md', 'vibe-stats.md', 'contract-check.md', 'aidevtool-from0.md', 'analyze-code-ia-practices.md', 'pipeline.md', 'roadmap.md', 'claude-md.md', 'git.md', 'squad.md', 'deps-audit.md', 'deep-analysis.md']) {
    cmds.includes(c) ? ok(`command ${c.replace('.md', '')} present`) : bad(`missing command ${c}`);
  }
  const agents = await readdir(resolve(KIT, 'templates/claude/agents')).catch(() => []);
  agents.length >= 19 ? ok(`${agents.length} agent archetypes present`) : bad(`only ${agents.length} agents`);
  for (const a of ['qa-orchestrator.md', 'qa-unit.md', 'qa-integration.md', 'qa-fuzzer.md', 'qa-perf.md', 'qa-e2e.md', 'privacy-lgpd.md', 'ux-designer.md', 'ui-designer.md', 'accessibility.md', 'product-owner.md', 'devops.md', 'infra-security.md']) {
    agents.includes(a) ? ok(`agent ${a.replace('.md', '')} present`) : bad(`missing agent ${a}`);
  }
  existsSync(resolve(KIT, '.github/workflows/release.yml')) ? ok('release workflow present') : bad('missing release workflow');
  const scripts = await readdir(resolve(KIT, 'templates/vibekit/tools/scripts')).catch(() => []);
  for (const s of ['detect-stack.mjs', 'setup-complete.mjs', 'vibe-config.mjs', 'doctor.mjs', 'mark-simulation.mjs', 'tech-debt-scan.mjs', 'tech-debt-detectors.mjs', 'stats.mjs', 'contract-scan.mjs', 'pipeline.mjs', 'roadmap.mjs', 'claude-md.mjs', 'git.mjs', 'deps-audit.mjs', 'pipeline-prioritize.mjs', 'pipeline-board.mjs', 'deep-analysis.mjs']) {
    scripts.includes(s) ? ok(`script ${s} present`) : bad(`missing script ${s}`);
  }
  const ghTpl = await readdir(resolve(KIT, 'templates/github')).catch(() => []);
  ghTpl.includes('PULL_REQUEST_TEMPLATE.md') ? ok('GitHub PR template present') : bad('missing PR template');
  for (const f of [
    'templates/CLAUDE.md.tpl', 'templates/docs/CHANGELOG.md.tpl', 'templates/vibekit/config.json',
    'templates/vibekit/instrucoes.md', 'templates/gitattributes', 'install.mjs',
    '.github/workflows/ci.yml', 'CHANGELOG.md', 'instrucoes.md', 'docs/ROADMAP.md',
    'templates/vibekit/runtime/hooks/concurrency-guard.mjs', 'templates/vibekit/runtime/git-hooks/pre-push.mjs',
    'templates/vibekit/best-practices.md', 'templates/vibekit/pipeline/devpipeline.md',
    'templates/vibekit/memory/roadmap.md', 'templates/vibekit/CLAUDE.child.md.tpl',
    'templates/vibekit/squads/README.md', 'templates/vibekit/squads/_BRIEFING.md.tpl',
    'templates/vibekit/memory/business-rules/_TEMPLATE.md',
  ]) {
    existsSync(resolve(KIT, f)) ? ok(f) : bad(`missing ${f}`);
  }
}

async function main() {
  console.log('\n🌀 VibeDevKit self-check\n');
  const mods = await importLibs();
  const compose = mods['config/settings-compose.mjs'];
  const load = mods['config/load.mjs'];
  if (compose?.composeSettings) checkCompose(compose.composeSettings);
  if (load?.loadConfigSync) checkConfig(load);
  await checkTemplates();
  console.log(failures === 0 ? '\n✅ All checks passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('self-check crashed:', err);
  process.exit(1);
});
