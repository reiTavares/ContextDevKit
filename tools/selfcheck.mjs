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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

/**
 * Boot-context reader behaviours that the boot banner depends on (pure-ish I/O).
 * Guards two boundary bugs: a clipped [Unreleased] must say so, and a session
 * number collision must resolve by the later date.
 */
async function checkBootReaders(boot) {
  console.log('Checking boot-context readers...');
  if (!boot?.extractUnreleased || !boot?.extractLatestSession) {
    bad('boot-context-readers exports missing (extractUnreleased/extractLatestSession)');
    return;
  }
  // 009 — short block returned verbatim; an over-limit block gets a truncation marker.
  boot.extractUnreleased('## [Unreleased]\n\n- one real change\n\n## [1.0.0]\n') === '- one real change'
    ? ok('extractUnreleased returns a short block verbatim') : bad('extractUnreleased mangled a short block');
  const bigBody = Array.from({ length: 80 }, (_, i) => `- change ${i}`).join('\n');
  /truncated/i.test(boot.extractUnreleased(`## [Unreleased]\n\n${bigBody}\n\n## [1.0.0]\n`) || '')
    ? ok('extractUnreleased flags a >60-line block as truncated') : bad('extractUnreleased truncated silently (no marker)');
  // 010 — same session number, different dates → later date wins.
  const tmp = mkdtempSync(join(tmpdir(), 'vibekit-sc-'));
  try {
    const sdir = resolve(tmp, 'vibekit/memory/sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(resolve(sdir, '2026-01-02-09-older.md'), '# OLDER session pick\n');
    writeFileSync(resolve(sdir, '2026-05-09-09-newer.md'), '# NEWER session pick\n');
    const latest = await boot.extractLatestSession(tmp);
    latest?.content?.includes('NEWER')
      ? ok('extractLatestSession breaks a number tie by the later date') : bad(`extractLatestSession tie-break wrong: ${latest?.content}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Concurrency-safety primitives: atomic writes round-trip and leave no temp
 * residue, and sid sanitization neutralizes path traversal. Guards 008/011/012.
 */
async function checkConcurrencySafety(safeio, ledger) {
  console.log('Checking atomic I/O + sid sanitization...');
  if (safeio?.writeFileAtomicSync && safeio?.writeFileAtomic) {
    const tmp = mkdtempSync(join(tmpdir(), 'vibekit-io-'));
    try {
      const f = resolve(tmp, 'a.txt');
      safeio.writeFileAtomicSync(f, 'hello');
      readFileSync(f, 'utf-8') === 'hello' ? ok('writeFileAtomicSync round-trips') : bad('writeFileAtomicSync wrong content');
      await safeio.writeFileAtomic(f, 'world');
      readFileSync(f, 'utf-8') === 'world' ? ok('writeFileAtomic round-trips') : bad('writeFileAtomic wrong content');
      readdirSync(tmp).length === 1 ? ok('atomic write leaves no temp residue') : bad('atomic write left temp files behind');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else bad('safe-io atomic writers not exported');
  if (ledger?.sanitizeSid) {
    const dirty = ledger.sanitizeSid('../../etc/passwd');
    !dirty.includes('/') && !dirty.includes('.') ? ok('sanitizeSid neutralizes path traversal') : bad(`sanitizeSid leaked separators: ${dirty}`);
  } else bad('ledger.sanitizeSid not exported');
}

/**
 * Level taxonomy is single-sourced (levels.mjs) and the optional config schema
 * agrees with it: getLevel honors the range, and (where zod is installed) strict
 * validation accepts the defaults + every passthrough section. Guards 024/025/018.
 */
async function checkLevelsAndSchema(mods) {
  console.log('Checking level taxonomy + config schema...');
  const levels = mods['config/levels.mjs'];
  const load = mods['config/load.mjs'];
  const defaults = mods['config/defaults.mjs']?.DEFAULT_CONFIG;
  if (levels) {
    levels.MAX_LEVEL === 7 && levels.isValidLevel(7) && !levels.isValidLevel(8) && !levels.isValidLevel(0)
      ? ok('levels: MAX_LEVEL 7 + isValidLevel bounds') : bad('levels bounds wrong');
    levels.clampLevel(99) === 7 && levels.clampLevel(-5) === 1 ? ok('levels: clampLevel clamps to range') : bad('clampLevel wrong');
    Object.keys(levels.LEVEL_LABELS).length === 7 ? ok('levels: 7 labels in the single table') : bad('LEVEL_LABELS count wrong');
  } else bad('config/levels.mjs not loaded');
  if (load?.getLevel) {
    const root = mkdtempSync(join(tmpdir(), 'vibekit-lv-'));
    try {
      mkdirSync(resolve(root, 'vibekit'), { recursive: true });
      writeFileSync(resolve(root, 'vibekit/config.json'), JSON.stringify({ level: 7 }));
      load.getLevel(root) === 7 ? ok('getLevel accepts L7') : bad('getLevel rejects L7');
      writeFileSync(resolve(root, 'vibekit/config.json'), JSON.stringify({ level: 8 }));
      load.getLevel(root) === 2 ? ok('getLevel rejects an out-of-range level (fallback 2)') : bad('getLevel did not reject L8');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  // 024/018 — strict schema validation (only where the optional zod dep is present).
  let zodAvailable = false;
  try {
    await import('zod');
    zodAvailable = true;
  } catch {
    /* optional dep */
  }
  if (!zodAvailable) {
    ok('schema validation skipped (zod not installed — optional dep by design)');
    return;
  }
  const schema = await import('file://' + resolve(RT, 'config/schema.mjs').replaceAll('\\', '/'));
  const good = schema.validateConfig(defaults);
  good.ok && good.config.qa && good.config.pipeline
    ? ok('schema validates DEFAULT_CONFIG + passthrough keeps every section') : bad('schema rejected defaults / dropped sections');
  schema.validateConfig({ ...defaults, level: 7 }).ok ? ok('schema accepts level 7') : bad('schema rejects level 7');
  !schema.validateConfig({ ...defaults, level: 9 }).ok ? ok('schema rejects an out-of-range level') : bad('schema accepted level 9');
}

const srcText = (rel) => readFile(resolve(KIT, rel), 'utf-8').catch(() => '');

/**
 * Source-level invariants: small structural guarantees that would silently
 * regress if a future edit dropped them. Each entry is [label, file, regex] and
 * fails the build when the pattern disappears. Cheaper than a behavioural test
 * for "the wiring is still there" properties.
 */
async function checkSourceInvariants() {
  console.log('Checking source-level invariants...');
  const cases = [
    ['network git calls time out (git.mjs)', 'templates/vibekit/tools/scripts/git.mjs', /timeout:\s*\w/],
    ['network git calls time out (pre-push.mjs)', 'templates/vibekit/runtime/git-hooks/pre-push.mjs', /timeout:\s*\w/],
    ['ledger writes are atomic', 'templates/vibekit/runtime/hooks/ledger.mjs', /writeFileAtomic/],
    ['pipeline writers are atomic', 'templates/vibekit/tools/scripts/pipeline.mjs', /writeFileAtomicSync/],
    ['workspace-sync write is atomic', 'templates/vibekit/tools/scripts/workspace-sync.mjs', /writeFileAtomic/],
    ['pipeline allocates ids with exclusive create', 'templates/vibekit/tools/scripts/pipeline.mjs', /flag:\s*'wx'/],
    ['claim sanitizes the session id', 'templates/vibekit/tools/scripts/claim.mjs', /sanitizeSid/],
    ['release sanitizes the session id', 'templates/vibekit/tools/scripts/release.mjs', /sanitizeSid/],
    ['track-edits sanitizes the session id', 'templates/vibekit/runtime/hooks/track-edits.mjs', /sanitizeSid/],
    ['session-start guards live ledgers from deletion', 'templates/vibekit/runtime/hooks/session-start.mjs', /maybeLive/],
    ['config schema is passthrough', 'templates/vibekit/runtime/config/schema.mjs', /\.passthrough\(\)/],
    ['config schema bounds level by MAX_LEVEL', 'templates/vibekit/runtime/config/schema.mjs', /max\(MAX_LEVEL\)/],
    ['installer labels single-sourced from levels.mjs', 'tools/install/cli.mjs', /levels\.mjs/],
    ['vibe-level labels single-sourced from levels.mjs', 'templates/vibekit/tools/scripts/vibe-level.mjs', /levels\.mjs/],
  ];
  for (const [label, rel, re] of cases) {
    re.test(await srcText(rel)) ? ok(label) : bad(`${label} — pattern ${re} missing in ${rel}`);
  }
}

/**
 * Supply-chain: shipped GitHub Actions must be pinned to a commit SHA (a moving
 * `@v4` tag is a supply-chain risk), and CI must declare least-privilege perms.
 */
async function checkWorkflowsPinned() {
  console.log('Checking GitHub Actions are SHA-pinned...');
  const files = [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    'templates/github/workflows/quality.yml',
    'templates/github/workflows/security.yml',
  ];
  const floating = /uses:\s*[\w./-]+@v\d/; // a `# v4` comment after a SHA does not match
  for (const rel of files) {
    const text = await srcText(rel);
    if (!text) {
      bad(`workflow missing: ${rel}`);
      continue;
    }
    floating.test(text) ? bad(`${rel} has an unpinned (floating) action tag`) : ok(`${rel} actions are SHA-pinned`);
  }
  /permissions:[\s\S]*?contents:\s*read/.test(await srcText('.github/workflows/ci.yml'))
    ? ok('ci.yml declares least-privilege permissions (contents: read)') : bad('ci.yml missing contents:read permissions');
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
  for (const s of ['detect-stack.mjs', 'setup-complete.mjs', 'vibe-config.mjs', 'doctor.mjs', 'mark-simulation.mjs', 'predictions-review.mjs', 'tech-debt-scan.mjs', 'tech-debt-detectors.mjs', 'stats.mjs', 'contract-scan.mjs', 'pipeline.mjs', 'roadmap.mjs', 'claude-md.mjs', 'git.mjs', 'deps-audit.mjs', 'gh-alerts.mjs', 'pipeline-prioritize.mjs', 'pipeline-board.mjs', 'deep-analysis.mjs', 'squad.mjs', 'fleet.mjs', 'agent-tuning.mjs', 'playbook.mjs', 'token-report.mjs', 'visual-test.mjs']) {
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
    'templates/vibekit/runtime/statusline.mjs', 'templates/vibekit/runtime/config/presets.mjs',
    'templates/vibekit/best-practices.md', 'templates/vibekit/pipeline/devpipeline.md',
    'templates/vibekit/memory/roadmap.md', 'templates/vibekit/CLAUDE.child.md.tpl',
    'templates/vibekit/squads/README.md', 'templates/vibekit/squads/_BRIEFING.md.tpl',
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
  const compose = mods['config/settings-compose.mjs'];
  const load = mods['config/load.mjs'];
  if (compose?.composeSettings) checkCompose(compose.composeSettings);
  if (load?.loadConfigSync) checkConfig(load);
  const presets = mods['config/presets.mjs'];
  if (presets?.applyPreset) {
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
  } else bad('presets.applyPreset not exported');
  await checkBootReaders(mods['hooks/boot-context-readers.mjs']);
  await checkConcurrencySafety(mods['hooks/safe-io.mjs'], mods['hooks/ledger.mjs']);
  await checkLevelsAndSchema(mods);
  await checkSourceInvariants();
  await checkWorkflowsPinned();
  await checkTemplates();
  console.log(failures === 0 ? '\n✅ All checks passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('self-check crashed:', err);
  process.exit(1);
});
