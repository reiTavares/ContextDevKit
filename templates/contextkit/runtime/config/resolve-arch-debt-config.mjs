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

/** Enforcement postures for the twelve dimensions (OP-0012). Advisory is the v4 default. */
const ENFORCEMENT_POSTURES = Object.freeze(['advisory', 'guarded', 'strict']);

/** Runtime modes retained by the architecture-debt engine during v4 migration. */
const GATE_MODES = Object.freeze(['active', 'shadow', 'canary']);

/** A finite positive integer guard — a malformed band number is ignored, never NaN. */
function isBand(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Normalise the optional conformance baseline (the pre-existing graph evidence to
 * grandfather, §25) into the shape `evaluateConformance` reads. Defaults to an
 * EMPTY graph baseline: the current tree is itself the conformant baseline, so any
 * NEW cycle/boundary/state-authority violation blocks while nothing pre-existing
 * is silently introduced. A present (non-null object) baseline is what flips
 * F1/F2/F3 from a fail-closed UNKNOWN into a real evaluation — so the resolver
 * supplies it ONLY when the floors are configured (null otherwise keeps F1/F2/F3
 * SKIPPED via `degradeUnconfigured`, never a blocking UNKNOWN on an install that
 * has not opted in).
 *
 * @param {Object} [provided]  optional `architectureDebtGate.conformanceBaseline`.
 * @returns {{cycles:Array, forbiddenEdges:Array, stateAuthorities:Array}}
 */
function normaliseBaseline(provided) {
  const base = provided && typeof provided === 'object' ? provided : {};
  return {
    cycles: Array.isArray(base.cycles) ? base.cycles : [],
    forbiddenEdges: Array.isArray(base.forbiddenEdges) ? base.forbiddenEdges : [],
    stateAuthorities: Array.isArray(base.stateAuthorities) ? base.stateAuthorities : [],
  };
}

/**
 * Map the `floors.{security,reliability,testability}` config keys onto the
 * DIMENSION-keyed authority map `enforcement-posture.mjs` consumes.
 *
 * Keyed by dimension (not ruleId) because floor rule ids are GENERATED per hit
 * (`F7.security-regression.<code>`), so a ruleId-keyed override could never
 * target them. The dimension names are inlined as string literals on purpose:
 * `Dimension` lives under `tools/scripts/arch-debt/`, and this module sits in
 * `runtime/config/` — importing upward would invert the dependency direction
 * (rubric S1) and create a cycle, since the gate imports this resolver.
 *
 * An unrecognised authority value is DROPPED (not passed through), so a typo
 * leaves the declared authority in force rather than silently disarming a floor.
 *
 * @param {Object} [floors]  the `architectureDebtGate.floors` slice.
 * @returns {Object<string,string>} dimension → Enforcement override.
 */
function floorAuthoritiesFrom(floors) {
  const source = floors && typeof floors === 'object' ? floors : {};
  const VALID = ['BLOCKING', 'REVIEW_REQUIRED', 'ADVISORY', 'OBSERVE_ONLY', 'DISABLED'];
  const BY_DIMENSION = {
    security: 'SECURITY_PRIVACY',
    reliability: 'RELIABILITY',
    testability: 'TESTABILITY',
    architecture: 'ARCHITECTURE_CONFORMANCE',
    dataContracts: 'DATA_CONTRACTS',
    modularity: 'MODULARITY',
    complexity: 'COMPLEXITY',
    observability: 'OBSERVABILITY',
    performance: 'PERFORMANCE',
    operations: 'OPERATIONS_DELIVERY',
    dependencies: 'DEPENDENCIES',
    cognitiveCoherence: 'COGNITIVE_COHERENCE',
  };
  const authorities = {};
  for (const [key, dimension] of Object.entries(BY_DIMENSION)) {
    const value = source[key];
    if (typeof value === 'string' && VALID.includes(value)) authorities[dimension] = value;
  }
  return authorities;
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
 *   layerRules:Object|undefined, ownership:Object|undefined,
 *   writeAuthorities:Array|undefined, conformanceBaseline:Object|null,
 *   conformanceConfigured:boolean, deprecationNotice:string|null, legacyMigrated:boolean,
 * }}
 */
