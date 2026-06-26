/**
 * ArchitectureConformanceEvaluator (WF-0057 W2.2, ADR-0122) — the deterministic
 * BLOCKING floor for architecture violations (dimension ARCHITECTURE_CONFORMANCE,
 * §9.1). PURE: the caller injects the structural graph (`insights` from
 * `computeInsights`), a `baseline` of the pre-change graph, a layer-rules config,
 * and a state-ownership map — this module does NO filesystem walk and owns no
 * clock. It emits `Finding[]` of the W0.3 shape (one per violation) carrying
 * `enforcement: BLOCKING`, `status: VIOLATION`, and a deterministic-tier evidence
 * class (GRAPH_DERIVED for F1/F2, SCHEMA_DERIVED for F3) — `makeFinding` THROWS if
 * a BLOCKING finding ever lacks that class, so the invariant is structural.
 *
 * BASELINE-RELATIVE (W0-contracts §25): a violation is emitted ONLY when it is NEW
 * vs the baseline, so an untouched legacy cycle/edge/authority never blocks
 * unrelated work (test §34.15). FAIL-CLOSED (§3/§16): when the graph or baseline
 * evidence is missing, the evaluator returns an UNKNOWN finding per affected floor
 * via the contract's `resolveMissingEvidence` pattern — it NEVER silently PASSes
 * (test §34.22). The rule bodies live in the sibling `conformance-rules.mjs`.
 *
 * Zero runtime deps, ESM, node:/relative imports only (immutable rule #1).
 */

import {
  makeFinding, resolveMissingEvidence,
  Enforcement, FindingStatus, EvidenceClass, Dimension, DebtClass, RecommendedAction,
} from './finding.mjs';
import {
  newCycles, boundaryViolations, duplicateStateAuthorities,
} from './conformance-rules.mjs';

/** Stable finding id from a ruleId + path + anchor (anchor over raw line, §1.1). */
const findingId = (ruleId, path, anchor) => `${ruleId}:${path}:${anchor}`;

/**
 * Build the single fail-closed UNKNOWN finding for a floor whose evidence could
 * not be produced (graph/baseline absent). Routes through `resolveMissingEvidence`
 * so the status can only be UNKNOWN/SKIPPED — never PASS (§16). Enforcement stays
 * ADVISORY because an UNKNOWN is not a deterministic VIOLATION; downstream policy
 * maps a material UNKNOWN to REVIEW_REQUIRED (§23), never approval.
 */
function unknownFinding(ruleId, evidenceClass, reasonCode, message) {
  return makeFinding({
    id: findingId(ruleId, 'arch-conformance', 'no-evidence'),
    ruleId,
    dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    debtClass: DebtClass.ARCHITECTURAL,
    status: resolveMissingEvidence({ status: FindingStatus.UNKNOWN }),
    confidence: 1,
    evidence: { class: evidenceClass, source: 'arch-conformance', ref: ruleId },
    reasonCodes: [reasonCode],
    recommendedAction: RecommendedAction.OBSERVE,
    enforcement: Enforcement.ADVISORY,
    message,
    path: 'arch-conformance',
  });
}

/** Lift an F1 new-cycle descriptor into a BLOCKING GRAPH_DERIVED VIOLATION finding. */
function cycleFinding(cycle) {
  const path = cycle.nodes[0] || 'unknown';
  return makeFinding({
    id: findingId('F1.forbidden-cycle', path, cycle.key),
    ruleId: 'F1.forbidden-cycle',
    dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    debtClass: DebtClass.ARCHITECTURAL,
    status: FindingStatus.VIOLATION,
    confidence: 1,
    evidence: { class: EvidenceClass.GRAPH_DERIVED, source: 'project-map', ref: cycle.key },
    reasonCodes: ['NEW_FORBIDDEN_CYCLE'],
    recommendedAction: RecommendedAction.INVERT_DEPENDENCY,
    enforcement: Enforcement.BLOCKING,
    message: `New forbidden dependency cycle: ${cycle.nodes.join(' → ')} → ${cycle.nodes[0]}`,
    path,
  });
}

/** Lift an F2 boundary descriptor into a BLOCKING GRAPH_DERIVED VIOLATION finding. */
function boundaryFinding(violation) {
  return makeFinding({
    id: findingId('F2.boundary', violation.from, violation.to),
    ruleId: 'F2.boundary',
    dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    debtClass: DebtClass.ARCHITECTURAL,
    status: FindingStatus.VIOLATION,
    confidence: 1,
    evidence: {
      class: EvidenceClass.GRAPH_DERIVED,
      source: 'project-map',
      ref: `${violation.from}→${violation.to}`,
    },
    reasonCodes: ['BOUNDARY_VIOLATION', `${violation.fromLayer}_TO_${violation.toLayer}`.toUpperCase()],
    recommendedAction: violation.action === 'INVERT_DEPENDENCY'
      ? RecommendedAction.INVERT_DEPENDENCY
      : RecommendedAction.RESTORE_BOUNDARY,
    enforcement: Enforcement.BLOCKING,
    message: `Boundary violation: ${violation.fromLayer} module "${violation.from}" imports ${violation.toLayer} "${violation.to}"`,
    path: violation.from,
  });
}

