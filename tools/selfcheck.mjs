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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRuntimeChecks } from './selfcheck-runtime.mjs';
import { runConfigChecks } from './selfcheck-config.mjs';
import { runSourceChecks } from './selfcheck-source.mjs';
import { runAgentForgeChecks } from './selfcheck-agent-forge.mjs';
import { runAgentForgeOpsChecks } from './selfcheck-agent-forge-ops.mjs';
import { runTemplateChecks } from './selfcheck-templates.mjs';
import { runModelPolicyChecks } from './selfcheck-model-policy.mjs';
import { runCodexChecks } from './selfcheck-codex.mjs';
import { runGateChecks } from './selfcheck-gates.mjs';
import { runEncodingChecks } from './selfcheck-encoding.mjs';

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
    'config/agent-hooks-compose.mjs',
    'config/codex-hooks-compose.mjs',
    'config/presets.mjs',
    'config/resolve-autonomy.mjs',
    'hooks/host-adapter.mjs',
    'hooks/path-classification.mjs',
    'hooks/safe-io.mjs',
    'hooks/boot-context-readers.mjs',
    'hooks/boot-signals.mjs',
    'hooks/ledger.mjs',
    'hooks/squad-context.mjs',
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
  // (At L4+ PostToolUse legitimately holds >1 group — track-edits + auto-format,
  // ADR-0061 — so the invariant is a STABLE count under re-compose, not "== 1".)
  const once = composeSettings(null, 5);
  const onceCount = (once.hooks.PostToolUse || []).length;
  const twice = composeSettings(structuredClone(once), 5);
  const dup = (twice.hooks.PostToolUse || []).length;
  if (dup === onceCount) ok('re-running installer is idempotent (no duplicate hooks)');
  else bad(`idempotency broken — PostToolUse has ${dup} groups after re-compose (expected ${onceCount})`);
  // Status-line widget wired at L1+, and a user's own statusLine is preserved.
  const sl = composeSettings(null, 1).statusLine;
  sl && String(sl.command).includes('contextkit/runtime/statusline') ? ok('statusLine widget wired (L1+)') : bad('statusLine widget not wired');
  composeSettings({ statusLine: { type: 'command', command: 'mine' } }, 5).statusLine?.command === 'mine'
    ? ok('composeSettings preserves a user statusLine') : bad('composeSettings clobbered a user statusLine');
}

/**
 * Behavioral table for the agy host wiring [ADR-0049]: the `.agents/hooks.json`
 * composer mirrors the Claude level rules, and the host adapter normalizes
 * both wire formats into one shape (so the hook scripts never fork per host).
 */
