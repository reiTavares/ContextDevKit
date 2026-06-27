/**
 * gate-enforcement-decision.mjs — Pure block/degrade decision for the execution gate.
 *
 * Implements the "mandatory-with-graceful-fallback" enforcement rule for the intake/
 * ceremony gate (OP-0005 / ADR-0125, Wave 5):
 *   - Returns action='block' ONLY when all five conditions hold (guarded/strict mode,
 *     non-degraded contract on disk, deny verdict, ceremony capability missing, and
 *     signals.work was confidently computed).
 *   - Degrades to action='warn' (exit 0, never block) for any degrade condition.
 *
 * Constitution §8: degrade to false-positive (warn when uncertain), never to
 * false-negative (block when uncertain).
 *
 * Pure — zero I/O. Inputs → {action, reason, reasonCode}. Unit-testable standalone.
 * Zero runtime deps (no node:* imports needed — pure logic only).
 */

/** Ceremony capabilities that warrant blocking when missing (intake/contract gates). */
const CEREMONY_CAPS = new Set(['intake-completed', 'adr-required']);

/**
 * @typedef {object} GateContext
 * @property {'advisory'|'guarded'|'strict'} mode
 * @property {object|null} contract       — loaded contract object (null = not on disk)
 * @property {'allow'|'warn'|'deny'} decision
 * @property {string[]} missedCapabilities — capabilities that are missing
 * @property {object|null} signalsWork    — signals.work from the contract (may be null)
 * @property {boolean} registryLoadFailed — true when policy/registry load threw
 * @property {boolean} taskRegistered    — false when no task id / no active task
 */

/**
 * Decides block vs degrade for the enforcement gate.
 *
 * Blocks ONLY when ALL five conditions hold:
 *   (1) mode is guarded or strict
 *   (2) contract exists and is non-degraded (non-null)
 *   (3) verdict is deny
 *   (4) at least one missing capability is a ceremony cap (intake-completed | adr-required)
 *   (5) signalsWork was computed (non-null) AND confidence !== 'ask'
 *
 * Degrades (warn, exit 0) when ANY degrade condition holds:
 *   - mode is advisory
 *   - no contract on disk
 *   - signalsWork is null / confidence === 'ask'
 *   - registry/policy load failed
 *   - task is unregistered
 *   - missing capability is NOT a ceremony cap
 *   - any thrown error (the outer catch handles that)
 *
 * @param {GateContext} ctx
 * @returns {{ action: 'block'|'warn', reason: string, reasonCode: string }}
 */
export function resolveGateAction(ctx) {
  // Null/undefined context is a degrade condition (cannot evaluate safely).
  if (ctx == null) {
    return { action: 'warn', reason: 'null context — cannot evaluate safely', reasonCode: 'degrade:null-context' };
  }

  const {
    mode,
    contract,
    decision,
    missedCapabilities,
    signalsWork,
    registryLoadFailed,
    taskRegistered,
  } = ctx;

  // Condition 1: mode must be guarded or strict to block.
  if (mode === 'advisory') {
    return { action: 'warn', reason: 'mode is advisory — never blocks', reasonCode: 'degrade:advisory-mode' };
  }

  // Condition 2: contract must exist on disk.
  if (!contract) {
    return { action: 'warn', reason: 'no contract on disk — cannot evaluate safely', reasonCode: 'degrade:no-contract' };
  }

  // Condition 3: verdict must be deny.
  if (decision !== 'deny') {
    return { action: 'warn', reason: `decision is ${decision} — not a deny`, reasonCode: 'degrade:non-deny' };
  }

  // Condition 4: at least one CEREMONY capability must be missing.
  const ceremonyCapsViolated = (missedCapabilities ?? []).filter((c) => CEREMONY_CAPS.has(c));
  if (ceremonyCapsViolated.length === 0) {
    return {
      action: 'warn',
      reason: 'missing capability is not a ceremony cap — degrade to advisory',
      reasonCode: 'degrade:non-ceremony-cap',
    };
  }

  // Condition 5a: signals.work must have been computed.
  if (!signalsWork) {
    return {
      action: 'warn',
      reason: 'signals.work not computed — cannot determine materiality',
      reasonCode: 'degrade:no-signals-work',
    };
  }

  // Condition 5b: confidence must not be 'ask'.
  if (signalsWork.confidence === 'ask') {
    return {
      action: 'warn',
      reason: 'signals.work.confidence is ask — clarification pending, not blocking',
      reasonCode: 'degrade:signals-ask',
    };
  }

  // Degrade: registry/policy load failed — cannot prove materiality.
  if (registryLoadFailed) {
    return {
      action: 'warn',
      reason: 'registry/policy load failed — cannot evaluate safely',
      reasonCode: 'degrade:registry-fail',
    };
  }

  // Degrade: task is unregistered.
  if (!taskRegistered) {
    return { action: 'warn', reason: 'task is unregistered — gate is silent', reasonCode: 'degrade:unregistered-task' };
  }

  // All five conditions met — block.
  return {
    action: 'block',
    reason: `ceremony capability missing: ${ceremonyCapsViolated.join(', ')}`,
    reasonCode: 'block:ceremony-gate',
  };
}

/**
 * Returns true when the given capability id is a ceremony capability that the
 * intake/contract gate enforces (intake-completed, adr-required).
 *
 * @param {string} capabilityId
 * @returns {boolean}
 */
export function isCeremonyCap(capabilityId) {
  return CEREMONY_CAPS.has(capabilityId);
}
