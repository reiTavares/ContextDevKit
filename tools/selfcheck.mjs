#!/usr/bin/env node
/**
 * ContextDevKit self-check — smoke test for the kit BEFORE you ship it.
 *
 * - Imports every library engine module to catch syntax / import errors.
 *   (Does NOT import the hook entrypoints — those self-execute `main()`.)
 * - Asserts `composeSettings` wires the right hooks per level + config defaults.
 * - Confirms the expected template files are present.
 * - Delegates the deeper invariants to sibling modules split by category
 *   (ADR-0016 H1 / task 037; inventory extracted in ADR-0041 F0 / task 104):
 *     - `selfcheck-runtime.mjs`     — boot readers, atomic I/O, sid, squad meta.
 *     - `selfcheck-config.mjs`      — level taxonomy + zod schema agreement.
 *     - `selfcheck-source.mjs`      — source-level patterns, rule 4, SHA-pinning.
 *     - `selfcheck-agent-forge.mjs` / `-ops.mjs` — agent-forge squad checks.
 *     - `selfcheck-templates.mjs`   — shipped template-tree inventory.
 *
 * Run:  node tools/selfcheck.mjs   (exit 0 = healthy)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRuntimeChecks } from './selfcheck-runtime.mjs';
import { runConfigChecks } from './selfcheck-config.mjs';
import { runSourceChecks } from './selfcheck-source.mjs';
import { runAgentForgeChecks } from './selfcheck-agent-forge.mjs';
import { runAgentForgeOpsChecks } from './selfcheck-agent-forge-ops.mjs';
import { runTemplateChecks } from './selfcheck-templates.mjs';
import { runGateChecks } from './selfcheck-gates.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const RT = resolve(KIT, 'templates/contextkit/runtime');

/**
 * Floor for the total number of executed checks (passes + failures). Guards
 * the runner wiring itself: losing a whole sibling module in a future split
 * (the silent failure mode of task-104-style refactors) drops the count far
 * below the floor and fails loudly. Raise as the suite grows; lowering it
 * requires an ADR (ADR-0041 F0, task 104 — count was 666 at extraction).
 */
const MIN_CHECKS = 660;
let failures = 0;
let passes = 0;
const ok = (m) => {
  passes++;
  console.log(`  ✓ ${m}`);
};
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
  sl && String(sl.command).includes('contextkit/runtime/statusline') ? ok('statusLine widget wired (L1+)') : bad('statusLine widget not wired');
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
  pf.pipeline.replaceAll('\\', '/').endsWith('contextkit/pipeline') && pf.sessions.replaceAll('\\', '/').endsWith('contextkit/memory/sessions')
    ? ok('pathsFor resolves canonical absolute paths') : bad(`pathsFor wrong: ${pf.pipeline}`);
}

async function main() {
  console.log('\n🌀 ContextDevKit self-check\n');
  const mods = await importLibs();
  if (mods['config/settings-compose.mjs']?.composeSettings) checkCompose(mods['config/settings-compose.mjs'].composeSettings);
  if (mods['config/load.mjs']?.loadConfigSync) checkConfig(mods['config/load.mjs']);
  checkPaths(mods['config/paths.mjs']);
  checkPresets(mods['config/presets.mjs']);
  await runRuntimeChecks({ ok, bad }, { KIT, mods });
  await runConfigChecks({ ok, bad }, { RT, mods });
  await runSourceChecks({ ok, bad }, { KIT });
  await runAgentForgeChecks({ ok, bad }, KIT);
  await runAgentForgeOpsChecks({ ok, bad }, KIT);
  await runTemplateChecks({ ok, bad }, { KIT });
  await runGateChecks({ ok, bad }, { KIT, RT, mods });
  const executed = passes + failures;
  if (executed >= MIN_CHECKS) ok(`check count ${executed} ≥ floor ${MIN_CHECKS} (no runner lost)`);
  else bad(`only ${executed} checks executed — below the ${MIN_CHECKS} floor; a sibling runner was lost (task 104)`);
  console.log(failures === 0 ? '\n✅ All checks passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('self-check crashed:', err);
  process.exit(1);
});
