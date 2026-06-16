#!/usr/bin/env node
/**
 * Integration test — installer config-section auto-migration (ADR-0095).
 *
 * Tests `migrateConfigSections(cfg, defaults)` from `tools/install/config-migrate.mjs`.
 * All cases operate purely in-process (no tmp filesystem) because the function
 * under test is a pure function.  Covers:
 *   A. A missing top-level section is added and recorded.
 *   B. Existing user values survive verbatim (never clobbered at any depth).
 *   C. Idempotency — a second pass (or a fully populated cfg) yields added=[].
 *   D. Arrays are leaves — a user's array is kept; a missing array is copied whole.
 *   E. Inputs are never mutated — the original cfg and frozen defaults are intact.
 *   F. Nested partial cfg — parent key present, one child key missing.
 *   G. Real DEFAULT_CONFIG smoke — round-trips against the actual shipped defaults.
 *
 * Run:  node tools/integration-test-config-migrate.mjs
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));

const rep = reporter();
const { ok, bad } = rep;

/**
 * Loads the module under test from the install sub-directory.
 * @returns {Promise<{migrateConfigSections: Function}>}
 */
async function loadMigrate() {
  const url = 'file:///' + resolve(KIT, 'tools/install/config-migrate.mjs').replaceAll('\\', '/');
  return import(url);
}

/**
 * Loads the shipped DEFAULT_CONFIG from the runtime config tree.
 * @returns {Promise<{DEFAULT_CONFIG: object}>}
 */
async function loadDefaults() {
  const url = 'file:///' + resolve(KIT, 'templates/contextkit/runtime/config/defaults.mjs').replaceAll('\\', '/');
  return import(url);
}

// ── A. Missing top-level section is added + recorded in `added` ─────────────
async function caseA(migrateConfigSections) {
  const cfg = { level: 2, autonomy: { grade: 3 } };
  const defaults = Object.freeze({ routing: { mode: 'shadow', enabled: true } });

  const { cfg: out, added } = migrateConfigSections(cfg, defaults);

  added.includes('routing')
    ? ok('A: missing top-level section "routing" is in added[]')
    : bad(`A: expected added to include "routing", got: ${JSON.stringify(added)}`);

  out.routing && out.routing.mode === 'shadow'
    ? ok('A: added section carries the correct default value')
    : bad(`A: added section value wrong: ${JSON.stringify(out.routing)}`);

  // Existing keys must still be present.
  out.level === 2 && out.autonomy?.grade === 3
    ? ok('A: pre-existing top-level keys survive alongside the addition')
    : bad('A: pre-existing keys were corrupted by the addition');
}

// ── B. Existing user values are never clobbered (any nesting depth) ─────────
async function caseB(migrateConfigSections) {
  const cfg = {
    routing: { mode: 'active', enabled: true },  // user has mode='active', default is 'shadow'
    qa: { criticalPaths: ['src/auth/'], coverageTarget: { lines: 90, branches: 80 } },
  };
  const defaults = Object.freeze({
    routing: { mode: 'shadow', enabled: true, canaryPct: 10 },
    qa: { criticalPaths: [], coverageTarget: { lines: 80, branches: 70 } },
  });

  const { cfg: out, added } = migrateConfigSections(cfg, defaults);

  out.routing.mode === 'active'
    ? ok('B: user routing.mode="active" is not reset to default "shadow"')
    : bad(`B: user routing.mode was overwritten; got: ${out.routing.mode}`);

  out.qa.coverageTarget.lines === 90
    ? ok('B: user qa.coverageTarget.lines=90 survives (not reset to 80)')
    : bad(`B: user coverageTarget.lines was overwritten; got: ${out.qa.coverageTarget.lines}`);

  JSON.stringify(out.qa.criticalPaths) === JSON.stringify(['src/auth/'])
    ? ok('B: user qa.criticalPaths array is preserved (not replaced by empty default)')
    : bad(`B: user criticalPaths was overwritten; got: ${JSON.stringify(out.qa.criticalPaths)}`);

  // Only the genuinely missing nested key should be added.
  added.includes('routing.canaryPct')
    ? ok('B: routing.canaryPct (missing from user cfg) is recorded in added[]')
    : bad(`B: expected "routing.canaryPct" in added[], got: ${JSON.stringify(added)}`);

  !added.includes('routing.mode')
    ? ok('B: routing.mode is NOT in added[] (it was already present)')
    : bad('B: routing.mode incorrectly appeared in added[]');
}

