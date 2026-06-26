#!/usr/bin/env node
/**
 * mcp-receipt.mjs — Write atomic MCP execution receipts (MCP-010).
 *
 * WHY this module exists: MCP tool-use events need auditable, tamper-evident
 * receipts so the governance layer can reconstruct what happened without
 * re-running or re-prompting. Receipts contain METADATA ONLY — no prompt
 * content, no source bytes, no secret values. Fields that depend on the
 * shared CDK-022 receipt store (absent in this tree) are reported as "skipped"
 * and a clean seam is left for when that substrate arrives.
 *
 * Design decisions:
 *   - PURE ATOMIC write (tmp + rename) — crash mid-write leaves the store intact.
 *   - Result values follow the canonical evidence taxonomy RESULTS set:
 *     passed | failed | skipped | error.
 *   - Secret values in evidence are redacted at call-site validation, never stored.
 *   - CLI: node mcp-receipt.mjs --write <json-arg> (dry-run unless --write).
 *   - CDK-022 seam: SUBSTRATE_STATUS is 'skipped' in this tree; integrate by
 *     wiring the sharedStore import when CDK-022 ships.
 *
 * Immutable rules:
 *   - Zero runtime deps — node:* only.
 *   - Exits 0 always (hook contract); throws internally to callers.
 *   - ≤ 280 useful lines. ADR-0073 / MCP-010.
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical outcome taxonomy (mirrors evidence-taxonomy-core.mjs RESULTS). */
export const RESULTS = Object.freeze(['passed', 'failed', 'skipped', 'error']);

/** Version stamp for forward-compatibility checks. */
export const RECEIPT_VERSION = '1.0.0';

/**
 * CDK-022 substrate status.
 * When CDK-022 (shared receipt store) ships, replace this with an import from
 * that module. Until then, all substrate-dependent fields report 'skipped'.
 *
 * SEAM — integrate here:
 *   import { writeShared, SUBSTRATE_STATUS } from '../../runtime/receipt-store.mjs';
 */
export const SUBSTRATE_STATUS = 'skipped';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generates a lexicographically sortable receipt ID: ISO-timestamp + random hex.
 * @returns {string}
 */
function generateReceiptId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
}

/**
 * Resolves the local receipt store directory.
 * Stored under <root>/contextkit/runtime/receipts/mcp/ (gitignored runtime state).
 *
 * @param {string} root — project root (process.cwd() by default)
 * @returns {string}
 */
export function receiptStoreDir(root = process.cwd()) {
  return resolve(root, 'contextkit', 'runtime', 'receipts', 'mcp');
}

/**
 * Redacts secret values from an evidence object.
 * Any key whose name contains 'secret', 'token', 'key', 'password', 'credential'
 * (case-insensitive) has its value replaced with '[REDACTED]'.
 *
 * @param {Record<string,unknown>} evidence
 * @returns {Record<string,unknown>}
 */
function redactSecrets(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return {};
  const SECRET_PATTERN = /secret|token|key|password|credential/i;
  const out = {};
  for (const [k, v] of Object.entries(evidence)) {
    out[k] = SECRET_PATTERN.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a receipt payload. Throws on invalid input (§8 — validators throw
 * at the boundary, never warn).
 *
 * @param {object} payload
 * @throws {TypeError} when required fields are missing or have wrong types.
 */
function validateReceiptPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('mcp-receipt: payload must be a non-null object');
  }
  const { task, run, servers, tools, host, result } = payload;
  if (typeof task !== 'string' || task.length === 0) {
    throw new TypeError('mcp-receipt: task must be a non-empty string');
  }
  if (typeof run !== 'string' || run.length === 0) {
    throw new TypeError('mcp-receipt: run must be a non-empty string');
  }
  if (!Array.isArray(servers)) {
    throw new TypeError('mcp-receipt: servers must be an array');
  }
  if (!Array.isArray(tools)) {
    throw new TypeError('mcp-receipt: tools must be an array');
  }
  if (typeof host !== 'string' || host.length === 0) {
    throw new TypeError('mcp-receipt: host must be a non-empty string');
  }
  if (!RESULTS.includes(result)) {
    throw new TypeError(`mcp-receipt: result must be one of [${RESULTS.join(', ')}]; got '${result}'`);
  }
}

