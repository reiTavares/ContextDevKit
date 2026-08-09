/**
 * output-contract.mjs — Resolver, CI check, and re-exports for Economy Runtime
 * output contracts (WF0020, ADR-0082).
 *
 * Public surface:
 *   WORKER_ENVELOPE_VERSION  — current envelope schema version (integer)
 *   resolveContract(cfg, agentOverride) — deep-merge defaults ← cfg ← override,
 *     enforcing the override floor (critical/high must stay uncapped).
 *   emptyEnvelope(status)    — valid skeleton WorkerOutputEnvelope
 *   validateEnvelope(obj)    — structural shape validator  (re-exported from core)
 *   applyFindingCaps(f, c)   — evidence-preservation invariant (re-exported)
 *   econCheckContract(root)  — CI check suite, returns {name,pass,detail}[]
 *
 * Design constraints:
 *   - Advisory + fail-open: resolveContract returns defaults on missing/bad input
 *     rather than throwing (except ContractFloorViolation, which IS intentional).
 *   - Zero runtime dependencies — node:* only.
 *   - UNREGISTERED: no hook or boot wiring in Phase 1.
 *
 * Cohesion note: validateEnvelope + applyFindingCaps live in output-contract-core.mjs
 * to keep this file within the 308-line constitution ceiling (§1 +10% tolerance).
 */

import { ECONOMY_DEFAULTS }                          from './economy-defaults.mjs';
import { validateEnvelope, applyFindingCaps }        from './output-contract-core.mjs';

export { validateEnvelope, applyFindingCaps };

// ---------------------------------------------------------------------------
// Version constant
// ---------------------------------------------------------------------------

/** Current WorkerOutputEnvelope schema version. Increment on breaking changes. */
export const WORKER_ENVELOPE_VERSION = 1;

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown when an agent override attempts to cap critical or high findings
 * (setting them to a finite number), violating the evidence-preservation invariant.
 * Critical and high findings must ALWAYS be uncapped (null).
 */
export class ContractFloorViolation extends Error {
  /**
   * @param {string} severity - The severity that was illegally capped
   * @param {unknown} attemptedValue - The value that triggered the violation
   */
  constructor(severity, attemptedValue) {
    super(
      `ContractFloorViolation: agent override may not cap '${severity}' findings ` +
      `(value: ${JSON.stringify(attemptedValue)}). Critical and high are always uncapped.`
    );
    this.name = 'ContractFloorViolation';
    this.severity = severity;
    this.attemptedValue = attemptedValue;
  }
}

// ---------------------------------------------------------------------------
// resolveContract
// ---------------------------------------------------------------------------

/**
 * Deep-merges output contract layers: ECONOMY_DEFAULTS.output ← cfg?.economy?.output
 * ← agentOverride, then validates the override floor before returning.
 *
 * Override floor (non-negotiable): an agent override may only LOOSEN caps —
 * raise a number, or set to null (uncapped). Tightening critical or high from
 * null to any finite number throws ContractFloorViolation. For medium/low,
 * tighter-than-effective values are silently ignored (loosen-only).
 *
 * Fail-open: missing or non-object config/override layers are treated as empty.
 *
 * @param {object|null|undefined} cfg - Full ContextDevKit config object
 * @param {Partial<typeof ECONOMY_DEFAULTS.output>|null|undefined} agentOverride
 * @returns {typeof ECONOMY_DEFAULTS.output} Resolved effective contract
 * @throws {ContractFloorViolation} If override tries to cap critical or high
 */
export function resolveContract(cfg, agentOverride) {
  const defaults    = ECONOMY_DEFAULTS.output;
  const safeObj     = (x) => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
  const cfgLayer    = safeObj(cfg?.economy?.output);
  const overrideLayer = safeObj(agentOverride);

  return {
    artifactFirst:         _pick(overrideLayer, cfgLayer, defaults, 'artifactFirst'),
    noEcho:                _pick(overrideLayer, cfgLayer, defaults, 'noEcho'),
    defaultMaxTokens:      _pickNumber(overrideLayer, cfgLayer, defaults, 'defaultMaxTokens'),
    finalResponseMaxLines: _pickNumber(overrideLayer, cfgLayer, defaults, 'finalResponseMaxLines'),
    maxFindings:           _mergeMaxFindings(overrideLayer.maxFindings, cfgLayer.maxFindings, defaults.maxFindings),
  };
}

