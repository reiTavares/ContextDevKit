/**
 * Architecture-debt gate — the INITIAL fitness-function catalogue (WF-0057 W3,
 * ADR-0122). The W2 floor analyzers are the first executable architectural
 * properties registered with the FitnessFunctionRunner (§17): F1/F2/F3 from
 * `conformance-evaluator.mjs` and the security/reliability/testability floors
 * from `floors.mjs`. The line-count signal rides as ADVISORY; the model-graded
 * dimensions (cognitive-coherence, change-amplification) ride as OBSERVE_ONLY
 * (decisions.md Fork-3 — promote to ADVISORY only after §33 calibration).
 *
 * WHY this file is split from `fitness-registry.mjs`: the catalogue is DATA — a
 * list of declarations binding analyzers to descriptors — and is a distinct
 * concern from the registry's validate/run LOGIC. Keeping the declarations here
 * lets `fitness-registry.mjs` stay a thin engine under the §1 line budget.
 *
 * Each `evaluate(context)` is PURE: it reads ONLY the injected analyzer outputs
 * the engine hands it (never the filesystem). Zero runtime deps, ESM,
 * relative imports only (immutable rule #1).
 */

import {
  EvidenceClass, Enforcement, Dimension,
} from './finding.mjs';
import { evaluateConformance } from './conformance-evaluator.mjs';
import {
  securityFloor, reliabilityFloor, testabilityFloor,
} from './floors.mjs';
import { FitnessType, RolloutState } from './fitness-registry.mjs';

/**
 * F1 — no NEW forbidden dependency cycle (§9.1). GRAPH_DERIVED, BLOCKING.
 * Reads `context.conformance` (the injected `evaluateConformance` input) and
 * returns only the F1 cycle findings.
 */
const f1NewCycle = {
  id: 'F1.forbidden-cycle', description: 'No new forbidden dependency cycle is introduced vs the baseline graph.',
  scope: 'module-graph', owner: 'architect', evidenceSource: EvidenceClass.GRAPH_DERIVED,
  severity: 'BLOCKER', enforcement: Enforcement.BLOCKING, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-2'],
  failureMessage: 'A new forbidden dependency cycle was introduced.',
  remediation: 'Invert one edge of the cycle behind an interface (dependency inversion).',
  rolloutState: RolloutState.ACTIVE, type: FitnessType.STATIC,
  evaluate: (ctx) => evaluateConformance(ctx.conformance || {})
    .filter((f) => f.ruleId === 'F1.forbidden-cycle'),
};

/** F2 — no NEW boundary/dependency-direction violation (§9.1). GRAPH_DERIVED, BLOCKING. */
const f2Boundary = {
  id: 'F2.boundary', description: 'No new boundary or dependency-direction violation is introduced.',
  scope: 'module-graph', owner: 'architect', evidenceSource: EvidenceClass.GRAPH_DERIVED,
  severity: 'BLOCKER', enforcement: Enforcement.BLOCKING, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-2'],
  failureMessage: 'A new layer-boundary violation was introduced.',
  remediation: 'Restore the boundary or invert the dependency at the edge.',
  rolloutState: RolloutState.ACTIVE, type: FitnessType.STATIC,
  evaluate: (ctx) => evaluateConformance(ctx.conformance || {})
    .filter((f) => f.ruleId === 'F2.boundary'),
};

/** F3 — single write-authority per state key (§9.1). SCHEMA_DERIVED, BLOCKING. */
const f3StateAuthority = {
  id: 'F3.state-authority', description: 'Each piece of state has exactly one declared write-authority (single source of truth).',
  scope: 'state-ownership', owner: 'architect', evidenceSource: EvidenceClass.SCHEMA_DERIVED,
  severity: 'BLOCKER', enforcement: Enforcement.BLOCKING, dimension: Dimension.ARCHITECTURE_CONFORMANCE,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-2'],
  failureMessage: 'A second write-authority was introduced for a state key.',
  remediation: 'Consolidate state writes onto the canonical owner.',
  rolloutState: RolloutState.ACTIVE, type: FitnessType.STATIC,
  evaluate: (ctx) => evaluateConformance(ctx.conformance || {})
    .filter((f) => f.ruleId === 'F3.state-authority'),
};

/** Security floor (F7, §9.6). DETERMINISTIC, BLOCKING — scoped to changed lines. */
const securityFloorFn = {
  id: 'floor.security', description: 'No critical security regression on a changed line vs baseline.',
  scope: 'changed-files', owner: 'security', evidenceSource: EvidenceClass.DETERMINISTIC,
  severity: 'BLOCKER', enforcement: Enforcement.BLOCKING, dimension: Dimension.SECURITY_PRIVACY,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-2'],
  failureMessage: 'A security regression was introduced on a changed line.',
  remediation: 'Restore the removed guard or replace the unsafe sink.',
  rolloutState: RolloutState.ACTIVE, type: FitnessType.STATIC,
  evaluate: (ctx) => securityFloor((ctx.floors || {}).changedFiles),
};

