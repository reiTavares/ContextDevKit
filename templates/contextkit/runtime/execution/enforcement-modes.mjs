/**
 * enforcement-modes.mjs - Mode resolver and pure decide() function (CDK-023, ADR-0072).
 *
 * Implements the three enforcement modes for capability gate enforcement:
 *   advisory - never blocks; warns when capabilities are missing.
 *   guarded  - blocks writes and completions when required capabilities are missing.
 *   strict   - blocks at every moment when any required capability is missing.
 *
 * The decide() function is the heart of the enforcement substrate. It:
 *   1. Resolves which capabilities are required for the given lifecycle moment.
 *   2. Checks each against real on-disk receipts and bypasses.
 *   3. Returns a structured verdict: decision + categorized capability lists.
 *
 * Anti-theatre rule: a bypass counts as 'bypassed', NEVER as 'satisfied'. The
 * caller of decide() can see exactly which capabilities were genuinely proved
 * (satisfied) vs. waived (bypassed) vs. absent (missing).
 *
 * Zero runtime deps - node:* + safe-io.mjs + paths.mjs + siblings only.
 * Do NOT import config/load.mjs or any hook file.
 */
import { readReceipt, isReceiptValid } from './receipt-store.mjs';
import { readBypass, isBypassValid } from './bypass-store.mjs';

// ---------------------------------------------------------------------------
// Mode resolver
// ---------------------------------------------------------------------------

const VALID_MODES = new Set(['advisory', 'guarded', 'strict']);

/**
 * Resolves the enforcement mode from a config object.
 *
 * Reads config?.enforcement?.mode. Unknown or missing values fall back to
 * 'guarded' — the BUSINESS RULE of this template (ADR-0125): the intake
 * ceremony ships ACTIVE for every install. This is safe because the gate
 * itself degrades to advisory (warn, exit 0) whenever it cannot evaluate
 * safely (no contract, no signals, registry-fail, unregistered task, any
 * throw) — see gate-enforcement-decision.mjs — so a fresh install is never
 * false-blocked. A project may explicitly set 'advisory' to opt OUT.
 *
 * @param {object|null|undefined} config project config
 * @returns {'advisory'|'guarded'|'strict'}
 */
export function resolveEnforcementMode(config) {
  const mode = config?.enforcement?.mode;
  if (typeof mode === 'string' && VALID_MODES.has(mode)) return mode;
  return 'guarded';
}

// ---------------------------------------------------------------------------
// Core decision engine
// ---------------------------------------------------------------------------

/**
 * Moment keys map to contract fields. beforeExploration is the least critical
 * moment; beforeCompletion is the most critical.
 */
const MOMENT_TO_CONTRACT_FIELD = {
  beforeExploration: 'requiredBeforeExploration',
  beforeWrite: 'requiredBeforeWrite',
  beforeCompletion: 'requiredBeforeCompletion',
};

/**
 * Moments at which guarded mode blocks (missing required capability -> deny).
 * For beforeExploration, guarded only warns.
 */
const GUARDED_BLOCKING_MOMENTS = new Set(['beforeWrite', 'beforeCompletion']);

/**
 * Pure enforcement decision for a single lifecycle moment.
 *
 * Reads receipts and bypasses from disk (the authoritative state for a given
 * moment). For each required capability:
 *   - A valid receipt (result='passed', not expired, scope-matched) -> satisfied.
 *   - A valid bypass (not expired, scope-matched, human-floor enforced) -> bypassed.
 *   - Otherwise -> missing.
 *
 * Decision by mode:
 *   advisory: NEVER deny. Warns on anything missing; allows otherwise.
 *   guarded:  Denies at beforeWrite/beforeCompletion when missing is non-empty.
 *             Only warns at beforeExploration.
 *   strict:   Denies at ANY moment when missing is non-empty.
 *
 * Bypassed capabilities are reported separately from satisfied ones. This is the
 * anti-theatre invariant: a bypass is a waiver, not a proof. Callers that need
 * to surface bypasses to auditors can inspect the 'bypassed' list.
 *
 * @param {{
 *   mode: 'advisory'|'guarded'|'strict',
 *   contract: object,
 *   moment: 'beforeExploration'|'beforeWrite'|'beforeCompletion',
 *   scope: { branch: string, taskId: string, paths?: string[], contentHash?: string },
 *   root: string,
 *   now?: number,
 *   requiresHumanApproval?: boolean
 * }} params
 * @returns {{
 *   decision: 'allow'|'warn'|'deny',
 *   missing: string[],
 *   bypassed: string[],
 *   satisfied: string[],
 *   reasons: string[]
 * }}
 */