/** Picks a scalar value: override > cfgLayer > defaults. @private */
function _pick(override, cfgLayer, defaults, key) {
  if (override[key] !== undefined) return override[key];
  if (cfgLayer[key] !== undefined) return cfgLayer[key];
  return defaults[key];
}

/** Picks a numeric value, ignoring non-numeric layers (fail-open). @private */
function _pickNumber(override, cfgLayer, defaults, key) {
  const ov = override[key];
  if (typeof ov === 'number' && isFinite(ov)) return ov;
  const cv = cfgLayer[key];
  if (typeof cv === 'number' && isFinite(cv)) return cv;
  return defaults[key];
}

/**
 * Merges maxFindings layers with the evidence-preservation invariant:
 * critical/high must stay null; medium/low are loosen-only (null or >= floor).
 * @private
 * @throws {ContractFloorViolation}
 */
function _mergeMaxFindings(overrideMF, cfgMF, defaultMF) {
  const safeObj = (x) => (x && typeof x === 'object') ? x : {};
  const cfg = safeObj(cfgMF);
  const ov  = safeObj(overrideMF);
  const result = {};

  for (const sev of ['critical', 'high', 'medium', 'low']) {
    if (sev === 'critical' || sev === 'high') {
      // Floor: override MUST NOT supply a finite number for these tiers.
      if (ov[sev] !== undefined && ov[sev] !== null) {
        throw new ContractFloorViolation(sev, ov[sev]);
      }
      result[sev] = null; // always uncapped
      continue;
    }

    // Advisory tiers: loosen-only. Effective floor starts at default.
    const defaultVal = defaultMF[sev]; // number

    let effective = defaultVal;

    // Config layer may loosen (null = uncapped, or number >= default).
    const cfgVal = cfg[sev];
    if (cfgVal === null) {
      effective = null;
    } else if (typeof cfgVal === 'number' && isFinite(cfgVal) && cfgVal >= defaultVal) {
      effective = cfgVal;
    }

    // Override layer may further loosen, but not tighten vs effective.
    const ovVal = ov[sev];
    if (ovVal === null) {
      effective = null;
    } else if (typeof ovVal === 'number' && isFinite(ovVal) && effective !== null && ovVal >= effective) {
      effective = ovVal;
    }
    // Tighter values silently ignored (loosen-only guarantee).

    result[sev] = effective;
  }

  return result;
}

// ---------------------------------------------------------------------------
// emptyEnvelope
// ---------------------------------------------------------------------------

/**
 * Returns a valid, empty WorkerOutputEnvelope skeleton.
 *
 * @param {'ok'|'blocked'|'failed'|'skipped'} [status='ok']
 * @returns {{ version:number, status:string, changed:[], verification:{command:string,exitCode:number}, blockers:[], findings:[], artifact:string }}
 */
export function emptyEnvelope(status = 'ok') {
  return {
    version:      WORKER_ENVELOPE_VERSION,
    status,
    changed:      [],
    verification: { command: '', exitCode: 0 },
    blockers:     [],
    findings:     [],
    artifact:     '',
  };
}

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Self-check suite for the output contract module.
 * Pure and fail-open: every assertion is caught individually; a thrown error
 * becomes a failed check, not an unhandled rejection.
 * Called by the wave selfcheck runner with the repo root path.
 *
 * @param {string} _root - Repo root path (unused; present for runner signature parity)
 * @returns {{ name: string, pass: boolean, detail: string }[]}
 */
