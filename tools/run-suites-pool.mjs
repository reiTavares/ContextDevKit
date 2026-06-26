#!/usr/bin/env node
/**
 * Execution strategies for `run-suites.mjs` — shuffle/repeat (isolation proof,
 * TEA-001 gap) + bounded-concurrency pool (TEA-008, ADR-0114). Kept OUT of
 * run-suites.mjs so the DEFAULT serial fail-fast path stays byte-identical
 * (`npm test` unchanged) and both files stay under the line budget. Only the new
 * `--shuffle` / `--repeat N` / `--jobs N` modes reach this module.
 *
 * Isolation precondition (what makes parallelism safe): each integration suite
 * installs into a UNIQUE `mkdtemp` dir (it-helpers.mjs `installFixture`), so
 * concurrent suites never share install state on disk. The `--shuffle`/`--repeat`
 * proof exercises order-independence; `--jobs>1` then runs them concurrently.
 *
 * Zero runtime deps; node:* only. Windows-safe: array-arg `spawn`, no shell.
 *
 * @module run-suites-pool
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Fisher–Yates shuffle (non-mutating). Proves order-independence when paired
 * with a green run; `rng` is injectable for a deterministic test.
 * @template T
 * @param {readonly T[]} array
 * @param {() => number} [rng] - defaults to Math.random.
 * @returns {T[]} a new shuffled array.
 */
export function shuffle(array, rng = Math.random) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Run one suite as an ASYNC child process (parallel-safe). Mirrors the sync
 * `runSuite` record shape so the reporter/telemetry are unchanged. Never rejects
 * — a spawn error becomes a synthetic exit 1 so aggregation still sees it.
 * @param {{id:string,file:string,tier?:string}} suite
 * @param {string} KIT - repo root (cwd for the child).
 * @returns {Promise<{id:string,tier?:string,ms:number,exitCode:number,logBytes:number,stdout:string,stderr:string}>}
 */
export function runSuiteAsync(suite, KIT) {
  return new Promise((resolveP) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [resolve(KIT, suite.file)], { cwd: KIT });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const finish = (code) => resolveP({
      id: suite.id, tier: suite.tier, ms: Date.now() - started,
      exitCode: code === null ? 1 : code,
      logBytes: Buffer.byteLength(stdout, 'utf-8') + Buffer.byteLength(stderr, 'utf-8'),
      stdout, stderr,
    });
    child.on('close', finish);
    child.on('error', () => finish(1));
  });
}

/**
 * Bounded-concurrency pool: `jobs` lanes pull from a shared cursor over `items`.
 * Soft-cancel — once `shouldStop()` is true no NEW item starts (in-flight work
 * drains). Results are returned in INPUT order; `onResult` fires per completion.
 * @template T,R
 * @param {readonly T[]} items
 * @param {number} jobs - concurrency (≥1).
 * @param {(item:T,index:number)=>Promise<R>} worker
 * @param {(result:R,index:number)=>void} [onResult]
 * @param {()=>boolean} [shouldStop]
 * @returns {Promise<R[]>} completed results in input order (drops un-started).
 */
export async function runPool(items, jobs, worker, onResult, shouldStop = () => false) {
  const results = new Array(items.length);
  let cursor = 0;
  async function lane() {
    while (cursor < items.length) {
      if (shouldStop()) return;
      const index = cursor;
      cursor += 1;
      const result = await worker(items[index], index);
      results[index] = result;
      if (onResult) onResult(result, index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, () => lane()));
  return results.filter((value) => value !== undefined);
}

/**
 * Orchestrate a `--shuffle`/`--repeat`/`--jobs` run (kept here so run-suites.mjs'
 * default serial path stays small + byte-identical). Parallel mode aggregates ALL
 * results (soft-cancel: no new suite starts after a failure); repeat/shuffle keeps
 * fail-fast via the same `stopped` flag. EXPERIMENTAL: `--jobs>1` is measured
 * SLOWER on these I/O-bound suites (ADR-0114) — instrument only, never a default.
 * @param {{jobs:number,shuffle:boolean,repeat:number}} opts
 * @param {Array<object>} suites
 * @param {{KIT:string,RUNS_DIR:string,reporter:{renderRun:Function}|null,printCompact:Function,persistRun:Function,recordRun:Function,baseMode:string,selection:object|null}} deps
 * @returns {Promise<void>} exits the process with the aggregate code.
 */
export async function executeProbe(opts, suites, deps) {
  const { KIT, RUNS_DIR, reporter, printCompact, persistRun, recordRun, baseMode, selection } = deps;
  const jobs = Math.min(opts.jobs, Math.max(1, cpus().length - 2));
  if (jobs > 1) console.error('⚠️  --jobs is EXPERIMENTAL and measured SLOWER on I/O-bound suites (ADR-0114) — re-measurement only, not a speedup.');
  const records = [];
  const runStarted = Date.now();
  let exitCode = 0;
  let stopped = false;
  for (let iter = 1; iter <= opts.repeat && !stopped; iter += 1) {
    const order = opts.shuffle ? shuffle(suites) : suites;
    const onResult = (rec) => {
      records.push(opts.repeat > 1 ? { ...rec, iter } : rec);
      if (!reporter) printCompact(rec, false);
      if (rec.exitCode !== 0) { exitCode = rec.exitCode; stopped = true; }
    };
    await runPool(order, jobs, (suite) => runSuiteAsync(suite, KIT), onResult, () => stopped);
  }
  const totalMs = Date.now() - runStarted;
  const mode = `${baseMode}${opts.shuffle ? '+shuffle' : ''}${opts.repeat > 1 ? `+repeat${opts.repeat}` : ''}${jobs > 1 ? `+jobs${jobs}` : ''}`;
  if (reporter) reporter.renderRun(records, { mode, runsDir: RUNS_DIR, exitCode });
  else console.log(exitCode === 0
    ? `\n✅ ${records.length} suite-run(s) passed (${(totalMs / 1000).toFixed(1)}s, jobs=${jobs}${opts.shuffle ? ', shuffled' : ''}${opts.repeat > 1 ? `, ×${opts.repeat}` : ''}).\n`
    : `\n❌ ${records.filter((r) => r.exitCode !== 0).map((r) => r.id).join(', ')} failed (jobs=${jobs}).\n`);
  persistRun(records, { mode, exitCode, totalMs, selection });
  try { recordRun(JSON.parse(readFileSync(join(RUNS_DIR, 'last-run.json'), 'utf-8').replace(/^﻿/, ''))); } catch { /* telemetry best-effort */ }
  process.exit(exitCode);
}
