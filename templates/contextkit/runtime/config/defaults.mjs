/**
 * Built-in default configuration for ContextDevKit — STACK-AGNOSTIC.
 *
 * This object is the fallback whenever `contextkit/config.json` is missing,
 * malformed, or only partially overrides the tree. It carries ZERO runtime
 * dependencies (no zod) so the Level 1–3 hooks work in a brand-new project
 * with nothing installed. Level 5 validation (`/context-config`) layers an
 * optional zod schema on top — see `schema.mjs`.
 *
 * The defaults describe a *generic* repository; the installer tunes them per
 * detected stack. Split note: `routing` defaults live in defaults-routing.mjs,
 * `eacp` in defaults-eacp.mjs and `economy` in defaults-economy.mjs.
 */
import { ROUTING_DEFAULTS } from './defaults-routing.mjs';
import { ORCHESTRATION_DEFAULTS } from './defaults-orchestration.mjs';
import { EACP_DEFAULTS } from './defaults-eacp.mjs';
import { ECONOMY_CONFIG_DEFAULTS } from './defaults-economy.mjs';
import { ARCH_DEBT_GATE_DEFAULTS } from './defaults-arch-debt.mjs';
import { DEFAULT_GOVERNANCE_CONFIG } from '../governance/gate-registry.mjs';
/**
 * `level` (1–7) gates which subsystems are active. 1–5 add Claude hooks; 6–7 are
 * capability tiers (no new hook — commands/tooling on top of the L5 gates):
 *   1 Memory      — read-only context + explicit session logs + ADRs
 *   2 Governance  — one bounded dispatcher per lifecycle event
 *   3 Multi       — explicit claims, worktrees, derived indices, git hooks
 *   4 Squads      — specialized sub-agents
 *   5 Proactive   — simulate-impact gate, tech-debt sweep, contract drift
 *   6 Autonomy    — /ship pipeline, /retro, metrics (capability tier)
 *   7 Ecosystem   — fleet (multi-repo), agent-tuning, visual tests, playbooks,
 *                   token/cost insight, security automation (capability tier)
 */
