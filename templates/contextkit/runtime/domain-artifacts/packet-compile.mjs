/**
 * packet-compile.mjs — `compileImplementationPacket(owner, classification,
 * sources, opts) -> packet` (ADR-0128 §13, WF-0066).
 *
 * Composes the Implementation Packet — the ONE artifact required for every
 * code create/modify profile (ADR-0128 evidence ruling) — from:
 *   - `classification`: the WF-0063 §15 implementation block shape (CMIS/DAS
 *     score, resolved profile, requiredAgents/requiredSkills) — reused
 *     verbatim, never re-derived (best-practices S4);
 *   - `sources`: the declared governing context (business/operation/workflow/
 *     decision/use-case) — Root Business, Work Nature and Ceremony are
 *     inherited, never recalculated here (spec invariant);
 *   - `opts`: the declared scope (allowedPaths/forbiddenPaths/contractsTo
 *     Preserve/invariants/steps/requiredTests/requiredEvidence). The compiler
 *     never invents scope — it only assembles what the caller declares.
 *
 * Pure — no I/O; `packetId`/`at` are injectable so tests are deterministic.
 *
 * @module domain-artifacts/packet-compile
 */

/** Packet schema version — bump on any breaking shape change (§13). */
export const IMPLEMENTATION_PACKET_SCHEMA_VERSION = '1.0.0';

/**
 * Compiles one Implementation Packet.
 *
 * @param {string} owner governing business/operation/workflow id.
 * @param {object} classification WF-0063 implementation block (or a subset):
 *   `{ codeMutationIntentScore, domainApplicabilityScore, profile,
 *   requiredAgents, requiredSkills, reasonCodes }`.
 * @param {object} [sources] declared governing sources: `{ business,
 *   operation, workflow, decision, useCase }` (each an id/path or omitted).
 * @param {object} [opts] declared scope + injectables.
 * @param {string[]} [opts.allowedPaths]
 * @param {string[]} [opts.forbiddenPaths]
 * @param {string[]} [opts.contractsToPreserve]
 * @param {string[]} [opts.invariants]
 * @param {string[]} [opts.steps]
 * @param {string[]} [opts.requiredTests]
 * @param {string[]} [opts.requiredEvidence]
 * @param {string} [opts.packetId] pre-computed id (tests inject this).
 * @param {string} [opts.at] ISO timestamp (tests inject this).
 * @returns {object} the implementation-packet.json document.
 */
export function compileImplementationPacket(owner, classification, sources, opts = {}) {
  const cls = classification && typeof classification === 'object' ? classification : {};
  const src = sources && typeof sources === 'object' ? sources : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const reasonCodes = [];

  const hasGoverningSource = ['business', 'operation', 'workflow']
    .some((key) => typeof src[key] === 'string' && src[key].length > 0);
  if (!hasGoverningSource) reasonCodes.push('PACKET_MISSING_SOURCE');

  const at = typeof o.at === 'string' && o.at ? o.at : new Date().toISOString();

  return {
    schemaVersion: IMPLEMENTATION_PACKET_SCHEMA_VERSION,
    packetId: typeof o.packetId === 'string' && o.packetId ? o.packetId : buildPacketId(owner, at),
    owner: typeof owner === 'string' && owner ? owner : 'unknown',
    classification: {
      cmis: numberOr(cls.codeMutationIntentScore, 0),
      das: numberOr(cls.domainApplicabilityScore, 0),
      profile: typeof cls.profile === 'string' ? cls.profile : 'simple',
    },
    sources: {
      business: typeof src.business === 'string' ? src.business : null,
      operation: typeof src.operation === 'string' ? src.operation : null,
      workflow: typeof src.workflow === 'string' ? src.workflow : null,
      decision: typeof src.decision === 'string' ? src.decision : null,
      useCase: typeof src.useCase === 'string' ? src.useCase : null,
    },
    requiredAgents: stringArray(cls.requiredAgents),
    requiredSkills: stringArray(cls.requiredSkills),
    allowedPaths: stringArray(o.allowedPaths),
    forbiddenPaths: stringArray(o.forbiddenPaths),
    contractsToPreserve: stringArray(o.contractsToPreserve),
    invariants: stringArray(o.invariants),
    steps: stringArray(o.steps),
    requiredTests: stringArray(o.requiredTests),
    requiredEvidence: stringArray(o.requiredEvidence),
    reasonCodes: dedupe([...stringArray(cls.reasonCodes), ...reasonCodes, 'PACKET_COMPILED']),
    degraded: reasonCodes.includes('PACKET_MISSING_SOURCE'),
    at,
  };
}

/** Builds a deterministic packet id from the owner + timestamp. */
function buildPacketId(owner, at) {
  const stamp = String(at).replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
  const ownerSlug = String(owner ?? 'unknown').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return `packet-${ownerSlug}-${stamp}`;
}

/** Filters to a plain string[], dropping non-string entries. */
function stringArray(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [];
}

/** Coerces to a finite number, else the fallback. */
function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Removes duplicates, preserving first-seen order. */
function dedupe(list) {
  return [...new Set(list)];
}
