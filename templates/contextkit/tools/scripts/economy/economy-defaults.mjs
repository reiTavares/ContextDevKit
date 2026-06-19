/**
 * economy-defaults.mjs — Single source of contract defaults for Economy Runtime (WF0020).
 *
 * WHY this exists as its own module: every Economy Runtime consumer that needs
 * to know what "default output behaviour" means imports from here — not from a
 * config file, not from inline literals. A single authoritative source means
 * a future ADR-gated change to (say) `finalResponseMaxLines` propagates
 * everywhere automatically rather than hunting for scattered magic numbers.
 *
 * Config-override path: callers may supply an `economy.output` block via the
 * ContextDevKit config (`.passthrough()` schema key). resolveContract() in
 * output-contract.mjs performs the deep-merge and floor validation before
 * returning the effective contract. This file NEVER touches config — it is
 * purely the default layer.
 *
 * null = UNCAPPED: a null value in maxFindings means no cap is applied
 * for that severity tier. critical and high are ALWAYS null (the evidence-
 * preservation invariant forbids capping them). medium and low have advisory
 * caps that can be loosened further by config/override but never tightened
 * for critical/high.
 *
 * Zero runtime dependencies — node:* only (no imports needed; pure data).
 */

/**
 * Default output contract values for Economy Runtime workers.
 *
 * @type {{
 *   output: {
 *     artifactFirst: boolean,
 *     noEcho: boolean,
 *     defaultMaxTokens: number,
 *     finalResponseMaxLines: number,
 *     maxFindings: { critical: null, high: null, medium: number, low: number }
 *   }
 * }}
 */
export const ECONOMY_DEFAULTS = Object.freeze({
  output: Object.freeze({
    /** Workers write to an artifact first; the response is a summary pointer. */
    artifactFirst: true,

    /** Workers never re-paste raw tool output into their response. */
    noEcho: true,

    /**
     * Soft token ceiling a worker should target for its final response.
     * Advisory — the host model enforces via its own limits; this value is
     * communicated to the worker in its system prompt context.
     */
    defaultMaxTokens: 1200,

    /** Maximum lines allowed in a worker's final response prose section. */
    finalResponseMaxLines: 40,

    /**
     * Per-severity finding caps. null means UNCAPPED (no limit).
     * critical + high are permanently null (evidence-preservation invariant).
     * medium + low caps are advisory defaults; they may be raised via config
     * or agent override, but never lowered for critical/high (ContractFloorViolation).
     */
    maxFindings: Object.freeze({
      critical: null,
      high:     null,
      medium:   8,
      low:      5,
    }),
  }),
});

/**
 * Per-module advisory toggle keys for Economy Runtime (ADR-0103 activation
 * go-live). Each key maps to one wired module; users disable any module via
 * `contextkit/config.json` → `economy.<key>.enabled = false`.
 *
 * Single source: FLAG_DEFAULTS (economy-governance-core.mjs) and EconomySchema
 * (runtime/config/schema-sections.mjs) both build their per-module surface from
 * THIS list, so adding/removing a module is a one-line change here.
 *
 * @type {readonly string[]}
 */
export const ECONOMY_MODULE_KEYS = Object.freeze([
  'outputContract',  // ECON-01 #254 — worker output contract + envelope
  'findings',        // ECON-02 #255 — findings protocol + merge
  'agentContract',   // ECON-03 #256 — per-agent contract injection
  'compaction',      // ECON-04 #257 — compact command runner
  'contextProfiles', // ECON-05 #258 — context-pack profiles + digest parity
  'bootDelta',       // ECON-06 #259 — boot-section delta gating
  'resumePack',      // ECON-07 #260 — checkpoint / resume-pack
  'leanLoop',        // ECON-08 #261 — delegate-to-worker in controllers
  'loopBreaker',     // ECON-09 #262 — advisory loop-breaker gate signal
  'patchEconomy',    // ECON-10 #263 — advisory patch-over-rewrite signal
  'measurement',     // ECON-11 #264 — before/after savings measurement
]);
