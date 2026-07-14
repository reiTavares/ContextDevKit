/**
 * receipt-compile.mjs — `buildImplementationReceipt(packet, actual) -> receipt`
 * (ADR-0128 §13, evidence ruling; WF-0066).
 *
 * Compares the Implementation Packet's PLAN against the ACTUAL result: agents
 * called vs required, skills applied vs required, files touched vs the
 * declared allowed/forbidden scope, and contracts changed vs the packet's
 * contractsToPreserve. This is the planned-vs-actual diff the acceptance
 * matrix requires — deterministic, no invented deviations.
 *
 * A capability is "used" only when a real spawn record or skill-application
 * receipt exists (ADR-0128 evidence ruling) — this module never treats a
 * planned agent/skill as evidence of activation; `actual.*` must be supplied
 * by the caller from real records (spawn logs, §18 skill receipts).
 *
 * Pure — no I/O; `at` is injectable so tests are deterministic.
 *
 * @module domain-artifacts/receipt-compile
 */

/** Receipt schema version — bump on any breaking shape change (§13). */
export const IMPLEMENTATION_RECEIPT_SCHEMA_VERSION = '1.0.0';

/**
 * Builds one Implementation Receipt comparing a packet against the actual
 * result of implementing it.
 *
 * @param {object} packet an implementation-packet.json document (from
 *   compileImplementationPacket).
 * @param {object} actual the real outcome: `{ agentsActual, skillsActual,
 *   filesTouched, filesNew, contractsChanged, testsRun, gatesRun, result }`.
 * @param {{ at?: string }} [opts] injectables.
 * @returns {object} the implementation-receipt.json document.
 */
export function buildImplementationReceipt(packet, actual, opts = {}) {
  const p = packet && typeof packet === 'object' ? packet : {};
  const a = actual && typeof actual === 'object' ? actual : {};
  const at = typeof opts?.at === 'string' && opts.at ? opts.at : new Date().toISOString();

  const agentsPlanned = stringArray(p.requiredAgents);
  const agentsActual = stringArray(a.agentsActual);
  const skillsPlanned = stringArray(p.requiredSkills);
  const skillsActual = stringArray(a.skillsActual);
  const filesPlanned = stringArray(p.allowedPaths);
  const filesTouched = stringArray(a.filesTouched);
  const filesNew = stringArray(a.filesNew);
  const contractsChanged = stringArray(a.contractsChanged);
  const forbiddenPaths = stringArray(p.forbiddenPaths);
  const contractsToPreserve = stringArray(p.contractsToPreserve);

  const deviations = [];
  for (const agent of agentsPlanned) {
    if (!agentsActual.includes(agent)) deviations.push({ kind: 'agent-missing', detail: agent });
  }
  for (const skill of skillsPlanned) {
    if (!skillsActual.includes(skill)) deviations.push({ kind: 'skill-missing', detail: skill });
  }
  for (const file of [...filesTouched, ...filesNew]) {
    if (forbiddenPaths.some((forbidden) => pathMatches(file, forbidden))) {
      deviations.push({ kind: 'forbidden-path-touched', detail: file });
    }
  }
  for (const contract of contractsChanged) {
    if (contractsToPreserve.includes(contract)) deviations.push({ kind: 'preserved-contract-changed', detail: contract });
  }

  const reasonCodes = ['RECEIPT_BUILT'];
  if (deviations.length > 0) reasonCodes.push('RECEIPT_DEVIATION_DETECTED');
  if (deviations.some((d) => d.kind === 'preserved-contract-changed')) reasonCodes.push('RECEIPT_CONTRACT_CHANGED');

  return {
    schemaVersion: IMPLEMENTATION_RECEIPT_SCHEMA_VERSION,
    packetId: typeof p.packetId === 'string' ? p.packetId : 'unknown',
    owner: typeof p.owner === 'string' ? p.owner : 'unknown',
    agentsPlanned,
    agentsActual,
    skillsPlanned,
    skillsActual,
    filesPlanned,
    filesTouched,
    filesNew,
    contractsChanged,
    deviations,
    testsRun: stringArray(a.testsRun),
    gatesRun: stringArray(a.gatesRun),
    result: typeof a.result === 'string' ? a.result : 'unknown',
    reasonCodes,
    at,
  };
}

/**
 * Matches a touched path against a forbidden-path declaration. Supports a
 * trailing `/**` glob (directory + everything under it) and an exact/prefix
 * match otherwise — the same conservative semantics the ownership guard uses.
 */
function pathMatches(file, pattern) {
  if (typeof file !== 'string' || typeof pattern !== 'string') return false;
  if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0, -3));
  return file === pattern || file.startsWith(`${pattern}/`);
}

/** Filters to a plain string[], dropping non-string entries. */
function stringArray(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [];
}
