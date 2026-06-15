/**
 * evaluate-completion.mjs — Pure completion gate evaluator (CDK-040, ADR-0072).
 *
 * `evaluateCompletion` is the decision function for the `beforeCompletion` lifecycle
 * moment. It wraps the receipt-based `decide()` substrate and translates its output
 * into the canonical { decision, reasonCodes, remediation, detail } shape used by
 * the completion-gate hook.
 *
 * Anti-theatre invariant (ADR-0072 §8):
 *   A bypass is reported in `detail.bypassed` and NEVER counted as a reason code.
 *   Only genuinely missing capabilities (no receipt, no bypass) raise a reason code.
 *   This prevents theatre: a waiver is visible to auditors but does not create a
 *   false sense of "gate passed."
 *
 * Advisory mode rule:
 *   Advisory NEVER denies — the result is `warn` when reasonCodes are present.
 *   Guarded and strict modes produce `deny` on reasonCodes.
 *
 * PURE FUNCTION — zero I/O of its own. `decide()` performs the disk reads for
 * receipts and bypasses; this function supplies all inputs via parameters. No
 * `Date.now()` call — callers supply `now` so tests are deterministic.
 *
 * Zero runtime deps — imports only ./enforcement-modes.mjs.
 */
import { decide, resolveEnforcementMode } from './enforcement-modes.mjs';

// ---------------------------------------------------------------------------
// Main pure decision function
// ---------------------------------------------------------------------------

/**
 * Evaluates whether the task has produced the completion evidence required by
 * its execution contract. Returns the gate verdict in a uniform shape.
 *
 * Null contract or missing / empty `requiredBeforeCompletion` → always allow
 * silently (covers trivial-tier tasks and unregistered flows).
 *
 * @param {{
 *   contract: object|null,
 *   scope: { branch: string, taskId: string, paths?: string[] },
 *   mode: 'advisory'|'guarded'|'strict',
 *   root: string,
 *   now?: number
 * }} params
 * @returns {{
 *   decision: 'allow'|'warn'|'deny',
 *   reasonCodes: string[],
 *   remediation: string[],
 *   detail: { missing: string[], bypassed: string[], satisfied: string[] }
 * }}
 */
export function evaluateCompletion({ contract, scope, mode, root, now = Date.now() }) {
  const emptyResult = {
    decision: 'allow',
    reasonCodes: [],
    remediation: [],
    detail: { missing: [], bypassed: [], satisfied: [] },
  };

  // Null contract or no required completion capabilities → silent allow.
  if (contract == null) return emptyResult;
  const required = contract.requiredBeforeCompletion;
  if (!Array.isArray(required) || required.length === 0) return emptyResult;

  // Delegate receipt + bypass resolution to the substrate.
  const verdict = decide({ mode, contract, moment: 'beforeCompletion', scope, root, now });

  const reasonCodes = [];
  const remediation = [];

  // Anti-theatre: only MISSING capabilities raise a reason code.
  // Bypassed capabilities are surfaced in detail but do not count as missing.
  if (verdict.missing.length > 0) {
    reasonCodes.push('completion-evidence-missing');
    for (const cap of verdict.missing) {
      remediation.push(`Run /${cap} to produce the completion evidence required before declaring this task done.`);
    }
  }

  const detail = {
    missing: verdict.missing,
    bypassed: verdict.bypassed,
    satisfied: verdict.satisfied,
  };

  // Re-derive decision defensively from mode + reasonCodes, consistent with
  // the substrate verdict but anchored here in case of future substrate drift.
  const decision = deriveDecision(mode, reasonCodes);

  return { decision, reasonCodes, remediation, detail };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Translates (mode, reasonCodes) into the final allow/warn/deny decision.
 *
 * Advisory invariant: NEVER deny. Any reason codes → warn.
 * Guarded + strict: deny when reason codes are present (beforeCompletion is a
 * blocking moment for both; guarded blocks at beforeWrite and beforeCompletion
 * per the GUARDED_BLOCKING_MOMENTS set in enforcement-modes.mjs).
 *
 * @param {'advisory'|'guarded'|'strict'} mode
 * @param {string[]} reasonCodes
 * @returns {'allow'|'warn'|'deny'}
 */
function deriveDecision(mode, reasonCodes) {
  if (reasonCodes.length === 0) return 'allow';
  switch (mode) {
    case 'advisory':
      // Immutable advisory guarantee: never block at this layer.
      return 'warn';
    case 'guarded':
    case 'strict':
      return 'deny';
    default:
      // Unknown mode falls back to advisory-safe warn.
      return 'warn';
  }
}
