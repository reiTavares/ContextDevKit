#!/usr/bin/env node
/**
 * Agent-friendly test reporter (TEA-003, SPEC §6).
 *
 * WHY: the built-in compact fallback in run-suites.mjs prints one line per
 * suite live but has no failure-first summary, no fingerprint grouping, and no
 * log file for failing output. This module is the optional reporter seam: when
 * present, run-suites.mjs calls `renderRun(records, ctx)` instead of its
 * built-in printer and its per-run console.log footer.
 *
 * CONTRACT (must match run-suites.mjs exactly):
 *   import('./test-report.mjs').then(mod => mod.renderRun(records, ctx))
 *   records — Array<{id, tier, ms, exitCode, logBytes, stdout, stderr}>
 *   ctx     — { mode: string, runsDir: string, exitCode: number }
 *
 * BEHAVIOR:
 *   - COMPACT summary: one line per suite (✓ / ✗), failures grouped first.
 *   - FAILURE-FIRST: failed suites + their fingerprint appear at the TOP of
 *     the printed summary so an agent reads actionable signal immediately.
 *   - Log files: full stdout+stderr of every FAILING suite is written to
 *     `<runsDir>/<id>.log`. Never written on success — keeps runs/ lean.
 *   - Return value: the rendered summary string (run-suites.mjs may also print
 *     it; this module does its own console output and also returns it).
 *   - Exit code ownership: run-suites.mjs calls process.exit; we never do.
 *
 * Zero runtime deps; node:* only. Windows-safe forward-slash paths.
 *
 * @module test-report
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── fingerprint helpers ──────────────────────────────────────────────────────

/**
 * Derive a short, normalized fingerprint from a failing suite's captured output.
 * The fingerprint is the first non-blank line from stderr (where test harnesses
 * write assertion errors), falling back to stdout, falling back to a generic
 * tag. This lets the summary group identical root causes.
 * @param {string} stdout - captured child stdout.
 * @param {string} stderr - captured child stderr.
 * @returns {string} A one-line fingerprint (≤120 chars, normalized whitespace).
 */
function deriveFingerprint(stdout, stderr) {
  const candidates = [stderr, stdout]
    .join('\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!candidates.length) return '(no output captured)';
  const fingerprint = candidates[0].slice(0, 120);
  return fingerprint;
}

// ── log file ──────────────────────────────────────────────────────────────────

/**
 * Write the full stdout+stderr of a failing suite to `<runsDir>/<id>.log`.
 * Best-effort: an I/O error here never crashes the reporter (defensive I/O,
 * immutable rule 2). Returns the absolute log path on success, null on error.
 * @param {string} runsDir - absolute path to the runs/ directory.
 * @param {string} id - suite id (used as filename base).
 * @param {string} stdout - captured child stdout.
 * @param {string} stderr - captured child stderr.
 * @returns {string|null} Absolute log path, or null if the write failed.
 */
function writeFailureLog(runsDir, id, stdout, stderr) {
  try {
    mkdirSync(runsDir, { recursive: true });
    const logPath = join(runsDir, `${id}.log`);
    const content = [
      `=== ${id} stdout ===\n`,
      stdout || '(empty)\n',
      `\n=== ${id} stderr ===\n`,
      stderr || '(empty)\n',
    ].join('');
    writeFileSync(logPath, content, 'utf-8');
    return logPath;
  } catch {
    return null;
  }
}

// ── formatters ───────────────────────────────────────────────────────────────

/**
 * Format elapsed milliseconds as a human-readable string (e.g. "1.2s").
 * @param {number} ms
 * @returns {string}
 */
function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format bytes as a human-readable size string.
 * @param {number} bytes
 * @returns {string}
 */
function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

// ── renderer ─────────────────────────────────────────────────────────────────

/**
 * Render a full test run as a compact, agent-friendly summary. Called by
 * run-suites.mjs after all selected suites have executed. Prints to
 * stdout/stderr and returns the rendered summary string.
 *
 * FAILURE-FIRST: when any suite failed, the block of failures (with
 * fingerprints, log paths, and fingerprint grouping) is printed BEFORE the
 * full per-suite list so an agent reading top-to-bottom sees the actionable
 * signal immediately without scrolling past all passing suites.
 *
 * @param {Array<{id:string,tier:string,ms:number,exitCode:number,logBytes:number,stdout:string,stderr:string}>} records
 * @param {{mode:string, runsDir:string, exitCode:number}} ctx
 * @returns {string} The rendered summary text.
 */
export function renderRun(records, ctx) {
  const { runsDir, exitCode } = ctx;
  const lines = [];

  const passed = records.filter((r) => r.exitCode === 0);
  const failed = records.filter((r) => r.exitCode !== 0);
  const totalMs = records.reduce((sum, r) => sum + r.ms, 0);

  // ── FAILURE-FIRST block ────────────────────────────────────────────────────
  if (failed.length > 0) {
    lines.push('');
    lines.push(`FAILURES (${failed.length}):`);

    // Group by fingerprint (identical root causes merged).
    /** @type {Map<string, Array<{id:string,tier:string,ms:number,exitCode:number,stdout:string,stderr:string}>>} */
    const byFingerprint = new Map();
    for (const record of failed) {
      const fp = deriveFingerprint(record.stdout, record.stderr);
      const group = byFingerprint.get(fp) ?? [];
      group.push(record);
      byFingerprint.set(fp, group);
    }

    for (const [fingerprint, group] of byFingerprint) {
      const ids = group.map((r) => r.id).join(', ');
      lines.push(`  fingerprint: ${fingerprint}`);
      lines.push(`    suites   : ${ids}`);
      // Write per-suite log files and reference their paths.
      for (const record of group) {
        const logPath = writeFailureLog(runsDir, record.id, record.stdout, record.stderr);
        const logRef = logPath
          ? `-> ${logPath.replaceAll('\\', '/')}`
          : '(log write failed)';
        lines.push(`    ✗ ${record.id} [${record.tier}] ${fmtMs(record.ms)} (exit ${record.exitCode}) ${logRef}`);
      }
      lines.push('');
    }
  }

  // ── per-suite compact list ─────────────────────────────────────────────────
  lines.push('');
  lines.push(`Test run — mode: ${ctx.mode}`);
  for (const record of records) {
    if (record.exitCode === 0) {
      lines.push(`  ✓ ${record.id} [${record.tier}] ${fmtMs(record.ms)} (${fmtBytes(record.logBytes)})`);
    } else {
      const logPath = join(runsDir, `${record.id}.log`).replaceAll('\\', '/');
      lines.push(`  ✗ ${record.id} [${record.tier}] ${fmtMs(record.ms)} (exit ${record.exitCode}) -> ${logPath}`);
    }
  }

  // ── summary footer ─────────────────────────────────────────────────────────
  lines.push('');
  if (exitCode === 0) {
    lines.push(`✓ ${passed.length} suite(s) passed (${fmtMs(totalMs)})`);
  } else {
    lines.push(`✗ ${failed.length} suite(s) failed, ${passed.length} passed (${fmtMs(totalMs)})`);
    lines.push('  Full logs in runs/ — see paths above.');
  }
  lines.push('');

  const summary = lines.join('\n');

  // Print: failures → stderr so they stand out; overall summary → stdout.
  if (failed.length > 0) {
    process.stderr.write(summary.slice(0, summary.indexOf('\nTest run')) + '\n');
    process.stdout.write(summary.slice(summary.indexOf('\nTest run')));
  } else {
    process.stdout.write(summary);
  }

  return summary;
}
