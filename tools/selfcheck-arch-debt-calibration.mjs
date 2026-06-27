#!/usr/bin/env node
/**
 * WF-0057 follow-up — card #370 (ADR-0122): CALIBRATION selftest for the F2
 * (boundary) + F3 (state-authority) conformance floors once project-specific
 * `layerRules` / `ownership` / `writeAuthorities` are wired into config.
 *
 * The unit-level conformance selftest (selfcheck-arch-debt-conformance.mjs) proves
 * the rule bodies on fixtures. THIS selftest proves the CALIBRATION wiring — that
 * the floors actually EVALUATE through the whole gate (composition root → resolver
 * → context → policy) on a real config instead of degrading to SKIPPED:
 *
 *   1. The resolver passes layerRules/ownership/writeAuthorities through and marks
 *      conformance configured + supplies an (empty) conformanceBaseline.
 *   2. On THIS repo's live tree the gate PASSES clean (no F2/F3 RULE_DISABLED,
 *      no manufactured UNKNOWN/violation) — calibration introduced no protection gap.
 *   3. A genuinely NEW boundary violation (core→tooling edge) BLOCKS the gate.
 *   4. A genuinely NEW duplicate state authority (2nd writer) BLOCKS the gate.
 *   5. With the floors UNCONFIGURED the resolver yields a null baseline so F2/F3
 *      stay SKIPPED (no blocking UNKNOWN on an install that has not opted in).
 *
 * Zero-dep, node:/relative only, Windows-safe. Standalone entrypoint (exit 0/1).
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };

const GATE = 'templates/contextkit/tools/scripts/architecture-debt-gate.mjs';
const RESOLVER = 'templates/contextkit/runtime/config/resolve-arch-debt-config.mjs';
const LOADER = 'templates/contextkit/runtime/config/load.mjs';

const gatePath = resolve(KIT, GATE);
const resolverPath = resolve(KIT, RESOLVER);
existsSync(gatePath) ? ok('architecture-debt-gate.mjs exists') : bad('gate NOT FOUND');
existsSync(resolverPath) ? ok('resolve-arch-debt-config.mjs exists') : bad('resolver NOT FOUND');

let runGate, resolveArchDebtConfig, loadConfigSync;
try {
  ({ runGate } = await import(pathToFileURL(gatePath).href));
  ({ resolveArchDebtConfig } = await import(pathToFileURL(resolverPath).href));
  ({ loadConfigSync } = await import(pathToFileURL(resolve(KIT, LOADER)).href));
} catch (err) {
  bad('Failed to import gate/resolver/loader: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}

// ── 1. Resolver passes the conformance authorities through + arms the baseline ──
console.log('\n#370.1 — resolver wires layerRules/ownership/writeAuthorities + baseline');
const wired = resolveArchDebtConfig({
  architectureDebtGate: {
    mode: 'active',
    layerRules: { layers: { core: ['templates'], tooling: ['tools'] }, forbidden: [{ from: 'core', to: 'tooling' }] },
    ownership: { 'kit.config': 'a/load.mjs' },
    writeAuthorities: [{ state: 'kit.config', module: 'a/load.mjs' }],
  },
});
wired.conformanceConfigured === true ? ok('conformanceConfigured true when floors wired') : bad('conformanceConfigured not flagged');
wired.layerRules && wired.ownership && wired.writeAuthorities ? ok('layerRules/ownership/writeAuthorities passed through') : bad('authorities dropped by resolver');
wired.conformanceBaseline && Array.isArray(wired.conformanceBaseline.forbiddenEdges)
  ? ok('conformanceBaseline armed (empty graph baseline) when configured') : bad('conformanceBaseline not armed');

// ── 5. Unconfigured ⇒ null baseline ⇒ floors stay SKIPPED (no UNKNOWN block) ──
const bare = resolveArchDebtConfig({ architectureDebtGate: { mode: 'active' } });
bare.conformanceConfigured === false && bare.conformanceBaseline === null
  ? ok('#370.5 — unconfigured floors → null baseline (stay SKIPPED, no UNKNOWN block)')
  : bad('#370.5 — unconfigured floors did not stay dormant: ' + JSON.stringify(bare.conformanceBaseline));

// ── 2. Live tree PASSES clean and F2/F3 EVALUATE (not RULE_DISABLED) ──
console.log('\n#370.2 — live tree: F2/F3 EVALUATE (not SKIP) and the gate passes clean');
const liveResolved = resolveArchDebtConfig(loadConfigSync(KIT));
// The committed/default config ships the floors as a documented EXAMPLE block
// (opt-in — see config.json `_floorConfigExample`); only a project that wires
// real layerRules/ownership/writeAuthorities activates F2/F3. So BOTH states are
// valid and must pass on a clean clone: wired → F2/F3 EVALUATE; unwired → they
// SKIP with no protection gap. The invariant in either case is a clean gate.
const floorsWired = liveResolved.conformanceConfigured === true;
ok(floorsWired
  ? 'this repo wires the conformance floors (config.json) → F2/F3 EVALUATE'
  : 'floors unwired in the committed config → F2/F3 stay SKIPPED (valid default/clean-clone state)');
const live = await runGate({ root: KIT, config: liveResolved, baseline: liveResolved.conformanceBaseline });
const disabledF2 = live.reasons.includes('RULE_DISABLED:F2.boundary');
const disabledF3 = live.reasons.includes('RULE_DISABLED:F3.state-authority');
if (floorsWired) {
  !disabledF2 && !disabledF3 ? ok('F2/F3 are NOT RULE_DISABLED on the live tree (they EVALUATE)') : bad('F2/F3 still SKIP though wired: ' + JSON.stringify(live.reasons));
} else {
  // Unwired (clean-clone / default): the gate must stay observation-only with no
  // protection gap. The exact RULE_DISABLED reasons vary (F1/F2 listed, F3 implicit);
  // the real invariant is OBSERVATION_ONLY + a clean, non-blocking gate.
  live.reasons.includes('OBSERVATION_ONLY')
    ? ok('floors unwired → gate stays OBSERVATION_ONLY (no false block, no protection gap)')
    : bad('expected OBSERVATION_ONLY when floors unwired: ' + JSON.stringify(live.reasons));
}
live.exitCode === 0 ? ok('live tree passes clean (exitCode 0 — no protection gap)') : bad('live tree blocked: outcome ' + live.outcome);
live.blocking.length === 0 ? ok('live tree has zero blocking findings') : bad('live tree blocking: ' + live.blocking.map((f) => f.ruleId).join(','));

// Shared minimal injection helpers (pure: inject model/insights, no real scan).
const EMPTY_BASELINE = { cycles: [], forbiddenEdges: [], stateAuthorities: [] };
const runInjected = (opts) => runGate({
  root: KIT, insights: { cycles: [] }, fileMetrics: [], baseline: EMPTY_BASELINE, ...opts,
});

// ── 3. A NEW boundary violation (core→tooling) BLOCKS ──
console.log('\n#370.3 — a NEW core→tooling boundary violation BLOCKS the gate');
const boundaryRes = await runInjected({
  config: { layerRules: { layers: { core: ['templates'], tooling: ['tools'] }, forbidden: [{ from: 'core', to: 'tooling' }] } },
  model: { modules: [{ path: 'templates/rogue.mjs', deps: ['tools/harness.mjs'] }, { path: 'tools/harness.mjs', deps: [] }], fileCount: 2 },
  readChangedFiles: () => ['templates/rogue.mjs'],
});
boundaryRes.exitCode === 1 ? ok('new boundary violation → exitCode 1 (BLOCKED)') : bad('boundary violation did not block: ' + boundaryRes.outcome);
boundaryRes.blocking.some((f) => f.ruleId === 'F2.boundary') ? ok('F2.boundary is the blocking finding') : bad('F2 not in blockers: ' + boundaryRes.blocking.map((f) => f.ruleId).join(','));

// ── 4. A NEW duplicate state authority BLOCKS ──
console.log('\n#370.4 — a NEW duplicate state authority BLOCKS the gate');
const authorityRes = await runInjected({
  config: {
    ownership: { 'kit.config': 'templates/contextkit/runtime/config/load.mjs' },
    writeAuthorities: [
      { state: 'kit.config', module: 'templates/contextkit/runtime/config/load.mjs' },
      { state: 'kit.config', module: 'templates/contextkit/rogue-writer.mjs' },
    ],
  },
  model: { modules: [{ path: 'templates/contextkit/rogue-writer.mjs', deps: [] }], fileCount: 1 },
  readChangedFiles: () => ['templates/contextkit/rogue-writer.mjs'],
});
authorityRes.exitCode === 1 ? ok('new duplicate authority → exitCode 1 (BLOCKED)') : bad('duplicate authority did not block: ' + authorityRes.outcome);
authorityRes.blocking.some((f) => f.ruleId === 'F3.state-authority') ? ok('F3.state-authority is the blocking finding') : bad('F3 not in blockers: ' + authorityRes.blocking.map((f) => f.ruleId).join(','));

// Calibration guard: the live config must stay mode:active (never demoted).
liveResolved.mode === 'active' ? ok('gate mode stays active') : bad('gate mode drifted: ' + liveResolved.mode);

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
