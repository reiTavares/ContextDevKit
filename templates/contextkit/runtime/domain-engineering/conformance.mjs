/**
 * conformance.mjs — the PostToolUse conformance reconciler (ADR-0128 §19;
 * WF-0067). After each write, compares the real file path + changed contracts
 * against the governing Implementation Packet's declared touch-set, and grades
 * the deviation by risk band into an action: record (low), require a packet
 * update (medium), or block the next write (high / preserved-contract change).
 *
 * This is the write-time companion to `receipt-compile.buildImplementationReceipt`
 * (WF-0066, the completion-time planned-vs-actual diff) — it reuses the same
 * conservative `pathMatches` semantics so a directory glob (`dir/**`) and a
 * prefix match mean the same thing at both moments.
 *
 * PURE: no I/O, no clock. Fail-open — a malformed input degrades to `record`
 * (never a false block). Zero runtime dependencies.
 *
 * @module domain-engineering/conformance
 */

/** Reconciliation schema version — bump on any breaking shape change (§19). */
export const CONFORMANCE_VERSION = '1.0.0';

/**
 * Reconcile one write against the packet. PURE.
 *
 * @param {object} input
 * @param {string} input.path the repo-relative path just written (forward slashes).
 * @param {object} [input.packet] the Implementation Packet
 *   (`{ allowedPaths, forbiddenPaths, contractsToPreserve }`). Absent ⇒ `record`.
 * @param {string[]} [input.contractsChanged] public contracts the write changed.
 * @param {object} [input.domainDelta] optional §23 declared-vs-real delta (its
 *   presence of `contractRemovals`/`stateAuthorityConflicts` escalates the band).
 * @returns {{ drift: string[], riskBand: 'low'|'medium'|'high',
 *   action: 'record'|'require-packet-update'|'block-next-write', reasonCodes: string[] }}
 */
export function reconcileWrite(input = {}) {
  const {
    path, packet, contractsChanged, domainDelta,
  } = input && typeof input === 'object' ? input : {};

  const drift = [];
  const reasonCodes = [];
  let riskBand = 'low';
  let action = 'record';

  // No packet (or no path) → nothing to reconcile against; record, never block.
  if (!isNonEmptyString(path) || !packet || typeof packet !== 'object') {
    return { drift, riskBand: 'low', action: 'record', reasonCodes: ['CONFORMANCE_NO_PACKET'] };
  }

  const allowedPaths = stringArray(packet.allowedPaths);
  const forbiddenPaths = stringArray(packet.forbiddenPaths);
  const contractsToPreserve = stringArray(packet.contractsToPreserve);
  const changed = stringArray(contractsChanged);

  // 1. Forbidden path touched → highest local risk, block the next write.
  if (forbiddenPaths.some((forbidden) => pathMatches(path, forbidden))) {
    drift.push(`forbidden-path-touched:${path}`);
    reasonCodes.push('CONFORMANCE_FORBIDDEN_PATH');
    riskBand = 'high';
    action = 'block-next-write';
  } else if (allowedPaths.length > 0 && !allowedPaths.some((allowed) => pathMatches(path, allowed))) {
    // 2. Path outside the declared touch-set → medium, require a packet update.
    drift.push(`out-of-touch-set:${path}`);
    reasonCodes.push('CONFORMANCE_OUT_OF_TOUCH_SET');
    riskBand = raise(riskBand, 'medium');
    action = escalateAction(action, 'require-packet-update');
  }

  // 3. A preserved contract changed → high / contract, block the next write.
  for (const contract of changed) {
    if (contractsToPreserve.includes(contract)) {
      drift.push(`preserved-contract-changed:${contract}`);
      reasonCodes.push('CONFORMANCE_PRESERVED_CONTRACT_CHANGED');
      riskBand = 'high';
      action = 'block-next-write';
    }
  }

  // 4. A §23 domain delta with a contract removal / state-authority conflict is a
  //    high, contract-class deviation regardless of the touch-set.
  if (domainDelta && typeof domainDelta === 'object') {
    if (nonEmpty(domainDelta.contractRemovals)) {
      drift.push('domain-contract-removed');
      reasonCodes.push('CONFORMANCE_DOMAIN_CONTRACT_REMOVED');
      riskBand = 'high';
      action = 'block-next-write';
    }
    if (nonEmpty(domainDelta.stateAuthorityConflicts)) {
      drift.push('domain-state-authority-conflict');
      reasonCodes.push('CONFORMANCE_DOMAIN_STATE_AUTHORITY_CONFLICT');
      riskBand = 'high';
      action = 'block-next-write';
    }
  }

  if (drift.length === 0) reasonCodes.push('CONFORMANCE_WITHIN_TOUCH_SET');
  return { drift, riskBand, action, reasonCodes };
}

/**
 * Matches a touched path against a packet path declaration. Supports a trailing
 * `/**` glob (directory + everything under it) and an exact/prefix match
 * otherwise — identical semantics to `receipt-compile.pathMatches` so the
 * write-time and completion-time diffs never disagree.
 */
function pathMatches(file, pattern) {
  if (typeof file !== 'string' || typeof pattern !== 'string') return false;
  const f = file.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');
  if (p.endsWith('/**')) return f.startsWith(p.slice(0, -3));
  return f === p || f.startsWith(`${p}/`);
}

/** Raise a risk band to at least `floor` (low < medium < high). */
function raise(current, floor) {
  const order = { low: 0, medium: 1, high: 2 };
  return (order[current] ?? 0) >= (order[floor] ?? 0) ? current : floor;
}

/** Escalate an action toward the more restrictive one, never downgrading. */
function escalateAction(current, next) {
  const order = { record: 0, 'require-packet-update': 1, 'block-next-write': 2 };
  return (order[current] ?? 0) >= (order[next] ?? 0) ? current : next;
}

/** True for a non-empty array. */
function nonEmpty(value) {
  return Array.isArray(value) && value.length > 0;
}

/** Filters to a plain string[], dropping non-string entries. */
function stringArray(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [];
}

/** True for a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}
