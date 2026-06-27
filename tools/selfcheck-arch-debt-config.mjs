#!/usr/bin/env node
/**
 * WF-0057 W5.2 (ADR-0122) — selftest for the Architecture & Technical-Debt
 * Governance Gate CONFIG block + the legacy line-budget MIGRATION (§31).
 *
 * Asserts:
 *   - defaults carry `mode:'active'` + `lineSignals.blocking:false` (hard
 *     ADR-0122 invariants);
 *   - the resolver maps `architectureDebtGate.lineSignals` → `lineBands` and
 *     forces blocking false regardless of config;
 *   - a legacy config with ONLY `l5.lineBudget {yellow, red}` migrates to the
 *     advisory `lineBands` (yellow preserved, red→elevated) and fires the
 *     deprecation notice;
 *   - the gate's own lineSignals WIN over the legacy alias when both are set;
 *   - the optional zod schema accepts the new block and REJECTS an invalid one
 *     (`lineSignals.blocking` non-boolean) — skipped cleanly if zod is absent.
 *
 * Zero-dep on the hot path; zod is loaded only behind an optional dynamic import.
 * Standalone entrypoint (exit 0/1), node:/relative only, Windows-safe.
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0, skipped = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };
const skip = (m) => { skipped++; console.log('  -- ' + m + ' (skipped)'); };

const CFG = 'templates/contextkit/runtime/config';
const defaultsArchPath = resolve(KIT, CFG + '/defaults-arch-debt.mjs');
const defaultsPath = resolve(KIT, CFG + '/defaults.mjs');
const resolverPath = resolve(KIT, CFG + '/resolve-arch-debt-config.mjs');

existsSync(defaultsArchPath) ? ok('defaults-arch-debt.mjs exists') : bad('defaults-arch-debt.mjs NOT FOUND');
existsSync(resolverPath) ? ok('resolve-arch-debt-config.mjs exists') : bad('resolve-arch-debt-config.mjs NOT FOUND');

let archDefaults, fullDefaults, resolver;
try {
  archDefaults = await import(pathToFileURL(defaultsArchPath).href);
  fullDefaults = await import(pathToFileURL(defaultsPath).href);
  resolver = await import(pathToFileURL(resolverPath).href);
} catch (err) {
  bad('Failed to import config modules: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}

const { ARCH_DEBT_GATE_DEFAULTS } = archDefaults;
const { DEFAULT_CONFIG } = fullDefaults;
const { resolveArchDebtConfig, lineBudgetDeprecationNotice, hasLegacyLineBudget } = resolver;

// 1. Hard invariants on the standalone defaults block.
ARCH_DEBT_GATE_DEFAULTS && ARCH_DEBT_GATE_DEFAULTS.mode === 'active'
  ? ok("defaults: mode === 'active'") : bad("defaults: mode is NOT 'active'");
ARCH_DEBT_GATE_DEFAULTS && ARCH_DEBT_GATE_DEFAULTS.lineSignals
  && ARCH_DEBT_GATE_DEFAULTS.lineSignals.blocking === false
  ? ok('defaults: lineSignals.blocking === false') : bad('defaults: lineSignals.blocking is NOT false');

// 2. The block is wired into DEFAULT_CONFIG (single source for the loader).
DEFAULT_CONFIG && DEFAULT_CONFIG.architectureDebtGate
  && DEFAULT_CONFIG.architectureDebtGate.mode === 'active'
  ? ok('DEFAULT_CONFIG.architectureDebtGate present + active') : bad('DEFAULT_CONFIG missing/inactive architectureDebtGate');

// 3. Resolver maps lineSignals → lineBands and forces blocking false.
const fromGate = resolveArchDebtConfig({
  architectureDebtGate: { mode: 'active', lineSignals: { yellow: 200, elevated: 400, blocking: true } },
});
fromGate.lineBands.yellow === 200 && fromGate.lineBands.elevated === 400
  ? ok('resolver: gate lineSignals → lineBands (200/400)') : bad('resolver: lineBands not mapped from lineSignals: ' + JSON.stringify(fromGate.lineBands));
fromGate.lineSignalsBlocking === false
  ? ok('resolver: lineSignalsBlocking forced false even when config says true') : bad('resolver: blocking leaked true');
fromGate.legacyMigrated === false && fromGate.deprecationNotice === null
  ? ok('resolver: no legacy migration when gate bands set (no l5.lineBudget)') : bad('resolver: spurious legacy migration');

// 4. Legacy-only config migrates l5.lineBudget → advisory lineBands (red→elevated)
//    and fires the deprecation notice.
const legacyOnly = { l5: { lineBudget: { yellow: 222, red: 333 } } };
const fromLegacy = resolveArchDebtConfig(legacyOnly);
fromLegacy.lineBands.yellow === 222 && fromLegacy.lineBands.elevated === 333
  ? ok('resolver: legacy l5.lineBudget → lineBands (yellow 222, red→elevated 333)') : bad('resolver: legacy bands not preserved: ' + JSON.stringify(fromLegacy.lineBands));
fromLegacy.legacyMigrated === true
  ? ok('resolver: legacyMigrated flagged true') : bad('resolver: legacyMigrated not flagged');
fromLegacy.lineSignalsBlocking === false
  ? ok('resolver: legacy path stays advisory (blocking false)') : bad('resolver: legacy path blocked');
typeof fromLegacy.deprecationNotice === 'string' && /l5\.lineBudget is DEPRECATED/.test(fromLegacy.deprecationNotice)
  ? ok('resolver: deprecation notice fires for legacy alias') : bad('resolver: deprecation notice missing');
hasLegacyLineBudget(legacyOnly) === true && lineBudgetDeprecationNotice({}) === null
  ? ok('helpers: hasLegacyLineBudget + notice gate correctly') : bad('helpers: legacy detection wrong');

// 5. Gate lineSignals WIN over a stale legacy alias when both are present.
const bothSet = resolveArchDebtConfig({
  architectureDebtGate: { lineSignals: { yellow: 240, elevated: 308 } },
  l5: { lineBudget: { yellow: 999, red: 1000 } },
});
bothSet.lineBands.yellow === 240 && bothSet.lineBands.elevated === 308 && bothSet.legacyMigrated === false
  ? ok('resolver: gate lineSignals win over stale l5.lineBudget') : bad('resolver: stale legacy dragged the bands: ' + JSON.stringify(bothSet.lineBands));

// 6. Empty config → safe defaults (active, advisory bands, REVIEW_REQUIRED).
const empty = resolveArchDebtConfig({});
empty.mode === 'active' && empty.lineBands.yellow === 240 && empty.lineBands.elevated === 308
  && empty.unknownEvidence === 'REVIEW_REQUIRED' && empty.lineSignalsBlocking === false
  ? ok('resolver: empty config → active/advisory defaults') : bad('resolver: empty-config defaults wrong: ' + JSON.stringify(empty));

// 7. Optional zod schema — accept the valid block, reject blocking:non-boolean.
let zod = null;
try { zod = await import('zod'); } catch { /* optional */ }
if (!zod) {
  skip('zod not installed — strict schema validation');
} else {
  try {
    const schemaPath = resolve(KIT, CFG + '/schema.mjs');
    const { validateConfig } = await import(pathToFileURL(schemaPath).href);

    const valid = validateConfig({
      level: 5,
      architectureDebtGate: { mode: 'active', lineSignals: { blocking: false, yellow: 240, elevated: 308 } },
    });
    valid.ok && valid.config.architectureDebtGate.mode === 'active'
      ? ok('schema: accepts a valid architectureDebtGate block') : bad('schema: rejected a valid block: ' + (valid.ok ? 'mode lost' : JSON.stringify(valid.error?.issues)));

    const invalid = validateConfig({
      level: 5,
      architectureDebtGate: { lineSignals: { blocking: 'yes' } },
    });
    !invalid.ok
      ? ok('schema: rejects lineSignals.blocking non-boolean') : bad('schema: accepted a non-boolean blocking');

    const badMode = validateConfig({ architectureDebtGate: { mode: 'enforce' } });
    !badMode.ok
      ? ok('schema: rejects an unknown gate mode') : bad('schema: accepted an unknown mode');

    // #370 — the conformance authorities (layerRules/ownership/writeAuthorities)
    // round-trip through the schema; a malformed layerRules (missing forbidden) is refused.
    const wiredFloors = validateConfig({
      level: 5,
      architectureDebtGate: {
        layerRules: { layers: { core: ['templates'] }, forbidden: [{ from: 'core', to: 'tooling' }] },
        ownership: { 'kit.config': 'a/load.mjs' },
        writeAuthorities: [{ state: 'kit.config', module: 'a/load.mjs' }],
      },
    });
    wiredFloors.ok && wiredFloors.config.architectureDebtGate.layerRules
      && wiredFloors.config.architectureDebtGate.ownership['kit.config'] === 'a/load.mjs'
      ? ok('schema: accepts + round-trips wired conformance authorities') : bad('schema: dropped/rejected wired floors: ' + (wiredFloors.ok ? 'authorities lost' : JSON.stringify(wiredFloors.error?.issues)));
    const badLayerRules = validateConfig({ architectureDebtGate: { layerRules: { layers: { core: ['templates'] } } } });
    !badLayerRules.ok
      ? ok('schema: rejects layerRules missing forbidden directions') : bad('schema: accepted layerRules without forbidden');
  } catch (err) {
    bad('schema validation crashed: ' + (err && err.message || err));
  }
}

const total = passes + failures;
console.log(`\narch-debt config selftest: ${passes}/${total} PASS` + (skipped ? ` (${skipped} skipped)` : ''));
if (failures) {
  console.error(`arch-debt config selftest: ${failures} FAILED`);
  process.exit(1);
}
process.exit(0);
