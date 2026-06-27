#!/usr/bin/env node
/**
 * WF-0057 W6 (ADR-0122) — ACTIVATION selftest for the Architecture &
 * Technical-Debt Governance Gate. This is the §13 protection-gap proof
 * (decisions.md Fork-1 + Fork-2): it asserts that AFTER activation the gate is
 * the SOLE CI verdict path AND that demoting the old line blocker left an
 * equivalent, never-empty, ALL-DETERMINISTIC blocking floor set in force.
 *
 * It guards the §34 headline acceptance rows this wave owns the invariant for:
 *   - §34.31 / AC-7 — gate is ACTIVE after install: `mode === 'active'` in the
 *     standalone defaults AND wired into `DEFAULT_CONFIG`.
 *   - §34.32 / AC-9 — deterministic-critical rules are BLOCKING: the default
 *     fitness catalogue's `blockingRules()` is NON-EMPTY and every blocking rule
 *     carries a deterministic-tier evidence class (the Fork-2 invariant).
 *   - §34.35 / AC-12 — NO protection gap: ONE CI verdict path. `package.json`
 *     `ci` + `ci:fast` invoke `architecture-debt-gate.mjs --ci` and do NOT invoke
 *     the legacy `tech-debt-scan.mjs --ci` as an enforcer (two `--ci` gates must
 *     never coexist), and the legacy `--ci` path no longer `process.exit(1)`s.
 *
 * Zero runtime deps (node: built-ins only). Standalone entrypoint (exit 0/1),
 * node:/relative only, Windows-safe. Suite id: `arch-debt-activation`.
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };

const SCRIPTS = 'templates/contextkit/tools/scripts';
const CFG = 'templates/contextkit/runtime/config';

// --------------------------------------------------------------------------
// Imports — fail-fast abort if the gate's modules cannot be loaded at all.
// --------------------------------------------------------------------------
let archDefaults, fullDefaults, registryMod, findingMod;
try {
  archDefaults = await import(pathToFileURL(resolve(KIT, CFG + '/defaults-arch-debt.mjs')).href);
  fullDefaults = await import(pathToFileURL(resolve(KIT, CFG + '/defaults.mjs')).href);
  registryMod = await import(pathToFileURL(resolve(KIT, SCRIPTS + '/arch-debt/fitness-registry.mjs')).href);
  findingMod = await import(pathToFileURL(resolve(KIT, SCRIPTS + '/arch-debt/finding.mjs')).href);
} catch (err) {
  bad('Failed to import gate modules: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const { ARCH_DEBT_GATE_DEFAULTS } = archDefaults;
const { DEFAULT_CONFIG } = fullDefaults;
const { buildDefaultRegistry } = registryMod;
const { Enforcement, DETERMINISTIC_TIER } = findingMod;

// --------------------------------------------------------------------------
// §34.31 / AC-7 — gate is ACTIVE after install (mode === 'active', wired in).
// --------------------------------------------------------------------------
console.log('\n§34.31 / AC-7 — gate is ACTIVE after install');
ARCH_DEBT_GATE_DEFAULTS && ARCH_DEBT_GATE_DEFAULTS.mode === 'active'
  ? ok("defaults: architectureDebtGate.mode === 'active'")
  : bad("defaults: mode is NOT 'active' (gate would not be active on install)");
ARCH_DEBT_GATE_DEFAULTS && ARCH_DEBT_GATE_DEFAULTS.enabled === true
  ? ok('defaults: gate enabled === true')
  : bad('defaults: gate not enabled');
DEFAULT_CONFIG && DEFAULT_CONFIG.architectureDebtGate
  && DEFAULT_CONFIG.architectureDebtGate.mode === 'active'
  ? ok('DEFAULT_CONFIG carries an active architectureDebtGate block (installed on every project)')
  : bad('DEFAULT_CONFIG missing/inactive architectureDebtGate block');

// --------------------------------------------------------------------------
// §34.32 / AC-9 + §34.35 Fork-2 — the BLOCKING floor set is NON-EMPTY and
// every blocking rule is deterministic-tier. THIS is the protection-equivalent
// that replaces the demoted line blocker: if it were ever empty or carried a
// non-deterministic rule, removing the old blocker WOULD open a gap.
// --------------------------------------------------------------------------
console.log('\n§34.32 / §34.35 (Fork-2) — blocking rule set is non-empty AND all-deterministic');
const registry = await buildDefaultRegistry();
/** The catalogue rules that run BLOCKING (the deterministic-critical floor set). */
const blockingRules = registry.functions.filter((fn) => fn.enforcement === Enforcement.BLOCKING);
blockingRules.length > 0
  ? ok(`blockingRules() is NON-EMPTY (${blockingRules.length} rules: ${blockingRules.map((f) => f.id).join(', ')})`)
  : bad('blockingRules() is EMPTY — the demotion would open a protection gap');

