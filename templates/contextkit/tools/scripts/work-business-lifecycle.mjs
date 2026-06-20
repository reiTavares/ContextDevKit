/**
 * Business lifecycle transitions (BIZ-0001 / WF-0036, A3-T2).
 *
 * Single source of truth for the draft → propose → approve → revise → reject
 * flow and the revision-history append. A3-T2 is the ONLY code that may set
 * `status === 'confirmed'` — no other module emits that state.
 *
 * CRITICAL INVARIANT (enforced here + in resolve-autonomy.mjs `adr` floor):
 *   AI cannot self-approve a Business. `approve` REQUIRES `ctx.actor === 'human'`.
 *   Any call with a non-human actor is a hard refusal (throws `ApprovalActorError`
 *   with a structured receipt). This check CANNOT be weakened by any grade or
 *   configuration — it mirrors the `adr` area's `manual` floor.
 *
 * Zero runtime dependencies — `node:*` + sibling modules only (immutable rule 1).
 *
 * @module work-business-lifecycle
 */
import { computeDecisionHash, extractCanonicalFields } from './work-decision-hash.mjs';

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

/**
 * Legal status transitions for the Business lifecycle. Terminal states have
 * an empty target list. `confirmed` is the internal name for approved+hash.
 * Matches `schema-business.mjs` lifecycle list (frozen authoritative source).
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['proposed']),
  proposed: Object.freeze(['needs-revision', 'confirmed', 'rejected']),
  'needs-revision': Object.freeze(['proposed']),
  confirmed: Object.freeze(['active', 'paused', 'needs-revision']),
  active: Object.freeze(['paused', 'validated', 'partially-validated', 'closed']),
  paused: Object.freeze(['active', 'closed']),
  validated: Object.freeze(['closed']),
  'partially-validated': Object.freeze(['validated', 'closed']),
  invalidated: Object.freeze(['closed']),
  closed: Object.freeze([]),
  rejected: Object.freeze([]),
});

/**
 * Maps the public action verb to the resulting status transition target.
 * `approve` → `confirmed` is A3-T2's exclusive transition (only actor=human).
 *
 * @type {Readonly<Record<string, string>>}
 */
const ACTION_TO_TARGET = Object.freeze({
  draft: 'draft',
  propose: 'proposed',
  approve: 'confirmed',
  revise: 'needs-revision',
  reject: 'rejected',
});

// ---------------------------------------------------------------------------
// Guard: AI-cannot-self-approve
// ---------------------------------------------------------------------------

/**
 * Validates that the `approve` action is being performed by a human actor.
 * This check is the primary enforcement point for the CRITICAL INVARIANT.
 *
 * The error is structured (not a plain string) so callers can distinguish a
 * refused-approval from an unexpected failure. The error's `refusal` property
 * carries a receipt-compatible detail.
 *
 * @param {object} ctx - action context.
 * @param {string} ctx.actor - the acting identity ('human', 'agent', or any string).
 * @throws {Error} with `code: 'APPROVAL_ACTOR_REFUSED'` when actor is not human.
 */
function assertHumanActor(ctx) {
  if (ctx.actor === 'human') return;
  const actor = typeof ctx.actor === 'string' ? ctx.actor : '(unknown)';
  const err = new Error(
    `Business approve REFUSED: actor "${actor}" is not "human". ` +
    'AI cannot self-approve a Business at any autonomy grade. ' +
    'This is a permanent floor — see resolve-autonomy.mjs §adr + ADR-0102.',
  );
  err.code = 'APPROVAL_ACTOR_REFUSED';
  err.refusal = { actor, reason: 'non-human-actor', action: 'approve' };
  throw err;
}

// ---------------------------------------------------------------------------
// Transition helpers
// ---------------------------------------------------------------------------

/**
 * Returns an ISO date string. Accepts an injected `now` for deterministic
 * testing — falls back to `new Date()` in production.
 *
 * @param {unknown} now - optional override (Date | string | number).
 * @returns {string} ISO-8601 date string.
 */
function isoNow(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'string' || typeof now === 'number') return new Date(now).toISOString();
  return new Date().toISOString();
}

/**
 * Asserts that a transition from `current` to `target` is legal per the state
 * machine. Throws descriptively on violation (fail-fast, constitution §4).
 *
 * @param {string} current - current status.
 * @param {string} target - proposed next status.
 * @param {string} action - the action name (for the error message).
 * @throws {Error} when the transition is not in the legal table.
 */
