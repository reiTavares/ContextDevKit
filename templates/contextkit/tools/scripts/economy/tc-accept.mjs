/**
 * Task-Compiler: acceptance gate (WF0022 / ADR-0090 §C).
 *
 * Single responsibility: conjunctive, skip-aware acceptance gate that binds
 * all prior TC stages (validate → re-observe → criteria-eval → suite-green).
 * A cheap-model result is ACCEPTED iff ALL six objectives pass; a skipped
 * objective criterion is NOT accepted — skipped ≠ pass (constitution §8).
 *
 * Design invariants:
 *   - PURE: all public functions are pure (zero I/O, zero side-effects).
 *     Observed signals (suite exit-codes, affected set) are injected.
 *   - CONJUNCTIVE: one failing or skipped objective ⇒ NOT accepted.
 *   - COMPILER-INJECTED GATE: full-suite-at-gate criterion is always present
 *     in the evaluated set; injectFullSuiteGate adds it if the worker omitted it.
 *   - FAIL-FAST ON BAD SHAPES: evaluateAcceptance throws TypeError on malformed
 *     criteria arrays or unknown kind values.
 *   - FROZEN-SAFE: accepts frozen inputs (Object.freeze'd OK).
 *
 * Cohesion note: per-kind evaluators and the escalation detector live in
 * tc-accept-core.mjs to keep this file within the 308-line constitution ceiling.
 * Both concerns are purely functional and form a single cohesion unit with this
 * module (criterion-level signal decoding feeding the gate logic).
 *
 * // consumes: economy/tc-validate
 * [task-compiler] [token-economy] [WF0022]
 */
import { validateResult, reobserveClaims } from './tc-validate.mjs';
import {
  evalFileExists,
  evalExitCode,
  evalCommand,
  evalGrepAbsent,
  evalCoverage,
  detectEscalation,
} from './tc-accept-core.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for acceptance verdicts produced by this module. */
export const TC_ACCEPT_SCHEMA_VERSION = 'cdk-tc-accept/1';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Criterion kind values supported by evaluateAcceptance. */
const SUPPORTED_KINDS = new Set([
  'file_exists',
  'command',
  'exitCode',
  'grep_absent',
  'coverage',
]);

/** The injected gate criterion label (unique; checked by injectFullSuiteGate). */
const FULL_SUITE_GATE_LABEL = 'full-suite-at-gate';

// ---------------------------------------------------------------------------
// evaluateAcceptance
// ---------------------------------------------------------------------------

/**
 * Evaluates acceptance criteria conjunctively and skip-aware.
 * Skipped objective criteria make the overall verdict NOT accepted (§8).
 *
 * @param {Array<{ kind:string, label?:string, expected?:unknown, objective?:boolean }>} criteria
 * @param {object} [observed={}] - Injected observations map (keyed by label).
 * @param {object} [opts={}]     - Reserved.
 * @returns {{ accepted:boolean, criteria:Array<object>, reasons:string[] }}
 * @throws {TypeError} on non-array criteria or unsupported criterion kind.
 */
export function evaluateAcceptance(criteria, observed = {}, opts = {}) {
  void opts; // reserved

  if (!Array.isArray(criteria)) {
    throw new TypeError('evaluateAcceptance: criteria must be an array');
  }

  const evaluated = [];
  const reasons   = [];
  let accepted    = true;

  for (let i = 0; i < criteria.length; i++) {
    const criterion = criteria[i];

    if (!criterion || typeof criterion !== 'object') {
      throw new TypeError(`evaluateAcceptance: criteria[${i}] must be an object`);
    }

    const { kind, label = `criterion-${i}`, objective = true } = criterion;

    if (!SUPPORTED_KINDS.has(kind)) {
      throw new TypeError(
        `evaluateAcceptance: unsupported criterion kind "${kind}" at index ${i}. ` +
        `Supported: ${[...SUPPORTED_KINDS].join(', ')}`
      );
    }

    const result = _dispatchEvaluator(kind, criterion, observed, label);
    evaluated.push({ kind, label, status: result.status, detail: result.detail });

    // A skipped OBJECTIVE criterion is NOT accepted (constitution §8: skipped ≠ pass).
    if (objective && result.status !== 'pass') {
      accepted = false;
      reasons.push(`${label}: ${result.status} — ${result.detail}`);
    }
  }

  return { accepted, criteria: evaluated, reasons };
}

/** Dispatches to the per-kind evaluator from tc-accept-core.mjs. @private */
function _dispatchEvaluator(kind, criterion, observed, label) {
  if (kind === 'file_exists') return evalFileExists(criterion, observed, label);
  if (kind === 'exitCode')    return evalExitCode(criterion, observed, label);
  if (kind === 'command')     return evalCommand(criterion, observed, label);
  if (kind === 'grep_absent') return evalGrepAbsent(criterion, observed, label);
  if (kind === 'coverage')    return evalCoverage(criterion, observed, label);
  // Unreachable — SUPPORTED_KINDS guard already ran.
  return { status: 'skipped', detail: `unknown kind "${kind}"` };
}

// ---------------------------------------------------------------------------
// injectFullSuiteGate
// ---------------------------------------------------------------------------

/**
 * Returns criteria guaranteed to contain a `full-suite-at-gate` exitCode criterion.
 * Idempotent: if the gate is already present (by label), input is returned unchanged.
 *
 * @param {Array<object>} criteria
 * @returns {Array<object>}
 * @throws {TypeError} on non-array input.
 */
