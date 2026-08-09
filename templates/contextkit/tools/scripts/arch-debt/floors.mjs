/**
 * Architecture-debt gate — the BLOCKING FLOORS (WF-0057 Wave W2, ADR-0122).
 *
 * The non-averageable, lexicographic floors for SECURITY (F7, §9.6), RELIABILITY
 * (§9.5/§34.11-13), and TESTABILITY (F8, §9.4/§34.14). A tripped floor short-
 * circuits the whole gate to BLOCKED regardless of any high score elsewhere
 * (§20.3 — "floors must NOT be averaged away"). The three floors are INDEPENDENT
 * and NON-AVERAGEABLE per decisions.md Fork-2.
 *
 * PURE & DETERMINISTIC: every check is INJECTED its inputs (changed-set, baseline,
 * impacted-tests, migration/async metadata). NO filesystem/git/clock/random here —
 * the W1 collector gathers evidence; this module only decides. FAIL-CLOSED
 * (Fork-2): a floor that THROWS or lacks evidence resolves to UNKNOWN →
 * REVIEW_REQUIRED, NEVER a silent PASS (distinct from the ADVISORY detector-error
 * swallow at `tech-debt-scan.mjs:89-93`, which is for non-floor signal only).
 *
 * COHESION NOTE (constitution §1): one responsibility — floor evaluation. The
 * three checks share `blockingFloorFinding`/`reviewFinding`/`floorRisk` emit
 * helpers + the `evaluateFloors`/`applyFloors` orchestrator; splitting them would
 * fragment a cohesive unit. The security regex catalogue is already split out.
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

import {
  makeFinding, isFloorBreach, resolveMissingEvidence,
  Enforcement, FindingStatus, EvidenceClass, Dimension, DebtClass, RecommendedAction,
} from './finding.mjs';
import { scanSecurityPatterns } from './floors-security-patterns.mjs';

/** A floor that throws or lacks evidence resolves here — never to PASS. */
const REVIEW_REQUIRED = 'REVIEW_REQUIRED';

/** Build the floor `risk` object: default all-UNKNOWN, then trip the one floor. */
const floorRisk = (which) => ({
  probability: 'UNKNOWN', impact: 'UNKNOWN', blastRadius: 'UNKNOWN',
  detectability: 'UNKNOWN', reversibility: 'UNKNOWN', compounding: 'UNKNOWN',
  timeToManifest: 'UNKNOWN',
  securityFloor: which === 'security',
  dataIntegrityFloor: which === 'dataIntegrity',
  operationalFloor: which === 'operational',
});

/**
 * Emit one BLOCKING floor VIOLATION — DETERMINISTIC evidence (the only tier
 * `makeFinding` permits for BLOCKING, fork #2) + a tripped floor in `risk` so
 * `isFloorBreach` short-circuits downstream.
 * @param {Object} spec {ruleId,path,dimension,debtClass,which,reasonCodes,action,message,line?,source?}
 * @returns {Object} a BLOCKING+VIOLATION Finding with the floor tripped.
 */
function blockingFloorFinding(spec) {
  return makeFinding({
    id: `${spec.ruleId}:${spec.path}:${spec.line ?? 'file'}`,
    ruleId: spec.ruleId,
    dimension: spec.dimension,
    debtClass: spec.debtClass,
    status: FindingStatus.VIOLATION,
    confidence: 0.9,
    evidence: { class: EvidenceClass.DETERMINISTIC, source: spec.source ?? 'arch-debt-floors', ref: spec.ruleId },
    reasonCodes: spec.reasonCodes,
    risk: floorRisk(spec.which),
    recommendedAction: spec.action,
    enforcement: Enforcement.BLOCKING,
    message: spec.message,
    path: spec.path,
    line: spec.line,
  });
}

/**
 * SECURITY FLOOR (F7, §9.6). A critical security regression on CHANGED lines vs
 * baseline → BLOCKING. Conservative, pattern-based (see floors-security-patterns).
 * Only the changed-set is scanned, so unchanged legacy security debt does NOT
 * block unrelated work (§34.15) — scope is the change, the floor is lexicographic.
 *
 * @param {{path:string, addedLines?:string[], removedLines?:string[]}[]} changedFiles
 * @returns {Object[]} zero or more BLOCKING security findings.
 * @throws never — a malformed input yields no findings (the collector validates upstream).
 */
export function securityFloor(changedFiles) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const findings = [];
  for (const file of files) {
    if (!file || typeof file.path !== 'string') continue;
    const hits = scanSecurityPatterns(file.addedLines, file.removedLines);
    for (const hit of hits) {
      findings.push(blockingFloorFinding({
        ruleId: `F7.security-regression.${hit.code.toLowerCase()}`,
        path: file.path,
        dimension: Dimension.SECURITY_PRIVACY,
        debtClass: hit.code.startsWith('PII') ? DebtClass.PRIVACY : DebtClass.SECURITY,
        which: 'security',
        reasonCodes: [hit.code],
        action: hit.code === 'AUTH_CHECK_REMOVED' ? RecommendedAction.RESTORE_BOUNDARY : RecommendedAction.SIMPLIFY,
        message: `Security regression on a changed line: ${hit.reason}`,
        source: 'arch-debt-floors.security',
      }));
    }
  }
  return findings;
}

