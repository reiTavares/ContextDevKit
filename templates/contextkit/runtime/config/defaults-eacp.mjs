/**
 * EACP (Economic & Autonomy Control Plane) default configuration.
 *
 * Extracted from defaults.mjs into this sibling file to keep defaults.mjs within
 * the 308-line budget (constitution §1 +10% tolerance), following the same
 * split-file pattern used by defaults-routing.mjs (ADR-0094).
 *
 * ADR-0077 scope: EACP extends existing counters / resolver — never a parallel
 * system. All flags here are ADDITIVE and OPTIONAL; none are REQUIRED schema
 * fields. Disabling the master switch (`enabled: false`) restores legacy
 * token-report behavior with no data loss (events are append-only, reversible).
 *
 * Advisory-first by design: no flag here activates enforcement, strict mode, or
 * hook wiring. Those are separate human-gated actions (§15 Gate C, ADR-0077).
 *
 * Rollout phases (rollout-plan.md):
 *   Phase 0 — baseline / measurement only (silent)
 *   Phase 1 — advisory surfaces (token-report v2, pressure, map effectiveness)
 *   Phase 2 — guarded (budget warn/ask through autonomy resolver) [opt-in]
 *   Phase 3 — controlled optimization (model routing actions) [opt-in]
 *   Phase 4 — proven autonomy (post-benchmark) [opt-in]
 *   Phase 5 — fleet / enterprise [opt-in]
 *
 * Zero runtime dependencies — relative import only; safe on the hot path.
 */

/** @type {Readonly<object>} */
export const EACP_DEFAULTS = Object.freeze({
  /**
   * Master switch. `false` → token-report reverts to legacy mode (pre-EACP).
   * No EACP module is loaded or evaluated when disabled. Default: true (Phase 0
   * measurement runs silently; no advisory or enforcement surfaces are shown).
   */
  enabled: true,

  /**
   * Current dogfood rollout phase (0–5). Advisory signal only — read by
   * `/token-report` and the boot banner to decide which surfaces are shown.
   * The kit does NOT auto-advance phases; the developer explicitly sets this
   * in `contextkit/config.json` after confirming phase-gate criteria.
   * See rollout-plan.md for gate criteria per phase.
   */
  rolloutPhase: 0,

  /**
   * Usage measurement & cost engine (ADR-0078 / ADR-0079 / cards #230–#234).
   * Phase 0: always on when `enabled`. Measures only; no advisory output.
   *   - `costEngine.enabled`: compute USD estimates (estimated, not billed).
   *   - `costEngine.grossCacheValueSeparate`: show provider cache value as its
   *     own line, never merged with kit-incremental savings (ADR-0079 §claims).
   */
  measurement: {
    enabled: true,
    costEngine: {
      enabled: true,
      grossCacheValueSeparate: true,
    },
  },

  /**
   * Advisory surfaces (Token Report v2, session pressure, map effectiveness,
   * quota snapshots, autonomy multiplier — cards #235–#237, #240–#241).
   * Phase 1: shown when `enabled` AND `rolloutPhase >= 1`.
   * All advisory: findings are displayed; nothing is blocked or enforced.
   *   - `sessionPressure.enabled`: surface session-pressure score + bands (#236).
   *   - `mapEffectiveness.enabled`: surface repeated-read / map-coverage facts (#237).
   *   - `quotaSnapshots.enabled`: surface quota usage from the append-only store (#240).
   *   - `autonomyMultiplier.enabled`: surface multiplier estimate (null until #243 data) (#241).
   */
  advisory: {
    enabled: true,
    sessionPressure: { enabled: true },
    mapEffectiveness: { enabled: true },
    quotaSnapshots: { enabled: true },
    autonomyMultiplier: { enabled: true },
  },

  /**
   * Budget guards and cost enforcement (card #238).
   * Phase 2: opt-in. Default false — no budget warn/ask before dogfood validates.
   * When enabled, the budget engine advises through the EXISTING autonomy resolver
   * (ADR-0077 §no-parallel-gate). Never blocks edit-class activity.
   *   - `mode`: observe | warn | ask | downgrade | split | block.
   *     Default `observe` (measure only, no user-visible warning).
   *   - observe/warn remain advisory; ask/downgrade map to `suggest` semantics.
   *   - block is only permitted for new fan-out / swarm dispatch.
   */
  budgetGuards: {
    enabled: false,
    mode: 'observe',
  },

  /**
   * Model-routing economics and Fable audit (card #239).
   * Phase 3: opt-in. Routing posture lives in `routing.*` (ADR-0094).
   * This flag gates the ECONOMIC SURFACE of routing (savings calculation,
   * Fable audit, applied-vs-recommended reconciliation).
   * `routingEconomics.enabled: false` suppresses the economics section only;
   * the routing decisions themselves remain governed by `routing.*`.
   */
  routingEconomics: {
    enabled: false,
  },

  /**
   * Benchmark and powered evidence (cards #242–#243).
   * Phase 4: opt-in, post benchmark authorization.
   * `benchmarkPilot.enabled: false` — harness ships, no real runs without human
   * authorization (§15 Gate A). `autonomyMultiplier.claim` stays null until
   * real evidence arrives (#241).
   */
  benchmark: {
    pilotEnabled: false,
    fullBenchmarkEnabled: false,
  },

  /**
   * Fleet / enterprise product reporting (cards #244–#245).
   * Phase 5: opt-in, post full benchmark.
   * `fleet.enabled: false` — multi-repo aggregation and public case study are
   * gated on ADR-0081 consent + #243 evidence.
   */
  fleet: {
    enabled: false,
  },

  /**
   * Privacy posture (ADR-0081 / card #231).
   * These are advisory-safe defaults. `metadataOnly` ensures no transcript
   * content enters any EACP aggregate even when the master switch is on.
   * `optOut`: when true, even metadata telemetry is suppressed for this install.
   */
  privacy: {
    metadataOnly: true,
    optOut: false,
    retentionDays: 90,
  },
});