function assertLegalTransition(current, target, action) {
  const allowed = STATUS_TRANSITIONS[current];
  if (!Array.isArray(allowed) || !allowed.includes(target)) {
    throw new Error(
      `Business lifecycle: action "${action}" transitions "${current}" → "${target}" ` +
      `which is not a legal move. Allowed targets from "${current}": ` +
      (Array.isArray(allowed) ? (allowed.join(', ') || '(none — terminal state)') : '(unknown state)'),
    );
  }
}

/**
 * Appends a revision entry to the business revision history. Creates the
 * `revisions` array if it is missing (defensive initialisation).
 *
 * @param {object} business - the mutable business clone.
 * @param {string} action - the transition action name.
 * @param {string} fromStatus - the status before the transition.
 * @param {string} toStatus - the status after the transition.
 * @param {object} ctx - action context.
 * @returns {void}
 */
function appendRevision(business, action, fromStatus, toStatus, ctx) {
  if (!Array.isArray(business.revisions)) business.revisions = [];
  business.revisions.push({
    action,
    fromStatus,
    toStatus,
    actor: typeof ctx.actor === 'string' ? ctx.actor : null,
    at: isoNow(ctx.now),
    note: typeof ctx.note === 'string' && ctx.note.trim() ? ctx.note.trim() : null,
  });
}

/**
 * Stamps the `approval` block after a successful human approve transition.
 * Recomputes the `decisionHash` from the primary ADR's canonical fields.
 *
 * @param {object} business - the mutable business clone.
 * @param {object} ctx - action context (actor, now, primaryAdr).
 * @returns {void}
 */
function stampApproval(business, ctx) {
  const primaryAdr = ctx.primaryAdr || null;
  const decisionHash = primaryAdr ? computeDecisionHash(extractCanonicalFields(primaryAdr)) : null;
  const revision = Array.isArray(business.revisions) ? business.revisions.length : 1;
  business.approval = {
    actor: 'human',
    revision,
    approvedAt: isoNow(ctx.now),
    decision: primaryAdr ? (primaryAdr.id || null) : null,
    decisionHash,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Applies a lifecycle action to a Business entity, returning the updated
 * business object plus a structured receipt. PURE LOGIC — never writes to disk.
 * Callers (work.mjs `approve` / `revise` / `reject` handlers) own I/O.
 *
 * A3-T2 EXCLUSIVITY: `approve` is the only path that sets `status = 'confirmed'`.
 * No other module emits that state. The human-actor guard is the enforcement.
 *
 * @param {object} business - the current business entity (will NOT be mutated;
 *   a shallow clone + deep `approval`/`revisions` copy is returned).
 * @param {'draft'|'propose'|'approve'|'revise'|'reject'} action - the lifecycle action.
 * @param {{ actor: string, now?: Date|string|number, note?: string, primaryAdr?: object }} ctx
 *   - `actor`     : 'human' or an AI/agent identifier (approve refuses non-human).
 *   - `now`       : injectable timestamp for deterministic testing.
 *   - `note`      : optional human note appended to the revision entry.
 *   - `primaryAdr`: parsed front-matter of the governing ADR (required for approve).
 * @returns {{ business: object, receipt: object }}
 * @throws {Error} when the action is unknown, the transition is illegal, or the
 *   actor is not human on `approve`.
 */
export function transition(business, action, ctx = {}) {
  if (!ACTION_TO_TARGET[action]) {
    throw new Error(`Business lifecycle: unknown action "${action}". Valid: ${Object.keys(ACTION_TO_TARGET).join(', ')}`);
  }
  if (action === 'approve') assertHumanActor(ctx);

  const fromStatus = typeof business.status === 'string' ? business.status : 'draft';
  const toStatus = ACTION_TO_TARGET[action];
  assertLegalTransition(fromStatus, toStatus, action);

  // Shallow-clone the business; deep-copy the mutable sub-objects.
  const updated = {
    ...business,
    status: toStatus,
    revisions: Array.isArray(business.revisions) ? [...business.revisions] : [],
    approval: business.approval ? { ...business.approval } : {
      actor: null, revision: 0, approvedAt: null, decision: null, decisionHash: null,
    },
  };

  appendRevision(updated, action, fromStatus, toStatus, ctx);
  if (action === 'approve') stampApproval(updated, ctx);

  const receipt = {
    action,
    fromStatus,
    toStatus,
    actor: ctx.actor || null,
    at: isoNow(ctx.now),
    decisionHash: action === 'approve' ? (updated.approval.decisionHash || null) : null,
  };

  return { business: updated, receipt };
}