/**
 * RELIABILITY FLOOR (§9.5). Three sub-checks:
 *  - §34.11 retryable op WITHOUT idempotency → REVIEW (detected, not auto-blocked).
 *  - §34.12 irreversible migration WITHOUT a declared rollback → BLOCKING.
 *  - §34.13 critical async path WITHOUT observability → REVIEW (detected).
 *
 * @param {Object} change  injected reliability evidence:
 *   {retryableOps?:{path,line?,idempotent:boolean}[],
 *    migrations?:{path,line?,irreversible:boolean,hasRollback:boolean}[],
 *    criticalAsync?:{path,line?,observable:boolean}[]}
 * @returns {Object[]} BLOCKING findings for unsafe migrations + REVIEW findings for the rest.
 */
export function reliabilityFloor(change) {
  if (!change || typeof change !== 'object') return [];
  const findings = [];

  for (const op of Array.isArray(change.retryableOps) ? change.retryableOps : []) {
    if (op && op.idempotent === false) {
      findings.push(reviewFinding({
        ruleId: 'R1.retryable-without-idempotency', path: op.path, line: op.line,
        dimension: Dimension.RELIABILITY, debtClass: DebtClass.RELIABILITY,
        reasonCodes: ['RETRYABLE_OP_NOT_IDEMPOTENT'], action: RecommendedAction.SIMPLIFY,
        message: 'Retryable operation has no idempotency guarantee (§34.11).',
      }));
    }
  }
  for (const mig of Array.isArray(change.migrations) ? change.migrations : []) {
    if (mig && mig.irreversible === true && mig.hasRollback !== true) {
      findings.push(blockingFloorFinding({
        ruleId: 'R2.irreversible-migration-without-rollback', path: mig.path, line: mig.line,
        dimension: Dimension.RELIABILITY, debtClass: DebtClass.MIGRATION,
        which: 'operational', reasonCodes: ['IRREVERSIBLE_MIGRATION_NO_ROLLBACK'],
        action: RecommendedAction.ADD_ROLLBACK,
        message: 'Irreversible migration with no declared rollback (§34.12).',
        source: 'arch-debt-floors.reliability',
      }));
    }
  }
  for (const path of Array.isArray(change.criticalAsync) ? change.criticalAsync : []) {
    if (path && path.observable === false) {
      findings.push(reviewFinding({
        ruleId: 'R3.critical-async-without-observability', path: path.path, line: path.line,
        dimension: Dimension.RELIABILITY, debtClass: DebtClass.OBSERVABILITY,
        reasonCodes: ['CRITICAL_ASYNC_NOT_OBSERVABLE'], action: RecommendedAction.ADD_OBSERVABILITY,
        message: 'Critical async path has no observability (§34.13).',
      }));
    }
  }
  return findings;
}

/**
 * TESTABILITY FLOOR (F8, §9.4/§34.14). A changed critical-behavior path with NO
 * covering test → BLOCKING. CONSUMES the project's test-impact selector result
 * (§17 — no second test platform); the impacted tests are injected, never
 * recomputed here. `impactedTests.available === false` means the selector could
 * not run → evidence MISSING → fail-closed (UNKNOWN→REVIEW), never PASS.
 * @param {{path:string,line?:number,critical:boolean}[]} changedBehaviors
 * @param {{coveredPaths?:string[], available?:boolean}} impactedTests selector output.
 * @returns {Object[]} BLOCKING per uncovered critical behavior, OR REVIEW per behavior when evidence absent.
 */
export function testabilityFloor(changedBehaviors, impactedTests) {
  const behaviors = Array.isArray(changedBehaviors) ? changedBehaviors : [];
  const critical = behaviors.filter((b) => b && b.critical === true && typeof b.path === 'string');
  if (critical.length === 0) return [];
  // Fail-closed: no selector result for a critical change → cannot prove coverage.
  if (!impactedTests || impactedTests.available === false || !Array.isArray(impactedTests.coveredPaths)) {
    return critical.map((behavior) => reviewFinding({
      ruleId: 'F8.testability.evidence-missing', path: behavior.path, line: behavior.line,
      dimension: Dimension.TESTABILITY, debtClass: DebtClass.TEST,
      reasonCodes: ['TEST_IMPACT_EVIDENCE_MISSING'], action: RecommendedAction.ADD_TEST,
      message: 'Critical behavior changed but test-impact evidence is unavailable — REVIEW_REQUIRED, not PASS (§34.22).',
      status: FindingStatus.UNKNOWN,
    }));
  }
  const covered = new Set(impactedTests.coveredPaths);
  return critical
    .filter((behavior) => !covered.has(behavior.path))
    .map((behavior) => blockingFloorFinding({
      ruleId: 'F8.testability.critical-behavior-uncovered', path: behavior.path, line: behavior.line,
      dimension: Dimension.TESTABILITY, debtClass: DebtClass.TEST,
      which: 'operational', reasonCodes: ['CRITICAL_BEHAVIOR_NO_COVERING_TEST'],
      action: RecommendedAction.ADD_TEST,
      message: 'Critical behavior changed with no covering test (§34.14).',
      source: 'arch-debt-floors.testability',
    }));
}

