/**
 * defaults-arch-debt.mjs — Architecture & Technical-Debt Governance Gate config
 * defaults (WF-0057, ADR-0122), extracted from defaults.mjs to keep that file
 * within the 308-line constitution budget (mirrors defaults-economy.mjs /
 * defaults-eacp.mjs).
 *
 * This is the SOLE config authority for the gate (decisions.md Fork-1: "one CI
 * verdict path, one findings store, one config authority"). The legacy
 * `l5.lineBudget {yellow, red}` is NOT a second authority — it is a deprecated
 * ALIAS read only by the migration in `resolve-arch-debt-config.mjs`, which maps
 * its thresholds onto `lineSignals.{yellow, elevated}` as ADVISORY-only and emits
 * a one-time deprecation notice.
 *
 * CRITICAL invariants (ADR-0122, do not weaken without a new ADR):
 *   - `mode` is `'active'` — the gate deploys ACTIVE, never Shadow/Canary.
 *   - `lineSignals.blocking` is `false` — line count alone can never block
 *     (constitution §1 amended to advisory; a long file requests review, it does
 *     not determine a split). Both bands stay advisory trip-wires.
 *
 * Zero runtime dependencies — pure data. The hot path (hooks) never imports this.
 */

/**
 * Built-in defaults for the `architectureDebtGate` config section.
 *
 * Key map (consumed by the gate's config-resolution + `arch-debt/gate-context.mjs`):
 *   - `enabled`        — master switch; false restores legacy line-budget-only behaviour.
 *   - `mode`           — global gate gear. ACTIVE by contract (ADR-0122).
 *   - `baseline`       — ratchet strategy; `blockUnchangedLegacyDebt:false` scopes
 *                        the verdict to the changed set so legacy debt never blocks
 *                        unrelated work (§25).
 *   - `ruleModes`      — per-`ruleId` Enforcement overrides (§12); empty by default.
 *   - `lineSignals`    — the ADVISORY line-count signal. `yellow`/`elevated` are the
 *                        trip-wire bands (map to `lineBands` for the collector).
 *                        `blocking:false` is a hard invariant.
 *   - `floors`         — deterministic floor authorities; security/reliability/
 *                        testability are BLOCKING when their evidence is present.
 *   - `intentionalDebt`— the evidence an intentional-debt waiver must carry.
 *   - `scope`          — changed-files / affected-modules scoping toggles.
 *   - `unknownEvidence`— how UNKNOWN/missing evidence resolves (never silent PASS).
 */
export const ARCH_DEBT_GATE_DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'active',
  baseline: { strategy: 'ratchet', blockUnchangedLegacyDebt: false },
  ruleModes: {},
  lineSignals: { enabled: true, blocking: false, yellow: 240, elevated: 308 },
  floors: { security: 'BLOCKING', reliability: 'BLOCKING', testability: 'BLOCKING' },
  intentionalDebt: {
    requireOwner: true,
    requireBusinessJustification: true,
    requireRepaymentTrigger: true,
    requireAcceptanceAuthority: true,
  },
  scope: { changedFilesOnly: true, affectedModules: true },
  unknownEvidence: 'REVIEW_REQUIRED',
});
