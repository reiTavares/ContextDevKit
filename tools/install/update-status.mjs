/**
 * Frozen status constants for the ContextDevKit updater safety layer.
 *
 * Every status string equals its own identifier name (stable, grep-friendly).
 * Consumers import the constants rather than comparing raw strings so that a
 * typo in a branch guard produces a reference error at load time, not a silent
 * wrong-path at runtime.
 *
 * Design: "default to refuse / opt-in to permit" — any non-null, non-UPDATED
 * status is a refusal that the caller must explicitly override.
 */

/** Update completed successfully. */
export const UPDATED = 'UPDATED';

/**
 * Update applied, but one or more personalization conflicts were preserved
 * unresolved in a non-interactive run (both sides kept, kit versions stashed).
 * Honest status [P0-07]: NOT a clean success — the user must merge by hand.
 */
export const UPDATED_WITH_PENDING_MERGES = 'UPDATED_WITH_PENDING_MERGES';

/**
 * One or more active sessions were detected in the target project and
 * `args.allowActiveSessions` was not set. Update deferred to protect
 * in-flight work.
 */
export const DEFERRED_ACTIVE_SESSIONS = 'DEFERRED_ACTIVE_SESSIONS';

/**
 * The installer source overlaps the target project (self-hosting scenario)
 * and `args.allowSelfUpdate` was not set. Update deferred to avoid
 * modifying the running installer's own files mid-execution.
 */
export const DEFERRED_SELF_UPDATE = 'DEFERRED_SELF_UPDATE';

/**
 * At least one file conflict could not be automatically resolved; the update
 * was aborted before any write was attempted.
 */
export const FAILED_CONFLICT = 'FAILED_CONFLICT';

/**
 * The pre-update snapshot could not be completed or its integrity check
 * failed. Update aborted to ensure a rollback path exists before mutation.
 */
export const FAILED_SNAPSHOT = 'FAILED_SNAPSHOT';

/**
 * Preflight validation detected an invalid target state (e.g. corrupt config,
 * unresolvable path, insufficient permissions). Update aborted.
 */
export const FAILED_VALIDATION = 'FAILED_VALIDATION';

// ---------------------------------------------------------------------------
// Predicate helpers
// ---------------------------------------------------------------------------

/** All deferred statuses — update did not proceed, no writes were made. */
const DEFERRED_SET = new Set([DEFERRED_ACTIVE_SESSIONS, DEFERRED_SELF_UPDATE]);

/** All failure statuses — update attempted or aborted due to an error. */
const FAILURE_SET = new Set([FAILED_CONFLICT, FAILED_SNAPSHOT, FAILED_VALIDATION]);

/**
 * Returns true when the status represents a deferral (safe stop, no writes).
 * @param {string} status
 * @returns {boolean}
 */
export function isDeferred(status) {
  return DEFERRED_SET.has(status);
}

/**
 * Returns true when the status represents a hard failure (update aborted).
 * @param {string} status
 * @returns {boolean}
 */
export function isFailure(status) {
  return FAILURE_SET.has(status);
}
