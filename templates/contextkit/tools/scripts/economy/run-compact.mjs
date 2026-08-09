#!/usr/bin/env node
/**
 * run-compact.mjs — ECON-04: compact command runner + delta logs.
 *
 * Lib exports: `runCompact`, `fingerprintRun`, `failureIdentity`, `deltaRuns`.
 * CLI: `node run-compact.mjs <cmd...> [--kind test|lint|build]`
 *
 * Responsibilities (this file):
 *   - Spawn a command via node:child_process (spawn, not exec — streaming stdout/stderr).
 *   - Tee full output to `runs/<id>/output.log`.
 *   - Write `runs/<id>/summary.json` (compact metadata).
 *   - Ring-prune to ~20 newest run dirs.
 *   - Redact secrets at write time.
 *
 * Pure helpers (fingerprint / delta) live in run-compact-core.mjs to keep
 * this file under the 308-line budget (constitution §1 +10% tolerance).
 *
 * Advisory / fail-open: every I/O error is swallowed; if we cannot persist a
 * run artifact the spawn result is still returned. Exit code is the ONLY
 * source of pass/fail — never suppressed, never fabricated.
 *
 * Zero runtime dependencies — node:* only.
 */

import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { logSavingSync } from './economy-savings.mjs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  fingerprintRun,
  failureIdentity,
  deltaRuns,
  matchSummary,
} from './run-compact-core.mjs';
import { makeRunId, resolveRunsDir, pruneRuns, detectKind } from './run-compact-io.mjs';
// W7 (ADR-0117): persist through the hardened 12-class redactor, not the weak
// single-regex in run-compact-core, so EVERY persisted byte is masked.
import { redactSecrets } from './redact.mjs';

// Re-export pure helpers so callers can import everything from one place.
export { fingerprintRun, failureIdentity, deltaRuns };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_KINDS = new Set(['test', 'lint', 'build', 'auto']);

// ---------------------------------------------------------------------------
// Core: runCompact
// ---------------------------------------------------------------------------

/**
 * Spawns `cmd` (a string or string[]), captures stdout + stderr, writes run
 * artifacts, and returns a compact summary.
 *
 * Exit code is the ONLY source of pass/fail. The tier-2 summary matcher is
 * best-effort; if nothing matches, `summary.matched` is false and
 * `summary.note` is `'summary unavailable'` — we NEVER fabricate "0 failures".
 *
 * @param {string | string[]} cmd - Command to run (string → shell-split on spaces; string[] used as-is).
 * @param {{ kind?: 'auto'|'test'|'lint'|'build', runsDir?: string, root?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ id: string, exitCode: number, summary: object, logPath: string }>}
 */
