/**
 * Architecture-debt gate — the Domain Engineering fitness CATALOGUE (ADR-0128 §24,
 * ADR-0129; WF-0067). The DATA companion to `domain-fitness.mjs` (the analyzer):
 * a list of fitness DECLARATIONS binding each domain rule to a descriptor the
 * `FitnessFunctionRunner` validates + runs. Mirrors the W2 `fitness-catalogue.mjs`
 * split (data here, engine there) so both stay under the §1 line budget.
 *
 * Rollout posture (default-OFF, ADR-0128 packaging ruling): EVERY declaration ships
 * `rolloutState: OBSERVE_ONLY` at launch — it runs and observes but its findings are
 * stamped `influencing: false`, so they NEVER sway the gate verdict until WF-0068
 * (or a project) promotes the blocking rules to ACTIVE. Combined with the empty
 * default `domainConformance` (an absent declared map ⇒ zero findings), the domain
 * rules are doubly inert on a fresh install — native hosts stay green.
 *
 * Authority (ADR-0129): the eight Class-A rules declare `enforcement: BLOCKING`
 * with a deterministic-tier evidence class (satisfying the registry's Fork-2
 * invariant); the six Class-B advisory rules declare `enforcement: OBSERVE_ONLY`
 * with SEMANTIC evidence (ceiling guarded, never auto-strict, never a dogmatic block).
 *
 * Each `evaluate(ctx)` is PURE: it reads ONLY `ctx.domainConformance` (the §23
 * comparator output the gate-context injects) and filters to its own ruleId. Zero
 * runtime deps, ESM, relative imports only (immutable rule #1).
 */

import { Enforcement, Dimension } from './finding.mjs';
import { FitnessType, RolloutState } from './fitness-registry.mjs';
import { DOMAIN_FITNESS_RULES, domainFindingsFor } from './domain-fitness.mjs';

/** Human remediation per rule id (kept out of the analyzer — the catalogue is the surface). */
const REMEDIATION = Object.freeze({
  DOMAIN_INFRASTRUCTURE_INDEPENDENCE: 'Invert the dependency behind a domain port; keep infrastructure at the edge.',
  BOUNDED_CONTEXT_BOUNDARY: 'Depend on the target context\'s published contract, not its internals.',
  STATE_AUTHORITY_UNIQUENESS: 'Consolidate the state writes onto the single canonical owner.',
  PUBLIC_CONTRACT_PRESERVATION: 'Restore the contract or record a Decision (ADR) for the breaking change.',
  AGGREGATE_CONSISTENCY_BOUNDARY: 'Route the write through the aggregate root that owns the invariant.',
  CROSS_CONTEXT_ACCESS: 'Add the relation to the allowed set or integrate via a published contract/event.',
  DOMAIN_EVENT_CONTRACT: 'Version the event; do not change a published event contract in place.',
  IMPLEMENTATION_PACKET_CONFORMANCE: 'Update the Implementation Packet touch-set or revert the out-of-scope change.',
  POSSIBLE_ANEMIC_MODEL: 'Consider moving behaviour onto the entity; tracked as observation until calibrated.',
  POSSIBLY_LARGE_AGGREGATE: 'Consider splitting the aggregate; tracked as observation until calibrated.',
  EXCESS_DOMAIN_SERVICES: 'Consider folding logic into entities/value objects; observation only.',
  VALUE_OBJECT_FRAGMENTATION: 'Consider consolidating value objects; observation only.',
  QUESTIONABLE_REPOSITORY_USE: 'Review the repository boundary; observation only.',
  OVER_COMPLEX_STRUCTURE: 'Consider simplifying to match the domain; observation only.',
});

/**
 * Build one fitness declaration from a domain rule spec. The `evaluate` closure
 * filters the analyzer output to this rule's id (mirrors how F1/F2/F3 filter
 * `evaluateConformance`). Every rule launches OBSERVE_ONLY.
 *
 * @param {object} rule an entry of DOMAIN_FITNESS_RULES.
 * @returns {object} a fitness declaration for `registerFitness`.
 */
function toDeclaration(rule) {
  return {
    id: rule.ruleId,
    description: rule.message,
    scope: rule.blocking ? 'domain-graph' : 'domain-model',
    owner: rule.dimension === Dimension.DATA_CONTRACTS ? 'architect' : 'domain-modeler',
    evidenceSource: rule.evidence,
    // `severity` records the INTENDED criticality (BLOCKER for the 8 Class-A rules,
    // INFO for the 6 Class-B signals) so a human report shows which domain findings
    // are the serious ones — but at LAUNCH every rule's registry AUTHORITY is
    // OBSERVE_ONLY (default-OFF): the descriptor `enforcement` is the current
    // authority, not the intended one. WF-0068 promotes the 8 blocking rules to
    // `enforcement: BLOCKING` + `rolloutState: ACTIVE` together. Keeping them
    // OBSERVE_ONLY here means they never enter the arch-debt "armed blocking floor"
    // set, so the protection-gap invariant (every BLOCKING rule is ACTIVE) is
    // untouched. The analyzer's FINDINGS still carry the true BLOCKING/deterministic
    // class (domain-fitness.mjs) — that is the blocking-vs-advisory truth EF3 tests.
    severity: rule.blocking ? 'BLOCKER' : 'INFO',
    enforcement: Enforcement.OBSERVE_ONLY,
    dimension: rule.dimension,
    relatedDecisions: ['ADR-0128', 'ADR-0129', 'WF-0067'],
    failureMessage: rule.message,
    remediation: REMEDIATION[rule.ruleId] || 'Review against the declared domain map.',
    rolloutState: RolloutState.OBSERVE_ONLY,
    type: FitnessType.STATIC,
    evaluate: (ctx) => domainFindingsFor(rule.ruleId, ctx && ctx.domainConformance),
  };
}

/**
 * The ordered domain fitness catalogue — the eight blocking rules first, then the
 * six advisory signals (mirrors the analyzer's rule order).
 * @type {Object[]}
 */
export const DOMAIN_FITNESS_CATALOGUE = DOMAIN_FITNESS_RULES.map(toDeclaration);
