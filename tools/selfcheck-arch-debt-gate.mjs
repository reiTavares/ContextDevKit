#!/usr/bin/env node
/**
 * WF-0057 W4 (ADR-0122) — INTEGRATION selftest for the architecture-debt-gate
 * COMPOSITION ROOT (`runGate`). Runs the whole engine end-to-end on small
 * synthetic FIXTURE inputs + once on the REAL repo tree, asserting the §34
 * headline rows the engine is responsible for composing:
 *
 *   - a fixture with a NEW cycle + layerRules wired → outcome BLOCKED (§34.3).
 *   - a cohesive-large-file fixture → PASS (line count NEVER blocks, §34.1/§34.25).
 *   - missing graph evidence (baseline wired, graph stale) → REVIEW/UNKNOWN,
 *     never PASS (§34.22).
 *   - the engine runs on the REAL repo tree and returns a passing outcome
 *     (PASS / PASS_WITH_OBSERVATION) end-to-end — proves it composes without crash.
 *
 * Fixtures are INJECTED (model/fileMetrics/baseline/changedSet/readChangedFiles),
 * so the test needs no temp tree for the synthetic cases; the real-tree case runs
 * the live walk + scan against the kit root. Suite name: `arch-debt-gate`.
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

const SCRIPTS = 'templates/contextkit/tools/scripts';
const gatePath = resolve(KIT, SCRIPTS + '/architecture-debt-gate.mjs');
existsSync(gatePath) ? ok('architecture-debt-gate.mjs exists') : bad('architecture-debt-gate.mjs NOT FOUND');

let gate, fmod;
try {
  gate = await import(pathToFileURL(gatePath).href);
  fmod = await import(pathToFileURL(resolve(KIT, SCRIPTS + '/arch-debt/finding.mjs')).href);
} catch (err) {
  bad('Failed to import gate: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const { runGate } = gate;
const { isApproval, GateOutcome } = fmod;
typeof runGate === 'function' ? ok('runGate exported as function') : bad('runGate not a function');

/** No-op changed-set reader → "scope nothing" (fail-closed empty set). */
const noChange = () => null;
/** A changed-set reader covering the fixture modules. */
const changedAll = (paths) => () => paths;

// --------------------------------------------------------------------------
// Fixture 1 — a NEW forbidden cycle + layerRules wired → BLOCKED (§34.3).
// model: domain → infra → domain (a cycle); baseline has NO cycle (so it's NEW).
// --------------------------------------------------------------------------
console.log('\n§34.3 — new forbidden cycle (baseline + layerRules wired) → BLOCKED');
const cyclicModules = [
  { path: 'src/domain', deps: ['src/infra'], capped: false },
  { path: 'src/infra', deps: ['src/domain'], capped: false },
];
const cycleResult = await runGate({
  root: KIT,
  model: { modules: cyclicModules, fileCount: 2 },
  fileMetrics: [{ path: 'src/domain/x.js', lines: 10 }],
  baseline: { cycles: [], forbiddenEdges: [], stateAuthorities: [] },
  readChangedFiles: changedAll(['src/domain', 'src/infra']),
  config: { layerRules: { layers: { domain: ['src/domain'], infra: ['src/infra'] }, forbidden: [['domain', 'infra']] } },
});
cycleResult.outcome === GateOutcome.BLOCKED
  ? ok('new cycle → BLOCKED')
  : bad('expected BLOCKED got ' + cycleResult.outcome);
isApproval(cycleResult.outcome) === false ? ok('BLOCKED is not an approval') : bad('BLOCKED counted as approval');
cycleResult.exitCode === 1 ? ok('BLOCKED → exitCode 1') : bad('expected exitCode 1 got ' + cycleResult.exitCode);
cycleResult.blocking.some((f) => f.ruleId === 'F1.forbidden-cycle')
  ? ok('F1.forbidden-cycle surfaced in blocking[]')
  : bad('F1 cycle not in blocking[]: ' + JSON.stringify(cycleResult.blocking.map((f) => f.ruleId)));

// --------------------------------------------------------------------------
// Fixture 2 — a cohesive LARGE file → PASS (line count never blocks, §34.1/§34.25).
// One module, one >500-line file, NO baseline/config → conformance SKIPPED.
// --------------------------------------------------------------------------
console.log('\n§34.1 / §34.25 — cohesive large file → PASS (line count never blocks)');
const bigFileResult = await runGate({
  root: KIT,
  model: { modules: [{ path: 'src/dto', deps: [], capped: false }], fileCount: 1 },
  fileMetrics: [{ path: 'src/dto/constants.js', lines: 540 }],
  baseline: null,
  readChangedFiles: changedAll(['src/dto/constants.js']),
});
isApproval(bigFileResult.outcome) ? ok('large cohesive file → approval outcome') : bad('large file non-approval: ' + bigFileResult.outcome);
bigFileResult.outcome === GateOutcome.PASS_WITH_OBSERVATION
  ? ok('large file → PASS_WITH_OBSERVATION (size advisory recorded, not blocking)')
  : bad('expected PASS_WITH_OBSERVATION got ' + bigFileResult.outcome);
