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
