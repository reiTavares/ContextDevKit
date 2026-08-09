#!/usr/bin/env node
/**
 * decision-selftest-helpers.mjs — shared harness for decision.selftest.mjs.
 *
 * Exports:
 *  - assert / assertThrows  — minimal reporter primitives
 *  - makeProjectRoot        — hermetic tmp-dir factory
 *  - allFilesUnder          — recursive file enumerator
 *  - fileCount              — snapshot helper for dry-run checks
 *  - summaryAndExit         — prints pass/fail summary and exits
 *
 * Zero runtime dependencies (node:* only).
 */
import {
  mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, copyFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathsFor } from '../../runtime/config/paths.mjs';

// ---------------------------------------------------------------------------
// Minimal test reporter
// ---------------------------------------------------------------------------

let PASS = 0;
let FAIL = 0;
const failures = [];

/**
 * Asserts a condition, recording pass/fail.
 *
 * @param {string} label - test label.
 * @param {boolean} condition - true = pass.
 * @param {string} [hint] - optional extra context on failure.
 */
export function assert(label, condition, hint = '') {
  if (condition) {
    PASS += 1;
  } else {
    FAIL += 1;
    failures.push(hint ? `FAIL: ${label} — ${hint}` : `FAIL: ${label}`);
  }
}

/**
 * Asserts that `fn()` throws and the message contains `contains`.
 *
 * @param {string} label
 * @param {() => unknown} fn
 * @param {string} contains - expected substring in the error message.
 */
export function assertThrows(label, fn, contains = '') {
  try {
    fn();
    FAIL += 1;
    failures.push(`FAIL: ${label} — expected a throw but none occurred`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (contains && !msg.includes(contains)) {
      FAIL += 1;
      failures.push(`FAIL: ${label} — threw but message "${msg}" lacks "${contains}"`);
    } else {
      PASS += 1;
    }
  }
}

/**
 * Prints the pass/fail summary and exits the process.
 *
 * @param {string} suiteName - label printed in the summary line.
 */
export function summaryAndExit(suiteName) {
  const total = PASS + FAIL;
  process.stdout.write(`\n${suiteName}: ${PASS}/${total} passed\n`);
  if (FAIL > 0) {
    for (const msg of failures) process.stderr.write(`  ${msg}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Hermetic tmp-dir factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal project tree sufficient for decision.mjs to operate.
 * The caller is responsible for cleanup (rmSync root after use).
 *
 * @param {string} selfDir - dirname of the calling test file, used to locate
 *   the shipped _templates directory alongside the source repo.
 * @returns {string} absolute path to the hermetic project root.
 */
export function makeProjectRoot(selfDir) {
  const tmp = mkdtempSync(join(tmpdir(), 'decision-selftest-'));
  const paths = pathsFor(tmp);

  mkdirSync(paths.decisions, { recursive: true });
  mkdirSync(paths.decisionsBusiness ?? join(paths.decisions, 'business'), { recursive: true });
  mkdirSync(paths.decisionsOperations ?? join(paths.decisions, 'operations'), { recursive: true });
  mkdirSync(paths.decisionsLegacy ?? join(paths.decisions, 'legacy'), { recursive: true });

  // Seed the _templates dir from the shipped templates alongside this script.
  const srcTemplates = resolve(selfDir, '../../memory/decisions/_templates');
  const dstTemplates = join(paths.decisions, '_templates');
  if (existsSync(srcTemplates)) {
    mkdirSync(dstTemplates, { recursive: true });
    for (const entry of readdirSync(srcTemplates, { withFileTypes: true })) {
      if (entry.isFile()) {
        copyFileSync(join(srcTemplates, entry.name), join(dstTemplates, entry.name));
      }
    }
  }

  return tmp;
}

// ---------------------------------------------------------------------------
// File-system helpers
// ---------------------------------------------------------------------------

/**
 * Collects all file paths under a directory recursively.
 *
 * @param {string} dir - directory to scan.
 * @returns {string[]}
 */
export function allFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...allFilesUnder(abs));
    else result.push(abs);
  }
  return result;
}

/**
 * Returns the number of files under `root` at this moment.
 * Used to compare before/after a dry-run to confirm nothing was written.
 *
 * @param {string} root
 * @returns {number}
 */
export function fileCount(root) {
  return allFilesUnder(root).length;
}