export function injectFullSuiteGate(criteria) {
  if (!Array.isArray(criteria)) {
    throw new TypeError('injectFullSuiteGate: criteria must be an array');
  }

  const alreadyPresent = criteria.some(
    (c) => c && typeof c === 'object' && c.label === FULL_SUITE_GATE_LABEL
  );

  if (alreadyPresent) return criteria;

  return [
    ...criteria,
    {
      kind:      'exitCode',
      label:     FULL_SUITE_GATE_LABEL,
      expected:  0,
      objective: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// acceptResult — the full conjunctive gate
// ---------------------------------------------------------------------------

/**
 * Runs the full conjunctive acceptance gate (ADR-0090 §C). PURE — no I/O.
 * Sequence: validate envelope → re-observe claims → inject gate → evaluate
 * criteria → affected/suite signal → escalation triggers.
 *
 * @param {object}  packet   - Work-packet context (not mutated).
 * @param {unknown} result   - Raw cheap-model result (may be prose).
 * @param {{ criteria?:Array<object>, diff?:{outOfScope?:boolean},
 *   suiteExitCode?:number|null, affectedGreen?:boolean|null,
 *   [key:string]:unknown }} observed - Injected observation signals.
 * @param {object}  [opts={}] - Reserved.
 * @returns {{ accepted:boolean, validate:object, criteria:Array<object>,
 *   escalate:boolean, reasons:string[] }}
 */
export function acceptResult(packet, result, observed = {}, opts = {}) {
  void opts;
  void packet; // context only; Phase-1 read/compile — never mutate

  const reasons = [];

  // ── Gate 1: Validate result envelope ─────────────────────────────────────
  const validation = validateResult(result);
  if (!validation.valid) {
    return {
      accepted: false,
      validate: validation,
      criteria: [],
      escalate: false,
      reasons:  [
        validation.rejectedAsProse
          ? 'result rejected as prose — expected ADR-0083 envelope'
          : `envelope invalid: ${validation.reasons.join('; ')}`,
      ],
    };
  }

  // ── Gate 2: Re-observe declared claims (advisory) ─────────────────────────
  const claimCheck = reobserveClaims(validation.envelope, { fsCheck: false });
  if (claimCheck.unverified.length > 0 && observed?.diff?.outOfScope === true) {
    reasons.push(`out-of-scope diff detected: ${claimCheck.unverified.join(', ')}`);
  }

  // ── Gate 3: Inject full-suite gate criterion ──────────────────────────────
  const rawCriteria   = Array.isArray(observed?.criteria) ? observed.criteria : [];
  const gatedCriteria = injectFullSuiteGate(rawCriteria);

  // Resolve full-suite gate observation from suiteExitCode if not already keyed.
  const criteriaObserved = { ...observed };
  if (!criteriaObserved[FULL_SUITE_GATE_LABEL] && observed?.suiteExitCode != null) {
    criteriaObserved[FULL_SUITE_GATE_LABEL] = { exitCode: observed.suiteExitCode };
  }

  // ── Gate 4: Evaluate acceptance criteria ──────────────────────────────────
  const evaluation = evaluateAcceptance(gatedCriteria, criteriaObserved);
  if (!evaluation.accepted) {
    reasons.push(...evaluation.reasons);
  }

  // ── Gate 5: Affected-set green but full-suite red ─────────────────────────
  const affectedGreen  = observed?.affectedGreen  === true;
  const suiteExitCode  = observed?.suiteExitCode  ?? null;
  const fullSuiteGreen = suiteExitCode === 0;

  if (affectedGreen && !fullSuiteGreen && suiteExitCode !== null) {
    reasons.push(
      `affected-set green but full-suite-at-gate red (exit code: ${suiteExitCode})`
    );
  }

  // ── Gate 6: Escalation triggers ───────────────────────────────────────────
  const { triggered: escalate, triggers } = detectEscalation(observed);
  if (escalate) {
    reasons.push(`escalation triggered: ${triggers.join(', ')}`);
  }

  const accepted =
    validation.valid &&
    evaluation.accepted &&
    !(affectedGreen && !fullSuiteGreen && suiteExitCode !== null) &&
    !escalate;

  return {
    accepted,
    validate:  validation,
    criteria:  evaluation.criteria,
    escalate,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// presentAcceptance
// ---------------------------------------------------------------------------

/**
 * Renders an acceptResult verdict as a human-readable string.
 *
 * @param {{ accepted:boolean, criteria:Array<object>, escalate:boolean, reasons:string[] }} verdict
 * @returns {string}
 */
export function presentAcceptance(verdict) {
  if (!verdict || typeof verdict !== 'object') {
    return `tc-accept [${TC_ACCEPT_SCHEMA_VERSION}]: invalid verdict object`;
  }

  const outcome = verdict.accepted ? 'ACCEPTED' : 'NEEDS-WORK';
  const lines   = [`tc-accept [${TC_ACCEPT_SCHEMA_VERSION}]: ${outcome}`];

  if (verdict.escalate) lines.push('  escalate: true');

  if (Array.isArray(verdict.criteria) && verdict.criteria.length > 0) {
    lines.push('  criteria:');
    for (const c of verdict.criteria) {
      const mark = c.status === 'pass' ? '✓' : (c.status === 'skipped' ? '~' : '✗');
      lines.push(`    ${mark} [${c.kind}] ${c.label}: ${c.status} — ${c.detail}`);
    }
  }

  if (Array.isArray(verdict.reasons) && verdict.reasons.length > 0) {
    lines.push('  reasons:');
    for (const reason of verdict.reasons) {
      lines.push(`    - ${reason}`);
    }
  }

  return lines.join('\n');
}