/** Reliability floor (§9.5). DETERMINISTIC, BLOCKING (irreversible migration sub-check). */
const reliabilityFloorFn = {
  id: 'floor.reliability', description: 'No irreversible migration ships without a declared rollback; retryable/async risks surfaced.',
  scope: 'change-metadata', owner: 'devops', evidenceSource: EvidenceClass.DETERMINISTIC,
  severity: 'BLOCKER', enforcement: Enforcement.BLOCKING, dimension: Dimension.RELIABILITY,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-2'],
  failureMessage: 'An irreversible migration has no declared rollback.',
  remediation: 'Add a rollback path or make the migration reversible.',
  rolloutState: RolloutState.ACTIVE, type: FitnessType.STATIC,
  evaluate: (ctx) => reliabilityFloor((ctx.floors || {}).reliability),
};

/** Testability floor (F8, §9.4). DETERMINISTIC, BLOCKING — consumes the test selector. */
const testabilityFloorFn = {
  id: 'floor.testability', description: 'No changed critical behavior ships without a covering test.',
  scope: 'changed-behaviors', owner: 'qa-orchestrator', evidenceSource: EvidenceClass.DETERMINISTIC,
  severity: 'BLOCKER', enforcement: Enforcement.BLOCKING, dimension: Dimension.TESTABILITY,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-2'],
  failureMessage: 'A changed critical behavior has no covering test.',
  remediation: 'Add a behavior test that covers the changed critical path.',
  rolloutState: RolloutState.ACTIVE, type: FitnessType.STATIC,
  evaluate: (ctx) => testabilityFloor(
    (ctx.floors || {}).changedBehaviors, (ctx.floors || {}).impactedTests,
  ),
};

/**
 * Line-count signal — ADVISORY (ADR-0122 demotes the legacy severity-5 block to
 * an investigation signal). The collector pre-computes the findings; this fitness
 * function only surfaces them, never blocks. Reads `context.lineSignals`.
 */
const lineCountAdvisory = {
  id: 'signal.line-count', description: 'File line-count over budget is an advisory investigation signal (not a CI block).',
  scope: 'changed-files', owner: 'code-reviewer', evidenceSource: EvidenceClass.HEURISTIC,
  severity: 'INFO', enforcement: Enforcement.ADVISORY, dimension: Dimension.COMPLEXITY,
  relatedDecisions: ['ADR-0122'],
  failureMessage: 'A file exceeds the line budget — investigate for a responsibility seam.',
  remediation: 'Split only on a real responsibility seam; document cohesion otherwise.',
  rolloutState: RolloutState.ADVISORY, type: FitnessType.STATIC,
  evaluate: (ctx) => (Array.isArray(ctx.lineSignals) ? ctx.lineSignals : []),
};

/**
 * Cognitive-coherence — model-graded (§9.12). OBSERVE_ONLY at launch (Fork-3):
 * it runs and observes, but its findings never influence the gate verdict until
 * §33 calibration promotes it. Reads pre-graded `context.cognitiveCoherence`.
 */
const cognitiveCoherence = {
  id: 'observe.cognitive-coherence', description: 'Cognitive-coherence of a unit (model-graded) — observed, not enforced.',
  scope: 'changed-files', owner: 'architect', evidenceSource: EvidenceClass.SEMANTIC,
  severity: 'INFO', enforcement: Enforcement.OBSERVE_ONLY, dimension: Dimension.COGNITIVE_COHERENCE,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-3'],
  failureMessage: 'A unit scored low on cognitive coherence (observation only).',
  remediation: 'Consider simplifying; tracked as observation until calibrated.',
  rolloutState: RolloutState.OBSERVE_ONLY, type: FitnessType.HOLISTIC,
  evaluate: (ctx) => (Array.isArray(ctx.cognitiveCoherence) ? ctx.cognitiveCoherence : []),
};

/** Change-amplification — model-estimated (§19). OBSERVE_ONLY (Fork-3). */
const changeAmplification = {
  id: 'observe.change-amplification', description: 'Change-amplification of a unit (model-estimated) — observed, not enforced.',
  scope: 'module-graph', owner: 'architect', evidenceSource: EvidenceClass.SEMANTIC,
  severity: 'INFO', enforcement: Enforcement.OBSERVE_ONLY, dimension: Dimension.MODULARITY,
  relatedDecisions: ['ADR-0122', 'WF-0057:Fork-3'],
  failureMessage: 'A change amplifies across many units (observation only).',
  remediation: 'Consider decoupling; tracked as observation until calibrated.',
  rolloutState: RolloutState.OBSERVE_ONLY, type: FitnessType.HOLISTIC,
  evaluate: (ctx) => (Array.isArray(ctx.changeAmplification) ? ctx.changeAmplification : []),
};

/**
 * The ordered initial catalogue. BLOCKING deterministic floors first
 * (lexicographic intent), then the ADVISORY signal, then the OBSERVE_ONLY
 * model-graded dimensions.
 * @type {Object[]}
 */
export const INITIAL_FITNESS_CATALOGUE = [
  f1NewCycle, f2Boundary, f3StateAuthority,
  securityFloorFn, reliabilityFloorFn, testabilityFloorFn,
  lineCountAdvisory, cognitiveCoherence, changeAmplification,
];
