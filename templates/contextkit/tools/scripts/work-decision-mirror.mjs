/**
 * Approval mirroring — Business/Operation approval → exactly ONE accepted ADR
 * (BIZ-0001 / WF-0037, B3-T1).
 *
 * CONTRACT:
 *   `mirrorBusinessApproval(business, ctx)` → `{ adr, receipt }`
 *
 * Core invariants (from B0-T2-decision-domain-contract §3.2 + ADR-0102):
 *   1. A confirmed Business approval mirrors into exactly ONE accepted ADR with
 *      NO second approval ceremony — the ADR's `status: accepted` reflects the
 *      already-approved Business; it does not re-decide it.
 *   2. The acceptance step REQUIRES `ctx.actor === 'human'`.  An AI cannot
 *      self-accept; any non-human actor returns a REFUSAL receipt (no throw —
 *      hooks must be able to handle this without crashing the host session).
 *   3. `approvalSource.decisionHash` is reused from the Business approval block
 *      (computed by A3 `work-business-lifecycle.mjs`) — it is NOT re-computed
 *      here.  B3 only mirrors; A3 is the canonical hash authority.
 *   4. `adr` floor in `resolve-autonomy.mjs` is NOT touched — acceptance stays
 *      manual at every grade.  This module PREPARES the artifact; a human still
 *      accepts the ADR (pressing "apply" or equivalent).
 *
 * Zero runtime deps — `node:crypto` ok; rest is sibling imports (immutable rule 1).
 *
 * @module work-decision-mirror
 */
import { computeDecisionHash, extractCanonicalFields } from './work-decision-hash.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ADR id pattern — mirrors the canonical one in decision-enums.mjs. */
const ADR_ID_PATTERN = /^ADR-\d{4}$/;

/** Business statuses that constitute a confirmed approval. */
const CONFIRMED_STATUSES = Object.freeze(['confirmed', 'active', 'validated', 'partially-validated']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns a compact ISO date string from an injectable `now`.
 * Falls back to today when `now` is absent.
 *
 * @param {unknown} now - optional Date | ISO string | epoch ms.
 * @returns {string} ISO-8601 string.
 */
function isoNow(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'string' || typeof now === 'number') return new Date(now).toISOString();
  return new Date().toISOString();
}

/**
 * Derives a short date string `YYYY-MM-DD` from an ISO timestamp.
 *
 * @param {string} iso - ISO-8601 string.
 * @returns {string}
 */
