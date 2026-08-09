/**
 * Ownership-transfer controls for governed entities (BIZ-0001 / WF-0037, B3-T1).
 *
 * CONTRACT (frozen — tests + B3-T2 depend on it via the re-export seam in
 * work-decision-supersede.mjs):
 *   `transferOwnership(entity, newOwner, ctx)` → `{ entity, receipt }`
 *
 * Core invariant (B0-T2-decision-domain-contract §2.2 rule 5):
 *   Re-parenting a governed entity (changing `primaryContext`) is a
 *   HUMAN-ONLY decision.  This function refuses unless BOTH:
 *     - `ctx.humanApproved === true`   (explicit sign-off flag)
 *     - `ctx.actor === 'human'`        (belt-and-suspenders actor check)
 *   A non-human actor OR a missing `humanApproved` flag → refused receipt, no throw.
 *
 * Pure — never writes to disk.  The caller applies the returned `entity` atomically.
 * Zero runtime deps (immutable rule 1).
 *
 * @module work-decision-ownership
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns an ISO timestamp from an injectable `now`.
 *
 * @param {unknown} now - optional Date | ISO string | epoch ms.
 * @returns {string}
 */
function isoNow(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'string' || typeof now === 'number') return new Date(now).toISOString();
  return new Date().toISOString();
}

/**
 * Derives a short date string `YYYY-MM-DD` from an ISO string.
 *
 * @param {string} iso - ISO-8601 string.
 * @returns {string}
 */
function toDateString(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/**
 * Builds a refused transfer result.  No throw — hooks must survive.
 *
 * @param {string} reason - machine-readable code.
 * @param {string} message - human-readable detail.
 * @param {string|null} actor
 * @param {string} at
 * @returns {{ entity: null, receipt: object }}
 */
function ownershipRefusal(reason, message, actor, at) {
  return {
    entity: null,
    receipt: { status: 'refused', reason, message, actor, at },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transfers the `primaryContext` (ownership) of a governed entity to a new owner.
 *
 * Refusals return `{ entity: null, receipt }`:
 *   - `ctx.humanApproved !== true`
 *   - `ctx.actor !== 'human'`
 *   - `entity` is not a non-null object
 *   - `newOwner` lacks a `type` or `id` string
 *
 * On success returns `{ entity: updatedEntity, receipt }` where `updatedEntity`
 * is a shallow clone with `primaryContext`, `contextType`, and `updatedAt`
 * replaced.  Nothing is written to disk.
 *
 * @param {object} entity - the entity whose `primaryContext` is being transferred.
 *   Expected shape: `{ id: string, primaryContext: { type, id }, contextType, ... }`.
 * @param {{ type: string, id: string }} newOwner - the new primary context.
 * @param {{
 *   actor: string,
 *   humanApproved: boolean,
 *   now?: Date|string|number,
 *   note?: string
 * }} ctx - action context.
 *   - `actor`         : MUST be `'human'`.
 *   - `humanApproved` : MUST be `true` (explicit sign-off, separate from actor).
 *   - `now`           : injectable timestamp.
 *   - `note`          : optional note recorded in the receipt.
 * @returns {{ entity: object|null, receipt: object }}
 */
export function transferOwnership(entity, newOwner, ctx = {}) {
  const at = isoNow(ctx.now);
  const actor = ctx && typeof ctx.actor === 'string' ? ctx.actor : null;

  // Guard 1 — explicit human-approval flag (separate from actor identity).
  if (ctx.humanApproved !== true) {
    return ownershipRefusal(
      'HUMAN_APPROVAL_REQUIRED',
      'transferOwnership requires ctx.humanApproved === true. ' +
      'Re-parenting a governed entity is a human-only decision (B0-T2 §2.2 rule 5).',
      actor,
      at,
    );
  }

  // Guard 2 — human actor (belt-and-suspenders alongside humanApproved).
  if (ctx.actor !== 'human') {
    return ownershipRefusal(
      'NON_HUMAN_ACTOR',
      `transferOwnership requires ctx.actor === 'human'; got "${ctx.actor}"`,
      actor,
      at,
    );
  }

  // Guard 3 — entity shape.
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    return ownershipRefusal('INVALID_ENTITY', 'entity must be a non-null, non-array object', 'human', at);
  }

  // Guard 4 — new owner shape.
  if (
    !newOwner || typeof newOwner !== 'object' ||
    typeof newOwner.type !== 'string' || !newOwner.type.trim() ||
    typeof newOwner.id !== 'string' || !newOwner.id.trim()
  ) {
    return ownershipRefusal(
      'INVALID_NEW_OWNER',
      'newOwner must be { type: string, id: string } with non-empty values',
      'human',
      at,
    );
  }

  const previousOwner = entity.primaryContext ? { ...entity.primaryContext } : null;
  const dateAt = toDateString(at);

  const updatedEntity = {
    ...entity,
    primaryContext: { type: newOwner.type, id: newOwner.id },
    contextType: newOwner.type,
    updatedAt: dateAt,
  };

  return {
    entity: updatedEntity,
    receipt: {
      status: 'transferred',
      entityId: entity.id || null,
      previousOwner,
      newOwner: { type: newOwner.type, id: newOwner.id },
      actor: 'human',
      humanApproved: true,
      at,
      note: typeof ctx.note === 'string' && ctx.note.trim() ? ctx.note.trim() : null,
    },
  };
}
