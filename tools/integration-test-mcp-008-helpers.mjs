/**
 * integration-test-mcp-008-helpers.mjs — Shared helpers and fixtures for the
 * MCP-008 Playwright least-privilege profile integration tests.
 *
 * Imported by every sibling integration-test-mcp-008-*.mjs file.
 * Not independently runnable — no finish() call at the module level.
 *
 * @module integration-test-mcp-008-helpers
 */

import { readFileSync, existsSync } from 'node:fs';
import { join }                     from 'node:path';
import { reporter, KIT }            from './it-helpers.mjs';

/** Absolute path to the MCP artifacts directory. */
export const MCP_DIR = join(KIT, 'templates', 'contextkit', 'mcp');

export const REGISTRY_PATH = join(MCP_DIR, 'registry.json');
export const PROFILE_PATH  = join(MCP_DIR, 'profiles', 'playwright-guarded.json');
export const POLICY_PATH   = join(MCP_DIR, 'policies', 'playwright.allow.json');

/**
 * Canonical set of read-only testing tools the guarded profile permits.
 * Single source of truth — all sibling files import from here.
 */
export const ALLOWED_TESTING_TOOLS = Object.freeze([
  'browser_navigate',
  'browser_snapshot',
  'browser_screenshot',
  'browser_wait_for',
  'browser_accessibility_snapshot',
]);

/**
 * Canonical set of destructive browser tools that must never appear on any
 * allow surface (profile or policy).
 */
export const DESTRUCTIVE_TOOLS = Object.freeze([
  'browser_install',
  'browser_evaluate',
  'browser_file_upload',
  'browser_handle_dialog',
  'browser_click',
  'browser_type',
  'browser_drag',
  'browser_select_option',
  'browser_check',
  'browser_uncheck',
  'browser_hover',
  'browser_press_key',
  'browser_scroll',
  'browser_resize',
  'browser_network_request',
  'browser_close',
]);

/**
 * Reads and parses a JSON file; strips BOM; throws with context on failure.
 * @param {string} filePath
 * @returns {unknown}
 */
export function loadJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  const raw = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed JSON in ${filePath}: ${err.message}`);
  }
}

/**
 * Builds a bound { ok, bad, check, expectContractFails, finish } object from
 * a reporter instance, plus the three loaded JSON documents.
 *
 * Calls finish() with a fatal message and exits if any file cannot be loaded.
 *
 * @param {string} suiteName  Label used by finish() on failure.
 * @returns {{ ok, bad, check, expectContractFails, finish, registry, profile, policy }}
 */
export function buildSuiteContext(suiteName) {
  const rep = reporter();
  const { ok, bad, finish } = rep;

  /** Asserts condition; logs ok or bad. */
  function check(condition, label, detail = '') {
    if (condition) ok(label);
    else bad(detail ? `${label} — ${detail}` : label);
  }

  /**
   * Verifies that an adversarial/mutated document fails a contract.
   * @param {string}        label
   * @param {() => boolean} contractFn  Returns true = contract passed (no catch).
   */
  function expectContractFails(label, contractFn) {
    const passed = contractFn();
    if (!passed) {
      ok(`regression-guard: "${label}" is correctly caught`);
    } else {
      bad(`regression-guard: "${label}" was NOT caught — contract is blind to this mutation`);
    }
  }

  let registry, profile, policy;
  try {
    registry = loadJson(REGISTRY_PATH);
    profile  = loadJson(PROFILE_PATH);
    policy   = loadJson(POLICY_PATH);
  } catch (err) {
    bad(`Setup: ${err.message}`);
    finish(suiteName);
  }

  return { ok, bad, check, expectContractFails, finish, registry, profile, policy };
}
