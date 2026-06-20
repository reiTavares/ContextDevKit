/**
 * Task-Compiler: patch-plan applier — `patch-plan --write` surface (WF0022 / ADR-0089).
 *
 * Single responsibility: validate a patch-plan, apply it atomically with
 * one CDK-022-compatible receipt per write, and never touch anything outside
 * the declared scope allowlist.
 *
 * Design invariants (ADR-0089 §Decision):
 *   - VALIDATORS THROW BEFORE ANY I/O: all input checks run before any fs op.
 *   - DRY-RUN BY DEFAULT: without --write the function only returns a preview.
 *   - ATOMIC WRITE: tmp + rename via safe-io; never in-place truncation.
 *   - EXACTLY ONE RECEIPT PER WRITE: before-sha256 + after-sha256 + recipeId +
 *     version + scope. A transform that cannot produce a receipt throws (stop).
 *   - SCOPE-FENCED: all target paths are checked against allowedPaths; any path
 *     outside throws TransformScopeError before I/O begins.
 *   - RIDES CDK-032 ADVISORY: reads the advisory signal, emits it visibly via
 *     advisoryLines; never overrides the gate or blocks an edit.
 *
 * Zero runtime dependencies — node:* only.
 * [task-compiler] [token-economy] [WF0022] [ADR-0089]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { writeFileAtomicSync } from '../../../runtime/hooks/safe-io.mjs';
import { assessPatchEconomy } from './patch-economy-core.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for transform receipts produced by this module. */
export const TC_TRANSFORM_SCHEMA_VERSION = 'cdk-tc-transform/1';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Thrown when a patch-plan field is missing or malformed (before any I/O). */
export class TransformValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`TransformValidationError: ${message}`);
    this.name = 'TransformValidationError';
  }
}

/** Thrown when a target path is outside the declared scope allowlist. */
export class TransformScopeError extends Error {
  /**
   * @param {string} path target path
   * @param {string[]} allowedPaths declared allowlist
   */
  constructor(path, allowedPaths) {
    super(
      `TransformScopeError: path "${path}" is outside the declared allowlist ` +
      `[${allowedPaths.join(', ')}]. Scope fence prevents the write.`
    );
    this.name = 'TransformScopeError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * SHA-256 digest of a UTF-8 string.
 * @param {string} content
 * @returns {string} hex digest
 */
function sha256(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Normalise to forward-slash for cross-platform scope checks. @param {string} p @returns {string} */
const normalisePath = (p) => p.replace(/\\/g, '/');

/**
 * Returns true when `candidatePath` is covered by at least one entry in `allowedPaths`.
 * Coverage: candidate starts with the allowed prefix (or equals it).
 * @param {string} candidatePath @param {string[]} allowedPaths @returns {boolean}
 */
function isScopedPath(candidatePath, allowedPaths) {
  const norm = normalisePath(candidatePath);
  return allowedPaths.some((a) => {
    const an = normalisePath(a);
    return norm === an || norm.startsWith(an.endsWith('/') ? an : `${an}/`);
  });
}

// ---------------------------------------------------------------------------
// PatchPlan validator (throws before any I/O)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PatchEntry
 * @property {string} path       - Relative or absolute target file path.
 * @property {string} newContent - Full replacement content (UTF-8 text).
 */

/**
 * @typedef {Object} PatchPlan
 * @property {string}       recipeId    - Recipe identifier (ADR-gated).
 * @property {string}       version     - Recipe version string.
 * @property {string[]}     allowedPaths - Declared scope allowlist.
 * @property {PatchEntry[]} patches     - List of file patches to apply.
 */

/**
 * Validates a patch-plan object. Throws TransformValidationError on any
 * structural problem — validation is always the first step, before any I/O.
 *
 * @param {unknown} plan
 * @throws {TransformValidationError}
 */
function validatePatchPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TransformValidationError('patch-plan must be a non-null object');
  }
  if (typeof plan.recipeId !== 'string' || !plan.recipeId.trim()) {
    throw new TransformValidationError('patch-plan.recipeId must be a non-empty string');
  }
  if (typeof plan.version !== 'string' || !plan.version.trim()) {
    throw new TransformValidationError('patch-plan.version must be a non-empty string');
  }
  if (!Array.isArray(plan.allowedPaths) || plan.allowedPaths.length === 0) {
    throw new TransformValidationError('patch-plan.allowedPaths must be a non-empty array');
  }
  for (const p of plan.allowedPaths) {
    if (typeof p !== 'string' || !p.trim()) {
      throw new TransformValidationError('every entry in patch-plan.allowedPaths must be a non-empty string');
    }
  }
  if (!Array.isArray(plan.patches) || plan.patches.length === 0) {
    throw new TransformValidationError('patch-plan.patches must be a non-empty array');
  }
  for (let i = 0; i < plan.patches.length; i++) {
    const entry = plan.patches[i];
    if (!entry || typeof entry !== 'object') {
      throw new TransformValidationError(`patch-plan.patches[${i}] must be an object`);
    }
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new TransformValidationError(`patch-plan.patches[${i}].path must be a non-empty string`);
    }
    if (typeof entry.newContent !== 'string') {
      throw new TransformValidationError(`patch-plan.patches[${i}].newContent must be a string`);
    }
  }
}