export function resolveArchDebtConfig(config = {}) {
  const cfg = config && typeof config === 'object' ? config : {};
  const gate = cfg.architectureDebtGate && typeof cfg.architectureDebtGate === 'object'
    ? cfg.architectureDebtGate
    : {};
  const l5 = cfg.l5 && typeof cfg.l5 === 'object' ? cfg.l5 : {};

  const { bands, fromLegacy } = resolveBands(gate, l5);

  // Architecture-conformance authorities (F1/F2/F3, §9.1). Project-specific: a
  // project declares its `layerRules` (layers + forbidden import directions, F2),
  // the canonical `ownership` map (state-key → owner module, F3), and the declared
  // `writeAuthorities` (F3). When ANY is wired the conformance floors EVALUATE; a
  // matching non-null `conformanceBaseline` is then supplied so they run the rules
  // instead of failing closed to UNKNOWN. When NONE is wired they stay SKIPPED.
  const layerRules = gate.layerRules && typeof gate.layerRules === 'object' ? gate.layerRules : undefined;
  const ownership = gate.ownership && typeof gate.ownership === 'object' ? gate.ownership : undefined;
  const writeAuthorities = Array.isArray(gate.writeAuthorities) ? gate.writeAuthorities : undefined;
  const conformanceConfigured = Boolean(layerRules || ownership || writeAuthorities);

  // Enforcement POSTURE for the twelve dimensions (OP-0012). Architecture debt
  // is advisory by default in v4; only an explicit project override may raise it.
  const enforcement = ENFORCEMENT_POSTURES.includes(gate.enforcement)
    ? gate.enforcement
    : 'advisory';

  return {
    // Master switch + gear. Missing or malformed modes degrade to canary.
    enabled: gate.enabled !== false,
    mode: GATE_MODES.includes(gate.mode) ? gate.mode : 'canary',
    enforcement,

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

    // Per-DIMENSION authority overrides (OP-0012). `floors.{security,reliability,
    // testability}` used to be decorative — nothing read it. It is now the
    // dimension-keyed authority map `enforcement-posture.mjs` applies, so setting
    // `floors.security: "ADVISORY"` genuinely demotes that dimension.
    floorAuthorities: floorAuthoritiesFrom(gate.floors),

    // DECLARED change evidence (§9.4/§9.5). These are facts only the project can
    // state — which migrations are irreversible, which behaviors are critical. The
    // resolver passes them through verbatim and NEVER infers them from a diff:
    // guessing would turn the reliability/testability floors into false-positive
    // generators. Absent ⇒ the floor emits nothing (silence, never a pass claim).
    reliability: gate.reliability && typeof gate.reliability === 'object' ? gate.reliability : undefined,
    changedBehaviors: Array.isArray(gate.changedBehaviors) ? gate.changedBehaviors : undefined,
    // The test-impact selector result (§17 — the gate CONSUMES it, never recomputes
    // it). Must be passthrough-able: `testabilityFloor` fails CLOSED to UNKNOWN when
    // a critical behavior is declared but no selector evidence exists, so a project
    // that declares `changedBehaviors` without ever being able to supply
    // `impactedTests` would sit at a permanent non-passing UNKNOWN.
    impactedTests: gate.impactedTests && typeof gate.impactedTests === 'object' ? gate.impactedTests : undefined,
    domainConformance: gate.domainConformance && typeof gate.domainConformance === 'object'
      ? gate.domainConformance
      : undefined,

    // The structural scanner honours projectMap roots/excludes when present.
    projectMap: cfg.projectMap,

    // Conformance authorities (F1/F2/F3). `conformanceBaseline` is null when the
    // floors are unconfigured (→ SKIPPED), an empty-by-default graph baseline when
    // they are (→ EVALUATE; current tree is the conformant baseline, regression blocks).
    layerRules,
    ownership,
    writeAuthorities,
    conformanceConfigured,
    conformanceBaseline: conformanceConfigured ? normaliseBaseline(gate.conformanceBaseline) : null,

    // Migration telemetry.
    deprecationNotice: lineBudgetDeprecationNotice(cfg),
    legacyMigrated: fromLegacy,
  };
}