export async function runCompact(cmd, opts = {}) {
  // captureFull (W7): default summary-only-on-disk. The full raw output tee is
  // written ONLY behind an explicit opt-in — raw test/build logs are the most
  // likely place a secret or token leaks onto disk.
  const { kind: kindOpt = 'auto', runsDir: runsDirOpt, root, env, captureFull = false } = opts;
  const cmdParts = Array.isArray(cmd) ? cmd : String(cmd).trim().split(/\s+/);
  if (cmdParts.length === 0) throw new TypeError('runCompact: cmd must be a non-empty string or array');

  const kind = VALID_KINDS.has(kindOpt) ? kindOpt : 'auto';
  const resolvedKind = kind === 'auto' ? detectKind(cmdParts) : kind;
  const runsDir = runsDirOpt ?? resolveRunsDir(root);
  const id = makeRunId();
  const runDir = resolve(runsDir, id);
  const logPath = resolve(runDir, 'output.log');
  const summaryPath = resolve(runDir, 'summary.json');

  // Ensure run dir exists (best-effort).
  try { mkdirSync(runDir, { recursive: true }); } catch { /* advisory */ }

  // Open the full-output log stream ONLY when explicitly opted in (W7). Default
  // is summary-only: the raw output stays in-memory for the fingerprint/summary
  // and is never persisted.
  let logStream = null;
  if (captureFull) {
    try { logStream = createWriteStream(logPath, { encoding: 'utf-8' }); } catch { /* advisory */ }
  }

  const chunks = [];

  const exitCode = await new Promise((resolve_) => {
    let child;
    try {
      child = spawn(cmdParts[0], cmdParts.slice(1), {
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      // spawn itself can throw on ENOENT etc. — treat as exit 127.
      if (logStream) try { logStream.end(`spawn error: ${err?.message ?? err}\n`); } catch { /* skip */ }
      chunks.push(`spawn error: ${err?.message ?? err}\n`);
      resolve_(127);
      return;
    }

    const onData = (chunk) => {
      chunks.push(chunk.toString('utf-8'));
      if (logStream) try { logStream.write(redactSecrets(chunk.toString('utf-8'))); } catch { /* skip */ }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      chunks.push(`process error: ${err?.message ?? err}\n`);
    });
    child.on('close', (code) => {
      if (logStream) try { logStream.end(); } catch { /* skip */ }
      resolve_(code ?? 1);
    });
  });

  const rawOutput = chunks.join('');
  const fp = fingerprintRun(rawOutput);
  const failures = failureIdentity(rawOutput);
  const matchResult = matchSummary(rawOutput);

  const summary = {
    id,
    kind: resolvedKind,
    cmd: cmdParts.join(' '),
    exitCode,
    pass: exitCode === 0,
    fingerprint: fp,
    failures,
    matched: matchResult.matched,
    ...(matchResult.matched
      ? { passed: matchResult.passed, failed: matchResult.failed, skipped: matchResult.skipped }
      : { note: matchResult.note ?? 'summary unavailable' }),
    ts: Date.now(),
  };

  // Write summary (best-effort + redact).
  const summaryJson = JSON.stringify(summary, null, 2);
  try { writeFileSync(summaryPath, redactSecrets(summaryJson), 'utf-8'); } catch { /* advisory */ }

  // Observed economy (best-effort): the full output went to disk; only the compact
  // summary entered context. savedTokens ≈ (full − compact) / 4. Not a causal claim.
  logSavingSync(root, { lever: 'run-compact', savedTokens: Math.max(0, Math.round((rawOutput.length - summaryJson.length) / 4)), kind: resolvedKind }, { now: Date.now() });

  // Ring-prune.
  pruneRuns(runsDir);

  // logPath is null when summary-only (W7): callers must not point at a file we
  // deliberately did not write.
  return { id, exitCode, summary, logPath: captureFull ? logPath : null, summaryPath };
}

// ---------------------------------------------------------------------------
// CI check export (used by the selfcheck harness)
// ---------------------------------------------------------------------------

/**
 * CI assertion suite for ECON-04.
 * Spawns real `node -e` child processes to verify runtime contracts:
 *   1. Exit-code truth: 0 vs 1 surfaced verbatim.
 *   2. No-matcher output → summary.note === 'summary unavailable'.
 *   3. deltaRuns reports changed:false for identical outputs.
 *   4. deltaRuns reports changed:true + newFailures entry when a failure identity appears.
 *
 * @param {string} root - Repo or project root used to resolve runsDir.
 * @returns {Promise<{ name: string, pass: boolean, detail: string }[]>}
 */
export async function econCheckRunCompact(root) {
  const results = [];
  const push = (name, pass, detail) => results.push({ name, pass, detail });
  const runsDir = resolveRunsDir(root);

  // 1. Exit-code 0 is surfaced correctly.
  try {
    const r0 = await runCompact(['node', '-e', 'process.exit(0)'], { runsDir });
    push(
      'econ04:exitCode-zero',
      r0.exitCode === 0 && r0.summary.pass === true,
      `exitCode=${r0.exitCode} pass=${r0.summary.pass}`,
    );
  } catch (err) {
    push('econ04:exitCode-zero', false, `threw: ${err?.message ?? err}`);
  }

  // 2. Exit-code 1 is NOT suppressed.
  try {
    const r1 = await runCompact(['node', '-e', 'process.exit(1)'], { runsDir });
    push(
      'econ04:exitCode-one',
      r1.exitCode === 1 && r1.summary.pass === false,
      `exitCode=${r1.exitCode} pass=${r1.summary.pass}`,
    );
  } catch (err) {
    push('econ04:exitCode-one', false, `threw: ${err?.message ?? err}`);
  }

  // 3. No-matcher output → summary.note === 'summary unavailable'.
  try {
    const rNm = await runCompact(
      ['node', '-e', 'console.log("hello world, no test runner here")'],
      { runsDir },
    );
    push(
      'econ04:no-matcher-note',
      rNm.summary.matched === false && rNm.summary.note === 'summary unavailable',
      `matched=${rNm.summary.matched} note=${rNm.summary.note}`,
    );
  } catch (err) {
    push('econ04:no-matcher-note', false, `threw: ${err?.message ?? err}`);
  }

  // 4. deltaRuns: identical fingerprints → changed:false.
  const fp1 = fingerprintRun('hello');
  const d1 = deltaRuns({ fingerprint: fp1, failures: [] }, { fingerprint: fp1, failures: [] });
  push(
    'econ04:delta-unchanged',
    d1.changed === false && d1.newFailures.length === 0 && d1.fixed.length === 0,
    `changed=${d1.changed} newFailures=${d1.newFailures.length} fixed=${d1.fixed.length}`,
  );

  // 5. deltaRuns: new failure identity surfaced.
  const fp2 = fingerprintRun('world');
  const d2 = deltaRuns(
    { fingerprint: fp1, failures: [] },
    { fingerprint: fp2, failures: ['SuiteA > testB'] },
  );
  push(
    'econ04:delta-new-failure',
    d2.changed === true && d2.newFailures.includes('SuiteA > testB'),
    `changed=${d2.changed} newFailures=${JSON.stringify(d2.newFailures)}`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node run-compact.mjs <cmd...> [--kind test|lint|build]');
    process.exit(1);
  }

  // Extract flags.
  const cmdArgs = [...args];
  const captureFull = (() => {
    const i = cmdArgs.indexOf('--capture-full');
    if (i === -1) return false;
    cmdArgs.splice(i, 1);
    return true;
  })();
  const kindIdx = cmdArgs.indexOf('--kind');
  let kind = 'auto';
  if (kindIdx !== -1 && kindIdx + 1 < cmdArgs.length) {
    kind = cmdArgs[kindIdx + 1];
    cmdArgs.splice(kindIdx, 2);
  }

  // ADR-0117: pass root so the line-144 logSavingSync actually records (a missing
  // root silently no-ops — the real reason run-compact stayed dormant when invoked).
  const { id, exitCode, summary, logPath } = await runCompact(cmdArgs, { kind, root: process.cwd(), captureFull });

  console.log(`\n--- run-compact summary (${id}) ---`);
  console.log(`cmd:      ${summary.cmd}`);
  console.log(`kind:     ${summary.kind}`);
  console.log(`exitCode: ${exitCode}  pass: ${summary.pass}`);
  if (summary.matched) {
    console.log(`tests:    passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped}`);
  } else {
    console.log(`summary:  ${summary.note}`);
  }
  if (summary.failures.length > 0) {
    console.log(`failures: ${summary.failures.join(', ')}`);
  }
  console.log(`log:      ${logPath ?? '(summary-only on disk; pass --capture-full to persist the raw output)'}`);

  process.exit(exitCode);
}

// Only run CLI when invoked directly.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
