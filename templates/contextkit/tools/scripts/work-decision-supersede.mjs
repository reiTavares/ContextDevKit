/**
 * ADR supersession controls (BIZ-0001 / WF-0037, B3-T1).
 *
 * CONTRACT (frozen — tests + B3-T2 depend on it):
 *   `supersede(oldAdr, newAdrFields, ctx)` → `{ newAdr, oldPatch, oldStatus, receipt }`
 *   `isGoverning(adr)` → boolean
 *   `transferOwnership(entity, newOwner, ctx)` → `{ entity, receipt }`
 *      (re-exported from work-decision-ownership.mjs — single import seam for B3-T2)
 *
 * Core invariants:
 *   1. A superseded ADR is REJECTED as governing.  `isGoverning` returns false for
 *      `status` in `['superseded', 'rejected', 'legacy']`; only `'accepted'` is true.
 *      (B0-T2-decision-domain-contract §4, SUPERSEDED_NOT_GOVERNING mode).
 *   2. Supersession writes a NEW ADR AND patches the old one: returns `newAdr` (the
 *      new front-matter, not yet on disk) + `oldPatch` (minimal field-set to apply
 *      atomically to the old file) + `oldStatus: 'superseded'`.
 *   3. Human-gated: `ctx.actor === 'human'` required for supersession.  Non-human
 *      returns a refused receipt — no throw (hooks must survive).
 *   4. `adr` floor in `resolve-autonomy.mjs` is NOT changed — B3-T1 only PREPARES
 *      artifacts; a human still accepts/applies them.
 *
 * Zero runtime deps — `node:crypto` ok; rest is sibling imports (immutable rule 1).
 * File cohesion note: supersede + isGoverning share the same invariant set
 * (governing-status + status-transition table) — kept together to avoid a single
 * three-line helper becoming a new file (constitution §1 split-when-seam-emerges).
 *
 * @module work-decision-supersede
 */
import { computeDecisionHash, extractCanonicalFields } from './work-decision-hash.mjs';
import { isLegalStatusTransition } from '../../runtime/work/decision-enums.mjs';
export { transferOwnership } from './work-decision-ownership.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ADR id pattern — mirrors the canonical one in decision-enums.mjs. */
const ADR_ID_PATTERN = /^ADR-\d{4}$/;

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
 * Builds a REFUSAL receipt (no throw — hooks must survive).
 *
 * @param {string} reason - machine-readable code.
 * @param {string} message - human-readable detail.
 * @param {unknown} [ctx] - the original ctx.
 * @returns {{ newAdr: null, oldPatch: null, oldStatus: null, receipt: object }}
 */
function supersessionRefusal(reason, message, ctx) {
  return {
    newAdr: null,
    oldPatch: null,
    oldStatus: null,
    receipt: {
      status: 'refused',
      reason,
      message,
      actor: ctx && typeof ctx.actor === 'string' ? ctx.actor : null,
      at: isoNow(ctx && ctx.now),
    },
  };
}

/**
 * Validates the `oldAdr` being superseded: must be an object with a valid `id`
 * and a status from which `'superseded'` is a legal transition.
 *
 * @param {unknown} oldAdr
 * @returns {{ ok: boolean, reason?: string, message?: string }}
 */
function validateOldAdr(oldAdr) {
  if (!oldAdr || typeof oldAdr !== 'object' || Array.isArray(oldAdr)) {
    return { ok: false, reason: 'INVALID_OLD_ADR', message: 'oldAdr must be a non-null, non-array object' };
  }
  if (typeof oldAdr.id !== 'string' || !ADR_ID_PATTERN.test(oldAdr.id)) {
    return { ok: false, reason: 'INVALID_OLD_ADR_ID', message: `oldAdr.id "${oldAdr.id}" does not match ADR-#### pattern` };
  }
  if (!isLegalStatusTransition(oldAdr.status, 'superseded')) {
    return {
      ok: false,
      reason: 'ILLEGAL_TRANSITION',
      message: `Cannot supersede ADR with status "${oldAdr.status}" — that transition is not legal`,
    };
  }
  return { ok: true };
}

/**
 * Validates that `newAdrFields` has a distinct, valid `id`.
 *
 * @param {object} newAdrFields
 * @param {string} oldId
 * @returns {{ ok: boolean, reason?: string, message?: string }}
 */
