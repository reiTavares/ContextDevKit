#!/usr/bin/env node
/**
 * CDK-065 — Continuous per-completed-task benchmark recorder.
 *
 * Records cost/tokens for a completed task into an advisory append-only ledger,
 * and summarises the ledger. The primary metric is tokens (and, optionally, cost)
 * per correctly-completed task, tracked over time for post-release comparison.
 *
 * Ledger location: resolved relative to this file at installation time via
 * pathsFor(root).pipeline (the canonical pipeline state directory), as a sibling
 * file `benchmark-ledger.json`. The override env var `BENCHMARK_LEDGER_PATH` or
 * `opts.ledgerPath` is honoured so tests are hermetic (write to a temp dir only).
 *
 * Design decisions:
 * - Accept explicit `{ taskId, tokens, … }` input so the recorder is decoupled
 *   from token-report.mjs and independently testable (CDK-065 spec §1).
 * - Append-only JSON array ledger file — same directory as the pipeline state
 *   substrate (templates/contextkit/runtime/state/state-io.mjs uses
 *   pathsFor(root).pipeline). No in-process state; every call reads+writes.
 * - Fail-open: exit 0 on all errors; report "skipped" when required inputs absent.
 * - Zero runtime dependencies — node:* only, ESM.
 *
 * @module benchmark-task
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathsFor } from '../../runtime/config/paths.mjs';

// ---------------------------------------------------------------------------
// Path resolution — mirrors state-io.mjs (uses pathsFor(root).pipeline).
// We derive the project root at two hops up from this script's location inside
// templates/contextkit/tools/scripts/, then fall back to the installed layout
// where this file sits at <root>/contextkit/tools/scripts/.
// ---------------------------------------------------------------------------

/**
 * Resolve the default ledger path. Single-sources the platform directory via
 * pathsFor() (Rule 4) exactly like pipeline.mjs / project-map.mjs: the ledger is
 * a sibling of the pipeline state directory under the project root (process.cwd()).
 *
 * Precedence: env var / opts.ledgerPath (hermetic tests) → pathsFor(cwd).pipeline.
 *
 * @returns {string} absolute path to the benchmark ledger JSON file.
 */
function defaultLedgerPath() {
  if (process.env.BENCHMARK_LEDGER_PATH) {
    return process.env.BENCHMARK_LEDGER_PATH;
  }
  return resolve(pathsFor(process.cwd()).pipeline, 'benchmark-ledger.json');
}

// ---------------------------------------------------------------------------
// Ledger I/O — append-only, defensive read
// ---------------------------------------------------------------------------

/**
 * Reads the benchmark ledger from disk. Returns an empty array when the file is
 * absent or unparseable (fail-open — never corrupt a test run).
 *
 * @param {string} ledgerPath - absolute path to the ledger JSON file.
 * @returns {BenchmarkRecord[]} existing records, oldest first.
 */