export function econCheckContract(_root) {
  const checkResults = [];

  /** @param {string} name @param {()=>void} fn */
  function check(name, fn) {
    try {
      fn();
      checkResults.push({ name, pass: true, detail: 'ok' });
    } catch (err) {
      checkResults.push({ name, pass: false, detail: err?.message ?? String(err) });
    }
  }

  /** @param {boolean} condition @param {string} msg */
  function assert(condition, msg) {
    if (!condition) throw new Error(msg);
  }

  // Check 1: override-floor rejects capping critical (throws ContractFloorViolation).
  check('override-floor rejects critical cap', () => {
    let threw = false;
    let correctType = false;
    try {
      resolveContract(null, { maxFindings: { critical: 1 } });
    } catch (err) {
      threw = true;
      correctType = err instanceof ContractFloorViolation;
    }
    assert(threw, 'expected ContractFloorViolation to be thrown for critical');
    assert(correctType, 'error must be ContractFloorViolation instance');
  });

  // Check 2: override-floor rejects capping high.
  check('override-floor rejects high cap', () => {
    let threw = false;
    let correctType = false;
    try {
      resolveContract(null, { maxFindings: { high: 3 } });
    } catch (err) {
      threw = true;
      correctType = err instanceof ContractFloorViolation;
    }
    assert(threw, 'expected ContractFloorViolation for high');
    assert(correctType, 'error must be ContractFloorViolation instance');
  });

  // Check 3: 10-finding evidence-preservation scenario.
  // 3 high (open) + 1 skipped low + 6 open low; cap low=2 → kept=6 deferred=4.
  check('applyFindingCaps 10-finding evidence-preservation scenario', () => {
    const findings = [
      { severity: 'high', status: 'open'    },
      { severity: 'high', status: 'open'    },
      { severity: 'high', status: 'open'    },
      { severity: 'low',  status: 'skipped' }, // always survives
      { severity: 'low',  status: 'open'    },
      { severity: 'low',  status: 'open'    },
      { severity: 'low',  status: 'open'    },
      { severity: 'low',  status: 'open'    },
      { severity: 'low',  status: 'open'    },
      { severity: 'low',  status: 'open'    },
    ];
    const contract = { maxFindings: { critical: null, high: null, medium: 8, low: 2 } };
    const result = applyFindingCaps(findings, contract);

    assert(result.counts.total === 10,
      `total must be 10, got ${result.counts.total}`);
    assert(result.counts.keptCount + result.counts.deferredCount === 10,
      `kept+deferred must equal 10 (got ${result.counts.keptCount}+${result.counts.deferredCount})`);

    const keptHighs    = result.kept.filter(f => f.severity === 'high');
    const keptSkipped  = result.kept.filter(f => f.status === 'skipped');
    const keptOpenLow  = result.kept.filter(f => f.severity === 'low' && f.status === 'open');

    assert(keptHighs.length   === 3, `expected 3 highs kept, got ${keptHighs.length}`);
    assert(keptSkipped.length === 1, `expected 1 skipped kept, got ${keptSkipped.length}`);
    assert(keptOpenLow.length === 2, `expected 2 open lows kept, got ${keptOpenLow.length}`);
    assert(result.deferred.length === 4, `expected 4 deferred, got ${result.deferred.length}`);
  });

  // Check 4: emptyEnvelope is valid per validateEnvelope.
  check('emptyEnvelope passes validateEnvelope', () => {
    const env = emptyEnvelope('ok');
    const { valid, errors } = validateEnvelope(env);
    assert(valid, `emptyEnvelope failed validation: ${errors.join('; ')}`);
  });

  // Check 5: resolveContract with no args returns sensible defaults.
  check('resolveContract no-args returns defaults', () => {
    const contract = resolveContract(null, null);
    assert(contract.maxFindings.critical === null, 'critical must be null');
    assert(contract.maxFindings.high     === null, 'high must be null');
    assert(typeof contract.maxFindings.medium === 'number', 'medium must be number');
    assert(contract.artifactFirst === true,  'artifactFirst must be true');
    assert(contract.noEcho        === true,  'noEcho must be true');
  });

  return checkResults;
}
