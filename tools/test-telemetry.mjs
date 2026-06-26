#!/usr/bin/env node
/**
 * Test-execution duration history — telemetry reader/reporter (TEA-006, SPEC §5).
 *
 * WHY: the new execution architecture (ADR-0093) must prove its autonomy and
 * economy impact via OBSERVED measurements, never via unsupported claims
 * (ADR-0080 honesty policy). This module:
 *   (a) appends a metadata-only run summary to `runs/history.jsonl` (the durable
 *       append-only log); called by run-suites.mjs via `recordRun()`.
 *   (b) reads `runs/history.jsonl` (and `runs/last-run.json` for the live run)
 *       and prints a labelled report when invoked as a CLI.
 *
 * Classification contract (ADR-0080):
 *   OBSERVED — a direct measurement from a real run (timing, exit codes, counts).
 *   DERIVED  — a value computed from OBSERVED measurements (percentiles, deltas).
 *   SKIPPED  — a check that could not run (missing data); never counted as PASS.
 *   Every printed number carries one of these tags.
 *
 * Reuse: follows the same section-by-section tabular style as
 *   templates/contextkit/tools/scripts/token-report.mjs (the economy sink);
 *   feeds the same autonomy/economy report audience (P10/P11).
 *
 * Zero runtime deps; node:* only. Windows-safe: forward-slash paths.
 *
 * Usage:
 *   node tools/test-telemetry.mjs           # print report
 *   node tools/test-telemetry.mjs --json    # machine-readable JSON
 *
 * @module test-telemetry
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_SAMPLES,
  aggregateSuiteStats,
  computeInnerLoopDelta,
  computeRunSummary,
} from './test-telemetry-stats.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNS_DIR = join(KIT, 'runs');
const HISTORY_FILE = join(RUNS_DIR, 'history.jsonl');
const LAST_RUN_FILE = join(RUNS_DIR, 'last-run.json');

// ── I/O helpers ───────────────────────────────────────────────────────────────

/**
 * Read and parse `runs/last-run.json`. Returns null when absent or malformed.
 * @returns {object|null}
 */
function readLastRun() {
  try {
    const raw = readFileSync(LAST_RUN_FILE, 'utf-8');
    // Strip BOM defensively.
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/**
 * Read all valid JSONL lines from `runs/history.jsonl`.
 * Malformed lines are skipped (defensive; the file is append-only so a bad
 * line from a past crash must not block current reads).
 * @returns {object[]}
 */
function readHistory() {
  if (!existsSync(HISTORY_FILE)) return [];
  let raw;
  try {
    raw = readFileSync(HISTORY_FILE, 'utf-8');
  } catch {
    return [];
  }
  const lines = raw.replace(/^﻿/, '').split('\n');
  const parsed = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      /* skip malformed line */
    }
  }
  return parsed;
}

// ── public API: recordRun ─────────────────────────────────────────────────────

/**
 * Append a metadata-only run summary to `runs/history.jsonl`.
 *
 * Called by run-suites.mjs AFTER `persistRun` writes `last-run.json`. The
 * history entry is intentionally smaller than `last-run.json` — no file
 * contents, no stdout/stderr, only the structural metadata needed for trend
 * analysis (SPEC §5). This keeps the file small and scannable even after
 * hundreds of runs.
 *
 * Fail-open: any I/O error is swallowed. The caller (run-suites.mjs) wraps
 * this in its own try/catch but we also guard here so a thrown error can
 * never surface to the runner even if the wrapper is removed later.
 *
 * @param {{startedAt:string,finishedAt:string,mode:string,exitCode:number,totalMs:number,suiteCount:number,suites:Array<{id:string,tier:string,ms:number,exitCode:number,logBytes:number}>}} runPayload
 * @returns {void}
 */
