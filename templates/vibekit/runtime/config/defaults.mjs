/**
 * Built-in default configuration for VibeDevKit — STACK-AGNOSTIC.
 *
 * This object is the fallback whenever `vibekit/config.json` is missing,
 * malformed, or only partially overrides the tree. It carries ZERO runtime
 * dependencies (no zod) so the Level 1–3 hooks work in a brand-new project
 * with nothing installed. Level 5 validation (`/vibe-config`) layers an
 * optional zod schema on top — see `schema.mjs`.
 *
 * The defaults intentionally describe a *generic* repository (`src/`, `lib/`,
 * `app/`, `packages/`, ...). The installer tunes these per detected stack and
 * the user refines them with `/vibe-config`.
 */

/**
 * `level` (1–7) gates which subsystems are active. 1–5 add Claude hooks; 6–7 are
 * capability tiers (no new hook — commands/tooling on top of the L5 gates):
 *   1 Memory      — boot context + session log + ADRs + changelog
 *   2 Ledger      — drift detection (PostToolUse + Stop nudge)
 *   3 Multi       — claims, worktrees, derived indices, git hooks
 *   4 Squads      — specialized sub-agents
 *   5 Proactive   — simulate-impact gate, tech-debt sweep, contract drift
 *   6 Autonomy    — /ship pipeline, /retro, metrics (capability tier)
 *   7 Ecosystem   — fleet (multi-repo), agent-tuning, visual tests, playbooks,
 *                   token/cost insight, security automation (capability tier)
 */
export const DEFAULT_CONFIG = Object.freeze({
  level: 2,

  /**
   * First-run onboarding state. The installer writes `completed: false` into a
   * fresh project's config so the SessionStart hook fires the `/setupvibedevkit`
   * trigger on the first session. `/setupvibedevkit` flips it to `true` when
   * onboarding finishes. The DEFAULT is `true` so a missing/corrupt config never
   * nags — only an installer-written `false` triggers the banner.
   */
  setup: { completed: true },

  /** Best-practices skill (vibekit/best-practices.md). When active, boot reminds + /analyze-code-ia-practices is encouraged. */
  practices: { active: false },

  /**
   * Path classification for the L2 ledger. Override per stack via config.
   *   - `important`: an edit here can trigger the Stop drift nudge.
   *   - `irrelevant`: never tracked (build output, caches, runtime state).
   *   - `registration`: an edit here counts AS registering the session.
   */
  ledger: {
    important: [
      'src/',
      'lib/',
      'app/',
      'apps/',
      'packages/',
      'components/',
      'pages/',
      'server/',
      'vibekit/',
      '.claude/',
      '.github/',
      'CLAUDE.md',
      'package.json',
      'tsconfig.json',
      'pyproject.toml',
      'go.mod',
      'Cargo.toml',
    ],
    irrelevant: [
      'node_modules/',
      'dist/',
      'build/',
      'out/',
      '.next/',
      '.turbo/',
      '.expo/',
      '.svelte-kit/',
      'coverage/',
      '__pycache__/',
      'target/',
      'vendor/',
      '.context-snapshot.md',
      '.claude/.sessions/',
      '.claude/.workspace/',
    ],
    registration: ['vibekit/memory/SESSIONS.md', 'docs/CHANGELOG.md'],
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
   * DevPipeline prioritization (WSJF / SAFe) + bug severity + SLA + WIP eviction.
   *   - `wsjfBands`: WSJF score ≥ value → priority (P0/P1/P2, else P3).
   *   - `severityPriority`: ITIL bug severity S1–S4 → priority.
   *   - `slaDays`: resolution target (days) per priority → the task's SLA due date.
   *   - `bugTypes`: the bug taxonomy used to classify bug tasks.
   *   - `workingStaleAfterMinutes`: ADR-0015 §B — a task auto-evicts from `working/`
   *     back to `backlog/` when its owning session is silent past this threshold.
   */
  pipeline: {
    framework: 'wsjf',
    wsjfBands: { p0: 8, p1: 5, p2: 2 },
    severityPriority: { S1: 'P0', S2: 'P1', S3: 'P2', S4: 'P3' },
    slaDays: { P0: 1, P1: 3, P2: 14, P3: 60 },
    bugTypes: ['functional', 'regression', 'security', 'performance', 'data', 'integration', 'ui', 'build', 'flaky', 'other'],
    workingStaleAfterMinutes: 90,
  },

  /**
   * Security mode — proactive analysis cadence. When `active`, the SessionStart
   * hook reminds you to run `/deep-analysis` every `everyNSessions` sessions.
   * ACTIVE by default; set `active: false` to disable.
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
   * Predictions-review cadence (L5/L6). When `active`, the SessionStart hook reminds you
   * to run `/predictions-review` every `everyNSessions` sessions — but ONLY when there are
   * unreviewed `/simulate-impact` predictions, so it stays silent otherwise.
   */
  predictionsReview: { active: true, everyNSessions: 10 },

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

  /** L5 — Proactive Engineering. Inert unless `level >= 5`. */
  l5: {
    /** Editing any of these without a prior `/simulate-impact` is gated.
     *  agent-packages/** is included by default — swapping a forged agent's primary
     *  model is high blast radius (ADR-0012 + Fase 5). Remove if you don't ship agents. */
    highRiskPaths: ['agent-packages/**'],
    /** Line-budget thresholds used by the tech-debt scanner. */
    lineBudget: { yellow: 240, red: 308 },
    /** Files whose exported symbols form the public contract (drift gate). Empty = off. */
    contractGlobs: [],
    /** Auto-distill cadence (CLAUDE.md self-refinement loop). */
    distill: {
      observeWindow: 10,
      proposeAfterSessions: 30,
      archiveLedgersOlderThanDays: 7,
    },
    techDebtSweep: {
      default: 'full',
      profiles: {
        full: { cadenceDays: 14, scope: 'all' },
        quick: { cadenceDays: 3, scope: 'red-zone-only' },
      },
    },
  },
});