function checkAgentHooksCompose(composer, adapter) {
  console.log('Checking agy hooks composition + host adapter (ADR-0049)...');
  const { composeAgentHooks, stripAgentHooks, KIT_HOOK_GROUP } = composer;
  const group = (lvl) => composeAgentHooks(null, lvl)[KIT_HOOK_GROUP];
  const events = (lvl) => Object.keys(group(lvl)).filter((k) => k !== 'enabled').sort();
  const expect = {
    1: ['SessionStart'],
    2: ['PostToolUse', 'SessionStart', 'Stop'],
    3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    5: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
  };
  for (const [lvl, want] of Object.entries(expect)) {
    const got = events(Number(lvl));
    if (JSON.stringify(got) === JSON.stringify(want.sort())) ok(`agy L${lvl} → ${got.join(', ')}`);
    else bad(`agy L${lvl} expected [${want}] got [${got}]`);
  }
  // One matcher entry PER agy tool name (no regex-alternation assumption).
  const l5 = group(5);
  l5.PreToolUse.length === adapter.AGY_WRITE_TOOLS.length * 3 && l5.PreToolUse.every((e) => adapter.AGY_WRITE_TOOLS.includes(e.matcher))
    ? ok('agy PreToolUse wires guard+gate+nudge once per write tool')
    : bad(`agy PreToolUse wiring wrong: ${JSON.stringify(l5.PreToolUse?.map((e) => e.matcher))}`);
  l5.PreToolUse.every((e) => e.hooks[0].command.endsWith('--host agy'))
    ? ok('every agy tool hook carries the --host agy flag')
    : bad('an agy tool hook is missing the --host agy flag');
  // Session boundaries reuse the agy-native session manager (no Claude hook fork).
  l5.SessionStart[0].hooks[0].command.includes('session-manager.mjs start') && l5.Stop[0].hooks[0].command.includes('session-manager.mjs end')
    ? ok('agy SessionStart/Stop reuse session-manager start/end')
    : bad('agy session boundary commands do not target session-manager');
  // Idempotence + user-group preservation + strip round-trip.
  const userFile = { 'my-gate': { enabled: true, PreToolUse: [] } };
  const composed = composeAgentHooks(composeAgentHooks(userFile, 5), 5);
  composed['my-gate'] && composed[KIT_HOOK_GROUP].PreToolUse.length === l5.PreToolUse.length
    ? ok('agy re-compose is idempotent and preserves user groups')
    : bad('agy re-compose duplicated entries or dropped a user group');
  const stripped = stripAgentHooks(composed);
  stripped && stripped['my-gate'] && !stripped[KIT_HOOK_GROUP] && stripAgentHooks(composeAgentHooks(null, 5)) === null
    ? ok('stripAgentHooks removes only the kit group (null when nothing remains)')
    : bad('stripAgentHooks misbehaved');
  // Host adapter normalization table — both wire formats → one shape.
  const norm = adapter.normalizeToolPayload;
  const cases = [
    ['claude Edit', { tool_name: 'Edit', tool_input: { file_path: 'a.js' } }, ['a.js']],
    ['claude MultiEdit edits[]', { tool_name: 'MultiEdit', tool_input: { edits: [{ file_path: 'b.js' }, { file_path: 'c.js' }] } }, ['b.js', 'c.js']],
    ['agy toolCall TargetFile', { toolCall: { name: 'write_to_file', args: { TargetFile: 'd.js' } } }, ['d.js']],
    ['agy claude-shaped variant', { tool_name: 'replace_file_content', tool_input: { TargetFile: 'e.js' } }, ['e.js']],
    ['junk payload', { nonsense: true }, []],
  ];
  for (const [label, payload, want] of cases) {
    const got = norm(payload).filePaths;
    JSON.stringify(got) === JSON.stringify(want) ? ok(`normalizeToolPayload: ${label}`) : bad(`normalizeToolPayload ${label} → ${JSON.stringify(got)}`);
  }
  adapter.hookHost(['node', 'x.mjs', '--host', 'agy']) === 'agy' &&
  adapter.hookHost(['node', 'x.mjs', '--host=codex']) === 'codex' &&
  adapter.hookHost(['node', 'x.mjs']) === 'claude'
    ? ok('hookHost resolves explicit agy/codex hosts and defaults to claude')
    : bad('hookHost flag parsing wrong');
}