export function recordRun(runPayload) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    const summary = computeRunSummary(runPayload);
    /** History entry shape (metadata-only, SPEC §5). */
    const entry = {
      runId: summary.runId,
      mode: summary.mode,
      totalMs: summary.totalMs,          // OBSERVED
      exitCode: summary.exitCode,        // OBSERVED
      suiteCount: summary.suiteCount,    // OBSERVED
      passCount: summary.passCount,      // OBSERVED
      failCount: summary.failCount,      // OBSERVED
      firstFailMs: summary.firstFailMs,  // OBSERVED (null when all passed)
      timeToGreenMs: summary.timeToGreenMs, // OBSERVED (null when red)
      selection: summary.selection,      // OBSERVED (impact-run narrowing; null otherwise)
      // Per-suite slim entries — id/tier/ms/exitCode only (no log content).
      suites: (runPayload.suites ?? []).map((s) => ({
        id: s.id,
        tier: s.tier,
        ms: s.ms,        // OBSERVED
        exitCode: s.exitCode, // OBSERVED
      })),
    };
    appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    /* fail-open: telemetry must never break a test run. */
  }
}

// ── false-negative watch slot ─────────────────────────────────────────────────

/**
 * Placeholder for the false-negative watch analysis (SPEC §5, TEA-006 AC3).
 * When `ci:fast` was green for a diff that later showed `ci:full` red on the
 * same ref, that is a selector false negative. This function compares history
 * runs by mode and startedAt — the actual git-ref linking requires TEA-004
 * selector output (selection reasons) not yet present.
 *
 * @param {object[]} entries - history entries.
 * @returns {{status:'skipped'|'ok'|'warning', misses:number, message:string}}
 */
function analyzeFalseNegatives(entries) {
  const fastEntries = entries.filter((e) => e.mode === 'tier:smoke' || e.mode === 'impact');
  const fullEntries = entries.filter((e) => e.mode === 'tier:all');
  if (!fastEntries.length || !fullEntries.length) {
    return { status: 'skipped', misses: 0, message: 'Need both ci:fast and ci:full history samples (SKIPPED — not yet available).' };
  }
  // TEA-004 exists + impact runs record `selection` (task 301). True FN detection
  // still needs same-ref fast/full pairing (git-ref linking) — honest-SKIPPED.
  const withSelection = fastEntries.filter((e) => e.selection).length;
  return {
    status: 'skipped',
    misses: 0,
    message: `${fastEntries.length} fast run(s) (${withSelection} with selection data) + ${fullEntries.length} full run(s). Cross-ref FN correlation needs same-ref fast/full pairing (SKIPPED — requires git-ref linking, future work).`,
  };
}

// ── report printer ────────────────────────────────────────────────────────────

