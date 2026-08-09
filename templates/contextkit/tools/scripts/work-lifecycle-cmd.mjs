/**
 * `work start` / `work close` / `work promote` handlers — lifecycle CLI verbs
 * (BIZ-0001 / WF-0036, Wave 3, OP-0005 / ADR-0125).
 *
 * Routes to:
 *   `work-business-lifecycle.mjs` → STATUS_TRANSITIONS state machine for start/close
 *   `work-decision-ownership.mjs` → `transferOwnership(entity, newOwner, ctx)` for promote
 *
 * Posture (constitution §8): DRY-RUN BY DEFAULT. `--apply` writes atomically.
 * `promote` is HUMAN-GATED: `--actor human` is required; non-human actor → throws.
 *
 * Both `start` (→ active) and `close` (→ closed) apply a direct status field update
 * rather than calling the Business lifecycle engine's `transition()`, because:
 *   (a) these verbs apply to both Business AND Operation entities,
 *   (b) the lifecycle engine's ACTION_TO_TARGET map does not define 'start'/'close' as actions;
 *       those are target states. Callers set the target status directly.
 *
 * Zero runtime dependencies — `node:*` + sibling/runtime modules only.
 *
 * @module work-lifecycle-cmd
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { makeReceipt, writeFileEnsured } from './work-io.mjs';
import { transferOwnership } from './work-decision-ownership.mjs';
import { closeBusiness, CLOSE_STATUSES } from './work-business-lifecycle.mjs';

// ---------------------------------------------------------------------------
// I/O helpers (shared within module)
// ---------------------------------------------------------------------------

/**
 * Finds the absolute path to `{entityId}/business.json` or `{entityId}/operation.json`
 * under the appropriate root, accepting either a bare id or a `OP-####-slug` folder.
 *
 * @param {string} root - project root.
 * @param {string} entityId - `BIZ-####` or `OP-####` id.
 * @returns {string} absolute path (may not exist).
 */
function resolveEntityJsonPath(root, entityId) {
  const paths = pathsFor(root);
  const isBiz = String(entityId).startsWith('BIZ-');
  const dir = isBiz ? paths.business : paths.operations;
  const jsonName = isBiz ? 'business.json' : 'operation.json';
  const direct = join(dir, entityId, jsonName);
  if (existsSync(direct)) return direct;
  const prefix = `${entityId}-`;
  let match;
  try {
    match = readdirSync(dir).find((name) => name === entityId || name.startsWith(prefix));
  } catch { /* dir absent */ }
  return match ? resolve(dir, match, jsonName) : direct;
}

/**
 * Reads and JSON-parses a file, stripping BOM. Throws descriptively on failure.
 *
 * @param {string} filePath - absolute path.
 * @returns {object} parsed object.
 * @throws {Error} on missing file or parse failure.
 */
function readJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`work: file not found at "${filePath}"`);
  const raw = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`work: failed to parse "${filePath}": ${err.message}`);
  }
}

/**
 * Returns today's ISO date string (`YYYY-MM-DD`).
 *
 * @returns {string}
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve and validate a Business outcome report reference. References may be
 * relative to the Business folder or the repository root, but never escape the
 * repository and must point to an existing regular file.
 * @param {string} root project root
 * @param {string} businessJsonPath absolute business.json path
 * @param {unknown} reference user-supplied report reference
 * @returns {{absolute:string, relative:string}} validated path pair
 * @throws {Error} when the reference is missing, outside root, or unreadable
 */
function resolveOutcomeReference(root, businessJsonPath, reference) {
  if (typeof reference !== 'string' || !reference.trim()) {
    throw new Error('work close: --outcome-ref <path> is required for a Business');
  }
  const raw = reference.trim();
  const businessDir = dirname(businessJsonPath);
  const candidates = isAbsolute(raw) ? [resolve(raw)] : [resolve(businessDir, raw), resolve(root, raw)];
  const rootPath = resolve(root);
  const hit = candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    const rel = relative(rootPath, candidate);
    try {
      return statSync(candidate).isFile() && rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    } catch {
      return false;
    }
  });
  if (!hit) {
    throw new Error(`work close: outcome report must exist inside the repository: "${raw}"`);
  }
  return { absolute: hit, relative: relative(rootPath, hit).replace(/\\/g, '/') };
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

/**
 * Handles `work start` — transitions an entity's status to `active`.
 *
 * Applies to Business AND Operation entities. The field `status` is set to
 * `"active"` and `updatedAt` is stamped. Dry-run by default; `--apply` writes.
 *
 * @param {{ flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing --id or unreadable entity file.
 */