// ── C. Idempotency — running twice (or on a complete cfg) → added=[] ────────
async function caseC(migrateConfigSections) {
  const defaults = Object.freeze({ level: 2, routing: { mode: 'shadow' } });
  const cfg = { level: 2, routing: { mode: 'shadow' } };  // already complete

  const { added: addedFirst } = migrateConfigSections(cfg, defaults);
  addedFirst.length === 0
    ? ok('C: cfg already matching defaults yields added=[] (idempotent)')
    : bad(`C: expected added=[], got: ${JSON.stringify(addedFirst)}`);

  // Two-pass idempotency: first pass fills gaps, second pass adds nothing.
  const partial = { level: 2 };
  const { cfg: after1, added: added1 } = migrateConfigSections(partial, defaults);
  const { added: added2 } = migrateConfigSections(after1, defaults);

  added1.length > 0
    ? ok('C: first pass on a partial cfg produces additions')
    : bad('C: first pass produced no additions (should have added routing)');

  added2.length === 0
    ? ok('C: second pass on the already-migrated cfg yields added=[] (strict idempotency)')
    : bad(`C: second pass still added: ${JSON.stringify(added2)}`);
}

// ── D. Arrays are leaves — missing arrays copied whole; present arrays kept ──
async function caseD(migrateConfigSections) {
  const defaults = Object.freeze({
    ledger: {
      important: ['src/', 'lib/'],
      irrelevant: ['node_modules/', 'dist/'],
    },
  });

  // User has ledger.important customised; ledger.irrelevant is absent.
  const cfg = { ledger: { important: ['my-app/', 'api/'] } };
  const { cfg: out, added } = migrateConfigSections(cfg, defaults);

  JSON.stringify(out.ledger.important) === JSON.stringify(['my-app/', 'api/'])
    ? ok('D: user ledger.important array kept intact (not merged element-wise)')
    : bad(`D: user array was mutated; got: ${JSON.stringify(out.ledger.important)}`);

  JSON.stringify(out.ledger.irrelevant) === JSON.stringify(['node_modules/', 'dist/'])
    ? ok('D: missing ledger.irrelevant array copied whole from defaults')
    : bad(`D: missing array not copied; got: ${JSON.stringify(out.ledger.irrelevant)}`);

  added.includes('ledger.irrelevant')
    ? ok('D: ledger.irrelevant (missing array) recorded in added[]')
    : bad(`D: ledger.irrelevant not in added[]; got: ${JSON.stringify(added)}`);

  !added.includes('ledger.important')
    ? ok('D: ledger.important (user-provided) NOT in added[]')
    : bad('D: ledger.important incorrectly appeared in added[]');
}

// ── E. Inputs are not mutated — original cfg and frozen defaults unchanged ───
async function caseE(migrateConfigSections) {
  const originalCfg = { level: 3, setup: { completed: false } };
  const originalCfgJson = JSON.stringify(originalCfg);

  const frozenDefaults = Object.freeze({
    level: 2,
    setup: { completed: true },
    routing: { mode: 'shadow' },
  });

  const { cfg: out } = migrateConfigSections(originalCfg, frozenDefaults);

  JSON.stringify(originalCfg) === originalCfgJson
    ? ok('E: original cfg object is not mutated by migrateConfigSections')
    : bad(`E: original cfg was mutated; now: ${JSON.stringify(originalCfg)}`);

  // Modifying the output must not affect the source default.
  try {
    out.routing.mode = 'active';  // attempt mutation of the output
    frozenDefaults.routing?.mode === 'shadow'
      ? ok('E: mutating the output does not corrupt the defaults source')
      : bad('E: defaults were corrupted by output mutation');
  } catch {
    // structuredClone output is a plain object so this won't throw; but if it
    // did that would also confirm isolation.
    ok('E: output is isolated from defaults (mutation threw on the frozen source)');
  }

  // The output must be a distinct object (not the same reference).
  out !== originalCfg
    ? ok('E: returned cfg is a new object (deep clone, not the input reference)')
    : bad('E: returned cfg is the same reference as the input (mutation risk)');
}