function checkCodexHooksCompose(composer) {
  console.log('Checking Codex hooks composition...');
  const events = (lvl) => Object.keys(composer.composeCodexHooks(null, lvl).hooks || {}).sort();
  const expect = {
    1: ['SessionStart'],
    2: ['PostToolUse', 'SessionStart', 'Stop'],
    3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    5: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
  };
  for (const [lvl, want] of Object.entries(expect)) {
    const got = events(Number(lvl));
    JSON.stringify(got) === JSON.stringify(want.sort()) ? ok(`Codex L${lvl} -> ${got.join(', ')}`) : bad(`Codex L${lvl} expected [${want}] got [${got}]`);
  }
  const once = composer.composeCodexHooks(null, 5);
  const commands = Object.values(once.hooks).flat().flatMap((entry) => (entry.hooks || []).map((hook) => hook.command || ''));
  commands.every((command) => command.includes('--host codex'))
    ? ok('Codex hook commands carry the explicit host flag')
    : bad('Codex hook command missing --host codex');
  const twice = composer.composeCodexHooks(structuredClone(once), 5);
  (twice.hooks.PreToolUse || []).length === (once.hooks.PreToolUse || []).length
    ? ok('Codex hook re-compose is idempotent')
    : bad('Codex hook re-compose duplicated entries');
  composer.stripCodexHooks(once) === null
    ? ok('stripCodexHooks removes only the kit hooks')
    : bad('stripCodexHooks left kit-only residue');
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

/**
 * CDK-012 — assert the repo-root CHANGELOG.md (kit PRODUCT changelog) documents how
 * it differs from the installer's docs/CHANGELOG.md, and the template path exists.
 */
function checkChangelogDisambiguation() {
  console.log('Checking product vs installed-project CHANGELOG disambiguation (CDK-012)...');
  let product = '';
  try { product = readFileSync(resolve(KIT, 'CHANGELOG.md'), 'utf-8'); } catch { /* handled below */ }
  if (!product) { bad('CHANGELOG.md (product changelog) is missing or unreadable'); return; }
  const lower = product.toLowerCase();
  lower.includes('product changelog') && product.includes('docs/CHANGELOG.md') && lower.includes('installed project')
    ? ok('CHANGELOG.md disambiguates product vs installed-project changelog (CDK-012)')
    : bad('CHANGELOG.md lacks the product-vs-installed-project note (CDK-012) — must name both contexts');
  existsSync(resolve(KIT, 'templates/docs/CHANGELOG.md.tpl'))
    ? ok('installed-project changelog template exists (templates/docs/CHANGELOG.md.tpl)')
    : bad('templates/docs/CHANGELOG.md.tpl missing — disambiguation note points at a dead path');
}

async function main() {
  console.log('\n🌀 ContextDevKit self-check\n');
  const mods = await importLibs();
  if (mods['config/settings-compose.mjs']?.composeSettings) checkCompose(mods['config/settings-compose.mjs'].composeSettings);
  if (mods['config/agent-hooks-compose.mjs']?.composeAgentHooks && mods['hooks/host-adapter.mjs']) {
    checkAgentHooksCompose(mods['config/agent-hooks-compose.mjs'], mods['hooks/host-adapter.mjs']);
  }
  if (mods['config/codex-hooks-compose.mjs']?.composeCodexHooks) checkCodexHooksCompose(mods['config/codex-hooks-compose.mjs']);
  if (mods['config/load.mjs']?.loadConfigSync) checkConfig(mods['config/load.mjs']);
  checkPaths(mods['config/paths.mjs']);
  checkPresets(mods['config/presets.mjs']);
  await runRuntimeChecks({ ok, bad }, { KIT, mods });
  await runConfigChecks({ ok, bad }, { RT, mods });
  await runSourceChecks({ ok, bad }, { KIT });
  await runAgentForgeChecks({ ok, bad }, KIT);
  await runAgentForgeOpsChecks({ ok, bad }, KIT);
  await runTemplateChecks({ ok, bad }, { KIT });
  await runModelPolicyChecks({ ok, bad }, { KIT });
  await runCodexChecks({ ok, bad }, { KIT });
  await runGateChecks({ ok, bad }, { KIT, RT, mods });
  await runEncodingChecks({ ok, bad }, { KIT });
  // Zero-dep invariant — ADR-0001 / ADR-0031
  try {
    const pkgDeps = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).dependencies;
    (!pkgDeps || Object.keys(pkgDeps).length === 0)
      ? ok('package.json has no runtime dependencies (zero-dep invariant)')
      : bad(`package.json has runtime dependencies: ${Object.keys(pkgDeps).join(', ')} — violates ADR-0001`);
  } catch (e) { bad(`zero-dep check failed to read package.json: ${e.message}`); }
  checkChangelogDisambiguation();
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