/**
 * Emit a REVIEW_REQUIRED floor finding (material, sub-blocking): the detect-not-
 * block reliability sub-checks (§34.11/§34.13) and fail-closed missing-evidence.
 * Evidence stays DETERMINISTIC (the detection is a static fact) but enforcement is
 * REVIEW_REQUIRED — never auto-blocks CI, yet can never be silently passed either.
 * @param {Object} spec {ruleId,path,line?,dimension,debtClass,reasonCodes,action,message,status?}
 * @returns {Object} a REVIEW_REQUIRED Finding (status WARNING unless overridden).
 */
function reviewFinding(spec) {
  return makeFinding({
    id: `${spec.ruleId}:${spec.path}:${spec.line ?? 'file'}`,
    ruleId: spec.ruleId,
    dimension: spec.dimension,
    debtClass: spec.debtClass,
    status: spec.status ?? FindingStatus.WARNING,
    confidence: 0.8,
    evidence: { class: EvidenceClass.DETERMINISTIC, source: 'arch-debt-floors', ref: spec.ruleId },
    reasonCodes: spec.reasonCodes,
    recommendedAction: spec.action,
    enforcement: Enforcement.REVIEW_REQUIRED,
    message: spec.message,
    path: spec.path,
    line: spec.line,
  });
}

/**
 * Run all three floors over the injected change-context, fail-closed per floor.
 * Each floor is evaluated independently; a floor that THROWS does NOT take down
 * the others — it surfaces as a synthetic REVIEW_REQUIRED finding (UNKNOWN
 * status), never a silent skip-to-PASS (decisions.md Fork-2).
 *
 * @param {Object} ctx  {changedFiles?, reliability?, changedBehaviors?, impactedTests?}
 * @returns {Object[]} the union of all floor findings (BLOCKING + REVIEW_REQUIRED).
 */
export function evaluateFloors(ctx) {
  const context = ctx && typeof ctx === 'object' ? ctx : {};
  const findings = [];
  const run = (label, dimension, debtClass, fn) => {
    try {
      const out = fn();
      if (Array.isArray(out)) findings.push(...out);
    } catch (err) {
      // Fail-closed: a thrown floor → UNKNOWN → REVIEW_REQUIRED, never PASS.
      findings.push(reviewFinding({
        ruleId: `${label}.floor-error`, path: '(floor)', dimension, debtClass,
        reasonCodes: ['FLOOR_EVALUATION_ERROR'], action: RecommendedAction.OBSERVE,
        message: `Floor "${label}" failed to evaluate (${err && err.message ? err.message : err}); REVIEW_REQUIRED, not PASS.`,
        status: FindingStatus.UNKNOWN,
      }));
    }
  };
  run('F7.security', Dimension.SECURITY_PRIVACY, DebtClass.SECURITY,
    () => securityFloor(context.changedFiles));
  run('R.reliability', Dimension.RELIABILITY, DebtClass.RELIABILITY,
    () => reliabilityFloor(context.reliability));
  run('F8.testability', Dimension.TESTABILITY, DebtClass.TEST,
    () => testabilityFloor(context.changedBehaviors, context.impactedTests));
  return findings;
}

/**
 * The lexicographic short-circuit (§20.3, decisions.md Fork-2). A single BLOCKING
 * floor VIOLATION forces the whole-gate outcome to BLOCKED regardless of any score
 * elsewhere — no average washes it away. A REVIEW_REQUIRED floor (or fail-closed
 * UNKNOWN) forces REVIEW_REQUIRED. Pure verdict over the floor set.
 * @param {Object[]} findings the floor findings (from evaluateFloors, or any set).
 * @returns {{outcome:'BLOCKED'|'REVIEW_REQUIRED'|'PASS',breached:boolean,blockingRuleIds:string[],reviewRuleIds:string[]}}
 */
export function applyFloors(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const blocking = list.filter((f) =>
    f && f.enforcement === Enforcement.BLOCKING
    && f.status === FindingStatus.VIOLATION && isFloorBreach(f));
  if (blocking.length > 0) {
    return {
      outcome: 'BLOCKED', breached: true,
      blockingRuleIds: blocking.map((f) => f.ruleId),
      reviewRuleIds: [],
    };
  }
  // A floor that could not evaluate or is sub-blocking → REVIEW_REQUIRED, not PASS.
  const review = list.filter((f) =>
    f && (f.enforcement === Enforcement.REVIEW_REQUIRED
      || resolveMissingEvidence(f) === FindingStatus.UNKNOWN && f.status === FindingStatus.UNKNOWN));
  if (review.length > 0) {
    return {
      outcome: REVIEW_REQUIRED, breached: false,
      blockingRuleIds: [], reviewRuleIds: review.map((f) => f.ruleId),
    };
  }
  return { outcome: 'PASS', breached: false, blockingRuleIds: [], reviewRuleIds: [] };
}
