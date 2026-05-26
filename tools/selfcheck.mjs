#!/usr/bin/env node
/**
 * VibeDevKit self-check — smoke test for the kit BEFORE you ship it.
 *
 * - Imports every library engine module to catch syntax / import errors.
 *   (Does NOT import the hook entrypoints — those self-execute `main()`.)
 * - Asserts `composeSettings` wires the right hooks per level + config defaults.
 * - Confirms the expected template files are present.
 * - Delegates the deeper behavioural + structural invariants to
 *   `selfcheck-checks.mjs` (split out to stay within the line budget).
 *
 * Run:  node tools/selfcheck.mjs   (exit 0 = healthy)
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExtendedChecks } from './selfcheck-checks.mjs';

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
    'config/levels.mjs',
    'config/defaults.mjs',
    'config/load.mjs',
    'config/settings-compose.mjs',
    'config/presets.mjs',
    'hooks/path-classification.mjs',
    'hooks/safe-io.mjs',
    'hooks/boot-context-readers.mjs',
    'hooks/boot-signals.mjs',
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
    7: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
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
  // Status-line widget wired at L1+, and a user's own statusLine is preserved.
  const sl = composeSettings(null, 1).statusLine;
  sl && String(sl.command).includes('vibekit/runtime/statusline') ? ok('statusLine widget wired (L1+)') : bad('statusLine widget not wired');
  composeSettings({ statusLine: { type: 'command', command: 'mine' } }, 5).statusLine?.command === 'mine'
    ? ok('composeSettings preserves a user statusLine') : bad('composeSettings clobbered a user statusLine');
}

function checkConfig(load) {
  console.log('Checking zero-dep config loader...');
  const cfg = load.loadConfigSync(KIT);
  if (Array.isArray(cfg?.ledger?.important) && cfg.ledger.important.length > 0) ok('defaults.ledger.important populated');
  else bad('config defaults missing ledger.important');
  if (Number.isInteger(load.getLevel(KIT))) ok(`getLevel() → L${load.getLevel(KIT)}`);
  else bad('getLevel() did not return an integer');
}

function checkPresets(presets) {
  if (!presets?.applyPreset) {
    bad('presets.applyPreset not exported');
    return;
  }
  const merged = presets.applyPreset({ ledger: { important: ['x/'] } }, 'next');
  merged.ledger.important.includes('app/') && merged.ledger.important.includes('x/')
    ? ok('applyPreset merges a stack preset (array union)') : bad('applyPreset did not merge the preset');
  // 013 — a partial/custom preset (omits l5 + qa) must merge, not crash.
  presets.PRESETS.__sc_partial = { ledger: { important: ['z/'] } };
  try {
    const partial = presets.applyPreset({}, '__sc_partial');
    partial.ledger.important.includes('z/') && Array.isArray(partial.l5.highRiskPaths) && Array.isArray(partial.qa.criticalPaths)
      ? ok('applyPreset tolerates a partial preset (missing l5/qa keys)') : bad('applyPreset partial-preset result malformed');
  } catch (err) {
    bad(`applyPreset crashed on a partial preset — ${err?.message ?? err}`);
  } finally {
    delete presets.PRESETS.__sc_partial;
  }
}

function checkPaths(paths) {
  if (!paths?.pathsFor) {
    bad('pathsFor not exported');
    return;
  }
  const pf = paths.pathsFor('/tmp/proj');
  pf.pipeline.replaceAll('\\', '/').endsWith('vibekit/pipeline') && pf.sessions.replaceAll('\\', '/').endsWith('vibekit/memory/sessions')
    ? ok('pathsFor resolves canonical absolute paths') : bad(`pathsFor wrong: ${pf.pipeline}`);
}

async function checkTemplates() {
  console.log('Checking template inventory...');
  const cmds = await readdir(resolve(KIT, 'templates/claude/commands')).catch(() => []);
  cmds.length >= 35 ? ok(`${cmds.length} slash commands present`) : bad(`only ${cmds.length} slash commands`);
  for (const c of ['setupvibedevkit.md', 'distill-sessions.md', 'distill-apply.md', 'vibe-doctor.md', 'vibe-config.md', 'test-plan.md', 'scaffold-tests.md', 'qa-signoff.md', 'audit.md', 'ship.md', 'retro.md', 'vibe-stats.md', 'contract-check.md', 'aidevtool-from0.md', 'analyze-code-ia-practices.md', 'pipeline.md', 'roadmap.md', 'claude-md.md', 'git.md', 'squad.md', 'deps-audit.md', 'deep-analysis.md', 'security-setup.md', 'fleet.md', 'tune-agents.md', 'playbook.md', 'token-report.md', 'visual-test.md']) {
    cmds.includes(c) ? ok(`command ${c.replace('.md', '')} present`) : bad(`missing command ${c}`);
  }
  const agents = await readdir(resolve(KIT, 'templates/claude/agents')).catch(() => []);
  agents.length >= 20 ? ok(`${agents.length} agent archetypes present`) : bad(`only ${agents.length} agents`);
  for (const a of ['qa-orchestrator.md', 'qa-unit.md', 'qa-integration.md', 'qa-fuzzer.md', 'qa-perf.md', 'qa-e2e.md', 'privacy-lgpd.md', 'ux-designer.md', 'ui-designer.md', 'accessibility.md', 'product-owner.md', 'devops.md', 'infra-security.md', 'code-security.md']) {
    agents.includes(a) ? ok(`agent ${a.replace('.md', '')} present`) : bad(`missing agent ${a}`);
  }
  existsSync(resolve(KIT, '.github/workflows/release.yml')) ? ok('release workflow present') : bad('missing release workflow');
  const scripts = await readdir(resolve(KIT, 'templates/vibekit/tools/scripts')).catch(() => []);
  for (const s of ['detect-stack.mjs', 'setup-complete.mjs', 'vibe-config.mjs', 'doctor.mjs', 'mark-simulation.mjs', 'predictions-review.mjs', 'tech-debt-scan.mjs', 'tech-debt-detectors.mjs', 'stats.mjs', 'contract-scan.mjs', 'pipeline.mjs', 'roadmap.mjs', 'claude-md.mjs', 'git.mjs', 'deps-audit.mjs', 'gh-alerts.mjs', 'pipeline-prioritize.mjs', 'pipeline-board.mjs', 'deep-analysis.mjs', 'squad.mjs', 'squad-meta.mjs', 'fleet.mjs', 'agent-tuning.mjs', 'playbook.mjs', 'token-report.mjs', 'visual-test.mjs']) {
    scripts.includes(s) ? ok(`script ${s} present`) : bad(`missing script ${s}`);
  }
  const ghTpl = await readdir(resolve(KIT, 'templates/github')).catch(() => []);
  ghTpl.includes('PULL_REQUEST_TEMPLATE.md') ? ok('GitHub PR template present') : bad('missing PR template');
  ghTpl.includes('dependabot.yml') ? ok('Dependabot config template present') : bad('missing dependabot.yml');
  existsSync(resolve(KIT, 'templates/github/workflows/security.yml')) ? ok('security workflow template present') : bad('missing security workflow template');
  existsSync(resolve(KIT, 'templates/github/workflows/quality.yml')) ? ok('quality workflow template present') : bad('missing quality workflow template');
  for (const f of [
    'templates/CLAUDE.md.tpl', 'templates/docs/CHANGELOG.md.tpl', 'templates/vibekit/config.json',
    'templates/vibekit/instrucoes.md', 'templates/gitattributes', 'install.mjs',
    '.github/workflows/ci.yml', 'CHANGELOG.md', 'instrucoes.md', 'docs/ROADMAP.md',
    'templates/vibekit/runtime/hooks/concurrency-guard.mjs', 'templates/vibekit/runtime/git-hooks/pre-push.mjs',
    'templates/vibekit/runtime/hooks/safe-io.mjs', 'templates/vibekit/runtime/config/levels.mjs',
    'templates/vibekit/runtime/statusline.mjs', 'templates/vibekit/runtime/config/presets.mjs',
    'templates/vibekit/best-practices.md', 'templates/vibekit/pipeline/devpipeline.md',
    'templates/vibekit/detectors/README.md', 'templates/vibekit/detectors/example-detector.mjs.example',
    'templates/vibekit/memory/roadmap.md', 'templates/vibekit/CLAUDE.child.md.tpl',
    'templates/vibekit/squads/README.md', 'templates/vibekit/squads/_BRIEFING.md.tpl',
    'templates/vibekit/squads/agent-forge/README.md', 'templates/vibekit/squads/agent-forge/best-practices.md',
    'templates/vibekit/squads/agent-forge/ROADMAP.md',
    'templates/vibekit/squads/agent-forge/templates/agent-package/manifest.yaml',
    'templates/vibekit/squads/agent-forge/templates/agent-package/README.md',
    'templates/vibekit/squads/agent-forge/templates/agent-package/.agentforgerc',
    'templates/vibekit/squads/agent-forge/templates/agent-package/prompts/system.canonical.md',
    'templates/vibekit/squads/agent-forge/templates/agent-package/tools/schemas.canonical.json',
    'templates/vibekit/squads/agent-forge/templates/agent-package/evals/golden.jsonl',
    'templates/vibekit/squads/agent-forge/templates/agent-package/evals/thresholds.yaml',
    'templates/vibekit/squads/agent-forge/templates/agent-package/governance/cost.policy.yaml',
    'templates/vibekit/squads/agent-forge/templates/agent-package/governance/compliance.policy.yaml',
    'templates/vibekit/squads/agent-forge/templates/agent-package/governance/quality.policy.yaml',
    'templates/vibekit/squads/agent-forge/templates/agent-package/governance/audit.schema.json',
    'templates/vibekit/memory/business-rules/_TEMPLATE.md',
    'templates/vibekit/memory/predictions/.gitkeep',
  ]) {
    existsSync(resolve(KIT, f)) ? ok(f) : bad(`missing ${f}`);
  }
  const wf = await readdir(resolve(KIT, 'templates/vibekit/workflows')).catch(() => []);
  for (const f of ['README.md', 'L1-static-loading.md', 'L2-session-ledger.md', 'L3-multi-session.md', 'L4-squads.md', 'L5-proactive.md']) {
    wf.includes(f) ? ok(`workflow ${f} present`) : bad(`missing workflow ${f}`);
  }
  const playbooks = await readdir(resolve(KIT, 'templates/vibekit/workflows/playbooks')).catch(() => []);
  for (const f of ['tech-debt-sweep.md', 'simulate-impact.md', 'distillation-cycle.md', 'security-batch.md']) {
    playbooks.includes(f) ? ok(`playbook ${f} present`) : bad(`missing playbook ${f}`);
  }
}

async function main() {
  console.log('\n🌀 VibeDevKit self-check\n');
  const mods = await importLibs();
  if (mods['config/settings-compose.mjs']?.composeSettings) checkCompose(mods['config/settings-compose.mjs'].composeSettings);
  if (mods['config/load.mjs']?.loadConfigSync) checkConfig(mods['config/load.mjs']);
  checkPaths(mods['config/paths.mjs']);
  checkPresets(mods['config/presets.mjs']);
  await runExtendedChecks({ ok, bad }, { KIT, RT, mods });
  await checkTemplates();
  console.log(failures === 0 ? '\n✅ All checks passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('self-check crashed:', err);
  process.exit(1);
});
