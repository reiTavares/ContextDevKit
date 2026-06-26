#!/usr/bin/env node
/**
 * Test-execution telemetry summary self-test (WF0025 task 301 / ADR-0093) —
 * STANDALONE entrypoint (exit 0/1).
 *
 * WHY: `computeRunSummary` is the pure core of the telemetry sink (TEA-006). The
 * selection metric (how much `--impact` narrowed the run) is the value task 301
 * adds — it must round-trip through the summary so the report can show the
 * inner-loop saving. A regression that drops `selection` would silently blind the
 * economy/autonomy report to the selector's effect. Pure, deterministic, zero-dep.
 */
import { computeRunSummary } from './test-telemetry-stats.mjs';

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

/** An impact run carries a selection metric; it must survive into the summary. */
function selectionPassthrough() {
  const run = {
    startedAt: '2026-06-25T00:00:00.000Z', mode: 'impact', totalMs: 1200, exitCode: 0,
    suiteCount: 9, selection: { selected: 9, total: 120 },
    suites: [{ id: 'selfcheck-request', tier: 'smoke', ms: 800, exitCode: 0 }],
  };
  const summary = computeRunSummary(run);
  summary.selection && summary.selection.selected === 9 && summary.selection.total === 120
    ? ok('impact run → selection {selected,total} survives into summary')
    : bad(`selection lost/mangled: ${JSON.stringify(summary.selection)}`);
  summary.passCount === 1 && summary.failCount === 0
    ? ok('pass/fail counts derived from suites')
    : bad(`pass/fail wrong: ${summary.passCount}/${summary.failCount}`);
}

/** A non-impact (full/tier) run has no narrowing → selection must be null, not absent. */
function nullForFullRun() {
  const summary = computeRunSummary({ mode: 'tier:all', totalMs: 90000, exitCode: 0, suiteCount: 120, suites: [] });
  summary.selection === null
    ? ok('full run → selection is explicitly null (no narrowing)')
    : bad(`expected null selection, got ${JSON.stringify(summary.selection)}`);
}

function main() {
  console.log('\n🌀 ContextDevKit TEA telemetry-summary self-test\n');
  selectionPassthrough();
  nullForFullRun();
  console.log(failures === 0 ? '\n✅ telemetry-summary self-test passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