function readLedger(ledgerPath) {
  try {
    const raw = readFileSync(ledgerPath, 'utf8').replace(/^﻿/, ''); // strip BOM (PS 5.1 trap)
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Writes the full ledger array atomically (write to tmp then rename is not
 * available in pure Node without a dep, so we write directly — acceptable for an
 * advisory ledger; corruption risk is low and the worst case is a skipped record).
 *
 * @param {string}            ledgerPath - absolute path to the ledger JSON file.
 * @param {BenchmarkRecord[]} records    - complete ledger to persist.
 */
function writeLedger(ledgerPath, records) {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(records, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BenchmarkInput
 * @property {string}  taskId    - stable task/card identifier (e.g. "CDK-065").
 * @property {number}  tokens    - total tokens consumed by the task.
 * @property {string}  [model]   - model alias (e.g. "sonnet", "haiku").
 * @property {number}  [cost]    - cost in USD, when available.
 * @property {boolean} completed - true when the task was correctly completed.
 */

/**
 * @typedef {Object} BenchmarkRecord
 * @property {string}  taskId    - stable task/card identifier.
 * @property {number}  tokens    - total tokens consumed.
 * @property {string}  [model]   - model alias.
 * @property {number}  [cost]    - cost in USD.
 * @property {boolean} completed - whether the task completed successfully.
 * @property {string}  ts        - ISO 8601 timestamp of the recording.
 */

/**
 * @typedef {Object} BenchmarkOpts
 * @property {string} [ledgerPath] - override ledger file path (for hermetic tests).
 */

/**
 * @typedef {Object} BenchmarkSummary
 * @property {number}         count                  - total records in the ledger.
 * @property {number}         completedCount         - records where completed === true.
 * @property {number}         totalTokens            - tokens across ALL records.
 * @property {number}         tokensPerCompletedTask - tokens(completed) / completedCount; 0 when none.
 * @property {number|undefined} totalCost            - sum of cost fields; undefined when no costs recorded.
 */

/**
 * Appends a benchmark record to the advisory ledger and returns the written record.
 *
 * Fail-open: if `taskId` is missing or `tokens` is not a finite number, the call
 * reports "skipped" to stderr and returns null — it never throws and never exits
 * non-zero (adhering to the hook contract even when called from a script context).
 *
 * @param {BenchmarkInput} input - task benchmark data.
 * @param {BenchmarkOpts}  [opts] - optional overrides (e.g. ledgerPath).
 * @returns {BenchmarkRecord|null} the written record, or null when skipped.
 */
export function recordTask(input, opts = {}) {
  const { taskId, tokens, model, cost, completed } = input ?? {};
  const ledgerPath = opts.ledgerPath ?? defaultLedgerPath();

  // Validate required fields — fail-open on bad input.
  if (!taskId || typeof taskId !== 'string') {
    console.error('[benchmark-task] skipped: taskId is required and must be a string.');
    return null;
  }
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) {
    console.error('[benchmark-task] skipped: tokens must be a non-negative finite number.');
    return null;
  }

  /** @type {BenchmarkRecord} */
  const record = {
    taskId,
    tokens,
    ...(model !== undefined && { model: String(model) }),
    ...(cost !== undefined && Number.isFinite(cost) && { cost }),
    completed: Boolean(completed),
    ts: new Date().toISOString(),
  };

  try {
    const existing = readLedger(ledgerPath);
    writeLedger(ledgerPath, [...existing, record]);
  } catch (writeErr) {
    console.error(`[benchmark-task] skipped ledger write: ${writeErr?.message ?? writeErr}`);
    return null;
  }

  return record;
}

/**
 * Summarises a set of benchmark records (or reads from the ledger when omitted).
 *
 * Only completed tasks count toward `tokensPerCompletedTask` — incomplete
 * recordings are still tracked in `count` and `totalTokens` for transparency,
 * but excluded from the per-completed-task metric to keep the benchmark honest.
 *
 * Never divides by zero: returns 0 for tokensPerCompletedTask when completedCount
 * is 0. Never returns NaN or Infinity.
 *
 * @param {BenchmarkRecord[]} [records] - optional records array; reads ledger when omitted.
 * @param {BenchmarkOpts}     [opts]    - optional overrides (e.g. ledgerPath).
 * @returns {BenchmarkSummary}
 */
export function summarize(records, opts = {}) {
  const ledgerPath = opts?.ledgerPath ?? defaultLedgerPath();
  const allRecords = Array.isArray(records) ? records : readLedger(ledgerPath);

  let completedCount = 0;
  let totalTokens = 0;
  let completedTokens = 0;
  let costAccum = 0;
  let hasCost = false;

  for (const rec of allRecords) {
    const tokensVal = typeof rec.tokens === 'number' && Number.isFinite(rec.tokens) ? rec.tokens : 0;
    totalTokens += tokensVal;
    if (rec.completed === true) {
      completedCount += 1;
      completedTokens += tokensVal;
    }
    if (typeof rec.cost === 'number' && Number.isFinite(rec.cost)) {
      costAccum += rec.cost;
      hasCost = true;
    }
  }

  return {
    count: allRecords.length,
    completedCount,
    totalTokens,
    // Guard: divide only when completedCount > 0 to prevent NaN/Infinity.
    tokensPerCompletedTask: completedCount > 0 ? completedTokens / completedCount : 0,
    ...(hasCost && { totalCost: costAccum }),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Parses raw process.argv into a structured command object.
 * @param {string[]} argv - raw CLI arguments (process.argv.slice(2)).
 * @returns {{ command: string, flags: Record<string, string|boolean> }}
 */
function parseArgs(argv) {
  const command = argv[0] ?? '';
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

/** Entry point when executed as a CLI script. */
async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const ledgerPath = flags['ledger-path']
    ? String(flags['ledger-path'])
    : (process.env.BENCHMARK_LEDGER_PATH ?? defaultLedgerPath());

  if (command === 'record') {
    const taskId  = flags['task'] ? String(flags['task']) : undefined;
    const tokens  = flags['tokens'] !== undefined ? Number(flags['tokens']) : undefined;
    const model   = flags['model'] ? String(flags['model']) : undefined;
    const cost    = flags['cost'] !== undefined ? Number(flags['cost']) : undefined;
    const completed = flags['completed'] === true || flags['completed'] === 'true';

    const rec = recordTask({ taskId, tokens, model, cost, completed }, { ledgerPath });
    if (rec) {
      console.log(`[benchmark-task] recorded: ${JSON.stringify(rec, null, 2)}`);
    }
    // Exit 0 regardless (fail-open contract).
    return;
  }

  if (command === 'summary') {
    const summary = summarize(undefined, { ledgerPath });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Unknown command — print usage and exit 0 (fail-open).
  console.log(
    'Usage:\n' +
    '  node benchmark-task.mjs record --task <id> --tokens <n> [--model m] [--cost c] [--completed]\n' +
    '  node benchmark-task.mjs summary\n' +
    '  BENCHMARK_LEDGER_PATH=<path>  (or --ledger-path <path>) overrides the ledger location.',
  );
}

// Run CLI only when executed directly (not imported as a module).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`[benchmark-task] unexpected error: ${err?.message ?? err}`);
    // Exit 0 — fail-open contract (hook-safe).
  });
}
