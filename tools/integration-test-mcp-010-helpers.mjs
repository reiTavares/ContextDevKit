/**
 * integration-test-mcp-010-helpers.mjs — Shared fixtures and module imports
 * for the MCP-010 acceptance-criteria sub-suites.
 *
 * Imported by:
 *   integration-test-mcp-010-receipt.mjs  (AC-1, AC-3)
 *   integration-test-mcp-010-core.mjs     (AC-5)
 *   integration-test-mcp-010-audit.mjs    (AC-2, AC-4b)
 *   integration-test-mcp-010-seam.mjs     (AC-4a)
 *
 * @module integration-test-mcp-010-helpers
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolve source modules from the worktree templates/ tree
// ---------------------------------------------------------------------------

export const KIT_ROOT = resolve(fileURLToPath(import.meta.url), '../../');
export const SCRIPTS = join(KIT_ROOT, 'templates', 'contextkit', 'tools', 'scripts');

export const {
  buildReceipt,
  writeMcpReceipt,
  RESULTS,
  RECEIPT_VERSION,
  SUBSTRATE_STATUS,
  receiptStoreDir,
} = await import(pathToFileURL(join(SCRIPTS, 'mcp-receipt.mjs')).href);

export const { runAudit } =
  await import(pathToFileURL(join(SCRIPTS, 'mcp-audit.mjs')).href);

export const { computeFlags, buildReport, hasWriteTools, secretReferenceNames } =
  await import(pathToFileURL(join(SCRIPTS, 'mcp-audit-core.mjs')).href);

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/** Create an isolated temp directory for one test run. */
export function makeTmpRoot() {
  const dir = join(tmpdir(), `mcp010-it-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Best-effort removal of a temp root created by makeTmpRoot. */
export function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/**
 * Write a minimal .claude/settings.json into `root`.
 * @param {string} root - temp project root
 * @param {object} content - parsed settings object
 */
export function writeSettings(root, content) {
  const claudeDir = join(root, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(content), 'utf-8');
}

/**
 * Write a pre-built receipt JSON file into the canonical receipt store path.
 * @param {string} root - temp project root
 * @param {string} fileName - file name for the receipt (e.g. 'receipt-a.json')
 * @param {object} obj - receipt object to serialize
 */
export function writeReceiptFile(root, fileName, obj) {
  const dir = join(root, 'contextkit', 'runtime', 'receipts', 'mcp');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), JSON.stringify(obj), 'utf-8');
}
