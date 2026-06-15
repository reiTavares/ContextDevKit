#!/usr/bin/env node
/**
 * Test-suite runner (TEA-002, SPEC §3) — a thin orchestration layer over the
 * UNCHANGED suite files listed in `tools/test-suites.mjs`.
 *
 * WHY: extracts the 41-suite execution out of the brittle `package.json` `&&`
 * chain into one place so subsets are runnable and the list can't silently
 * drift. `npm test` === `node tools/run-suites.mjs --tier all` and MUST stay
 * behavior-identical: serial, fail-fast on first non-zero, exit with the first
 * failing suite's code (0 if all pass).
 *
 * Flags:
 *   --tier <name|all>   run a tier (default `all` when nothing else is given).
 *   --list <a,b,c>      run an explicit comma-separated set of suite ids.
 *   --legacy            run the literal old chain order (rollback parity path).
 *   --verbose           inherit child stdio (stream full output live).
 *   --impact            select suites from a changed-file diff via the optional
 *                       `tools/test-impact.mjs` selector (Wave 2); graceful
 *                       fallback to `--tier all` when absent.
 *
 * SEAMS for later waves (we provide the optional hooks, not the impls):
 *   - Reporter seam: a present `tools/test-report.mjs` exporting `renderRun`
 *     takes over output; otherwise a built-in compact printer runs.
 *   - Selector seam: a present `tools/test-impact.mjs` exporting `selectSuites`
 *     drives `--impact`; otherwise we print a clear "not installed" notice.
 *
 * Zero runtime deps; `node:*` only. Windows-safe: array-arg spawnSync, no shell
 * string interpolation, forward-slash paths, tolerant of a path with a space.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSuites, suitesForTier } from './test-suites.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNS_DIR = join(KIT, 'runs');

/**
 * Parse argv into a normalized options object. Unknown flags are ignored
 * (forward-compatible). Last-wins for repeated value flags.
 * @param {string[]} argv - process.argv.slice(2).
 * @returns {{tier:string|null,list:string[]|null,legacy:boolean,verbose:boolean,impact:boolean}}
 */
function parseArgs(argv) {
  const opts = { tier: null, list: null, legacy: false, verbose: false, impact: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tier') opts.tier = argv[++i] ?? 'all';
    else if (arg === '--list') opts.list = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--legacy') opts.legacy = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--impact') opts.impact = true;
  }
  return opts;
}

/**
 * Resolve the ordered suite set to execute from the parsed options. Precedence:
 * --legacy → full list in legacy order; --list → that id set (order preserved
 * from the canonical list); --tier <name> → that tier; default → all.
 * @param {ReturnType<typeof parseArgs>} opts
 * @returns {Array<{id:string,file:string,tier:string,touches:string[]}>}
 * @throws {Error} if --list names an unknown suite id (fail-fast).
 */
function resolveSuites(opts) {
  if (opts.legacy) return [...allSuites()];
  if (opts.list) {
    const byId = new Map(allSuites().map((suite) => [suite.id, suite]));
    const unknown = opts.list.filter((id) => !byId.has(id));
    if (unknown.length) throw new Error(`unknown suite id(s): ${unknown.join(', ')}`);
    // Preserve canonical order, restricted to the requested ids.
    return allSuites().filter((suite) => opts.list.includes(suite.id));
  }
  const tier = opts.tier ?? 'all';
  if (tier === 'all') return [...allSuites()];
  return suitesForTier(tier);
}

/**
 * Run one suite as a child Node process. Captures stdout/stderr unless verbose
 * (then it inherits live). Never throws — a spawn failure becomes a non-zero
 * synthetic exit so fail-fast still triggers.
 * @param {{id:string,file:string}} suite
 * @param {boolean} verbose
 * @returns {{id:string,tier?:string,ms:number,exitCode:number,logBytes:number,stdout:string,stderr:string}}
 */
function runSuite(suite, verbose) {
  const started = Date.now();
  const child = spawnSync(process.execPath, [resolve(KIT, suite.file)], {
    cwd: KIT,
    encoding: 'utf-8',
    stdio: verbose ? 'inherit' : 'pipe',
  });
  const ms = Date.now() - started;
  const stdout = child.stdout || '';
  const stderr = child.stderr || '';
  // spawnSync sets status=null on a spawn error; treat that as failure (code 1).
  const exitCode = child.status === null ? 1 : child.status;
  const logBytes = Buffer.byteLength(stdout, 'utf-8') + Buffer.byteLength(stderr, 'utf-8');
  return { id: suite.id, tier: suite.tier, ms, exitCode, logBytes, stdout, stderr };
}

/**
 * Built-in compact fallback printer (one line per suite). Used only when the
 * optional `tools/test-report.mjs` reporter is absent. On failure it echoes the
 * captured child output so the diagnosis is never hidden.
 * @param {{id:string,ms:number,exitCode:number,stdout:string,stderr:string}} record
 * @param {boolean} verbose - when true the child already streamed; skip echo.
 * @returns {void}
 */