/** Lift an F3 duplicate-authority descriptor into a BLOCKING SCHEMA_DERIVED finding. */
function stateAuthorityFinding(dup) {
  return makeFinding({
    id: findingId('F3.state-authority', dup.module, dup.state),
    ruleId: 'F3.state-authority',
    dimension: Dimension.ARCHITECTURE_CONFORMANCE,
    debtClass: DebtClass.DATA,
    status: FindingStatus.VIOLATION,
    confidence: 1,
    evidence: { class: EvidenceClass.SCHEMA_DERIVED, source: 'state-ownership', ref: dup.state },
    reasonCodes: ['DUPLICATE_STATE_AUTHORITY'],
    recommendedAction: RecommendedAction.CONSOLIDATE_STATE,
    enforcement: Enforcement.BLOCKING,
    message: `Duplicate write-authority for state "${dup.state}": "${dup.module}" writes it, but the canonical owner is "${dup.owner}"`,
    path: dup.module,
  });
}

/**
 * Evaluate the architecture-conformance floors over an injected graph + baseline.
 *
 * @param {Object} input
 * @param {{cycles?:string[][], structural?:Object}} input.insights  current graph
 *        insights (from `computeInsights`). Absent/null → F1/F2 fail closed.
 * @param {Array<{path:string, deps?:string[]}>} [input.modules]  edge model for F2.
 * @param {Object} [input.baseline]  pre-change evidence:
 *        `{ cycles?:string[][], forbiddenEdges?:Array<{from,to}>, stateAuthorities?:Array<{state,module}> }`.
 *        Absent → fail closed (no silent PASS), never "everything is new".
 * @param {Object} [input.layerRules]  `{ layers, forbidden, adapters?, adapterLayers?, invertPairs? }` for F2.
 * @param {Record<string,string>} [input.ownership]  canonical owner module per state key (F3).
 * @param {Array<{state:string, module:string}>} [input.writeAuthorities]  declared writers (F3).
 * @returns {Object[]} a list of validated `Finding`s (BLOCKING VIOLATION or fail-closed UNKNOWN).
 */
export function evaluateConformance(input = {}) {
  const findings = [];
  const { insights, modules, baseline, layerRules, ownership, writeAuthorities } = input;

  // Fail-closed precondition: F1/F2 are GRAPH_DERIVED — without the graph or the
  // baseline they cannot be evaluated, so they surface UNKNOWN, never PASS (§16).
  const graphMissing = !insights || !Array.isArray(insights.cycles);
  const baselineMissing = !baseline || typeof baseline !== 'object';

  if (graphMissing || baselineMissing) {
    findings.push(unknownFinding(
      'F1.forbidden-cycle', EvidenceClass.GRAPH_DERIVED, 'GRAPH_EVIDENCE_MISSING',
      'Cannot evaluate dependency cycles: structural graph or baseline evidence is missing',
    ));
    findings.push(unknownFinding(
      'F2.boundary', EvidenceClass.GRAPH_DERIVED, 'GRAPH_EVIDENCE_MISSING',
      'Cannot evaluate boundary direction: structural graph or baseline evidence is missing',
    ));
  } else {
    for (const cycle of newCycles(insights.cycles, baseline.cycles)) {
      findings.push(cycleFinding(cycle));
    }
    for (const v of boundaryViolations(modules, layerRules, baseline.forbiddenEdges)) {
      findings.push(boundaryFinding(v));
    }
  }

  // F3 is SCHEMA_DERIVED (declared ownership). It needs the ownership map AND the
  // baseline to be baseline-relative; missing baseline fails closed for F3 too.
  if (ownership && typeof ownership === 'object' && !baselineMissing) {
    for (const dup of duplicateStateAuthorities(
      writeAuthorities, ownership, baseline.stateAuthorities,
    )) {
      findings.push(stateAuthorityFinding(dup));
    }
  } else if (ownership && typeof ownership === 'object' && baselineMissing) {
    findings.push(unknownFinding(
      'F3.state-authority', EvidenceClass.SCHEMA_DERIVED, 'BASELINE_EVIDENCE_MISSING',
      'Cannot evaluate state authority: baseline evidence is missing',
    ));
  }

  return findings;
}
