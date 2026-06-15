/**
 * compaction-continuity-core.mjs — pure helper for compaction continuity
 * (CDK-042, ADR-0072).
 *
 * Extracted to keep the hook file within the 280-line budget AND to make
 * the obligation-summarization logic testable without I/O.
 *
 * Single export: `summarizeObligations({ contract, receipts, scope, now })`
 *
 * PURE: zero I/O, no Date.now() in the call path (callers pass `now`).
 * Zero runtime deps — only node:* standard lib needed (none used here).
 */
import { isReceiptValid } from './receipt-store.mjs';

// ---------------------------------------------------------------------------
// Types (JSDoc only — no runtime overhead)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ moment: 'beforeWrite'|'beforeCompletion', capability: string }} OutstandingObligation
 */

// ---------------------------------------------------------------------------
// Moments that are surfaced at compaction resume
// ---------------------------------------------------------------------------

/** The two moments checked at a compaction boundary (exploration is excluded). */
const RESUME_MOMENTS = [
  { moment: 'beforeWrite', field: 'requiredBeforeWrite' },
  { moment: 'beforeCompletion', field: 'requiredBeforeCompletion' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the list of capability obligations that are still outstanding
 * (unsatisfied and not bypassed) at the time of a compaction resume.
 *
 * Only `beforeWrite` and `beforeCompletion` moments are surfaced — these are
 * the moments that block real work. `beforeExploration` is too early in the
 * lifecycle to be actionable at a compaction boundary.
 *
 * A receipt is considered satisfied when `isReceiptValid` returns `valid: true`
 * for the provided scope. Any capability without a passing, non-expired,
 * scope-matched receipt is counted as outstanding.
 *
 * Anti-theatre (ADR-0072 §8): bypassed capabilities are NOT counted as
 * satisfied — they remain in the outstanding list. The hook that calls this
 * function makes the call to surface or suppress them.
 *
 * @param {{
 *   contract: object,
 *   receipts: object[],
 *   scope: { branch: string, taskId: string, paths?: string[] },
 *   now: number
 * }} params
 * @returns {OutstandingObligation[]} stable order (beforeWrite before beforeCompletion)
 */
export function summarizeObligations({ contract, receipts, scope, now }) {
  if (!contract || typeof contract !== 'object') return [];
  if (!Array.isArray(receipts)) return [];

  // Index receipts by capability for O(1) lookup.
  /** @type {Map<string, object>} */
  const receiptByCapability = new Map();
  for (const receipt of receipts) {
    if (receipt && typeof receipt.capability === 'string') {
      // When multiple receipts exist for the same capability (e.g. re-runs),
      // keep the one with the latest createdAt so we always test the freshest.
      const existing = receiptByCapability.get(receipt.capability);
      if (!existing || (receipt.createdAt ?? 0) > (existing.createdAt ?? 0)) {
        receiptByCapability.set(receipt.capability, receipt);
      }
    }
  }

  /** @type {OutstandingObligation[]} */
  const outstanding = [];

  for (const { moment, field } of RESUME_MOMENTS) {
    const required = Array.isArray(contract[field]) ? contract[field] : [];
    for (const capability of required) {
      const receipt = receiptByCapability.get(capability) ?? null;
      const { valid } = isReceiptValid(receipt, scope, now);
      if (!valid) {
        outstanding.push({ moment, capability });
      }
    }
  }

  return outstanding;
}