function toDateString(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/**
 * Returns a structured REFUSAL receipt. Never throws — so the caller (or a
 * hook) can surface the reason without crashing.
 *
 * @param {string} reason - machine-readable code.
 * @param {string} message - human-readable detail.
 * @param {unknown} [ctx] - the ctx passed to the caller.
 * @returns {{ adr: null, receipt: object }}
 */
function refusal(reason, message, ctx) {
  return {
    adr: null,
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
 * Validates that `business` is in an approved state (status ∈ CONFIRMED_STATUSES)
 * and has a non-null `approval` block with a `decision` (ADR-####) reference.
 *
 * @param {object} business - the business entity.
 * @returns {{ ok: boolean, reason?: string, message?: string }}
 */
function validateBusinessApproval(business) {
  if (!business || typeof business !== 'object') {
    return { ok: false, reason: 'INVALID_BUSINESS', message: 'business must be a non-null object' };
  }
  if (!CONFIRMED_STATUSES.includes(business.status)) {
    return {
      ok: false,
      reason: 'NOT_CONFIRMED',
      message: `business.status is "${business.status}" — must be in ${JSON.stringify([...CONFIRMED_STATUSES])} before mirroring`,
    };
  }
  const approval = business.approval;
  if (!approval || typeof approval !== 'object') {
    return { ok: false, reason: 'MISSING_APPROVAL', message: 'business.approval block is absent' };
  }
  if (approval.actor !== 'human') {
    return {
      ok: false,
      reason: 'APPROVAL_NOT_HUMAN',
      message: `business.approval.actor is "${approval.actor}" — only human-approved businesses may be mirrored`,
    };
  }
  if (typeof approval.decision !== 'string' || !ADR_ID_PATTERN.test(approval.decision)) {
    return {
      ok: false,
      reason: 'MISSING_ADR_REFERENCE',
      message: `business.approval.decision "${approval.decision || '(unset)'}" does not match ADR-#### — a governing ADR reference is required`,
    };
  }
  return { ok: true };
}

/**
 * Builds the `approvalSource` block for the mirrored ADR. Reuses the hash
 * already present in the Business approval (A3's canonical hash).  If the
 * Business has no stored hash, a fresh one is computed from the primaryAdrRecord
 * when provided (defensive fallback).
 *
 * @param {object} business - the confirmed business.
 * @param {object|null} primaryAdrRecord - parsed front matter of the ADR.
 * @param {string} at - ISO acceptance timestamp.
 * @returns {object} approvalSource block.
 */
function buildApprovalSource(business, primaryAdrRecord, at) {
  const approval = business.approval;
  const revision = typeof approval.revision === 'number' ? approval.revision : 1;

  // Reuse A3's stored hash; fall back to recomputing only if absent.
  let decisionHash = approval.decisionHash || null;
  if (!decisionHash && primaryAdrRecord && typeof primaryAdrRecord === 'object') {
    try {
      decisionHash = computeDecisionHash(extractCanonicalFields(primaryAdrRecord));
    } catch (_) {
      decisionHash = null;
    }
  }

  return {
    type: 'business',
    id: business.id || null,
    revision,
    decisionHash,
    approvedAt: toDateString(approval.approvedAt || at),
    actor: 'human',
  };
}

/**
 * Produces the minimal accepted ADR record (front-matter fields) from a confirmed
 * Business approval. The record is DRY-RUN ready — the caller feeds it to
 * `decision-template.mjs` for the Markdown render + atomic write.
 *
 * Fields derived from `business`:
 *   - `id` — from `business.approval.decision` (ADR-####)
 *   - `title` — from `business.title`
 *   - `primaryContext` — `{ type: 'business', id: business.id }`
 *   - `contextType` — `'business'`
 *   - `approvalSource` — built here with `actor: 'human'`
 *   - `status` — always `'accepted'` (the mirror state)
 *   - `decisionKind` — `ctx.decisionKind` || `'BUSINESS_AUTHORIZATION'`
 *
 * @param {object} business - the confirmed business entity.
 * @param {object} ctx - action context.
 * @param {string} at - ISO acceptance timestamp.
 * @returns {object} partial ADR front-matter record.
 */
function buildAdrRecord(business, ctx, at) {
  const primaryAdrRecord = ctx.primaryAdrRecord || null;
  const adrId = business.approval.decision;
  const decisionKind = typeof ctx.decisionKind === 'string' ? ctx.decisionKind : 'BUSINESS_AUTHORIZATION';
  const decisionScope = typeof ctx.decisionScope === 'string' ? ctx.decisionScope : 'business';

  return {
    schemaVersion: 2,
    id: adrId,
    title: typeof business.title === 'string' ? business.title : `Authorization — ${adrId}`,
    status: 'accepted',
    contextType: 'business',
    primaryContext: { type: 'business', id: business.id || null },
    relatedContexts: Array.isArray(ctx.relatedContexts) ? ctx.relatedContexts : [],
    decisionKind,
    decisionScope,
    approvalSource: buildApprovalSource(business, primaryAdrRecord, at),
    supersedes: [],
    supersededBy: null,
    createdAt: toDateString(at),
    acceptedAt: toDateString(at),
    updatedAt: toDateString(at),
    // NOTE: valueIntents, product, governs, tags are caller-supplied via ctx.adrOverrides.
    // They are spread AFTER so callers can provide the full schema-valid front matter.
    ...(ctx.adrOverrides && typeof ctx.adrOverrides === 'object' ? ctx.adrOverrides : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mirrors a confirmed Business approval into exactly ONE accepted-ADR record.
 *
 * Rules enforced:
 *   - `ctx.actor` MUST be `'human'` to produce an acceptance — non-human returns a
 *     REFUSED receipt with `adr: null` (no throw, hooks must survive).
 *   - The business MUST be in a confirmed status with a human `approval` block and a
 *     valid `ADR-####` reference in `approval.decision`.
 *   - No second approval ceremony: the ADR's `status: 'accepted'` reflects the
 *     already-approved Business; it does NOT re-decide it.
 *   - The `decisionHash` is reused from the Business approval block (A3's authority).
 *
 * @param {object} business - the confirmed business entity (not mutated).
 * @param {{
 *   actor: string,
 *   now?: Date|string|number,
 *   decisionKind?: string,
 *   decisionScope?: string,
 *   relatedContexts?: object[],
 *   primaryAdrRecord?: object,
 *   adrOverrides?: object
 * }} ctx - action context.
 *   - `actor`          : MUST be `'human'` for acceptance to proceed.
 *   - `now`            : injectable timestamp (deterministic testing).
 *   - `decisionKind`   : ADR kind (default `'BUSINESS_AUTHORIZATION'`).
 *   - `decisionScope`  : ADR scope (default `'business'`).
 *   - `relatedContexts`: optional secondary context links.
 *   - `primaryAdrRecord`: parsed front matter of the governing ADR (for hash fallback).
 *   - `adrOverrides`   : additional front-matter fields (valueIntents, product, governs…).
 * @returns {{ adr: object|null, receipt: object }}
 *   `adr` is the accepted ADR front-matter record (not yet written to disk).
 *   `receipt` describes the outcome. `adr` is null on any refusal.
 */
export function mirrorBusinessApproval(business, ctx = {}) {
  const at = isoNow(ctx.now);

  // Guard 1 — human actor required for the acceptance step.
  if (!ctx || ctx.actor !== 'human') {
    return refusal(
      'NON_HUMAN_ACTOR',
      `ADR acceptance requires ctx.actor === 'human'; got "${ctx && ctx.actor !== undefined ? ctx.actor : '(absent)'}"` +
      ' — AI cannot self-accept an ADR at any autonomy grade (resolve-autonomy.mjs §adr floor).',
      ctx,
    );
  }

  // Guard 2 — business approval pre-conditions.
  const businessCheck = validateBusinessApproval(business);
  if (!businessCheck.ok) {
    return refusal(businessCheck.reason, businessCheck.message, ctx);
  }

  // Build the single accepted ADR record.
  const adr = buildAdrRecord(business, ctx, at);

  const receipt = {
    status: 'mirrored',
    adrId: adr.id,
    businessId: business.id || null,
    approvalSource: adr.approvalSource,
    actor: 'human',
    at,
    note: 'Exactly one accepted ADR produced from Business approval — no second ceremony.',
  };

  return { adr, receipt };
}