function printCompact(record, verbose) {
  const secs = (record.ms / 1000).toFixed(1);
  if (record.exitCode === 0) {
    console.log(`  ✓ ${record.id} ${secs}s`);
    return;
  }
  console.error(`  ✗ ${record.id} ${secs}s (exit ${record.exitCode})`);
  if (!verbose) {
    if (record.stdout) process.stdout.write(record.stdout);
    if (record.stderr) process.stderr.write(record.stderr);
  }
}

/**
 * Try to load the optional reporter seam. Wave 2 adds `tools/test-report.mjs`
 * WITHOUT editing this runner. We expect an exported `renderRun(records, ctx)`.
 * @returns {Promise<{renderRun:Function}|null>}
 */
async function loadReporter() {
  try {
    const mod = await import('./test-report.mjs');
    return typeof mod.renderRun === 'function' ? mod : null;
  } catch {
    return null; // absent or broken → built-in compact printer.
  }
}

/**
 * Resolve the suite set for --impact via the optional selector seam. Wave 2 adds
 * `tools/test-impact.mjs` exporting `selectSuites({ changed, suites })`. When the
 * module is absent we print a clear notice and fall back to the full list — never
 * crash, never silently run nothing (fail-safe, SPEC §4).
 * @returns {Promise<Array<{id:string,file:string,tier:string,touches:string[]}>>}
 */
async function resolveImpactSuites() {
  let selector = null;
  try {
    const mod = await import('./test-impact.mjs');
    if (typeof mod.selectSuites === 'function') selector = mod;
  } catch {
    selector = null;
  }
  if (!selector) {
    console.log('impact selector not installed yet (tools/test-impact.mjs absent) — running --tier all.');
    return [...allSuites()];
  }
  const changed = changedFiles();
  const selected = selector.selectSuites({ changed, suites: allSuites() });
  return Array.isArray(selected) && selected.length ? selected : [...allSuites()];
}

/**
 * Best-effort changed-file list (vs the merge-base) for the selector. Never
 * throws; an empty/failed diff yields [] so the selector applies its fail-safe.
 * @returns {string[]}
 */
function changedFiles() {
  const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: KIT, encoding: 'utf-8' });
  if (diff.status !== 0 || !diff.stdout) return [];
  return diff.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Persist run instrumentation (TEA-001) — metadata only, gitignored. Writes the
 * per-suite metrics + a run summary to `runs/last-run.json`. Best-effort: an I/O
 * error here never breaks the run (defensive, immutable rule 2).
 * @param {Array<{id:string,tier:string,ms:number,exitCode:number,logBytes:number}>} records
 * @param {{mode:string,exitCode:number,totalMs:number}} summary
 * @returns {void}
 */
function persistRun(records, summary) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    const payload = {
      startedAt: new Date(Date.now() - summary.totalMs).toISOString(),
      finishedAt: new Date().toISOString(),
      mode: summary.mode,
      exitCode: summary.exitCode,
      totalMs: summary.totalMs,
      suiteCount: records.length,
      suites: records.map((r) => ({ id: r.id, tier: r.tier, ms: r.ms, exitCode: r.exitCode, logBytes: r.logBytes })),
    };
    writeFileSync(join(RUNS_DIR, 'last-run.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  } catch {
    /* observability is best-effort; never fail the run on a metadata write. */
  }
}

/**
 * Entry point. Resolves the suite set, runs serially with fail-fast, persists
 * instrumentation, and exits with the first failing suite's code (0 if green).
 * @returns {Promise<void>}
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let mode = opts.legacy ? 'legacy' : opts.list ? 'list' : opts.impact ? 'impact' : `tier:${opts.tier ?? 'all'}`;
  const suites = opts.impact ? await resolveImpactSuites() : resolveSuites(opts);
  const reporter = await loadReporter();
  const records = [];
  const runStarted = Date.now();
  let exitCode = 0;

  for (const suite of suites) {
    const record = runSuite(suite, opts.verbose);
    records.push(record);
    if (!reporter) printCompact(record, opts.verbose);
    if (record.exitCode !== 0) {
      exitCode = record.exitCode; // fail-fast: stop at the first non-zero.
      break;
    }
  }

  const totalMs = Date.now() - runStarted;
  if (reporter) reporter.renderRun(records, { mode, runsDir: RUNS_DIR, exitCode });
  else console.log(exitCode === 0 ? `\n✅ ${records.length} suite(s) passed (${(totalMs / 1000).toFixed(1)}s).\n`
    : `\n❌ suite "${records[records.length - 1]?.id}" failed (exit ${exitCode}).\n`);

  persistRun(records, { mode, exitCode, totalMs });
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('run-suites crashed:', err?.message ?? err);
  process.exit(1);
});
