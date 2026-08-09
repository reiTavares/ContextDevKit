/**
 * B-owned enumerations for the Authoritative Decision Record schema v2
 * (BIZ-0001 / WF-0037). SINGLE SOURCE OF TRUTH for the decision-domain enums.
 *
 * Workflow B (WF-0037) OWNS these per `shared-entity-contracts.md`
 * §"Enum ownership" ("Workflow B extends with: decision kinds, decision coverage
 * modes, ADR states, approval-source shape"). They sit ALONGSIDE Workflow A's
 * `enums.mjs` (it stays the authority for VALUE_INTENTS / RELATION_TYPES, which
 * this module IMPORTS and re-exports for decision consumers — never forks).
 *
 * Encodes the B0-T2 design (`design/B0-T2-decision-kind-taxonomy.md` §1/§2/§3 +
 * `design/B0-T2-decision-domain-contract.md` §4). Zero runtime dependencies —
 * plain frozen arrays + small pure helpers.
 *
 * Importers (B1-T2 registry, B2 search, B3 gates):
 *   import { DECISION_KINDS, DECISION_STATUSES, ... } from '../work/decision-enums.mjs';
 */
import { VALUE_INTENTS, RELATION_TYPES } from './enums.mjs';

// Re-export A's enums so decision consumers single-source them through B without
// reaching past this module. These remain A-owned; B references, never redefines.
export { VALUE_INTENTS, RELATION_TYPES };

/**
 * decisionKind taxonomy — what KIND of decision an ADR records
 * (B0-T2-decision-kind-taxonomy §2). Closed, B-owned set; adding a kind needs an
 * ADR. `BUSINESS_AUTHORIZATION` / `OPERATION_AUTHORIZATION` are the mirror kinds.
 * @type {readonly string[]}
 */
export const DECISION_KINDS = Object.freeze([
  'BUSINESS_AUTHORIZATION',
  'OPERATION_AUTHORIZATION',
  'ARCHITECTURE',
  'POLICY',
  'ROUTINE_OPERATION_GOVERNANCE',
  'EMERGENCY_GOVERNANCE',
  'COMPLIANCE',
  'LIFECYCLE',
]);

/**
 * ADR status lifecycle (B0-T2-decision-kind-taxonomy §3). `legacy` is a
 * registry-LOGICAL state for plain-markdown `NNNN-slug.md` ADRs — it is NEVER
 * written into a file's front matter (compatibility-plan §"Legacy
 * classification"). Closed, B-owned set.
 * @type {readonly string[]}
 */
export const DECISION_STATUSES = Object.freeze([
  'proposed',
  'accepted',
  'superseded',
  'rejected',
  'legacy',
]);

/**
 * Legal status transitions (B0-T2-decision-kind-taxonomy §3.1). A status moves
 * only to a state listed here; `rejected`/`superseded`/`legacy` are terminal.
 * `legacy` is never a transition TARGET (assigned in the registry, not by a write).
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const DECISION_STATUS_TRANSITIONS = Object.freeze({
  proposed: Object.freeze(['accepted', 'rejected']),
  accepted: Object.freeze(['superseded']),
  superseded: Object.freeze([]),
  rejected: Object.freeze([]),
  legacy: Object.freeze([]),
});

/**
 * decisionScope — HOW FAR a decision reaches (B0-T2-decision-kind-taxonomy §1).
 * Orthogonal to `primaryContext` (whose decision it is). Closed, B-owned set.
 * @type {readonly string[]}
 */
export const DECISION_SCOPES = Object.freeze([
  'platform',
  'business',
  'operation',
  'workflow',
]);

/**
 * contextType — the KIND of owner a decision belongs to
 * (B0-T2-decision-domain-contract §2.1). `legacy` ⟹ `primaryContext: null`.
 * Closed, B-owned set. NOTE: `contextType` must agree with `primaryContext.type`
 * (validator rule, §2.2 rule 2).
 * @type {readonly string[]}
 */
export const DECISION_CONTEXT_TYPES = Object.freeze([
  'business',
  'operation',
  'platform',
  'legacy',
]);

/**
 * Decision-coverage modes (B0-T2-decision-domain-contract §4). Every unit of
 * work that requires a decision resolves to exactly one. Closed, B-owned set;
 * B3 maps these to gate verdicts (B1 only encodes the set).
 * @type {readonly string[]}
 */
export const DECISION_COVERAGE_MODES = Object.freeze([
  'COVERED_BY_ACCEPTED',
  'ROUTINE_COVERED',
  'LEGACY_GRANDFATHERED',
  'NEEDS_DECISION',
  'SUPERSEDED_NOT_GOVERNING',
]);

/**
 * approvalSource.type — where acceptance authority ORIGINATES
 * (B0-T2-decision-domain-contract §3.1). `business`/`operation` are the mirror
 * sources; `platform`/`human` cover technical/ad-hoc rulings. Closed, B-owned.
 * @type {readonly string[]}
 */
export const APPROVAL_SOURCE_TYPES = Object.freeze([
  'business',
  'operation',
  'platform',
  'human',
]);

/**
 * Canonical id pattern for an Authoritative Decision Record (new, v2 format).
 * @type {RegExp}
 */
export const DECISION_ID_PATTERN = /^ADR-\d{4}$/;

/**
 * Legacy ADR filename shape `<NNNN>-<slug>.md`. MUST stay byte-identical to
 * `tools/scripts/adr-digest-core.mjs#ADR_FILENAME_RE` (compatibility-plan
 * §"Do-not-touch list" forbids changing the legacy regex). Duplicated here, not
 * imported, to keep the runtime/work layer free of a tools/scripts dependency;
 * a selfcheck/registry consumer in tools/scripts keeps the canonical one.
 * @type {RegExp}
 */
export const LEGACY_DECISION_FILENAME_PATTERN = /^(\d{4})-([a-z0-9._-]+)\.md$/;

/**
 * Tests whether `status` may legally transition to `next` per the lifecycle.
 *
 * @param {string} status - the current ADR status.
 * @param {string} next - the proposed target status.
 * @returns {boolean} true only when the transition is in the legal table.
 */
export function isLegalStatusTransition(status, next) {
  const allowed = DECISION_STATUS_TRANSITIONS[status];
  return Array.isArray(allowed) && allowed.includes(next);
}
