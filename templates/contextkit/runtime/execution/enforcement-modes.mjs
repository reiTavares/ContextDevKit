/**
 * Canonical ContextDevKit 4 enforcement modes plus the compatibility decision
 * adapter used by the remaining receipt-based consumers during cutover.
 *
 * Zero third-party dependencies. Do not import config/load.mjs or hook files.
 */
import { readReceipt, isReceiptValid } from './receipt-store.mjs';
import { readBypass, isBypassValid } from './bypass-store.mjs';
import { canGateDeny } from '../governance/gate-registry.mjs';

export const ENFORCEMENT_MODES = Object.freeze(['off', 'shadow', 'canary', 'guarded']);
const VALID_MODES = new Set(ENFORCEMENT_MODES);
const MODE_ALIASES = Object.freeze({ advisory: 'canary', strict: 'guarded' });

/**
 * Normalizes one mode without throwing. Compatibility aliases never add
 * powers, and any missing or invalid value becomes canary.
 *
 * @param {unknown} value configured mode
 * @returns {{mode:'off'|'shadow'|'canary'|'guarded', source:'canonical'|'alias'|'fallback', warning:string|null}}
 */
export function normalizeEnforcementMode(value) {
  if (typeof value === 'string' && VALID_MODES.has(value)) {
    return { mode: value, source: 'canonical', warning: null };
  }
  if (typeof value === 'string' && Object.hasOwn(MODE_ALIASES, value)) {
    const mode = MODE_ALIASES[value];
    return { mode, source: 'alias', warning: `${value} is deprecated; using ${mode}` };
  }
  return { mode: 'canary', source: 'fallback', warning: 'mode missing or invalid; using canary' };
}

/**
 * Resolves the v4 governance default, accepting the v3 enforcement key only as
 * a temporary input. Property access errors also fail open to canary.
 *
 * @param {object|null|undefined} config project config
 * @param {{onWarning?:(message:string)=>void}} [options] optional warning sink
 * @returns {'off'|'shadow'|'canary'|'guarded'} canonical mode
 */
export function resolveEnforcementMode(config, options = {}) {
  try {
    const candidate = config?.governance?.defaultMode ?? config?.enforcement?.mode;
    const normalized = normalizeEnforcementMode(candidate);
    if (normalized.warning && typeof options.onWarning === 'function') options.onWarning(normalized.warning);
    return normalized.mode;
  } catch (error) {
    if (typeof options.onWarning === 'function') {
      options.onWarning(`mode resolver failed; using canary: ${error?.message ?? error}`);
    }
    return 'canary';
  }
}

const MOMENT_TO_CONTRACT_FIELD = {
  beforeExploration: 'requiredBeforeExploration',
  beforeWrite: 'requiredBeforeWrite',
  beforeCompletion: 'requiredBeforeCompletion',
};

/**
 * Evaluates remaining receipt contracts under the v4 mode rules. A guarded
 * mode denies only when `gateId`, lifecycle moment, and deterministic violation
 * facts satisfy the central allowlist. Absence of those facts is a warning.
 *
 * @param {{
 *   mode:'off'|'shadow'|'canary'|'guarded'|'advisory'|'strict',
 *   contract:object,
 *   moment:'beforeExploration'|'beforeWrite'|'beforeCompletion',
 *   scope:{branch:string,taskId:string,paths?:string[],contentHash?:string},
 *   root:string,
 *   now?:number,
 *   requiresHumanApproval?:boolean,
 *   gateId?:string,
 *   violation?:object
 * }} params decision inputs
 * @returns {{decision:'allow'|'warn'|'deny',missing:string[],bypassed:string[],
 *   satisfied:string[],reasons:string[],visibility:'silent'|'visible'}} verdict
 */
export function decide({
  mode,
  contract,
  moment,
  scope,
  root,
  now = Date.now(),
  requiresHumanApproval = false,
  gateId,
  violation = {},
}) {
  const normalizedMode = normalizeEnforcementMode(mode).mode;
  if (normalizedMode === 'off') {
    return { decision: 'allow', missing: [], bypassed: [], satisfied: [], reasons: [], visibility: 'silent' };
  }

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

  const resolvedGateId = gateId ?? (missing.length === 1 ? missing[0] : null);
  const decision = resolveDecision(normalizedMode, resolvedGateId, moment, missing, violation);
  if (decision === 'warn' && missing.length > 0) {
    reasons.push(`mode=${normalizedMode} at ${moment}: missing capabilities recorded but not blocking`);
  }
  return {
    decision,
    missing,
    bypassed,
    satisfied,
    reasons,
    visibility: normalizedMode === 'shadow' ? 'silent' : 'visible',
  };
}

/**
 * @param {string} root project root
 * @param {object} scope receipt scope
 * @param {string} capability capability id
 * @param {number} now current epoch
 * @returns {{satisfied:boolean,reason:string}} receipt status
 */
function checkReceipt(root, scope, capability, now) {
  const receipt = readReceipt(root, scope.taskId, capability);
  if (!receipt) return { satisfied: false, reason: 'no receipt on disk' };
  const { valid, reason } = isReceiptValid(receipt, scope, now);
  return { satisfied: valid, reason };
}

/**
 * @param {string} root project root
 * @param {object} scope bypass scope
 * @param {string} capability capability id
 * @param {boolean} requiresHumanApproval human-only capability flag
 * @param {number} now current epoch
 * @returns {{bypassed:boolean,reason:string}} bypass status
 */
function checkBypass(root, scope, capability, requiresHumanApproval, now) {
  const bypass = readBypass(root, scope.taskId, capability);
  if (!bypass) return { bypassed: false, reason: 'no bypass on disk' };
  const context = { capability, taskId: scope.taskId, branch: scope.branch, requiresHumanApproval };
  const { valid, reason } = isBypassValid(bypass, context, now);
  return { bypassed: valid, reason };
}

/**
 * @param {'shadow'|'canary'|'guarded'} mode canonical mode
 * @param {string|null} gateId gate id
 * @param {string} moment lifecycle moment
 * @param {string[]} missing missing capabilities
 * @param {object} violation deterministic evidence facts
 * @returns {'allow'|'warn'|'deny'} decision
 */
function resolveDecision(mode, gateId, moment, missing, violation) {
  if (missing.length === 0) return 'allow';
  if (mode === 'shadow') return 'allow';
  if (mode === 'guarded' && canGateDeny(gateId, moment, violation)) return 'deny';
  return 'warn';
}