bigFileResult.exitCode === 0 ? ok('large file → exitCode 0 (does not block)') : bad('large file blocked, exitCode ' + bigFileResult.exitCode);
bigFileResult.blocking.length === 0 ? ok('no blocking findings for a large file') : bad('large file produced blockers');
bigFileResult.advisory.some((f) => f.ruleId === 'arch-debt.line-count')
  ? ok('line-count signal present as advisory') : bad('line-count signal missing from advisory');

// --------------------------------------------------------------------------
// Fixture 3 — missing GRAPH evidence (baseline wired, graph stale) → REVIEW/UNKNOWN,
// never PASS (§34.22). Baseline present (conformance IS configured) but insights
// carry no `cycles` array → evaluateConformance fails closed to UNKNOWN.
// --------------------------------------------------------------------------
console.log('\n§34.22 — missing graph evidence (configured) → UNKNOWN/REVIEW, never PASS');
// Control: a CONFIGURED baseline + a clean (empty) computed graph + no forbidden
// edges → no violation, no missing evidence → a clean approval. Proves the §34.22
// branch is the STALE graph, not merely "conformance is enabled".
const staleGraphResult = await runGate({
  root: KIT,
  model: { modules: [{ path: 'src/a', deps: [] }], fileCount: 1 },
  fileMetrics: [{ path: 'src/a/x.js', lines: 10 }],
  baseline: { cycles: [], forbiddenEdges: [], stateAuthorities: [] }, // configured
  readChangedFiles: changedAll(['src/a/x.js']),
  config: { layerRules: { layers: {}, forbidden: [] } },
});
// §34.22 proper — baseline configured but the structural graph is MISSING (the
// injected insights carry no `cycles` array) → conformance fails closed to UNKNOWN.
const missingInsightsResult = await runGate({
  root: KIT,
  model: { modules: [{ path: 'src/a' }], fileCount: 1 },
  fileMetrics: [],
  baseline: { stateAuthorities: [] }, // configured, but no graph evidence wired
  readChangedFiles: changedAll(['src/a/x.js']),
  config: { layerRules: { layers: {}, forbidden: [] } },
  insights: {}, // no `cycles` array → graphMissing → UNKNOWN (never PASS)
});
isApproval(missingInsightsResult.outcome) === false
  ? ok('missing graph evidence → non-passing (' + missingInsightsResult.outcome + ')')
  : bad('missing graph evidence silently PASSed: ' + missingInsightsResult.outcome);
(missingInsightsResult.outcome === GateOutcome.UNKNOWN
  || missingInsightsResult.outcome === GateOutcome.REVIEW_REQUIRED)
  ? ok('missing graph evidence → UNKNOWN or REVIEW_REQUIRED')
  : bad('expected UNKNOWN/REVIEW_REQUIRED got ' + missingInsightsResult.outcome);
missingInsightsResult.exitCode === 1 ? ok('missing-evidence → exitCode 1 (non-passing)') : bad('missing-evidence exitCode ' + missingInsightsResult.exitCode);
// guard the staleGraphResult clean case (sanity: configured + clean graph passes)
isApproval(staleGraphResult.outcome) ? ok('configured + clean empty graph → approval (control)') : bad('control case non-approval: ' + staleGraphResult.outcome);

// --------------------------------------------------------------------------
// Fixture 4 — the engine runs on the REAL repo tree end-to-end → passing outcome.
// --------------------------------------------------------------------------
console.log('\nreal-tree end-to-end → passing outcome (composes without crashing)');
let realResult;
try {
  realResult = await runGate({ root: KIT, readChangedFiles: noChange });
  ok('runGate(real tree) completed without throwing');
} catch (err) {
  bad('runGate(real tree) threw: ' + (err && err.message || err));
}
if (realResult) {
  isApproval(realResult.outcome)
    ? ok('real tree → passing outcome (' + realResult.outcome + ')')
    : bad('real tree non-passing: ' + realResult.outcome);
  (realResult.outcome === GateOutcome.PASS || realResult.outcome === GateOutcome.PASS_WITH_OBSERVATION)
    ? ok('real tree → PASS or PASS_WITH_OBSERVATION')
    : bad('real tree unexpected outcome: ' + realResult.outcome);
  realResult.exitCode === 0 ? ok('real tree → exitCode 0') : bad('real tree exitCode ' + realResult.exitCode);
  typeof realResult.report === 'string' && realResult.report.length > 0 ? ok('real tree produced a report') : bad('no report rendered');
  typeof realResult.board === 'string' && realResult.board.includes('Tech Debt Board') ? ok('real tree produced a render-only board') : bad('no board rendered');
  realResult.store && Array.isArray(realResult.store.findings) ? ok('real tree produced a findings store') : bad('no findings store');
}

// --------------------------------------------------------------------------
// Defensive: runGate with no opts must not crash (defaults to cwd).
// --------------------------------------------------------------------------
console.log('\ndefensive — runGate handles minimal opts');
let injectedThrew = false;
try {
  const r = await runGate({ root: KIT, model: { modules: [], fileCount: 0 }, fileMetrics: [], readChangedFiles: noChange });
  r && typeof r.outcome === 'string' ? ok('empty model → defined outcome (' + r.outcome + ')') : bad('empty model produced no outcome');
} catch (err) {
  injectedThrew = true;
  bad('empty model threw: ' + (err && err.message || err));
}
if (!injectedThrew) ok('runGate is defensive on an empty model');

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
