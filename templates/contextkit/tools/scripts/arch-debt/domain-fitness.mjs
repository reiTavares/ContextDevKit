/**
 * Architecture-debt gate — the Domain Engineering fitness ANALYZER (ADR-0128 §24,
 * ADR-0129; WF-0067). Turns a `domainConformance` object (from the §23 Project Map
 * comparator, `runtime/domain-engineering/project-map-compare.mjs`) into the ONE
 * `Finding` shape the gate consumes, via `makeFinding` — no second finding shape.
 *
 * Eight DETERMINISTIC (Class A) blocking rules + six PREDICTIVE (Class B) advisory
 * signals. The blocking rules carry a deterministic-tier evidence class
 * (GRAPH_DERIVED / SCHEMA_DERIVED / DETERMINISTIC) so `makeFinding`'s Fork-2
 * invariant (BLOCKING ⇒ deterministic) is satisfied. The advisory signals carry
 * SEMANTIC evidence + OBSERVE_ONLY enforcement (Class B ceiling guarded, ADR-0129 —
 * never a dogmatic block). The catalogue declarations (`domain-fitness-catalogue`)
 * ship every rule OBSERVE_ONLY at LAUNCH so it observes without swaying the verdict
 * until WF-0068 (or a project) promotes it — default-OFF, native hosts stay green.
 *
 * PURE: reads only the injected `domainConformance`; no filesystem/clock. Fail-safe:
 * a malformed input yields zero findings (never a false finding, never a throw).
 * Zero runtime deps, ESM, relative imports only (immutable rule #1).
 */

import {
  makeFinding, EvidenceClass, Enforcement, FindingStatus, Dimension,
} from './finding.mjs';

/**
 * The rule table: each entry binds a `domainConformance` list to a fitness ruleId,
 * its evidence tier, enforcement, dimension and the finding status it emits. The
 * eight blocking rules emit VIOLATION (BLOCKING, deterministic); the six advisory
 * signals emit OBSERVATION (OBSERVE_ONLY, semantic). `key` is the conformance
 * property; `blocking` marks the Class-A deterministic rules.
 * @type {ReadonlyArray<object>}
 */
export const DOMAIN_FITNESS_RULES = Object.freeze([
  // ---- Class A — deterministic blocking (§24) ----
  {
    ruleId: 'DOMAIN_INFRASTRUCTURE_INDEPENDENCE', key: 'domainInfrastructureDependencies',
    evidence: EvidenceClass.GRAPH_DERIVED, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    blocking: true, message: 'A domain module imports infrastructure.',
  },
  {
    ruleId: 'BOUNDED_CONTEXT_BOUNDARY', key: 'boundedContextViolations',
    evidence: EvidenceClass.GRAPH_DERIVED, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    blocking: true, message: 'A forbidden import crosses a bounded-context boundary.',
  },
  {
    ruleId: 'STATE_AUTHORITY_UNIQUENESS', key: 'stateAuthorityConflicts',
    evidence: EvidenceClass.SCHEMA_DERIVED, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    blocking: true, message: 'A state key has more than one write-authority.',
  },
  {
    ruleId: 'PUBLIC_CONTRACT_PRESERVATION', key: 'publicContractRemovals',
    evidence: EvidenceClass.SCHEMA_DERIVED, dimension: Dimension.DATA_CONTRACTS,
    blocking: true, message: 'A public contract was removed without a Decision.',
  },
  {
    ruleId: 'AGGREGATE_CONSISTENCY_BOUNDARY', key: 'aggregateBoundaryViolations',
    evidence: EvidenceClass.GRAPH_DERIVED, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    blocking: true, message: 'A write bypasses the aggregate root (consistency boundary).',
  },
  {
    ruleId: 'CROSS_CONTEXT_ACCESS', key: 'crossContextViolations',
    evidence: EvidenceClass.GRAPH_DERIVED, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    blocking: true, message: 'A context reaches another context via a disallowed relation.',
  },
  {
    ruleId: 'DOMAIN_EVENT_CONTRACT', key: 'domainEventContractViolations',
    evidence: EvidenceClass.SCHEMA_DERIVED, dimension: Dimension.DATA_CONTRACTS,
    blocking: true, message: 'A published domain event contract changed without versioning.',
  },
  {
    ruleId: 'IMPLEMENTATION_PACKET_CONFORMANCE', key: 'packetConformanceViolations',
    evidence: EvidenceClass.DETERMINISTIC, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    blocking: true, message: 'The real diff diverges from the Implementation Packet touch-set.',
  },
  // ---- Class B — predictive advisory (§24, ceiling guarded, never a dogmatic block) ----
  {
    ruleId: 'POSSIBLE_ANEMIC_MODEL', key: 'anemicModelSignals',
    evidence: EvidenceClass.SEMANTIC, dimension: Dimension.MODULARITY,
    blocking: false, message: 'A model looks anemic (behaviour outside the entity) — observation.',
  },
  {
    ruleId: 'POSSIBLY_LARGE_AGGREGATE', key: 'oversizedAggregates',
    evidence: EvidenceClass.SEMANTIC, dimension: Dimension.COMPLEXITY,
    blocking: false, message: 'An aggregate looks large — observation.',
  },
  {
    ruleId: 'EXCESS_DOMAIN_SERVICES', key: 'excessDomainServices',
    evidence: EvidenceClass.SEMANTIC, dimension: Dimension.MODULARITY,
    blocking: false, message: 'Excess domain services relative to entities — observation.',
  },
  {
    ruleId: 'VALUE_OBJECT_FRAGMENTATION', key: 'valueObjectFragmentation',
    evidence: EvidenceClass.SEMANTIC, dimension: Dimension.MODULARITY,
    blocking: false, message: 'Value-object fragmentation — observation.',
  },
  {
    ruleId: 'QUESTIONABLE_REPOSITORY_USE', key: 'questionableRepositoryUse',
    evidence: EvidenceClass.SEMANTIC, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    blocking: false, message: 'Questionable repository use — observation.',
  },
  {
    ruleId: 'OVER_COMPLEX_STRUCTURE', key: 'overComplexStructure',
    evidence: EvidenceClass.SEMANTIC, dimension: Dimension.COMPLEXITY,
    blocking: false, message: 'Structure more complex than the domain justifies — observation.',
  },
]);

