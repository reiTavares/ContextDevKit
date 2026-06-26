#!/usr/bin/env node
/**
 * ContextDevKit self-check: imports engine modules, checks top-level wiring, and
 * delegates deeper invariants to focused sibling suites before shipping.
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
import { runCapabilityChecks } from './selfcheck-capabilities.mjs';
import { runEnforcementChecks } from './selfcheck-enforcement.mjs';
import { runEnforcementGateChecks } from './selfcheck-enforcement-gate.mjs';
import { runAllEacpChecks } from './selfcheck-eacp-all.mjs';
import { runAllEconomyChecks } from './selfcheck-economy-all.mjs';
import { runRoutingChecks } from './selfcheck-routing.mjs';
import { runConfigPathChecks } from './selfcheck-config-paths.mjs';
import { runAllRequestOrchestrationChecks } from './selfcheck-request-all.mjs';
import { runHostHookChecks } from './selfcheck-host-hooks.mjs';
import { runMcp002Checks } from './selfcheck-mcp-002.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const RT = resolve(KIT, 'templates/contextkit/runtime');
const MIN_CHECKS = 1550;
let failures = 0;
let passes = 0;
const VERBOSE = process.argv.includes('--verbose');
const ok = (message) => { passes++; if (VERBOSE) console.log(`  ✓ ${message}`); };
const bad = (message) => { console.error(`  ✗ ${message}`); failures++; };

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
      mods[rel] = await import(`file://${resolve(RT, rel).replaceAll('\\', '/')}`);
      ok(rel);
    } catch (err) {
      bad(`${rel} - ${err?.message ?? err}`);
    }
  }
  return mods;
}

function checkConfig(load) {
  console.log('Checking zero-dep config loader...');
  const cfg = load.loadConfigSync(KIT);
  Array.isArray(cfg?.ledger?.important) && cfg.ledger.important.length > 0
    ? ok('defaults.ledger.important populated')
    : bad('config defaults missing ledger.important');
  Number.isInteger(load.getLevel(KIT))
    ? ok(`getLevel() -> L${load.getLevel(KIT)}`)
    : bad('getLevel() did not return an integer');
}

function checkPresets(presets) {
  if (!presets?.applyPreset) {
    bad('presets.applyPreset not exported');
    return;
  }
  const merged = presets.applyPreset({ ledger: { important: ['x/'] } }, 'next');
  merged.ledger.important.includes('app/') && merged.ledger.important.includes('x/')
    ? ok('applyPreset merges a stack preset (array union)')
    : bad('applyPreset did not merge the preset');
  presets.PRESETS.__sc_partial = { ledger: { important: ['z/'] } };
  try {
    const partial = presets.applyPreset({}, '__sc_partial');
    partial.ledger.important.includes('z/') &&
    Array.isArray(partial.l5.highRiskPaths) &&
    Array.isArray(partial.qa.criticalPaths)
      ? ok('applyPreset tolerates a partial preset (missing l5/qa keys)')
      : bad('applyPreset partial-preset result malformed');
  } catch (err) {
    bad(`applyPreset crashed on a partial preset - ${err?.message ?? err}`);
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
  pf.pipeline.replaceAll('\\', '/').endsWith('contextkit/pipeline') &&
  pf.sessions.replaceAll('\\', '/').endsWith('contextkit/memory/sessions')
    ? ok('pathsFor resolves canonical absolute paths')
    : bad(`pathsFor wrong: ${pf.pipeline}`);
}

function checkChangelogDisambiguation() {
  console.log('Checking product vs installed-project CHANGELOG disambiguation (CDK-012)...');
  let product = '';
  try {
    product = readFileSync(resolve(KIT, 'CHANGELOG.md'), 'utf-8');
  } catch {
    // Reported below.
  }
  if (!product) {
    bad('CHANGELOG.md (product changelog) is missing or unreadable');
    return;
  }
  const lower = product.toLowerCase();
  lower.includes('product changelog') &&
  product.includes('docs/CHANGELOG.md') &&
  lower.includes('installed project')
    ? ok('CHANGELOG.md disambiguates product vs installed-project changelog (CDK-012)')
    : bad('CHANGELOG.md lacks the product-vs-installed-project note (CDK-012)');
  existsSync(resolve(KIT, 'templates/docs/CHANGELOG.md.tpl'))
    ? ok('installed-project changelog template exists (templates/docs/CHANGELOG.md.tpl)')
    : bad('templates/docs/CHANGELOG.md.tpl missing');
}

function checkZeroDependencyInvariant() {
  try {
    const pkgDeps = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).dependencies;
    !pkgDeps || Object.keys(pkgDeps).length === 0
      ? ok('package.json has no runtime dependencies (zero-dep invariant)')
      : bad(`package.json has runtime dependencies: ${Object.keys(pkgDeps).join(', ')}`);
  } catch (err) {
    bad(`zero-dep check failed to read package.json: ${err.message}`);
  }
}

async function main() {
  console.log('\n🌀 ContextDevKit self-check\n');
  const mods = await importLibs();
  runHostHookChecks({ ok, bad }, { mods });
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
  await runCapabilityChecks({ ok, bad }, { KIT });
  await runEnforcementChecks({ ok, bad }, { KIT });
  await runEnforcementGateChecks({ ok, bad }, { KIT });
  await runAllEacpChecks({ ok, bad }, { KIT });
  await runAllEconomyChecks({ ok, bad }, { KIT });
  await runRoutingChecks({ ok, bad }, { KIT });
  await runConfigPathChecks({ ok, bad }, { KIT });
  await runAllRequestOrchestrationChecks({ ok, bad }, { KIT });
  await runMcp002Checks({ ok, bad }, { KIT });
  checkZeroDependencyInvariant();
  checkChangelogDisambiguation();

  const executed = passes + failures;
  executed >= MIN_CHECKS
    ? ok(`check count ${executed} >= floor ${MIN_CHECKS} (no runner lost)`)
    : bad(`only ${executed} checks executed - below the ${MIN_CHECKS} floor`);
  if (!VERBOSE) console.log(`selfcheck: ${passes}/${passes + failures} ✓`);
  console.log(failures === 0 ? '\n✅ All checks passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('self-check crashed:', err);
  process.exit(1);
});
