/**
 * Architecture-debt gate — frozen enum/const vocabulary (WF-0057, ADR-0122).
 *
 * WHY this file is split from `finding.mjs`: the gate's enum surface is large
 * (8 closed enums + 2 rank/tier maps) and is a genuinely distinct concern from
 * the pure validation/comparator logic that consumes it. Keeping the value sets
 * here lets `finding.mjs` stay a thin logic module well under the line budget
 * (constitution §1 cohesive seam). Every value below traces VERBATIM to
 * `W0-contracts.md` §1.2/§1.3/§2/§3/§4/§5/§6; changing one is a contract change.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

/**
 * The mode a RULE runs in (§1.3). One rule → exactly one mode.
 * @type {Readonly<Record<string,string>>}
 */
export const Enforcement = Object.freeze({
  BLOCKING: 'BLOCKING',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  ADVISORY: 'ADVISORY',
  OBSERVE_ONLY: 'OBSERVE_ONLY',
  DISABLED: 'DISABLED',
});

/**
 * Per-FINDING status (§1.2). Distinct from the whole-gate GateOutcome.
 * UNKNOWN and SKIPPED are NEVER a PASS (§16).
 * @type {Readonly<Record<string,string>>}
 */
export const FindingStatus = Object.freeze({
  VIOLATION: 'VIOLATION',
  WARNING: 'WARNING',
  OBSERVATION: 'OBSERVATION',
  PASS: 'PASS',
  UNKNOWN: 'UNKNOWN',
  SKIPPED: 'SKIPPED',
});

/**
 * The remediation a finding recommends (§27). 15 closed values — no free text.
 * KEEP_COHESIVE and OBSERVE are terminal-positive (no mandatory backlog work);
 * ACCEPT_TEMPORARILY routes to the intentional-debt governance path (§21).
 * @type {Readonly<Record<string,string>>}
 */
export const RecommendedAction = Object.freeze({
  SPLIT: 'SPLIT',
  MERGE: 'MERGE',
  SIMPLIFY: 'SIMPLIFY',
  REMOVE_WRAPPER: 'REMOVE_WRAPPER',
  RESTORE_BOUNDARY: 'RESTORE_BOUNDARY',
  INVERT_DEPENDENCY: 'INVERT_DEPENDENCY',
  ADD_CONTRACT: 'ADD_CONTRACT',
  ADD_TEST: 'ADD_TEST',
  ADD_ROLLBACK: 'ADD_ROLLBACK',
  ADD_OBSERVABILITY: 'ADD_OBSERVABILITY',
  CONSOLIDATE_STATE: 'CONSOLIDATE_STATE',
  MIGRATE: 'MIGRATE',
  KEEP_COHESIVE: 'KEEP_COHESIVE',
  OBSERVE: 'OBSERVE',
  ACCEPT_TEMPORARILY: 'ACCEPT_TEMPORARILY',
});

/**
 * The 9 evidence classes (§2). The class drives precedence in the policy engine.
 * @type {Readonly<Record<string,string>>}
 */
export const EvidenceClass = Object.freeze({
  DETERMINISTIC: 'DETERMINISTIC',
  SCHEMA_DERIVED: 'SCHEMA_DERIVED',
  GRAPH_DERIVED: 'GRAPH_DERIVED',
  TEST_DERIVED: 'TEST_DERIVED',
  RUNTIME_DERIVED: 'RUNTIME_DERIVED',
  HISTORY_DERIVED: 'HISTORY_DERIVED',
  SEMANTIC: 'SEMANTIC',
  HEURISTIC: 'HEURISTIC',
  HUMAN_REVIEWED: 'HUMAN_REVIEWED',
});

/**
 * Evidence precedence (§3/§16). Lower number = stronger authority.
 * HEURISTIC shares the lowest automated tier (7) with SEMANTIC; HUMAN_REVIEWED
 * ranks last (8) as a FACT source (authoritative for ACCEPTANCE, not fabrication).
 * @type {Readonly<Record<string,number>>}
 */
export const EVIDENCE_RANK = Object.freeze({
  SCHEMA_DERIVED: 1,
  DETERMINISTIC: 2,
  GRAPH_DERIVED: 3,
  TEST_DERIVED: 4,
  RUNTIME_DERIVED: 5,
  HISTORY_DERIVED: 6,
  SEMANTIC: 7,
  HEURISTIC: 7,
  HUMAN_REVIEWED: 8,
});

/** Classes that may carry a BLOCKING floor — the deterministic tier (§3, fork #2). */
export const DETERMINISTIC_TIER = Object.freeze(
  new Set(['SCHEMA_DERIVED', 'DETERMINISTIC', 'GRAPH_DERIVED', 'TEST_DERIVED']),
);

/**
 * The 9 whole-gate verdicts (§6.1). Distinct from per-finding FindingStatus.
 * @type {Readonly<Record<string,string>>}
 */
export const GateOutcome = Object.freeze({
  PASS: 'PASS',
  PASS_WITH_OBSERVATION: 'PASS_WITH_OBSERVATION',
  DEBT_REDUCED: 'DEBT_REDUCED',
  DEBT_ACCEPTED: 'DEBT_ACCEPTED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  REMEDIATION_REQUIRED: 'REMEDIATION_REQUIRED',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED',
  UNKNOWN: 'UNKNOWN',
});

/** The approval subset of GateOutcome (§6.1/§23). UNKNOWN/SKIPPED are NOT here. */
export const PASSING_OUTCOMES = Object.freeze(
  new Set(['PASS', 'PASS_WITH_OBSERVATION', 'DEBT_REDUCED', 'DEBT_ACCEPTED']),
);

