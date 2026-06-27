/**
 * `work link` / `work unlink` handlers — thin I/O adapters for Business-Operation
 * binding verbs (BIZ-0001 / WF-0036, Wave 3, OP-0005 / ADR-0125).
 *
 * Routes to:
 *   `decision-coverage.mjs`              → `evaluateDecisionCoverage` (link validation)
 *   `registry/work-context.mjs`          → `buildWorkContextRegistry` (existence check)
 *
 * Posture (constitution §8): DRY-RUN BY DEFAULT. `--apply` writes atomically.
 * Operations are idempotent: linking already-linked → no second mutation.
 *
 * Zero runtime dependencies — `node:*` + sibling/runtime modules only.
 *
 * @module work-link
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { makeReceipt, writeFileEnsured } from './work-io.mjs';
import { evaluateDecisionCoverage } from './decision-coverage.mjs';

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to an Operation's `operation.json`. Tries an exact
 * folder name first, then a `OP-####-*` prefix scan.
 *
 * @param {string} root - project root.
 * @param {string} opId - `OP-####` id or full folder name.
 * @returns {string} absolute path (may not yet exist).
 */
function resolveOpJsonPath(root, opId) {
  const opsRoot = pathsFor(root).operations;
  const direct = join(opsRoot, opId, 'operation.json');
  if (existsSync(direct)) return direct;
  const prefix = `${opId}-`;
  let match;
  try {
    match = readdirSync(opsRoot).find((name) => name === opId || name.startsWith(prefix));
  } catch { /* opsRoot absent */ }
  return match ? join(opsRoot, match, 'operation.json') : direct;
}

/**
 * Reads and JSON-parses a file, stripping BOM. Throws descriptively on failure.
 *
 * @param {string} filePath - absolute path.
 * @returns {object} parsed object.
 * @throws {Error} on missing file or parse failure.
 */
function readJson(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`work: file not found at "${filePath}"`);
  }
  const raw = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`work: failed to parse "${filePath}": ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

/**
 * Handles `work link` — binds an Operation to a Business entity by updating
 * `operation.json:business.*` and optionally adding a `decisionRef`.
 *
 * The write is atomic and idempotent: if the operation already points at the
 * same BIZ id with status "confirmed", a second run is a no-op (no write).
 *
 * @param {{ flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing --id (operation), missing --biz (business), or
 *   missing/unreadable operation.json.
 */
export function handleLink({ flags, apply, root }) {
  const opId = flags.id;
  const bizId = flags.biz;
  if (!opId || typeof opId !== 'string') throw new Error('work link: --id OP-#### is required');
  if (!bizId || typeof bizId !== 'string') throw new Error('work link: --biz BIZ-#### is required');

  const opJsonPath = resolveOpJsonPath(root, String(opId));
  const operation = readJson(opJsonPath);

  // Idempotency check: if already linked to the same BIZ with confirmed status,
  // skip the write — second run is a no-op.
  const alreadyLinked =
    operation.business &&
    operation.business.id === String(bizId) &&
    operation.business.status === 'confirmed';

  // Optional decision ref append.
  const decisionRef = typeof flags['decision-ref'] === 'string' ? flags['decision-ref'].trim() : null;

  // Evaluate decision coverage if a ref is supplied.
  let coverage = null;
  if (decisionRef) {
    // Build a minimal entity shape for evaluateDecisionCoverage.
    const entity = { decisionRefs: [decisionRef] };
    // Pass an empty registry — coverage check is advisory at link time.
    coverage = evaluateDecisionCoverage(entity, {});
  }

  let updated = operation;
  if (!alreadyLinked) {
    updated = {
      ...operation,
      business: {
        ...(operation.business || {}),
        id: String(bizId),
        status: 'confirmed',
        confirmedAt: new Date().toISOString().slice(0, 10),
      },
    };
  }

  // Append decisionRef idempotently.
  if (decisionRef) {
    const existing = Array.isArray(updated.decisionRefs)
      ? updated.decisionRefs
      : (typeof updated.decisionRefs === 'object' && Array.isArray(updated.decisionRefs?.governing)
        ? updated.decisionRefs.governing
        : []);
    if (!existing.includes(decisionRef)) {
      if (Array.isArray(updated.decisionRefs)) {
        updated = { ...updated, decisionRefs: [...updated.decisionRefs, decisionRef] };
      } else {
        updated = { ...updated, decisionRefs: [decisionRef] };
      }
    }
  }

  const willWrite = apply && !alreadyLinked;
  if (willWrite) {
    writeFileEnsured(opJsonPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  return makeReceipt({
    command: 'link',
    applied: willWrite,
    writes: [opJsonPath],
    detail: {
      operationId: opId,
      businessId: bizId,
      idempotentNoop: alreadyLinked,
      decisionRef: decisionRef || null,
      decisionCoverage: coverage,
    },
  });
}

/**
 * Handles `work unlink` — clears the Business link on an Operation by setting
 * `business.status = 'unlinked'`. Idempotent: already-unlinked → no second write.
 *
 * @param {{ flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing --id or missing/unreadable operation.json.
 */
export function handleUnlink({ flags, apply, root }) {
  const opId = flags.id;
  if (!opId || typeof opId !== 'string') throw new Error('work unlink: --id OP-#### is required');

  const opJsonPath = resolveOpJsonPath(root, String(opId));
  const operation = readJson(opJsonPath);

  const alreadyUnlinked =
    !operation.business ||
    operation.business.status === 'unlinked' ||
    !operation.business.id;

  let updated = operation;
  if (!alreadyUnlinked) {
    updated = {
      ...operation,
      business: {
        ...(operation.business || {}),
        status: 'unlinked',
        unlinkedAt: new Date().toISOString().slice(0, 10),
      },
    };
  }

  const willWrite = apply && !alreadyUnlinked;
  if (willWrite) {
    writeFileEnsured(opJsonPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  return makeReceipt({
    command: 'unlink',
    applied: willWrite,
    writes: [opJsonPath],
    detail: {
      operationId: opId,
      previousBusinessId: alreadyUnlinked ? null : (operation.business?.id || null),
      idempotentNoop: alreadyUnlinked,
    },
  });
}