export function handleStart({ flags, apply, root }) {
  const entityId = flags.id;
  if (!entityId || typeof entityId !== 'string') {
    throw new Error('work start: --id BIZ-#### or OP-#### is required');
  }

  const jsonPath = resolveEntityJsonPath(root, String(entityId));
  const entity = readJson(jsonPath);
  const fromStatus = entity.status || 'draft';
  const updated = { ...entity, status: 'active', updatedAt: today() };

  if (apply) {
    writeFileEnsured(jsonPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  return makeReceipt({
    command: 'start',
    applied: apply,
    writes: [jsonPath],
    detail: { id: entityId, fromStatus, toStatus: 'active' },
  });
}

/**
 * Handles `work close` — transitions an entity's status to `closed` (terminal).
 *
 * Applies to Business AND Operation entities. Dry-run by default; `--apply` writes.
 *
 * @param {{ flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing --id or unreadable entity file.
 */
export function handleClose({ flags, apply, root }) {
  const entityId = flags.id;
  if (!entityId || typeof entityId !== 'string') {
    throw new Error('work close: --id BIZ-#### or OP-#### is required');
  }

  const jsonPath = resolveEntityJsonPath(root, String(entityId));
  const entity = readJson(jsonPath);

  // Business closure is a governed outcome decision. Operations retain the
  // historical direct terminal verb until their own lifecycle workflow owns it.
  if (String(entityId).startsWith('BIZ-')) {
    const status = typeof flags.status === 'string' ? flags.status.trim() : '';
    if (!CLOSE_STATUSES.includes(status)) {
      throw new Error(`work close: Business --status must be one of ${CLOSE_STATUSES.join(', ')}`);
    }
    const actor = typeof flags.actor === 'string' ? flags.actor : 'agent';
    const outcomeInput = flags['outcome-ref'] ?? flags.outcomeRef ?? flags.outcome;
    const outcome = resolveOutcomeReference(root, jsonPath, outcomeInput);
    const closed = closeBusiness(entity, {
      status,
      outcomeRef: outcome.relative,
      actor,
      now: flags.now,
      note: typeof flags.note === 'string' ? flags.note : undefined,
    });
    if (apply && closed.changed) {
      writeFileEnsured(jsonPath, `${JSON.stringify(closed.business, null, 2)}\n`);
    }
    return makeReceipt({
      command: 'close',
      applied: Boolean(apply && closed.changed),
      writes: [jsonPath],
      detail: {
        id: entityId,
        fromStatus: closed.receipt.fromStatus,
        toStatus: closed.receipt.toStatus,
        outcomeRef: closed.receipt.outcomeRef,
        actor: closed.receipt.actor,
        idempotentNoop: closed.receipt.idempotentNoop,
      },
    });
  }

  const fromStatus = entity.status || 'draft';
  const updated = { ...entity, status: 'closed', updatedAt: today() };

  if (apply) {
    writeFileEnsured(jsonPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  return makeReceipt({
    command: 'close',
    applied: apply,
    writes: [jsonPath],
    detail: { id: entityId, fromStatus, toStatus: 'closed' },
  });
}

/**
 * Handles `work promote` — transfers ownership (`primaryContext`) of an entity.
 * HUMAN-GATED: `--actor human` is required; non-human actor throws immediately.
 *
 * Required flags: `--id`, `--actor human`, `--owner-type <type>`, `--owner-id <id>`.
 *
 * @param {{ flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on missing --id, non-human actor, or shape violations.
 */
export function handlePromote({ flags, apply, root }) {
  const entityId = flags.id;
  if (!entityId || typeof entityId !== 'string') throw new Error('work promote: --id is required');

  const actor = typeof flags.actor === 'string' ? flags.actor : 'agent';
  if (actor !== 'human') {
    throw new Error(
      `work promote REFUSED: actor "${actor}" is not "human". ` +
      'Re-parenting a governed entity is a human-only decision ' +
      '(work-decision-ownership §ctx.humanApproved + ADR-0125).',
    );
  }

  const newOwnerType = typeof flags['owner-type'] === 'string' ? flags['owner-type'].trim() : '';
  const newOwnerId = typeof flags['owner-id'] === 'string' ? flags['owner-id'].trim() : '';
  if (!newOwnerType || !newOwnerId) {
    throw new Error('work promote: --owner-type <type> and --owner-id <id> are required');
  }

  const jsonPath = resolveEntityJsonPath(root, String(entityId));
  const entity = readJson(jsonPath);
  const note = typeof flags.note === 'string' ? flags.note : undefined;

  const { entity: updated, receipt: ownerReceipt } = transferOwnership(
    entity,
    { type: newOwnerType, id: newOwnerId },
    { actor: 'human', humanApproved: true, note },
  );

  if (!updated) {
    throw new Error(`work promote REFUSED: ${ownerReceipt.message}`);
  }

  if (apply) {
    writeFileEnsured(jsonPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  return makeReceipt({
    command: 'promote',
    applied: apply,
    writes: [jsonPath],
    detail: {
      id: entityId,
      previousOwner: ownerReceipt.previousOwner,
      newOwner: ownerReceipt.newOwner,
      actor,
    },
  });
}