export function decide({ mode, contract, moment, scope, root, now = Date.now(), requiresHumanApproval = false }) {
  const contractField = MOMENT_TO_CONTRACT_FIELD[moment];
  const requiredCapabilities = contractField && Array.isArray(contract?.[contractField])
    ? contract[contractField]
    : [];

  const satisfied = [];
  const bypassed = [];
  const missing = [];
  const reasons = [];

  for (const capability of requiredCapabilities) {
    const receiptResult = checkReceipt(root, scope, capability, now);
    if (receiptResult.satisfied) {
      satisfied.push(capability);
      continue;
    }

    const bypassResult = checkBypass(root, scope, capability, requiresHumanApproval, now);
    if (bypassResult.bypassed) {
      bypassed.push(capability);
      reasons.push(`capability '${capability}' satisfied via bypass (not a proof)`);
      continue;
    }

    missing.push(capability);
    reasons.push(`capability '${capability}' missing: ${receiptResult.reason}`);
  }

  const decision = resolveDecision(mode, moment, missing);
  if (decision === 'warn' && missing.length > 0) {
    reasons.push(`mode=${mode} at ${moment}: missing capabilities recorded but not blocking`);
  }

  return { decision, missing, bypassed, satisfied, reasons };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether a valid receipt exists for the capability in this scope.
 *
 * @param {string} root
 * @param {{ branch: string, taskId: string, paths?: string[], contentHash?: string }} scope
 * @param {string} capability
 * @param {number} now
 * @returns {{ satisfied: boolean, reason: string }}
 */
function checkReceipt(root, scope, capability, now) {
  const receipt = readReceipt(root, scope.taskId, capability);
  if (!receipt) return { satisfied: false, reason: 'no receipt on disk' };
  const { valid, reason } = isReceiptValid(receipt, scope, now);
  return { satisfied: valid, reason };
}

/**
 * Checks whether a valid bypass exists for the capability in this scope.
 *
 * @param {string} root
 * @param {{ branch: string, taskId: string }} scope
 * @param {string} capability
 * @param {boolean} requiresHumanApproval
 * @param {number} now
 * @returns {{ bypassed: boolean, reason: string }}
 */
function checkBypass(root, scope, capability, requiresHumanApproval, now) {
  const bypass = readBypass(root, scope.taskId, capability);
  if (!bypass) return { bypassed: false, reason: 'no bypass on disk' };
  const ctx = { capability, taskId: scope.taskId, branch: scope.branch, requiresHumanApproval };
  const { valid, reason } = isBypassValid(bypass, ctx, now);
  return { bypassed: valid, reason };
}

/**
 * Translates (mode, moment, missing) into the final allow/warn/deny decision.
 *
 * @param {'advisory'|'guarded'|'strict'} mode
 * @param {string} moment
 * @param {string[]} missing
 * @returns {'allow'|'warn'|'deny'}
 */
function resolveDecision(mode, moment, missing) {
  if (missing.length === 0) return 'allow';
  switch (mode) {
    case 'advisory':
      // Never deny in advisory mode - this is the non-blocking observation layer.
      return 'warn';
    case 'guarded':
      // Block only at critical moments (writes and completions); warn at exploration.
      return GUARDED_BLOCKING_MOMENTS.has(moment) ? 'deny' : 'warn';
    case 'strict':
      // Block at every moment - zero tolerance for missing capabilities.
      return 'deny';
    default:
      // Unknown modes fall back to advisory behavior (safe default).
      return 'warn';
  }
}