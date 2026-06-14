/**
 * bypass-store.mjs - Audited, scoped, expiring bypass persistence (CDK-023, ADR-0072).
 *
 * A bypass is a PERSISTED, AUDITED artifact that allows a specific capability gate
 * to be skipped for a specific (taskId, branch) scope. Bypasses are NEVER runtime
 * flags - every grant is written to disk so the decision is durable and auditable.
 *
 * Bypass schema v1:
 *   { version, capability, taskId, branch, paths?, reason, actor, approvedBy,
 *     createdAt, expiresAt }
 *
 * Bypass files live at:
 *   <pipeline>/state/<taskId>/bypasses/<capability>.json
 *
 * Key invariants:
 *   - writeBypass is the ONLY writer - throws on malformed input (fail-fast).
 *   - Readers (readBypass, readBypasses) are fully defensive - never throw.
 *   - isBypassValid enforces both scope isolation and the Grade-4 human-floor rule
 *     (ADR-0045/0058): an actor:'auto' bypass of a requiresHumanApproval capability
 *     is ALWAYS invalid - auto cannot self-authorize human-gated actions.
 *   - A bypass counts as 'bypassed' in decide() - NEVER as 'satisfied'. Anti-theatre.
 *
 * Zero runtime deps - node:* + hooks/safe-io.mjs + config/paths.mjs only.
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';
import { pathsFor } from '../config/paths.mjs';

const BYPASS_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Required top-level fields on every bypass record. */
const REQUIRED_FIELDS = ['capability', 'taskId', 'branch', 'reason', 'actor'];

// ---------------------------------------------------------------------------
// Writer - fail-fast, the ONLY path to a stored bypass
// ---------------------------------------------------------------------------

/**
 * Validates, timestamps, and atomically writes a bypass record to disk.
 *
 * Required fields: capability, taskId, branch, reason, actor.
 * Optional: paths (string[]), approvedBy.
 * Stamps version, createdAt, expiresAt. Never trusts caller-supplied timestamps.
 *
 * @param {string} root project root
 * @param {object} bypass raw bypass fields
 * @param {{ ttlMs?: number }} [opts]
 * @returns {object} stored bypass record
 * @throws {TypeError} on missing or malformed required fields
 */
export function writeBypass(root, bypass, { ttlMs = DEFAULT_TTL_MS } = {}) {
  validateBypassInput(bypass);
  const now = Date.now();
  const stored = {
    version: BYPASS_VERSION,
    capability: String(bypass.capability),
    taskId: String(bypass.taskId),
    branch: String(bypass.branch),
    paths: Array.isArray(bypass.paths) ? [...bypass.paths] : undefined,
    reason: String(bypass.reason),
    actor: String(bypass.actor),
    approvedBy: bypass.approvedBy != null ? String(bypass.approvedBy) : undefined,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  // Remove undefined optional fields for clean JSON output.
  if (stored.paths === undefined) delete stored.paths;
  if (stored.approvedBy === undefined) delete stored.approvedBy;

  const bypassDir = bypassesDirFor(root, stored.taskId);
  mkdirSync(bypassDir, { recursive: true });
  writeFileAtomicSync(bypassPathFor(root, stored.taskId, stored.capability), JSON.stringify(stored, null, 2));
  return stored;
}

// ---------------------------------------------------------------------------
// Readers - fully defensive, never throw
// ---------------------------------------------------------------------------

/**
 * Reads a single bypass for a (taskId, capability) pair.
 * Returns null when missing or unparseable.
 *
 * @param {string} root project root
 * @param {string} taskId
 * @param {string} capability
 * @returns {object|null}
 */
export function readBypass(root, taskId, capability) {
  return readJsonSafe(bypassPathFor(root, String(taskId), String(capability)), null);
}

/**
 * Reads all bypasses for a task. Returns [] when the dir is missing or empty.
 *
 * @param {string} root project root
 * @param {string} taskId
 * @returns {object[]}
 */
export function readBypasses(root, taskId) {
  const dir = bypassesDirFor(root, String(taskId));
  let entries;
  try { entries = readdirSync(dir).filter((n) => n.endsWith('.json')); }
  catch { return []; }
  return entries.map((n) => readJsonSafe(join(dir, n), null)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Validity check
// ---------------------------------------------------------------------------

/**
 * Determines whether a stored bypass is valid for the given context.
 *
 * Valid ONLY when ALL of the following hold:
 *   1. The bypass is not null/object.
 *   2. Not expired (now <= expiresAt).
 *   3. bypass.capability === ctx.capability.
 *   4. bypass.taskId === ctx.taskId (scope isolation - task X cannot use task Y bypass).
 *   5. bypass.branch === ctx.branch (scope isolation - branch mismatch is always invalid).
 *   6. Grade-4 human-floor (ADR-0045/0058):
 *        If ctx.requiresHumanApproval is true, the bypass is valid ONLY when
 *        bypass.approvedBy is a non-empty string AND bypass.actor !== 'auto'.
 *        An actor:'auto' bypass cannot self-authorize a human-gated capability.
 *
 * @param {object|null} bypass stored bypass record
 * @param {{ capability: string, taskId: string, branch: string, requiresHumanApproval?: boolean }} ctx
 * @param {number} [now] timestamp override for testing
 * @returns {{ valid: boolean, reason: string }}
 */
export function isBypassValid(bypass, ctx, now = Date.now()) {
  if (!bypass || typeof bypass !== 'object') {
    return { valid: false, reason: 'missing: bypass is null or not an object' };
  }
  if (typeof bypass.expiresAt !== 'number' || now > bypass.expiresAt) {
    return { valid: false, reason: 'expired' };
  }
  if (bypass.capability !== ctx.capability) {
    return { valid: false, reason: `capability mismatch: bypass=${bypass.capability} ctx=${ctx.capability}` };
  }
  if (bypass.taskId !== String(ctx.taskId)) {
    return { valid: false, reason: `taskId mismatch: bypass=${bypass.taskId} ctx=${ctx.taskId}` };
  }
  if (bypass.branch !== String(ctx.branch)) {
    return { valid: false, reason: `branch mismatch: bypass=${bypass.branch} ctx=${ctx.branch}` };
  }
  // Grade-4 human-floor (ADR-0045/0058): auto cannot self-authorize a human-approval gate.
  if (ctx.requiresHumanApproval) {
    if (bypass.actor === 'auto') {
      return { valid: false, reason: 'human approval required; auto cannot self-authorize' };
    }
    if (!bypass.approvedBy || typeof bypass.approvedBy !== 'string' || !bypass.approvedBy.trim()) {
      return { valid: false, reason: 'human approval required; approvedBy must be a non-empty human identity' };
    }
  }
  return { valid: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validates required bypass fields. Throws TypeError on any violation.
 * @param {unknown} bypass
 * @throws {TypeError}
 */
function validateBypassInput(bypass) {
  if (!bypass || typeof bypass !== 'object') {
    throw new TypeError('writeBypass: bypass must be a non-null object');
  }
  for (const field of REQUIRED_FIELDS) {
    if (bypass[field] == null || String(bypass[field]).trim() === '') {
      throw new TypeError(`writeBypass: missing or empty required field '${field}'`);
    }
  }
}

/** @param {string} root @param {string} taskId @param {string} capability @returns {string} */
function bypassPathFor(root, taskId, capability) {
  return join(bypassesDirFor(root, taskId), `${capability}.json`);
}

/** @param {string} root @param {string} taskId @returns {string} */
function bypassesDirFor(root, taskId) {
  return join(pathsFor(root).pipeline, 'state', taskId, 'bypasses');
}