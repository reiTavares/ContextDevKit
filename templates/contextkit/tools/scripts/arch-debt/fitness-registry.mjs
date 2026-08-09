/**
 * Architecture-debt gate — the FITNESS-FUNCTION registry (WF-0057 W3, ADR-0122).
 *
 * A fitness function is an EXECUTABLE architectural property (evolutionary
 * architecture, §17). Each one DECLARES its identity, scope, owner, evidence
 * source, severity, enforcement mode, related decisions, failure message,
 * remediation, rollout state, and type — then carries an `evaluate(context)`
 * that runs against the injected analyzer outputs and returns `Finding[]`.
 *
 * PURE: this module owns no filesystem/clock/random. The caller injects the
 * `context` (the analyzers' outputs) into `runFitness`. FAIL-FAST (constitution
 * §8): `registerFitness` THROWS on a malformed declaration and REJECTS a BLOCKING
 * fitness function whose evidence source is non-deterministic — the same
 * invariant `makeFinding` enforces on the finding (decisions.md Fork-2). The
 * declaration CATALOGUE lives in the sibling `fitness-catalogue.mjs` (cohesive
 * data/logic split, §1).
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

import { Enforcement, EvidenceClass, DETERMINISTIC_TIER } from './finding.mjs';

/**
 * The TYPE of architectural property a fitness function checks (§17).
 * STATIC = source/graph snapshot; DYNAMIC = runtime; ATOMIC = one unit;
 * HOLISTIC = cross-cutting/system-wide; TRIGGERED = on an event; CONTINUOUS = every run.
 * @type {Readonly<Record<string,string>>}
 */
export const FitnessType = Object.freeze({
  STATIC: 'STATIC', DYNAMIC: 'DYNAMIC', ATOMIC: 'ATOMIC',
  HOLISTIC: 'HOLISTIC', TRIGGERED: 'TRIGGERED', CONTINUOUS: 'CONTINUOUS',
});

/**
 * The rollout posture of a fitness function (§17, Fork-3). ACTIVE/ADVISORY run
 * and influence the verdict (ADVISORY never blocks CI); OBSERVE_ONLY runs but its
 * findings are marked non-influencing; DISABLED is skipped entirely.
 * @type {Readonly<Record<string,string>>}
 */
export const RolloutState = Object.freeze({
  ACTIVE: 'ACTIVE', ADVISORY: 'ADVISORY', OBSERVE_ONLY: 'OBSERVE_ONLY', DISABLED: 'DISABLED',
});

/** The descriptor fields that MUST be present on every declaration (fail-fast). */
const REQUIRED_FIELDS = Object.freeze([
  'id', 'description', 'scope', 'owner', 'evidenceSource', 'severity',
  'enforcement', 'relatedDecisions', 'failureMessage', 'remediation',
  'rolloutState', 'type',
]);

/** Throw a descriptive, typed error when a closed-enum value is invalid. */
const assertIn = (label, value, allowed) => {
  if (!allowed.includes(value)) {
    throw new TypeError(`Fitness.${label}: "${value}" is not one of [${allowed.join(', ')}]`);
  }
};

/**
 * Validate a single fitness declaration into a frozen, complete descriptor.
 * Fail-fast: throws on any missing required field, an invalid enum value, a
 * non-function `evaluate`, or a BLOCKING function with a non-deterministic
 * evidence source (mirrors the finding contract invariant, Fork-2).
 *
 * @param {Object} def  the caller-supplied fitness declaration.
 * @returns {Object} the validated, frozen descriptor (with `evaluate`).
 * @throws {TypeError} on any contract violation.
 */
function validateFitness(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('registerFitness: expected a declaration object');
  }
  for (const field of REQUIRED_FIELDS) {
    const value = def[field];
    const empty = value === undefined || value === null || value === ''
      || (Array.isArray(value) && value.length === 0);
    if (empty) {
      throw new TypeError(`registerFitness: required descriptor field "${field}" is missing on "${def.id ?? '(no id)'}"`);
    }
  }
  if (typeof def.evaluate !== 'function') {
    throw new TypeError(`registerFitness: "${def.id}" must carry an evaluate(context) function`);
  }
  assertIn('enforcement', def.enforcement, Object.values(Enforcement));
  assertIn('evidenceSource', def.evidenceSource, Object.values(EvidenceClass));
  assertIn('rolloutState', def.rolloutState, Object.values(RolloutState));
  assertIn('type', def.type, Object.values(FitnessType));
  // Fork-2 invariant: BLOCKING is permitted only for a deterministic evidence tier.
  if (def.enforcement === Enforcement.BLOCKING && !DETERMINISTIC_TIER.has(def.evidenceSource)) {
    throw new TypeError(
      `registerFitness: "${def.id}" is BLOCKING but its evidenceSource "${def.evidenceSource}" is not deterministic-tier`,
    );
  }
  return Object.freeze({ ...def });
}