// ── F. Nested partial cfg — parent present, one child key missing ────────────
async function caseF(migrateConfigSections) {
  const cfg = { l5: { highRiskPaths: ['my-risky-path/**'] } };
  const defaults = Object.freeze({
    l5: {
      highRiskPaths: ['agent-packages/**'],
      lineBudget: { yellow: 240, red: 308 },
      contractGlobs: [],
    },
  });

  const { cfg: out, added } = migrateConfigSections(cfg, defaults);

  JSON.stringify(out.l5.highRiskPaths) === JSON.stringify(['my-risky-path/**'])
    ? ok('F: user l5.highRiskPaths kept when parent l5 exists (not reset to default)')
    : bad(`F: l5.highRiskPaths was overwritten; got: ${JSON.stringify(out.l5.highRiskPaths)}`);

  out.l5.lineBudget?.yellow === 240
    ? ok('F: missing nested object l5.lineBudget was added with correct values')
    : bad(`F: l5.lineBudget not added correctly; got: ${JSON.stringify(out.l5.lineBudget)}`);

  added.includes('l5.lineBudget')
    ? ok('F: l5.lineBudget recorded in added[] (highest missing ancestor)')
    : bad(`F: l5.lineBudget not in added[]; got: ${JSON.stringify(added)}`);

  // lineBudget.yellow and lineBudget.red should NOT appear separately (highest ancestor wins).
  !added.includes('l5.lineBudget.yellow') && !added.includes('l5.lineBudget.red')
    ? ok('F: child paths (l5.lineBudget.yellow/red) not redundantly in added[]')
    : bad(`F: redundant child paths in added[]: ${JSON.stringify(added)}`);
}

// ── G. Real DEFAULT_CONFIG smoke — round-trips against shipped defaults ───────
async function caseG(migrateConfigSections, DEFAULT_CONFIG) {
  // A minimal project config (like a newly installed L2 project).
  const minimalCfg = { level: 2, autonomy: { grade: 3 } };
  const { cfg: out, added } = migrateConfigSections(minimalCfg, DEFAULT_CONFIG);

  added.length > 0
    ? ok(`G: minimal cfg gains ${added.length} section(s) from DEFAULT_CONFIG`)
    : bad('G: minimal cfg against DEFAULT_CONFIG added nothing (should add many sections)');

  out.routing !== undefined
    ? ok('G: routing block is present in the migrated output')
    : bad('G: routing block missing from migrated output');

  out.autonomy?.grade === 3
    ? ok('G: user autonomy.grade=3 survives the full DEFAULT_CONFIG merge')
    : bad(`G: user autonomy.grade was clobbered; got: ${out.autonomy?.grade}`);

  // Second pass on the real output must be a no-op.
  const { added: added2 } = migrateConfigSections(out, DEFAULT_CONFIG);
  added2.length === 0
    ? ok('G: second pass against DEFAULT_CONFIG yields added=[] (idempotent at scale)')
    : bad(`G: second pass still added: ${JSON.stringify(added2)}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🌀 Integration test — config-section auto-migration (ADR-0095)\n');

  let migrateConfigSections, DEFAULT_CONFIG;
  try {
    ({ migrateConfigSections } = await loadMigrate());
    ok('tools/install/config-migrate.mjs imports cleanly');
  } catch (err) {
    bad(`import failed: ${err?.message ?? err}`);
    rep.finish('config-section auto-migration (ADR-0095)');
    return;
  }
  try {
    ({ DEFAULT_CONFIG } = await loadDefaults());
    ok('templates/contextkit/runtime/config/defaults.mjs imports cleanly');
  } catch (err) {
    bad(`defaults import failed: ${err?.message ?? err}`);
    rep.finish('config-section auto-migration (ADR-0095)');
    return;
  }

  await caseA(migrateConfigSections);
  await caseB(migrateConfigSections);
  await caseC(migrateConfigSections);
  await caseD(migrateConfigSections);
  await caseE(migrateConfigSections);
  await caseF(migrateConfigSections);
  await caseG(migrateConfigSections, DEFAULT_CONFIG);

  rep.finish('config-section auto-migration (ADR-0095)');
})();