const fmtMs = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(2)}s`);
const tag = (cls) => `[${cls}]`;

/**
 * Print the full telemetry report to stdout. Each number is tagged OBSERVED,
 * DERIVED, or SKIPPED per ADR-0080. Never invents a value; missing data
 * reports "SKIPPED — not enough samples".
 * @param {object[]} history - parsed history.jsonl entries.
 * @param {object|null} lastRun - parsed last-run.json (may be null).
 * @returns {void}
 */
function printReport(history, lastRun) {
  const n = (x) => (x == null ? 'n/a' : x.toLocaleString('en-US'));

  console.log('\nContextDevKit — Test Execution Telemetry (TEA-006)');
  console.log(`History file : ${HISTORY_FILE.replaceAll('\\', '/')}`);
  console.log(`History lines: ${n(history.length)} ${tag('OBSERVED')}`);
  if (!history.length && !lastRun) {
    console.log('\nNo run history found. Run `npm run test:smoke` first.');
    return;
  }

  // ── Section 1: latest run ─────────────────────────────────────────────────
  console.log('\n--- Latest run (last-run.json) ---');
  if (!lastRun) {
    console.log('  (no last-run.json found)');
  } else {
    const s = computeRunSummary(lastRun);
    console.log(`  mode          : ${s.mode}`);
    console.log(`  total duration: ${fmtMs(s.totalMs)} ${tag('OBSERVED')}`);
    console.log(`  exit code     : ${s.exitCode} ${tag('OBSERVED')}`);
    console.log(`  suites run    : ${n(s.suiteCount)} ${tag('OBSERVED')}`);
    console.log(`  passed        : ${n(s.passCount)} ${tag('OBSERVED')}`);
    console.log(`  failed        : ${n(s.failCount)} ${tag('OBSERVED')}`);
    if (s.firstFailMs !== null) {
      console.log(`  time-to-first-failure: ${fmtMs(s.firstFailMs)} ${tag('OBSERVED')}`);
    }
    if (s.timeToGreenMs !== null) {
      console.log(`  time-to-green        : ${fmtMs(s.timeToGreenMs)} ${tag('OBSERVED')}`);
    }
    if (s.selection) console.log(`  selection     : ${n(s.selection.selected)}/${n(s.selection.total)} (${s.selection.total ? Math.round((s.selection.selected / s.selection.total) * 100) : 100}% of full) ${tag('OBSERVED — impact narrowing')}`);
  }

  // ── Section 2: per-suite p50/p95 ─────────────────────────────────────────
  console.log('\n--- Per-suite duration stats ---');
  // Flatten all per-suite entries from history into a single array.
  const allSuiteEntries = history.flatMap((run) => run.suites ?? []);
  const stats = aggregateSuiteStats(allSuiteEntries);

  if (!stats.size) {
    console.log(`  (SKIPPED — no suite entries in history yet)`);
  } else {
    const ENOUGH = [...stats.values()].filter((s) => s.sampleCount >= MIN_SAMPLES);
    if (!ENOUGH.length) {
      console.log(`  (SKIPPED — need >= ${MIN_SAMPLES} samples per suite for p50/p95; current max: ${Math.max(...[...stats.values()].map((s) => s.sampleCount))} run(s))`);
    } else {
      console.log(`  ${'Suite'.padEnd(32)} ${'n'.padStart(4)}  ${'p50'.padStart(7)}  ${'p95'.padStart(7)}  Pass  Fail  [DERIVED]`);
      for (const s of [...stats.values()].sort((a, b) => a.id.localeCompare(b.id))) {
        if (s.sampleCount < MIN_SAMPLES) continue;
        console.log(
          `  ${s.id.padEnd(32)} ${n(s.sampleCount).padStart(4)}  ${fmtMs(s.p50Ms).padStart(7)}  ${fmtMs(s.p95Ms).padStart(7)}  ${n(s.passCount).padStart(4)}  ${n(s.failCount).padStart(4)}`
        );
      }
      if (ENOUGH.length < stats.size) {
        const skipped = stats.size - ENOUGH.length;
        console.log(`  (${skipped} suite(s) with < ${MIN_SAMPLES} samples SKIPPED from p-stats table)`);
      }
    }
  }

  // ── Section 3: inner-loop vs full delta ───────────────────────────────────
  console.log('\n--- Inner-loop vs full delta ---');
  const delta = computeInnerLoopDelta(history);
  if (delta.smokeMs === null && delta.fullMs === null) {
    console.log(`  (SKIPPED — need >= ${MIN_SAMPLES} smoke runs AND >= ${MIN_SAMPLES} full runs)`);
  } else {
    if (delta.smokeMs !== null) console.log(`  smoke p50 : ${fmtMs(delta.smokeMs)} ${tag('OBSERVED via DERIVED percentile')}`);
    if (delta.fullMs !== null)  console.log(`  full  p50 : ${fmtMs(delta.fullMs)}  ${tag('OBSERVED via DERIVED percentile')}`);
    if (delta.savedMs !== null) console.log(`  delta     : ${fmtMs(delta.savedMs)} ${tag('DERIVED — full minus smoke; savings only if inner loop triggers first')}`);
  }

  // ── Section 4: false-negative watch ──────────────────────────────────────
  console.log('\n--- False-negative watch ---');
  const fnWatch = analyzeFalseNegatives(history);
  console.log(`  status: ${fnWatch.status.toUpperCase()}`);
  console.log(`  ${fnWatch.message}`);
  if (fnWatch.misses > 0) {
    console.log(`  ALERT: ${fnWatch.misses} selector miss(es) detected ${tag('OBSERVED')}`);
  }

  console.log('\nClassification key: OBSERVED = direct measurement. DERIVED = computed from measured. SKIPPED = check could not run (not counted as pass).\n');
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
// Guard: only run the report when this file is the direct entrypoint, not when
// imported as a module by run-suites.mjs (where only `recordRun` is needed).

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/') ===
  process.argv[1].replace(/\\/g, '/');

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--json')) {
    const history = readHistory();
    const lastRun = readLastRun();
    process.stdout.write(JSON.stringify({ history, lastRun }, null, 2) + '\n');
  } else {
    printReport(readHistory(), readLastRun());
  }
}
