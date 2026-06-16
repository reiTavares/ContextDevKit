/**
 * Default routing configuration — extracted from defaults.mjs to keep that
 * file within the 308-line budget (constitution §1 +10% tolerance).
 *
 * Automatic model routing for STANDARD sessions (ADR-0094) — composes the
 * ADR-0052 routing engine (`model-policy.mjs`) + EACP economics into every
 * session. The posture: *Haiku operates, Sonnet executes, Opus decides* (and
 * Opus implements directly on high/critical-risk code). The kit LOADS, RECORDS,
 * SURFACES and MEASURES the policy — the host dispatches; this is a governance
 * layer, not a model scheduler (ADR-0094 §Decision).
 *   - `enabled`: master switch. Off → no ledger flag, banner, or telemetry.
 *   - `mode`: `shadow` (recommend only) | `canary` (auto-apply `canaryPct`%)
 *     | `active` (apply where guard estimates net benefit). Default: `shadow`.
 *     Promotion shadow→canary→active requires telemetry — never automatic.
 *   - `applyToStandardSessions`: active posture outside `/swarm`.
 *   - `canaryPct`: 0–100, only in `canary` mode.
 *   - `mechanical/implementation/reasoningExecutor`: tier aliases (NEVER ids).
 *   - `allowOpusCoding`: Opus may implement directly (ADR-0094 §2).
 *   - `allowAutomaticFable`: false — manual `/fable` only (ADR-0052).
 *   - `escalationEnabled`: Haiku→Sonnet→Opus escalation (ADR-0094 §5).
 *   - `runnerFirstMaxCommands`: ≤ N direct commands before subagent (§4).
 *   - `handoffMaxTokens`: compact-handoff ceiling (ADR-0044).
 *   - `minLevel`: inert below this level (model tiers require L4+ squads).
 * Zero runtime dependencies — relative import only.
 */

/** @type {Readonly<object>} */
export const ROUTING_DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'shadow',
  applyToStandardSessions: true,
  canaryPct: 10,
  mechanicalExecutor: 'haiku',
  implementationExecutor: 'sonnet',
  reasoningExecutor: 'opus',
  allowOpusCoding: true,
  allowAutomaticFable: false,
  escalationEnabled: true,
  compactHandoffs: true,
  useProjectMapFirst: true,
  routeToolOperationsToHaiku: true,
  routeSessionLoggingToHaiku: true,
  runnerFirstMaxCommands: 3,
  handoffMaxTokens: 2000,
  minLevel: 4,
});
