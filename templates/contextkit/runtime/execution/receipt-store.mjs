/**
 * receipt-store.mjs — Tamper-resistant evidence store for capability gate receipts
 * (CDK-022, ADR-0072 §9).
 *
 * Receipts live at: <pipeline>/state/<taskId>/receipts/<capability>.json
 * Fingerprint = SHA-256(branch|taskId|sortedPaths|contentHash) — computed inside
 * writeReceipt, never trusted from the caller (forgery resistance).
 * Readers are defensive (never throw). writeReceipt is fail-fast (throws on bad input).
 * Evidence stores METADATA only — no file content, no prompt text (ADR-0072 §9).
 *
 * Zero runtime deps — node:* + hooks/safe-io.mjs + config/paths.mjs only.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';
import { pathsFor } from '../config/paths.mjs';

// CDK-075 will extract RESULTS to a shared constant file.
// ONLY 'passed' satisfies a gate; 'bypassed' is NOT a pass (§8 anti-theatre).
/** All valid receipt result values. */
export const RESULTS = Object.freeze([
  'passed', 'failed', 'skipped', 'unknown', 'not-applicable',
  'blocked', 'bypassed', 'stale', 'insufficient-data',
]);
const RESULT_SET = new Set(RESULTS);

const RECEIPT_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SUMMARY_LENGTH = 2000; // ADR-0072 §9 — metadata guard

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 of a scope: branch|taskId|sortedPaths|contentHash.
 * Path order is always sorted so ['a','b'] and ['b','a'] produce the same hash.
 * Always computed inside writeReceipt — callers cannot supply their own value.
 *
 * @param {{ branch?: string, taskId?: string, paths?: string[], contentHash?: string }} scope
 * @returns {string} hex SHA-256 digest
 */
