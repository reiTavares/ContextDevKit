#!/usr/bin/env node
/**
 * selfcheck-mcp-004-helpers.mjs — Shared harness utilities for MCP-004 sub-suites.
 *
 * Exports: the test counter/reporter functions, temp-dir helpers, and the
 * lazy import of mcp-doctor-core + mcp-doctor so every sibling file gets the
 * same resolved module instances without duplicating the dynamic-import logic.
 *
 * NOT standalone-runnable on its own — imported by the -pure, -deny, -pass,
 * and -report sub-suites.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname }           from 'node:path';
import { tmpdir }                           from 'node:os';
import { fileURLToPath, pathToFileURL }     from 'node:url';

export const __dirname = dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT  = resolve(__dirname, '..');
export const SCRIPTS   = join(KIT_ROOT, 'templates', 'contextkit', 'tools', 'scripts');
export const NODE      = process.execPath;

// ---------------------------------------------------------------------------
// Test harness — counters live in the CALLER's module scope; these helpers
// mutate the shared { passed, failed } counter object passed in.
// ---------------------------------------------------------------------------

/**
 * Creates a fresh { passed, failed } counter bag.
 * @returns {{ passed: number, failed: number }}
 */
export function makeCounters() {
  return { passed: 0, failed: 0 };
}

/**
 * @param {{ passed: number, failed: number }} counters
 * @param {string} label
 */
export function ok(counters, label) {
  console.log(`  [OK]  ${label}`);
  counters.passed++;
}

/**
 * @param {{ passed: number, failed: number }} counters
 * @param {string} label
 * @param {string} [detail]
 */
export function fail(counters, label, detail = '') {
  console.error(`  [FAIL] ${label}${detail ? ': ' + detail : ''}`);
  counters.failed++;
}

/**
 * @param {{ passed: number, failed: number }} counters
 * @param {boolean} condition
 * @param {string} label
 * @param {string} [detail]
 */
export function assert_ok(counters, condition, label, detail = '') {
  if (condition) ok(counters, label);
  else fail(counters, label, String(detail));
}

/** @param {string} title */
export function section(title) { console.log(`\n[${title}]`); }

// ---------------------------------------------------------------------------
// Temp-dir helpers
// ---------------------------------------------------------------------------

/**
 * Creates an isolated temp directory for a test run.
 * @param {string} [suffix]
 * @returns {string}
 */
export function makeTmpRoot(suffix = '') {
  const dir = join(tmpdir(), `mcp004-test-${Date.now()}${suffix}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Best-effort recursive removal of a temp directory.
 * @param {string} dir
 */
export function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/**
 * Writes a .claude/settings.json into the given root directory.
 * @param {string} root
 * @param {unknown} content
 */
export function writeSettings(root, content) {
  const d = join(root, '.claude');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'settings.json'), JSON.stringify(content), 'utf-8');
}

// ---------------------------------------------------------------------------
// Lazy module loaders — resolved once per import of this helper
// ---------------------------------------------------------------------------

export const coreModule = await import(
  pathToFileURL(join(SCRIPTS, 'mcp-doctor-core.mjs')).href
);

export const doctorModule = await import(
  pathToFileURL(join(SCRIPTS, 'mcp-doctor.mjs')).href
);
