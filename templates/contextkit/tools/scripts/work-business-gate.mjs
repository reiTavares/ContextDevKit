/**
 * Business Gate — approval guard + authorized-workflow generation (BIZ-0001 /
 * WF-0036, A3-T2).
 *
 * `evaluateBusinessGate`: decides whether a Business may proceed to active
 * execution. Four conditions must ALL hold:
 *   1. status === 'confirmed'  (set only by a human via work-business-lifecycle)
 *   2. approval.actor === 'human'  (AI cannot self-approve)
 *   3. decisions.primary matches ADR-#### pattern
 *   4. approval.decisionHash === computeDecisionHash(primary ADR canonical fields)
 *      (tamper-evidence: if the ADR changed after approval the hash mismatches)
 *
 * `generateAuthorizedWorkflows`: returns workflow stubs ONLY when the gate passes
 * — constitution §8 refuse-default. Empty array when the gate is blocked.
 *
 * Zero runtime dependencies — `node:*` + sibling modules only (immutable rule 1).
 *
 * @module work-business-gate
 */
import { computeDecisionHash, extractCanonicalFields } from './work-decision-hash.mjs';

// ---------------------------------------------------------------------------
// Patterns & constants
// ---------------------------------------------------------------------------

/** `decisions.primary` must match ADR-#### for the gate to pass. */
const ADR_ID_PATTERN = /^ADR-\d{4}$/;

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates the four Business Gate conditions against a business entity.
 *
 * The `ctx.primaryAdrRecord` is the full parsed front-matter of the ADR whose
 * id equals `business.decisions.primary`. Callers must load it from disk and
 * pass it in — this function is PURE (no I/O).
 *
 * @param {object} business - the current business entity.
 * @param {{ primaryAdrRecord?: object }} [ctx]
 *   - `primaryAdrRecord`: parsed front-matter of the primary governing ADR.
 *     When omitted the hash check fails and gate blocks (fail-safe, §8).
 * @returns {{ pass: boolean, reasons: string[] }}
 *   `pass` true only when ALL conditions hold. `reasons` lists every failed
 *   condition so callers can surface the exact block reason.
 */
export function evaluateBusinessGate(business, ctx = {}) {
  const reasons = [];

  // Condition 1 — lifecycle must be 'confirmed' (human-approved)
  if (business.status !== 'confirmed') {
    reasons.push(
      `status is "${business.status || '(unset)'}" — must be "confirmed" (human-approved)`,
    );
  }

  // Condition 2 — approval.actor must be 'human'
  const approvalActor = business.approval && business.approval.actor;
  if (approvalActor !== 'human') {
    reasons.push(
      `approval.actor is "${approvalActor || '(unset)'}" — must be "human"`,
    );
  }

  // Condition 3 — decisions.primary must be an ADR-#### reference
  const primaryRef = business.decisions && business.decisions.primary;
  if (typeof primaryRef !== 'string' || !ADR_ID_PATTERN.test(primaryRef)) {
    reasons.push(
      `decisions.primary "${primaryRef || '(unset)'}" does not match ADR-#### — ` +
      'a governing ADR is required before execution',
    );
  }

  // Condition 4 — decision hash must match (tamper-evidence)
  const storedHash = business.approval && business.approval.decisionHash;
  const primaryAdrRecord = ctx && ctx.primaryAdrRecord;
  if (typeof primaryRef === 'string' && ADR_ID_PATTERN.test(primaryRef)) {
    if (!primaryAdrRecord || typeof primaryAdrRecord !== 'object') {
      reasons.push(
        `decision hash cannot be verified — primaryAdrRecord for "${primaryRef}" was not provided`,
      );
    } else {
      let computedHash;
      try {
        computedHash = computeDecisionHash(extractCanonicalFields(primaryAdrRecord));
      } catch (err) {
        reasons.push(`decision hash computation failed: ${err.message}`);
        computedHash = null;
      }
      if (computedHash !== null && storedHash !== computedHash) {
        reasons.push(
          `decision hash mismatch for "${primaryRef}": ` +
          `stored "${storedHash || '(none)'}" ≠ computed "${computedHash}". ` +
          'The ADR may have changed since approval — a human must re-approve.',
        );
      }
    }
  }

  return { pass: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Authorized workflow generation
// ---------------------------------------------------------------------------

/**
 * Builds a minimal workflow stub from the business context. This is a starting
 * template — the workflow engine's intake will expand it with wave/task details.
 *
 * @param {object} business - the approved business entity.
 * @param {number} index - zero-based sequence index (for the stub id suffix).
 * @returns {{ id: string, title: string, businessId: string, status: string, authorizedAt: string }}
 */
function buildWorkflowStub(business, index) {
  const suffix = String(index + 1).padStart(4, '0');
  return {
    id: `WF-${suffix}`,
    title: `Workflow ${suffix} — authorized under ${business.id}`,
    businessId: business.id || null,
    authorizedDecision: (business.decisions && business.decisions.primary) || null,
    status: 'authorized',
    authorizedAt: new Date().toISOString(),
  };
}

/**
 * Generates authorized workflow stubs from an approved Business entity.
 *
 * Returns an empty array when the Business Gate does not pass — constitution §8
 * refuse-default: only a passing gate unlocks workflow generation. The caller
 * may pass the same `ctx` used with `evaluateBusinessGate`.
 *
 * Stub count is derived from `business.workflows.planned` when present (max 10
 * for safety). When no planned count is declared, exactly one stub is generated
 * as the seed (constitution §9 — don't ship a speculative half).
 *
 * @param {object} business - the current business entity.
 * @param {{ primaryAdrRecord?: object }} [ctx]
 *   The same context passed to `evaluateBusinessGate`.
 * @returns {Array<{ id: string, title: string, businessId: string, status: string, authorizedAt: string }>}
 *   Array of workflow stubs, or empty array when the gate is blocked.
 */
export function generateAuthorizedWorkflows(business, ctx = {}) {
  const gate = evaluateBusinessGate(business, ctx);
  if (!gate.pass) return [];

  const plannedCount = business.workflows && typeof business.workflows.planned === 'number'
    ? Math.min(Math.max(1, Math.floor(business.workflows.planned)), 10)
    : 1;

  return Array.from({ length: plannedCount }, (_, index) => buildWorkflowStub(business, index));
}