export function computeFingerprint(scope) {
  const branch = String(scope?.branch ?? '');
  const taskId = scope?.taskId != null ? String(scope.taskId) : '';
  const paths = Array.isArray(scope?.paths) ? [...scope.paths].sort().join(',') : '';
  const contentHash = String(scope?.contentHash ?? '');
  return createHash('sha256').update(`${branch}|${taskId}|${paths}|${contentHash}`, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Writer (the ONLY path to a valid stored receipt — fail-fast)
// ---------------------------------------------------------------------------

/**
 * Validates, fingerprints, timestamps, and atomically writes a capability receipt.
 *
 * Required fields: capability, taskId, sessionId, runId, command, host, result,
 * evidence {exitCode, summary?}, scope {branch, paths?}.
 * result must be in RESULTS. evidence.summary: ≤ 2000 chars, no newlines.
 * Any caller-supplied fingerprint is discarded and recomputed from scope.
 *
 * @param {string} root project root
 * @param {object} receipt raw fields (fingerprint overwritten)
 * @param {{ ttlMs?: number }} [opts]
 * @returns {object} stored receipt
 * @throws {TypeError|RangeError} on malformed input
 */
export function writeReceipt(root, receipt, { ttlMs = DEFAULT_TTL_MS } = {}) {
  validateReceiptInput(receipt);
  const now = Date.now();
  const fingerprint = computeFingerprint(receipt.scope);
  const stored = {
    version: RECEIPT_VERSION,
    capability: String(receipt.capability),
    taskId: String(receipt.taskId),
    sessionId: String(receipt.sessionId),
    runId: String(receipt.runId),
    command: String(receipt.command),
    host: String(receipt.host),
    result: receipt.result,
    evidence: sanitizeEvidence(receipt.evidence),
    scope: normalizeScope(receipt.scope),
    fingerprint,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  mkdirSync(join(pathsFor(root).pipeline, 'state', stored.taskId, 'receipts'), { recursive: true });
  writeFileAtomicSync(receiptPathFor(root, stored.taskId, stored.capability), JSON.stringify(stored, null, 2));
  return stored;
}

// ---------------------------------------------------------------------------
// Readers — fully defensive, never throw
// ---------------------------------------------------------------------------

/**
 * Reads all receipts for a task. Missing dir or unparseable files → [].
 *
 * @param {string} root
 * @param {string} taskId
 * @returns {object[]}
 */
export function readReceipts(root, taskId) {
  const dir = receiptsDirFor(root, String(taskId));
  let entries;
  try { entries = readdirSync(dir).filter((n) => n.endsWith('.json')); }
  catch { return []; }
  return entries.map((n) => readJsonSafe(join(dir, n), null)).filter(Boolean);
}

/**
 * Reads a single receipt for a (task, capability) pair. Returns null when missing.
 *
 * @param {string} root
 * @param {string} taskId
 * @param {string} capability
 * @returns {object|null}
 */
export function readReceipt(root, taskId, capability) {
  return readJsonSafe(receiptPathFor(root, String(taskId), String(capability)), null);
}

// ---------------------------------------------------------------------------
// Validity check
// ---------------------------------------------------------------------------

/**
 * Returns `{ valid, reason }` for whether a stored receipt is still valid.
 *
 * Valid ONLY when ALL hold:
 *   1. result === 'passed'
 *   2. now <= expiresAt
 *   3. scope.branch matches currentScope.branch (when given)
 *   4. receipt.taskId matches currentScope.taskId (when given)
 *   5. fingerprint === computeFingerprint(currentScope)
 *
 * @param {object} receipt
 * @param {{ branch?: string, taskId?: string, paths?: string[], contentHash?: string }} currentScope
 * @param {number} [now] timestamp override for testing
 * @returns {{ valid: boolean, reason: string }}
 */
export function isReceiptValid(receipt, currentScope, now = Date.now()) {
  if (!receipt || typeof receipt !== 'object') {
    return { valid: false, reason: 'missing: receipt is null or not an object' };
  }
  if (receipt.result !== 'passed') {
    return { valid: false, reason: `result=${receipt.result} not passed` };
  }
  if (typeof receipt.expiresAt !== 'number' || now > receipt.expiresAt) {
    return { valid: false, reason: 'expired' };
  }
  if (currentScope?.branch !== undefined && receipt.scope?.branch !== currentScope.branch) {
    return { valid: false, reason: `branch mismatch: receipt=${receipt.scope?.branch} current=${currentScope.branch}` };
  }
  if (currentScope?.taskId !== undefined && receipt.taskId !== String(currentScope.taskId)) {
    return { valid: false, reason: `taskId mismatch: receipt=${receipt.taskId} current=${currentScope.taskId}` };
  }
  if (receipt.fingerprint !== computeFingerprint(currentScope)) {
    return { valid: false, reason: 'stale: fingerprint mismatch' };
  }
  return { valid: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** @param {object} receipt @throws {TypeError|RangeError} */
function validateReceiptInput(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new TypeError('writeReceipt: receipt must be a non-null object');
  for (const f of ['capability', 'taskId', 'sessionId', 'runId', 'command', 'host', 'result', 'evidence', 'scope']) {
    if (receipt[f] == null) throw new TypeError(`writeReceipt: missing required field '${f}'`);
  }
  if (!RESULT_SET.has(receipt.result)) {
    throw new RangeError(`writeReceipt: result '${receipt.result}' not in taxonomy. Valid: ${RESULTS.join(', ')}`);
  }
  validateEvidence(receipt.evidence);
  validateScope(receipt.scope);
}

/**
 * Evidence must be a plain object with exitCode. summary: short string, no newlines.
 * Enforces ADR-0072 §9 metadata-only invariant.
 * @param {unknown} ev
 */
function validateEvidence(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
    throw new TypeError("writeReceipt: evidence must be a plain object with 'exitCode'");
  }
  if (ev.exitCode == null) throw new TypeError("writeReceipt: evidence.exitCode is required");
  if (ev.summary !== undefined) {
    if (typeof ev.summary !== 'string') throw new TypeError('writeReceipt: evidence.summary must be a string');
    if (ev.summary.length > MAX_SUMMARY_LENGTH) {
      throw new RangeError(`writeReceipt: evidence.summary exceeds ${MAX_SUMMARY_LENGTH} chars — metadata only`);
    }
    if (/\n/.test(ev.summary)) {
      throw new RangeError('writeReceipt: evidence.summary must not contain newlines — no file dumps (ADR-0072 §9)');
    }
  }
}

/** @param {unknown} scope @throws {TypeError} */
function validateScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('writeReceipt: scope must be a plain object');
  }
  if (typeof scope.branch !== 'string' || !scope.branch) {
    throw new TypeError("writeReceipt: scope.branch must be a non-empty string");
  }
}

/** Strips non-metadata fields from evidence (privacy, ADR-0072 §9). */
function sanitizeEvidence(ev) {
  const out = { exitCode: ev.exitCode };
  if (typeof ev.summary === 'string') out.summary = ev.summary;
  return out;
}

/** Normalizes scope: sorts paths, retains only allowed fields. */
function normalizeScope(scope) {
  const out = { branch: String(scope.branch) };
  if (Array.isArray(scope.paths)) out.paths = [...scope.paths].sort();
  if (typeof scope.contentHash === 'string') out.contentHash = scope.contentHash;
  return out;
}

/** @param {string} root @param {string} taskId @param {string} capability @returns {string} */
function receiptPathFor(root, taskId, capability) {
  return join(receiptsDirFor(root, taskId), `${capability}.json`);
}

/** @param {string} root @param {string} taskId @returns {string} */
function receiptsDirFor(root, taskId) {
  return join(pathsFor(root).pipeline, 'state', taskId, 'receipts');
}