/**
 * The 7-way baseline delta (§6.2). UNKNOWN is honest-non-passing.
 * @type {Readonly<Record<string,string>>}
 */
export const BaselineClass = Object.freeze({
  PRE_EXISTING: 'PRE_EXISTING',
  INTRODUCED: 'INTRODUCED',
  WORSENED: 'WORSENED',
  UNCHANGED: 'UNCHANGED',
  REDUCED: 'REDUCED',
  PAID: 'PAID',
  TRANSFERRED: 'TRANSFERRED',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Effort-to-pay-down class (§5.1). UNKNOWN is legitimate (model-estimated
 * principal is OBSERVE_ONLY) and must NOT be coerced to a number.
 * @type {Readonly<Record<string,string>>}
 */
export const Principal = Object.freeze({
  TRIVIAL: 'TRIVIAL',
  SMALL: 'SMALL',
  MEDIUM: 'MEDIUM',
  LARGE: 'LARGE',
  PROGRAM_LEVEL: 'PROGRAM_LEVEL',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Recurring-cost categories (§5.2). A finding lists ALL that apply (array).
 * @type {Readonly<Record<string,string>>}
 */
export const Interest = Object.freeze({
  FUTURE_CHANGE_COST: 'FUTURE_CHANGE_COST',
  TESTING_COST: 'TESTING_COST',
  REVIEW_COST: 'REVIEW_COST',
  INCIDENT_RISK: 'INCIDENT_RISK',
  DEPLOYMENT_COST: 'DEPLOYMENT_COST',
  SUPPORT_COST: 'SUPPORT_COST',
  RUNTIME_COST: 'RUNTIME_COST',
  OPERATIONS_COST: 'OPERATIONS_COST',
  CONTEXT_RETRIEVAL_COST: 'CONTEXT_RETRIEVAL_COST',
  AGENT_TOKEN_COST: 'AGENT_TOKEN_COST',
  REPEATED_EXPLORATION_COST: 'REPEATED_EXPLORATION_COST',
});

/** Bounded risk band (§5.3). UNKNOWN factors stay UNKNOWN, never coerced to 0. */
export const RiskBand = Object.freeze({
  LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', UNKNOWN: 'UNKNOWN',
});

/** Default risk: all factors UNKNOWN, no floor tripped (§5.3). */
export const DEFAULT_RISK = Object.freeze({
  probability: 'UNKNOWN', impact: 'UNKNOWN', blastRadius: 'UNKNOWN',
  detectability: 'UNKNOWN', reversibility: 'UNKNOWN', compounding: 'UNKNOWN',
  timeToManifest: 'UNKNOWN',
  securityFloor: false, dataIntegrityFloor: false, operationalFloor: false,
});

/** The 12 evaluation DIMENSIONS (§4) — what the gate MEASURES. */
export const Dimension = Object.freeze({
  ARCHITECTURE_CONFORMANCE: 'ARCHITECTURE_CONFORMANCE',
  MODULARITY: 'MODULARITY',
  COMPLEXITY: 'COMPLEXITY',
  TESTABILITY: 'TESTABILITY',
  RELIABILITY: 'RELIABILITY',
  SECURITY_PRIVACY: 'SECURITY_PRIVACY',
  OBSERVABILITY: 'OBSERVABILITY',
  PERFORMANCE: 'PERFORMANCE',
  OPERATIONS_DELIVERY: 'OPERATIONS_DELIVERY',
  DEPENDENCIES: 'DEPENDENCIES',
  DATA_CONTRACTS: 'DATA_CONTRACTS',
  COGNITIVE_COHERENCE: 'COGNITIVE_COHERENCE',
});

/** The ~21 debt CLASSES (§4) — what KIND of debt. */
export const DebtClass = Object.freeze({
  CODE: 'CODE', DESIGN: 'DESIGN', ARCHITECTURAL: 'ARCHITECTURAL', TEST: 'TEST',
  SECURITY: 'SECURITY', PRIVACY: 'PRIVACY', RELIABILITY: 'RELIABILITY',
  OPERATIONAL: 'OPERATIONAL', OBSERVABILITY: 'OBSERVABILITY', PERFORMANCE: 'PERFORMANCE',
  DEPENDENCY: 'DEPENDENCY', DATA: 'DATA', CONTRACT: 'CONTRACT', CONFIGURATION: 'CONFIGURATION',
  BUILD_AND_DELIVERY: 'BUILD_AND_DELIVERY', MIGRATION: 'MIGRATION', DOCUMENTATION: 'DOCUMENTATION',
  GOVERNANCE: 'GOVERNANCE', CONTEXT: 'CONTEXT', AGENT_EXECUTION: 'AGENT_EXECUTION',
});

/**
 * Legacy detector `kind` → new dimension (§1.4). Unmapped kinds default to
 * COGNITIVE_COHERENCE in the lifter (the cheapest/most-generic lens).
 * @type {Readonly<Record<string,string>>}
 */
export const LEGACY_DIMENSION = Object.freeze({
  'line-budget': 'COMPLEXITY',
  'srp-and': 'COGNITIVE_COHERENCE',
  'todo-marker': 'COGNITIVE_COHERENCE',
  'react-state-loop': 'MODULARITY',
});

/**
 * Legacy detector `kind` → new debtClass (§1.4). Unmapped kinds default to CODE.
 * @type {Readonly<Record<string,string>>}
 */
export const LEGACY_DEBTCLASS = Object.freeze({
  'line-budget': 'CODE',
  'srp-and': 'CODE',
  'todo-marker': 'CODE',
  'react-state-loop': 'DESIGN',
});