// ---------------------------------------------------------------------------
// applyPatchPlan — main export
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TransformReceipt
 * @property {string}   schemaVersion - TC_TRANSFORM_SCHEMA_VERSION
 * @property {string}   recipeId      - Recipe identifier
 * @property {string}   recipeVersion - Recipe version
 * @property {string}   path          - Normalised target path
 * @property {string}   beforeSha256  - SHA-256 of prior content (or '' for new)
 * @property {string}   afterSha256   - SHA-256 of written content
 * @property {string[]} scope         - allowedPaths at time of write
 * @property {string}   timestamp     - ISO-8601 wall clock
 */

/**
 * @typedef {Object} ApplyResult
 * @property {boolean}           dryRun       - true when no write was performed
 * @property {TransformReceipt[]} receipts    - One receipt per patch (empty in dry-run)
 * @property {string[]}          preview      - Dry-run diff summary lines
 * @property {string[]}          advisoryLines - CDK-032 advisory signal lines (never blocking)
 * @property {string[]}          skipped      - Paths skipped due to economy signal
 */

/**
 * Validates and applies (or previews) a patch-plan.
 *
 * Validators throw BEFORE any I/O. Dry-run is the default — pass `write: true`
 * to trigger atomic file writes. Each write produces exactly one CDK-022-
 * compatible receipt. Any path outside `plan.allowedPaths` causes a
 * TransformScopeError before any write begins (scope fence).
 *
 * CDK-032 advisory: for each patch, the patch-economy signal is read and
 * reported in `advisoryLines`. The signal is NEVER used to block or suppress
 * the write — it is informational only.
 *
 * @param {PatchPlan} plan       - Validated patch-plan object.
 * @param {{
 *   write?:   boolean,   - Default false (dry-run). Explicit true triggers writes.
 *   root?:    string,    - Project root for absolute path resolution (default cwd).
 * }} [opts={}]
 * @returns {ApplyResult}
 * @throws {TransformValidationError} on malformed plan (before any I/O)
 * @throws {TransformScopeError}      on out-of-scope path (before any I/O)
 */
export function applyPatchPlan(plan, opts = {}) {
  // ── Step 1: Validate BEFORE any I/O (ADR-0089 invariant) ─────────────────
  validatePatchPlan(plan);

  const writeMode = opts?.write === true;
  const root = (typeof opts?.root === 'string' && opts.root) ? opts.root : process.cwd();
  const { recipeId, version: recipeVersion, allowedPaths, patches } = plan;

  // ── Step 2: Scope-fence — all paths checked before any write begins ───────
  for (const entry of patches) {
    const absPath = resolve(root, entry.path);
    const relPath = normalisePath(entry.path);
    if (!isScopedPath(relPath, allowedPaths) && !isScopedPath(absPath, allowedPaths)) {
      throw new TransformScopeError(entry.path, allowedPaths);
    }
  }

  /** @type {string[]} */
  const preview = [];
  /** @type {string[]} */
  const advisoryLines = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {TransformReceipt[]} */
  const receipts = [];

  const timestamp = new Date().toISOString();

  for (const entry of patches) {
    const absPath = resolve(root, entry.path);
    const existingContent = existsSync(absPath)
      ? (() => { try { return readFileSync(absPath, 'utf-8'); } catch { return ''; } })()
      : '';

    // ── CDK-032 Advisory: assess patch economy (visible, never blocking) ─────
    const economy = assessPatchEconomy({
      tool:            'Write',
      path:            entry.path,
      newContent:      entry.newContent,
      existingContent: existingContent || undefined,
    });
    if (economy.suggestPatch) {
      advisoryLines.push(
        `[tc-transform] CDK-032 advisory: ${entry.path} — ${economy.reason}`
      );
    }

    const beforeSha256 = existingContent ? sha256(existingContent) : '';
    const afterSha256  = sha256(entry.newContent);

    preview.push(
      `${writeMode ? 'WRITE' : 'WOULD-WRITE'} ${entry.path} ` +
      `(before=${beforeSha256.slice(0, 8)} after=${afterSha256.slice(0, 8)})`
    );

    if (!writeMode) continue; // dry-run: skip actual I/O

    // ── Atomic write: tmp + rename (ADR-0089 invariant) ──────────────────────
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileAtomicSync(absPath, entry.newContent, 'utf-8');

    // ── Exactly one CDK-022 receipt per write (ADR-0089 invariant) ───────────
    receipts.push({
      schemaVersion: TC_TRANSFORM_SCHEMA_VERSION,
      recipeId,
      recipeVersion,
      path:          normalisePath(entry.path),
      beforeSha256,
      afterSha256,
      scope:         [...allowedPaths],
      timestamp,
    });
  }

  return { dryRun: !writeMode, receipts, preview, advisoryLines, skipped };
}

// ---------------------------------------------------------------------------
// presentTransform — human-readable summary
// ---------------------------------------------------------------------------

/**
 * Renders an ApplyResult as a human-readable multi-line string.
 *
 * @param {ApplyResult} result
 * @returns {string}
 */
export function presentTransform(result) {
  if (!result || typeof result !== 'object') {
    return `tc-transform [${TC_TRANSFORM_SCHEMA_VERSION}]: invalid result`;
  }

  const mode = result.dryRun ? 'DRY-RUN' : 'APPLIED';
  const lines = [`tc-transform [${TC_TRANSFORM_SCHEMA_VERSION}]: ${mode}`];

  for (const line of result.preview ?? [])  lines.push(`  ${line}`);
  for (const line of result.advisoryLines ?? []) lines.push(`  advisory: ${line}`);

  if (!result.dryRun && result.receipts?.length) {
    lines.push(`  receipts: ${result.receipts.length} written`);
  }

  return lines.join('\n');
}