function validateNewAdrFields(newAdrFields, oldId) {
  if (!newAdrFields || typeof newAdrFields !== 'object' || Array.isArray(newAdrFields)) {
    return { ok: false, reason: 'INVALID_NEW_ADR_FIELDS', message: 'newAdrFields must be a non-null, non-array object' };
  }
  if (typeof newAdrFields.id !== 'string' || !ADR_ID_PATTERN.test(newAdrFields.id)) {
    return { ok: false, reason: 'INVALID_NEW_ADR_ID', message: `newAdrFields.id "${newAdrFields.id}" does not match ADR-####` };
  }
  if (newAdrFields.id === oldId) {
    return { ok: false, reason: 'SAME_ADR_ID', message: 'newAdrFields.id must differ from oldAdr.id — supersession creates a NEW ADR' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns whether an ADR is the GOVERNING decision.
 *
 * Only `status === 'accepted'` is governing.  `'proposed'`, `'superseded'`,
 * `'rejected'`, and `'legacy'` are all non-governing.  This is the single
 * authority for the B0-T2 §4 `SUPERSEDED_NOT_GOVERNING` invariant — B3's
 * coverage gate calls this before accepting any ADR as coverage evidence.
 *
 * @param {unknown} adr - ADR front-matter record (or any object with `status`).
 * @returns {boolean}
 */
export function isGoverning(adr) {
  if (!adr || typeof adr !== 'object' || Array.isArray(adr)) return false;
  return typeof adr.status === 'string' && adr.status === 'accepted';
}

/**
 * Supersedes an ADR: produces the NEW ADR record and a patch for the old one.
 *
 * Dry-run by design — nothing is written to disk.  The caller feeds `newAdr`
 * to `decision-template.mjs` and applies `oldPatch` atomically to the existing
 * file.  A human then accepts the new ADR (per the `adr` autonomy floor).
 *
 * Refusals return `{ newAdr: null, oldPatch: null, oldStatus: null, receipt }`:
 *   - `ctx.actor !== 'human'`
 *   - `oldAdr` has an illegal status transition
 *   - `newAdrFields.id` is missing, invalid, or equals `oldAdr.id`
 *
 * @param {object} oldAdr - full ADR front-matter being superseded.
 * @param {object} newAdrFields - fields for the new superseding ADR.
 *   Required: `id` (ADR-####). Other v2 fields (title, contextType, etc.) are
 *   caller-supplied; missing fields produce a partial (not schema-valid) record
 *   that the caller must complete before the render step.
 * @param {{ actor: string, now?: Date|string|number, note?: string }} ctx
 * @returns {{ newAdr: object|null, oldPatch: object|null, oldStatus: 'superseded'|null, receipt: object }}
 */
export function supersede(oldAdr, newAdrFields, ctx = {}) {
  const at = isoNow(ctx.now);

  if (!ctx || ctx.actor !== 'human') {
    return supersessionRefusal(
      'NON_HUMAN_ACTOR',
      `Supersession requires ctx.actor === 'human'; got "${ctx && ctx.actor !== undefined ? ctx.actor : '(absent)'}"`,
      ctx,
    );
  }

  const oldCheck = validateOldAdr(oldAdr);
  if (!oldCheck.ok) return supersessionRefusal(oldCheck.reason, oldCheck.message, ctx);

  const newCheck = validateNewAdrFields(newAdrFields, oldAdr.id);
  if (!newCheck.ok) return supersessionRefusal(newCheck.reason, newCheck.message, ctx);

  const dateAt = toDateString(at);

  // Build the new ADR.  Caller fields win on everything except the supersession
  // lineage keys (supersedes, id) which must be correct for integrity.
  const newAdr = {
    schemaVersion: 2,
    status: 'proposed',         // New ADR starts proposed — human must accept.
    supersedes: [oldAdr.id],    // Lineage link.
    supersededBy: null,
    createdAt: dateAt,
    updatedAt: dateAt,
    ...newAdrFields,            // Caller fields (title, contextType, etc.) last.
    id: newAdrFields.id,        // Validated — must not be overrideable by spread.
  };

  // Hash of the new ADR (for future approvalSource stamping by the caller).
  let newAdrHash = null;
  try { newAdrHash = computeDecisionHash(extractCanonicalFields(newAdr)); } catch (_) { /* defensive */ }

  // Minimal patch for the old ADR file.
  const oldPatch = { status: 'superseded', supersededBy: newAdrFields.id, updatedAt: dateAt };

  return {
    newAdr,
    oldPatch,
    oldStatus: 'superseded',
    receipt: {
      status: 'superseded',
      oldAdrId: oldAdr.id,
      newAdrId: newAdrFields.id,
      oldStatus: 'superseded',
      newAdrHash,
      actor: 'human',
      at,
      note: typeof ctx.note === 'string' && ctx.note.trim() ? ctx.note.trim() : null,
    },
  };
}
