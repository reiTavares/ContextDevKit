/**
 * Architecture-debt gate — DebtClassifier + DebtRiskEvaluator (WF-0057,
 * ADR-0122, Wave W2). PURE functions over the §4 taxonomy and §5 cost/risk
 * model. No FS, no git, no clock: every external fact (blastRadius from
 * project-map-signals, floor verdicts from a fitness function, principal from a
 * collector) is INJECTED via the `context` argument so this module stays
 * testable and deterministic (constitution §H3 — side effects injected).
 *
 * Two responsibilities, two functions:
 *   - `classify`     — validate/assign the (dimension, debtClass) pair (§4).
 *   - `evaluateRisk` — assemble the bounded Risk object + principal + interest[]
 *                      (§5). Risk is LEXICOGRAPHIC, never an arithmetic average:
 *                      a floor breach forces the max disposition regardless of
 *                      any low factor (§20.3, §9.6).
 *
 * The frozen mapping table lives in the sibling `debt-taxonomy.mjs` (cohesive
 * seam, §1). Zero runtime deps, ESM, `node:`/relative imports only (rule #1).
 * Fail-fast: invalid pairs/enums THROW (constitution §8 — validators throw).
 */

import {
  Dimension, DebtClass, Principal, Interest, DEFAULT_RISK, isFloorBreach,
} from './finding.mjs';
// `RiskBand` is not re-exported by finding.mjs (only the closed enums the
// validator needs are). It lives in the enum module — import it from there.
import { RiskBand } from './finding-enums.mjs';
import {
  DIMENSION_DEBTCLASS, isAllowedPair,
  SECURITY_FLOOR_CLASSES, DATA_INTEGRITY_FLOOR_CLASSES, OPERATIONAL_FLOOR_CLASSES,
} from './debt-taxonomy.mjs';

export { DIMENSION_DEBTCLASS };

const DIMENSIONS = Object.values(Dimension);
const DEBT_CLASSES = Object.values(DebtClass);
const PRINCIPALS = Object.values(Principal);
const INTERESTS = Object.values(Interest);
const RISK_BANDS = Object.values(RiskBand);

/** Throw a descriptive, typed error when a value is outside a closed enum (§8). */
function assertIn(label, value, allowed) {
  if (!allowed.includes(value)) {
    throw new TypeError(`classify.${label}: "${value}" is not one of [${allowed.join(', ')}]`);
  }
}

/**
 * Validate + assign the `(dimension, debtClass)` pair of a finding/signal
 * against the §4 allowed mapping. Pure; returns a new `{dimension, debtClass}`
 * — does NOT mutate the input. Rejects any pair outside the mapping fail-fast
 * (§4 note: a detector emitting an out-of-table pair is a wiring bug).
 *
 * @param {{dimension:string, debtClass:string}} signal  a finding or raw signal.
 * @returns {{dimension:string, debtClass:string}} the validated pair.
 * @throws {TypeError} when either value is not in its enum, or the pair is
 *   outside the §4 allowed mapping.
 */
export function classify(signal) {
  if (!signal || typeof signal !== 'object') {
    throw new TypeError('classify: expected an object with dimension + debtClass');
  }
  const { dimension, debtClass } = signal;
  assertIn('dimension', dimension, DIMENSIONS);
  assertIn('debtClass', debtClass, DEBT_CLASSES);
  if (!isAllowedPair(dimension, debtClass)) {
    const allowed = [...(DIMENSION_DEBTCLASS[dimension] || [])].join(', ');
    throw new TypeError(
      `classify: (${dimension}, ${debtClass}) is not an allowed pair — ${dimension} may surface [${allowed}] (W0-contracts §4)`,
    );
  }
  return { dimension, debtClass };
}

/** Coerce a caller-supplied band to a valid RiskBand, defaulting to UNKNOWN. */
function band(value) {
  return RISK_BANDS.includes(value) ? value : RiskBand.UNKNOWN;
}

/**
 * Decide whether a given floor is tripped: explicit context signal OR (the
 * debtClass nature can carry the floor AND the context flags a confirmed
 * breach for it). Deterministic, no averaging.
 */
function floorTripped(explicit, debtClass, floorClasses, breachFlag) {
  if (explicit === true) return true;
  return Boolean(breachFlag && floorClasses.has(debtClass));
}