export const DEFAULT_CONFIG = Object.freeze({
  level: 2,

  /** ContextDevKit 4 canonical gate matrix (ADR-0158). */
  governance: DEFAULT_GOVERNANCE_CONFIG,

  /** Real-risk acknowledgement is metadata; host/platform controls stay authoritative. */
  riskAcknowledgement: {
    requiredFor: ['destructive-production', 'force-push', 'secret-rotation'],
    message: 'Confirm this high-risk action through the real host/platform safety boundary.',
    extraSecretPaths: [],
  },

  /**
   * project-map (ADR-0046). `autoRefresh`: the pre-commit hook regenerates the
   * committed map when source is staged (derived doc — never blocks).
   * `enforce`: when `rules.json` declares architectural-fitness rules, a violation
   * fails `--check --strict` (the CI gate). Both inert until a map / rules exist.
   * `roots`/`excludes` (CDK-050): configurable scan scope — `roots` defaults to
   * the whole project (`['.']`); `excludes` adds bare-name excludes on top of the
   * hardcoded catalogue. Defaults reproduce the legacy scan exactly.
   *
   * `graph` (ADR-0134, amended by ADR-0155): the structural knowledge graph is
   * MANDATORY, not opt-in — ADR-0155 replaces ADR-0134's default-OFF posture with
   * a forced default, because an optional graph was never consulted (0 of 37 agent
   * briefings referenced it, and `autoIndex` had no consumer at all). `mode:
   * 'guarded'` + `humanFlip: true` is the kit-level flip ADR-0134 §G-RO4 demands
   * for a blocking mode; `resolveGraphActivation` still clamps it to advisory
   * below L7. Safety comes from DEGRADATION, not from being off: an absent or
   * unreadable projection makes the gate warn-and-allow (skipped, never a
   * fabricated pass), so no project is ever false-blocked. `maxAgeMinutes` is the
   * age above which the gate rebuilds the projection on demand.
   */
  projectMap: {
    autoRefresh: true,
    enforce: true,
    roots: ['.'],
    excludes: [],
    graph: { enabled: true, mode: 'advisory', humanFlip: false, autoIndex: true, maxAgeMinutes: 60 },
  },

  /**
   * WF-0090 grounded content auto-fill (ADR-0148, the four rails) — the ONE place
   * an LLM writes. Ships OFF twice over, deliberately: `enabled:false` is the
   * primary switch and `tokenBudgetPerContext:0` means *no spend authorized*, so
   * a single mis-flip cannot open the gate. A disabled engine leaves WF-0089's
   * `{{TOKEN}}` skeleton standing and never blocks (rail d).
   * `promptVersion` is the explicit, recorded escape for intentional
   * regeneration: it is folded into the field inputHash, so bumping it — and
   * only bumping it — re-runs generation on unchanged exemplars.
   */
  methodology: {
    contentFill: { enabled: false, tokenBudgetPerContext: 0, promptVersion: 1 },
  },

  /**
   * First-run onboarding state. The installer writes `completed: false` into a
   * fresh project's config so the SessionStart hook fires the `/setupcontextdevkit`
   * trigger on the first session. `/setupcontextdevkit` flips it to `true` when
   * onboarding finishes. The DEFAULT is `true` so a missing/corrupt config never
   * nags — only an installer-written `false` triggers the banner.
   */
  setup: { completed: true },

  /** Best-practices skill (contextkit/best-practices.md). When active, boot reminds + /analyze-code-ia-practices is encouraged. */
  practices: { active: false },

  /**
   * Behavioral discipline (contextkit/behaviors.md, ADR-0029) — how the agent ACTS
   * while coding: think-before-coding (surface assumptions / ask when ambiguous),
   * simplicity-first, surgical changes, goal-driven (reproduce-test first). When
   * `active`, the SessionStart hook reminds you each session. ON by default — it's
   * universal, cheap, and the constitution §8 already states it.
   */
  behaviors: { active: true },

  /**
   * Boot banner budget (ADR-0033). `valueLine` shows a once-a-week, local-only,
   * no-PII line reflecting the kit's accrued value (sessions logged · ADRs
   * recorded) so the dev can see the payoff. Set `false` to mute.
   */
  boot: { valueLine: true },

  /**
   * Analysis exclusions are read-only scan inputs. They never track mutations,
   * create session state, or participate in a completion decision.
   */
  /** Read-only analysis exclusions. This list never drives mutation tracking. */
  analysis: {
    excludePaths: ['node_modules/', 'dist/', 'build/', 'out/', '.next/', '.turbo/', '.expo/', '.svelte-kit/', 'coverage/', '__pycache__/', 'target/', 'vendor/'],
  },

  /** L3 — Multi-session. `mainBranch` is the upstream the pre-push conflict check compares against. */
  l3: { mainBranch: 'main' },

  /**
   * QA squad config (used by /test-plan, /scaffold-tests, /qa-signoff and the
   * qa-* agents at Level >= 4). `criticalPaths` get the highest coverage
   * priority; `coverageTarget` is the floor a sign-off aims for.
   */
  qa: {
    criticalPaths: [],
    coverageTarget: { lines: 80, branches: 70 },
  },

  /**
   * Optional swarm runtime facts. `hostTechnicalLimit` is null until the host
   * exposes a real scheduler limit; it is never inferred from complexity/tier.
   */
  swarm: { hostTechnicalLimit: null, tokenBudgetPerRun: 0, staleMinutes: 30 },

  /**
   * Security mode — advisory cadence consumed by explicit status/context reads.
   */
  securityMode: { active: true, everyNSessions: 10 },

  /**
   * Token economy & usage insight (L6). `/token-report` reads Claude Code's local
   * session transcripts (`~/.claude/projects/…`) and aggregates token usage for this
   * project — advisory, read-only, aggregated counts only.
   *   - `budgetPerSession`: total tokens/session that triggers a ⚠️ warning (0 = off).
   *   - `warnAtPct`: warn once a session reaches this % of the budget.
   */
  tokens: { budgetPerSession: 0, warnAtPct: 80 },

  /**
   * Predictions-review cadence (L5/L6), surfaced only by explicit context reads.
   */
  predictionsReview: { active: true, everyNSessions: 10 },
  /** Automatic model routing for STANDARD sessions (ADR-0094). See defaults-routing.mjs. */
  routing: ROUTING_DEFAULTS,

  /**
   * Deliberations (L5+, ADR-0035 / ADR-0070) — multi-agent debate artifact that
   * feeds ADRs. `/debate <question>` fans out to genuinely independent voices, a
   * separate synthesizer converges (or records an explicit `unresolved`), and the
   * result lands in `contextkit/memory/deliberations/`, optionally pre-filling a
   * `/new-adr`.
   *   - `active`: master switch — when false, the command, gates and nudge stay silent.
   *   - `voices`: legacy default count of positions (the autoSelect-off fallback).
   *   - `minLevel`: the nudge hook is inert below this level (born active at L5).
   *   - `nudgeOnHighRisk`: when true, editing an `l5.highRiskPaths` target (or a new
   *     `memory/decisions/` ADR) suggests `/debate` first — a soft nudge that NEVER
   *     blocks the edit (rule 2). The path set is single-sourced from `l5.highRiskPaths`.
   *   - `council` (ADR-0070): dynamic specialist roster. `autoSelect` picks the
   *     relevant advisor-lane owners by question; the count scales to
   *     `clamp(matchedLanes, min, max)`. Off → fall back to the flat `voices` count.
   *   - `autoInvoke` (ADR-0070): advisory surfaces that may suggest a council
   *     (`debate` mode via the resolver) — `newFeature` (`/workflow` intake) and
   *     `decision` (`/new-adr`, architectural tier). The ADR WRITE still stays manual.
   *   - `research` (ADR-0070): tiered economy. When `tiered`, cheap `scoutTier`
   *     (Haiku) agents gather an evidence pack and `verifyTier` (Sonnet) handles
   *     complex verification; the voices + synthesizer stay reasoning-tier (ADR-0052).
   */
  deliberations: {
    active: true,
    voices: 3,
    minLevel: 5,
    nudgeOnHighRisk: true,
    council: { autoSelect: true, min: 3, max: 6 },
    autoInvoke: { newFeature: true, decision: true, standardRequests: true, business: true, materialDecision: true, shipCheckpoint: true },
    materialityThreshold: 0.6,
    research: { tiered: true, scoutTier: 'fast', verifyTier: 'powerful' },
  },

  /** Optional, recommendation-only orchestration-size guidance. */
  orchestration: ORCHESTRATION_DEFAULTS,

  /**
   * Proactive Advisor (L6, ADR-0028) — the six-lane improvement engine. When
   * `active`, `/advise` fans out to the owning agent per lane and emits ONE
   * classified digest (`--before` = opportunities/risks, `--after` = improvements).
   * The interaction is read-only and never creates tasks. Each lane is `{ owner }`
   * — the agent/command that owns it, or
   * `null` to mute a lane. All six ship with an owner; a muted lane is reported as
   * *skipped*, never faked (rule 8/9). `growth` is the growth-team lead (pairs with
   * `retention` + `seo-specialist` for acquisition); `deepen` is product-owner's
   * depth lens (maturing existing features, distinct from greenfield `features`).
   */
  advisor: {
    active: true,
    lanes: {
      architecture: { owner: 'architect' },
      features: { owner: 'product-owner' },
      deepen: { owner: 'product-owner' },
      security: { owner: 'security' },
      ux: { owner: 'ux-designer' },
      growth: { owner: 'growth' },
    },
  },

  /**
   * Dependency policy for `/deps-audit` (security-team). All advisory — findings
   * flow into the DevPipeline backlog, they don't block by default.
   *   - `requireLockfile`: flag a manifest with deps but no committed lockfile.
   *   - `licenses.allow`: if non-empty, a dependency whose license is NOT listed
   *     is flagged (allow-list mode). SPDX ids, case-insensitive.
   *   - `licenses.deny`: a dependency whose license IS listed is always flagged.
   *   - `maxAgeDays`: reserved for registry-backed staleness (not enforced yet).
   */
  deps: {
    requireLockfile: true,
    licenses: { allow: [], deny: ['GPL-3.0', 'AGPL-3.0'] },
    maxAgeDays: null,
  },

  /**
   * ContextKit parity imports (ADR-0060). Enforcers are on-by-level but
   * warn-first — they never block at their entry level (rule 2).
   *   - `autoFormat` (ADR-0061): PostToolUse format/lint after each edit (L≥4).
   *     `excludePaths` are skipped; advisory only, never blocks.
   *   - `qualityGate` (ADR-0062): multi-language pre-push checks. `strictLevel`
   *     is the level at which a failing gate blocks (warn below it). `disabled`
   *     lists gate keys to skip. A missing tool is reported skipped, never failed.
   *   - `bridges` (ADR-0068): context-only bridge files for non-native tools.
   *     `enabled` opts in per tool (cursor|copilot|gemini|windsurf|aider|continue).
   */
  autoFormat: { enabled: true, minLevel: 4, excludePaths: ['node_modules/', 'dist/', 'build/', '.next/', 'target/', '__pycache__/', 'vendor/'] },
  qualityGate: { enabled: true, minLevel: 3, strictLevel: 4, disabled: [] },
  bridges: { enabled: [] },

  /** L5 — Proactive Engineering. Inert unless `level >= 5`. */
  l5: {
    /** Editing any of these without a prior `/simulate-impact` is gated.
     *  agent-packages/** is included by default — swapping a forged agent's primary
     *  model is high blast radius (ADR-0012 + Fase 5). Remove if you don't ship agents. */
    highRiskPaths: ['agent-packages/**'],
    /**
     * REMOVED (BIZ-0005/WF-0077, ADR-0144): the deprecated `l5.lineBudget` alias is
     * no longer shipped in the defaults. Line count is advisory telemetry only; the
     * enforced bar is DDD Class-A conformance + the reviewer-gate (ADR-0143), never a
     * line number. The MIGRATION path in `resolve-arch-debt-config.mjs` is retained so
     * a project that STILL carries `l5.lineBudget` migrates it onto `lineSignals`
     * (yellow→yellow, red→elevated) — but a fresh install never gets the alias. */
    /** Files whose exported symbols form the public contract (drift gate). Empty = off. */
    contractGlobs: [],
    /** Auto-distill cadence (CLAUDE.md self-refinement loop). */
    distill: {
      observeWindow: 10,
      proposeAfterSessions: 30,
      archiveRunsOlderThanDays: 7,
    },
    techDebtSweep: {
      default: 'full',
      profiles: {
        full: { cadenceDays: 14, scope: 'all' },
        quick: { cadenceDays: 3, scope: 'red-zone-only' },
      },
    },
  },
  eacp: EACP_DEFAULTS,                // advisory-first; see defaults-eacp.mjs (disable restores legacy)
  economy: ECONOMY_CONFIG_DEFAULTS,   // ADR-0103 go-live; see defaults-economy.mjs (per-module toggles)

  /**
   * Architecture & Technical-Debt Governance Gate (WF-0057, ADR-0158) — the SOLE
   * config authority for the gate. `mode:'canary'` + `lineSignals.blocking:false`
   * keep architecture heuristics non-blocking. The legacy `l5.lineBudget` is a
   * migration-only advisory alias. See defaults-arch-debt.mjs.
   */
  architectureDebtGate: ARCH_DEBT_GATE_DEFAULTS,
});