/** Fast lookup: ruleId → spec (for the per-declaration filter in the catalogue). */
const RULE_BY_ID = Object.freeze(Object.fromEntries(DOMAIN_FITNESS_RULES.map((r) => [r.ruleId, r])));

/**
 * Evaluate every domain fitness rule against a `domainConformance` object,
 * producing the flat `Finding[]`. Each catalogue declaration filters this by its
 * own `ruleId` (mirrors how F1/F2/F3 filter `evaluateConformance`). PURE + total.
 *
 * @param {object} [domainConformance] the §23 comparator output (may be absent).
 * @returns {object[]} findings (empty when the conformance is absent/empty).
 */
export function evaluateDomainFitness(domainConformance) {
  const conf = domainConformance && typeof domainConformance === 'object' ? domainConformance : {};
  const findings = [];
  for (const rule of DOMAIN_FITNESS_RULES) {
    const entries = Array.isArray(conf[rule.key]) ? conf[rule.key] : [];
    entries.forEach((entry, idx) => {
      const path = entryPath(entry);
      findings.push(makeFinding({
        id: `${rule.ruleId}:${path}:${idx}`,
        ruleId: rule.ruleId,
        path,
        dimension: rule.dimension,
        status: rule.blocking ? FindingStatus.VIOLATION : FindingStatus.OBSERVATION,
        confidence: rule.blocking ? 1 : 0.5,
        evidence: { class: rule.evidence, source: 'domain-project-map-compare', ref: rule.ruleId },
        enforcement: rule.blocking ? Enforcement.BLOCKING : Enforcement.OBSERVE_ONLY,
        message: entryMessage(rule, entry),
      }));
    });
  }
  return findings;
}

/** Convenience for a catalogue declaration: findings for one ruleId only. */
export function domainFindingsFor(ruleId, domainConformance) {
  if (!RULE_BY_ID[ruleId]) return [];
  return evaluateDomainFitness(domainConformance).filter((f) => f.ruleId === ruleId);
}

/** Extract a stable finding path from a conformance entry ({path}|string|other). */
function entryPath(entry) {
  if (entry && typeof entry === 'object' && typeof entry.path === 'string' && entry.path) return entry.path;
  if (typeof entry === 'string' && entry) return entry;
  return 'unknown';
}

/** Compose the finding message, appending the entry detail when present. */
function entryMessage(rule, entry) {
  const detail = entry && typeof entry === 'object' && typeof entry.detail === 'string' ? entry.detail : '';
  return detail ? `${rule.message} (${detail})` : rule.message;
}
