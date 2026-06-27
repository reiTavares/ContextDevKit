/**
 * resolve-arch-debt-config.mjs — the SINGLE config authority resolver for the
 * Architecture & Technical-Debt Governance Gate (WF-0057 W5.2, ADR-0122).
 *
 * The gate engine (`architecture-debt-gate.mjs`) consumes "config slices" that
 * `arch-debt/gate-context.mjs` reads (`lineBands`, `layerRules`, `ownership`,
 * `writeAuthorities`, floor inputs…). This module is the ONE place that turns the
 * loaded `contextkit/config.json` into those slices, so there is never a second
 * config authority (decisions.md Fork-1).
 *
 * Migration contract (§31):
 *   - `architectureDebtGate.lineSignals.{yellow, elevated}` is the source of truth
 *     for the line-count trip-wire bands.
 *   - The legacy `l5.lineBudget.{yellow, red}` is recognised as a deprecated ALIAS:
 *     when it is present AND differs from the gate's own band defaults, its numbers
 *     are preserved as the ADVISORY `lineSignals` bands (yellow→yellow, red→elevated)
 *     and a one-time deprecation notice is surfaced. Line-only blocking is removed:
 *     `blocking` always resolves `false` (a hard invariant — line count never blocks).
 *   - The gate's `lineSignals` always WINS over the legacy alias when both are set,
 *     so a project that has migrated is never dragged back by a stale `l5.lineBudget`.
 *
 * Zero runtime dependencies, ESM, `node:`-free (pure data transform). The hot path
 * never imports this; it runs in the gate engine (off the boot hot path).
 */

/** The gate's own default bands (mirrors defaults-arch-debt.mjs / DEFAULT_LINE_BANDS). */
const DEFAULT_BANDS = Object.freeze({ yellow: 240, elevated: 308 });

/** A finite positive integer guard — a malformed band number is ignored, never NaN. */
function isBand(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the line-count bands + whether the legacy alias drove them.
 *
 * @param {Object} gate  the `architectureDebtGate` config slice (may be partial).
 * @param {Object} l5    the legacy `l5` config slice (may carry `lineBudget`).
 * @returns {{ bands: {yellow:number, elevated:number}, fromLegacy:boolean }}
 */
function resolveBands(gate, l5) {
  const signals = gate && typeof gate.lineSignals === 'object' ? gate.lineSignals : {};
  const legacy = l5 && typeof l5.lineBudget === 'object' ? l5.lineBudget : null;

  // The gate's own lineSignals win whenever they are explicitly set.
  const gateYellow = isBand(signals.yellow) ? signals.yellow : undefined;
  const gateElevated = isBand(signals.elevated) ? signals.elevated : undefined;
  if (gateYellow !== undefined || gateElevated !== undefined) {
    return {
      bands: {
        yellow: gateYellow ?? DEFAULT_BANDS.yellow,
        elevated: gateElevated ?? DEFAULT_BANDS.elevated,
      },
      fromLegacy: false,
    };
  }

  // No gate bands set → fall back to the legacy alias if it carries usable numbers.
  if (legacy && (isBand(legacy.yellow) || isBand(legacy.red))) {
    return {
      bands: {
        yellow: isBand(legacy.yellow) ? legacy.yellow : DEFAULT_BANDS.yellow,
        elevated: isBand(legacy.red) ? legacy.red : DEFAULT_BANDS.elevated, // red → elevated
      },
      fromLegacy: true,
    };
  }

  return { bands: { ...DEFAULT_BANDS }, fromLegacy: false };
}

/**
 * Does the loaded config still carry the deprecated `l5.lineBudget` alias?
 * @param {Object} config  the loaded, deep-merged config.
 * @returns {boolean}
 */
export function hasLegacyLineBudget(config) {
  return Boolean(config && config.l5 && config.l5.lineBudget && typeof config.l5.lineBudget === 'object');
}

/**
 * The one-time deprecation notice for the legacy alias (null when not applicable).
 * Callers surface it once per process (doctor, loader warning, gate header).
 * @param {Object} config  the loaded, deep-merged config.
 * @returns {string|null}
 */
export function lineBudgetDeprecationNotice(config) {
  if (!hasLegacyLineBudget(config)) return null;
  return 'l5.lineBudget is DEPRECATED (ADR-0122): superseded by '
    + 'architectureDebtGate.lineSignals and now ADVISORY-only (line count never '
    + 'blocks). Move your thresholds to architectureDebtGate.lineSignals.{yellow, '
    + 'elevated} and drop l5.lineBudget.';
}

/**
 * Resolve the gate engine's injected `config` slices from the loaded config — the
 * single migration + authority point. Maps `architectureDebtGate` (with the legacy
 * `l5.lineBudget` alias folded in, advisory-only) onto the keys
 * `arch-debt/gate-context.mjs` reads.
 *
 * @param {Object} [config]  the loaded `contextkit/config.json` (deep-merged).
 * @returns {{
 *   enabled:boolean, mode:string, lineBands:{yellow:number, elevated:number},
 *   lineSignalsBlocking:boolean, ruleModes:Object, baseline:Object, floors:Object,
 *   scope:Object, unknownEvidence:string, projectMap:Object|undefined,
 *   deprecationNotice:string|null, legacyMigrated:boolean,
 * }}
 */
export function resolveArchDebtConfig(config = {}) {
  const cfg = config && typeof config === 'object' ? config : {};
  const gate = cfg.architectureDebtGate && typeof cfg.architectureDebtGate === 'object'
    ? cfg.architectureDebtGate
    : {};
  const l5 = cfg.l5 && typeof cfg.l5 === 'object' ? cfg.l5 : {};

  const { bands, fromLegacy } = resolveBands(gate, l5);

  return {
    // Master switch + gear (ACTIVE by contract).
    enabled: gate.enabled !== false,
    mode: typeof gate.mode === 'string' ? gate.mode : 'active',

    // Line-count signal — ADVISORY only. `blocking` is forced false (hard invariant):
    // line count alone can never block, regardless of any config value.
    lineBands: bands,
    lineSignalsBlocking: false,

    // Pass-through authorities the gate-context + policy engine read.
    ruleModes: gate.ruleModes && typeof gate.ruleModes === 'object' ? gate.ruleModes : {},
    baseline: gate.baseline && typeof gate.baseline === 'object' ? gate.baseline : {},
    floors: gate.floors && typeof gate.floors === 'object' ? gate.floors : {},
    scope: gate.scope && typeof gate.scope === 'object' ? gate.scope : {},
    unknownEvidence: typeof gate.unknownEvidence === 'string' ? gate.unknownEvidence : 'REVIEW_REQUIRED',

    // The structural scanner honours projectMap roots/excludes when present.
    projectMap: cfg.projectMap,

    // Migration telemetry.
    deprecationNotice: lineBudgetDeprecationNotice(cfg),
    legacyMigrated: fromLegacy,
  };
}