// ---------------------------------------------------------------------------
// Core: buildReceipt
// ---------------------------------------------------------------------------

/**
 * Builds an immutable receipt object from a validated payload.
 * METADATA ONLY — no prompt content, no source bytes, no secret values.
 *
 * @param {object} opts
 * @param {string} opts.task            — task slug or ID (no prompt content)
 * @param {string} opts.run             — run ID (session or job identifier)
 * @param {string[]} opts.servers       — MCP server names active in this run
 * @param {string[]} opts.tools         — tool names invoked
 * @param {string} opts.host            — host name (e.g. 'claude-code')
 * @param {'passed'|'failed'|'skipped'|'error'} opts.result — canonical outcome
 * @param {Record<string,unknown>} [opts.evidence] — metadata-only evidence (secrets redacted)
 * @returns {object} receipt (plain JSON-serializable)
 */
export function buildReceipt({ task, run, servers, tools, host, result, evidence = {} }) {
  validateReceiptPayload({ task, run, servers, tools, host, result });
  return {
    receiptVersion: RECEIPT_VERSION,
    id: generateReceiptId(),
    kind: 'mcp',
    task,
    run,
    host,
    servers: [...servers],
    tools: [...tools],
    result,
    evidence: redactSecrets(evidence),
    substrate: SUBSTRATE_STATUS,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Core: writeMcpReceipt
// ---------------------------------------------------------------------------

/**
 * Writes an MCP execution receipt atomically to the local store.
 *
 * ATOMIC: writes to a tmp sibling file then renames, so a crash mid-write
 * cannot leave a partial file. The store directory is created if absent.
 *
 * CDK-022 SEAM: when the shared substrate arrives, integrate here by also
 * calling `writeShared(receipt)` from receipt-store.mjs. The local write
 * stays as the primary; shared is secondary.
 *
 * @param {object} opts — same fields as buildReceipt
 * @param {string} [root] — project root (default process.cwd())
 * @returns {Promise<{ receiptPath: string, receipt: object }>}
 * @throws on invalid payload or I/O failure
 */
export async function writeMcpReceipt(opts, root = process.cwd()) {
  const receipt = buildReceipt(opts);
  const storeDir = receiptStoreDir(root);
  await mkdir(storeDir, { recursive: true });

  const fileName = `${receipt.id}.json`;
  const destPath = join(storeDir, fileName);
  const tmpPath = `${destPath}.tmp-${process.pid}`;
  const payload = JSON.stringify(receipt, null, 2) + '\n';

  try {
    await writeFile(tmpPath, payload, 'utf-8');
    await rename(tmpPath, destPath);
  } catch (err) {
    try {
      const { rm } = await import('node:fs/promises');
      await rm(tmpPath, { force: true });
    } catch { /* ignore cleanup failure */ }
    throw err;
  }

  return { receiptPath: destPath, receipt };
}

// ---------------------------------------------------------------------------
// CLI entry point (dry-run by default; --write to persist)
// ---------------------------------------------------------------------------

/**
 * CLI: node mcp-receipt.mjs [--write] <json>
 * --write  — persist the receipt (atomic); otherwise prints to stdout only.
 */
async function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes('--write');
  const jsonArg = args.find((a) => !a.startsWith('--'));

  if (!jsonArg) {
    process.stderr.write(
      'Usage: node mcp-receipt.mjs [--write] \'{"task":"..","run":"..","servers":[],"tools":[],"host":"..","result":"passed"}\'\n',
    );
    process.exit(0); // exits 0 per hook contract
  }

  let opts;
  try {
    opts = JSON.parse(jsonArg);
  } catch {
    process.stderr.write('mcp-receipt: invalid JSON argument\n');
    process.exit(0);
  }

  try {
    if (writeMode) {
      const { receiptPath, receipt } = await writeMcpReceipt(opts);
      console.log(JSON.stringify({ status: 'written', receiptPath, receipt }, null, 2));
    } else {
      const receipt = buildReceipt(opts);
      console.log(JSON.stringify({ status: 'dry-run', receipt }, null, 2));
    }
  } catch (err) {
    process.stderr.write(`mcp-receipt error: ${err.message}\n`);
    process.exit(0);
  }
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`mcp-receipt: unexpected error: ${err.message}\n`);
    process.exit(0);
  });
}