/**
 * Assemble the bounded `Risk` object for a finding (§5.3). The result is an
 * OBJECT of independent bands — NOT a single averaged number. Each band comes
 * from injected `context` (e.g. `blastRadius` from project-map-signals) and
 * defaults to UNKNOWN, never to 0 (§5.3 — UNKNOWN factors stay UNKNOWN).
 *
 * LEXICOGRAPHIC floor short-circuit (§20.3, §9.6): if any of the three floors
 * is tripped, the floor-relevant bands are forced to HIGH and the floor flags
 * set — a low score on any other factor can NEVER wash it away. The raised
 * bands encode the max disposition; `isFloorBreach()` (from the contract) then
 * reads true, which the policy engine turns into BLOCKED before any scoring.
 *
 * @param {{dimension:string, debtClass:string}} finding  classified finding.
 * @param {Object} [context]  injected facts:
 *   {probability,impact,blastRadius,detectability,reversibility,compounding,
 *    timeToManifest} RiskBand values; {securityBreach,dataIntegrityBreach,
 *    operationalBreach} booleans; {securityFloor,dataIntegrityFloor,
 *    operationalFloor} explicit floor overrides.
 * @returns {Object} a complete Risk object (the §5.3 shape).
 */
export function evaluateRisk(finding, context = {}) {
  if (!finding || typeof finding !== 'object') {
    throw new TypeError('evaluateRisk: expected a classified finding object');
  }
  const debtClass = finding.debtClass;
  assertIn('debtClass', debtClass, DEBT_CLASSES);

  const securityFloor = floorTripped(
    context.securityFloor, debtClass, SECURITY_FLOOR_CLASSES, context.securityBreach);
  const dataIntegrityFloor = floorTripped(
    context.dataIntegrityFloor, debtClass, DATA_INTEGRITY_FLOOR_CLASSES, context.dataIntegrityBreach);
  const operationalFloor = floorTripped(
    context.operationalFloor, debtClass, OPERATIONAL_FLOOR_CLASSES, context.operationalBreach);

  const breached = securityFloor || dataIntegrityFloor || operationalFloor;

  // Lexicographic max: a tripped floor forces the harm-bearing bands to HIGH so
  // no other low factor can average it down (§20.3). Other bands still report
  // honestly from context — the floor flags are what the policy engine acts on.
  const risk = {
    probability: breached ? RiskBand.HIGH : band(context.probability),
    impact: breached ? RiskBand.HIGH : band(context.impact),
    blastRadius: breached ? RiskBand.HIGH : band(context.blastRadius),
    detectability: band(context.detectability),
    reversibility: band(context.reversibility),
    compounding: band(context.compounding),
    timeToManifest: breached ? RiskBand.HIGH : band(context.timeToManifest),
    securityFloor,
    dataIntegrityFloor,
    operationalFloor,
  };
  return risk;
}

/** Validate a caller-supplied principal, defaulting to UNKNOWN (§5.1). */
function resolvePrincipal(value) {
  return PRINCIPALS.includes(value) ? value : Principal.UNKNOWN;
}

/** Filter a caller-supplied interest list to valid bounded categories (§5.2). */
function resolveInterest(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  for (const candidate of values) {
    if (INTERESTS.includes(candidate)) seen.add(candidate);
  }
  return [...seen];
}

/**
 * Full cost+risk evaluation for a classified finding (§5). Composes the bounded
 * `risk` object with the bounded `principal` enum and the `interest[]`
 * categories — the three are independent (NOT collapsed to one number, §20).
 * `disposition: 'MAX'` is set iff a floor is breached, so callers can see the
 * lexicographic short-circuit without re-deriving it.
 *
 * @param {{dimension:string, debtClass:string}} finding  classified finding.
 * @param {Object} [context]  injected facts (see `evaluateRisk`) plus
 *   `{principal, interest}` cost inputs.
 * @returns {{risk:Object, principal:string, interest:string[], disposition:'MAX'|'SCORED'}}
 */
export function evaluateDebt(finding, context = {}) {
  const risk = evaluateRisk(finding, context);
  return {
    risk,
    principal: resolvePrincipal(context.principal),
    interest: resolveInterest(context.interest),
    disposition: isFloorBreach(risk) ? 'MAX' : 'SCORED',
  };
}

export { DEFAULT_RISK };