/**
 * Create an empty fitness registry. Pure data — the engine functions below
 * operate over it; nothing is global.
 * @returns {{functions: Object[], byId: Map<string,Object>}}
 */
export function createRegistry() {
  return { functions: [], byId: new Map() };
}

/**
 * Register a validated fitness function into the registry (fail-fast).
 *
 * @param {{functions:Object[],byId:Map}} registry  the target registry.
 * @param {Object} def  the fitness declaration.
 * @returns {Object} the frozen, registered descriptor.
 * @throws {TypeError} on a malformed declaration or a duplicate id.
 */
export function registerFitness(registry, def) {
  const descriptor = validateFitness(def);
  if (registry.byId.has(descriptor.id)) {
    throw new TypeError(`registerFitness: duplicate fitness id "${descriptor.id}"`);
  }
  registry.functions.push(descriptor);
  registry.byId.set(descriptor.id, descriptor);
  return descriptor;
}

/** True iff an OBSERVE_ONLY finding may never sway the gate verdict. */
const isInfluencing = (rolloutState) =>
  rolloutState === RolloutState.ACTIVE || rolloutState === RolloutState.ADVISORY;

/**
 * Run every ACTIVE/ADVISORY/OBSERVE_ONLY fitness function against the injected
 * `context` (the analyzers' outputs), collecting their Findings. DISABLED ones are
 * skipped. OBSERVE_ONLY ones RUN but every finding they emit is stamped
 * `influencing: false` so the downstream policy engine can never let an
 * observation block or clear a verdict (decisions.md Fork-3 / §16).
 *
 * A fitness function whose `evaluate` THROWS is recorded as an error result
 * (fail-closed: never silently skipped to a PASS), and its error never takes down
 * its siblings.
 *
 * @param {{functions:Object[]}} registry  the registry to run.
 * @param {Object} context  the injected analyzer outputs (one object, read-only).
 * @returns {{results:Object[], findings:Object[], skipped:string[], errored:string[]}}
 */
export function runFitness(registry, context) {
  const ctx = context && typeof context === 'object' ? context : {};
  const results = [];
  const findings = [];
  const skipped = [];
  const errored = [];
  for (const fn of registry.functions) {
    if (fn.rolloutState === RolloutState.DISABLED) {
      skipped.push(fn.id);
      results.push({ id: fn.id, rolloutState: fn.rolloutState, skipped: true, findings: [] });
      continue;
    }
    const influencing = isInfluencing(fn.rolloutState);
    let raw;
    try {
      raw = fn.evaluate(ctx);
    } catch (err) {
      errored.push(fn.id);
      results.push({
        id: fn.id, rolloutState: fn.rolloutState, errored: true,
        error: err && err.message ? err.message : String(err), findings: [],
      });
      continue;
    }
    const emitted = (Array.isArray(raw) ? raw : [])
      .map((finding) => ({ ...finding, fitnessId: fn.id, influencing }));
    findings.push(...emitted);
    results.push({ id: fn.id, rolloutState: fn.rolloutState, influencing, findings: emitted });
  }
  return { results, findings, skipped, errored };
}

/** The findings that are ALLOWED to sway the verdict (OBSERVE_ONLY excluded). */
export const influencingFindings = (run) =>
  (run && Array.isArray(run.findings) ? run.findings : []).filter((f) => f.influencing === true);

/**
 * Build the pre-registered registry seeded with the W2 floor catalogue (§17).
 * Lazily imports the catalogue to avoid a static import cycle (the catalogue
 * imports `FitnessType`/`RolloutState` from this module).
 * @returns {Promise<{functions:Object[],byId:Map}>}
 */
export async function buildDefaultRegistry() {
  const { INITIAL_FITNESS_CATALOGUE } = await import('./fitness-catalogue.mjs');
  const registry = createRegistry();
  for (const def of INITIAL_FITNESS_CATALOGUE) registerFitness(registry, def);
  return registry;
}