const nonDeterministic = blockingRules.filter((fn) => !DETERMINISTIC_TIER.has(fn.evidenceSource));
nonDeterministic.length === 0
  ? ok('every BLOCKING rule carries a deterministic-tier evidence class (Fork-2 invariant holds)')
  : bad('a BLOCKING rule is NON-deterministic: ' + nonDeterministic.map((f) => `${f.id}(${f.evidenceSource})`).join(', '));

// The day-1 non-negotiable subset (decisions.md Fork-2): F1 new cycle + F2
// boundary must be present and blocking — the deterministic architectural floor.
const blockingIds = new Set(blockingRules.map((f) => f.id));
['F1.forbidden-cycle', 'F2.boundary', 'F3.state-authority', 'floor.security'].every((id) => blockingIds.has(id))
  ? ok('day-1 critical floors present + blocking (F1 cycle, F2 boundary, F3 state-authority, floor.security)')
  : bad('a day-1 critical floor is missing from the blocking set: ' + [...blockingIds].join(', '));

// Every BLOCKING rule must also be ACTIVE (not DISABLED/OBSERVE_ONLY) — armed, not dormant.
const armed = blockingRules.every((fn) => fn.rolloutState === 'ACTIVE');
armed
  ? ok('every BLOCKING rule is ACTIVE (armed, not dormant)')
  : bad('a BLOCKING rule is not ACTIVE rolloutState: ' + blockingRules.filter((f) => f.rolloutState !== 'ACTIVE').map((f) => f.id).join(', '));

// --------------------------------------------------------------------------
// §34.35 / AC-12 — ONE CI verdict path (Fork-1): package.json wires the engine
// and NOT the legacy tech-debt-scan as a CI enforcer.
// --------------------------------------------------------------------------
console.log('\n§34.35 / AC-12 — ONE CI verdict path (the engine is the sole CI gate)');
const pkgPath = resolve(KIT, 'package.json');
existsSync(pkgPath) ? ok('package.json exists') : bad('package.json NOT FOUND');
let pkg = null;
try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); } catch (err) { bad('package.json unparseable: ' + (err && err.message || err)); }
const scripts = (pkg && pkg.scripts) || {};
const ENGINE = 'architecture-debt-gate.mjs --ci';
const LEGACY = 'tech-debt-scan.mjs --ci';

for (const name of ['ci', 'ci:fast']) {
  const body = typeof scripts[name] === 'string' ? scripts[name] : '';
  body.includes(ENGINE)
    ? ok(`scripts.${name} invokes the governance gate (${ENGINE})`)
    : bad(`scripts.${name} does NOT invoke the governance gate: "${body}"`);
  !body.includes(LEGACY)
    ? ok(`scripts.${name} does NOT invoke the legacy ${LEGACY} (no second CI gate)`)
    : bad(`scripts.${name} still invokes the legacy CI gate (two --ci gates coexist): "${body}"`);
}

// The legacy tech-debt-scan --ci path must no longer be a hard enforcer: it must
// not `process.exit(1)` inside its --ci branch (demoted to report-only, §13).
const scanSrc = readFileSync(resolve(KIT, SCRIPTS + '/tech-debt-scan.mjs'), 'utf-8');
// Isolate JUST the `if (args.includes('--ci')) { ... }` block body — from the
// guard to the NEXT branch guard `if (args.includes('--json'))`. A process.exit(1)
// inside THIS span would make the legacy path a second enforcing CI gate (§13).
const ciStart = scanSrc.indexOf("if (args.includes('--ci'))");
const ciEnd = scanSrc.indexOf("if (args.includes('--json'))", ciStart);
const ciBranchRaw = ciStart >= 0 && ciEnd > ciStart ? scanSrc.slice(ciStart, ciEnd) : '';
// Strip `//` line-comments so a `process.exit(1)` mentioned in PROSE (e.g. this
// file's own demotion note) is not mistaken for a live enforcing statement.
const ciBranchCode = ciBranchRaw
  .split('\n')
  .map((ln) => ln.replace(/\/\/.*$/, ''))
  .join('\n');
ciBranchCode.length > 0 && !/process\.exit\(1\)/.test(ciBranchCode)
  ? ok('legacy tech-debt-scan --ci is REPORT-ONLY (no live process.exit(1) — cannot enforce)')
  : bad('legacy tech-debt-scan --ci still calls process.exit(1) — second enforcing gate');

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
