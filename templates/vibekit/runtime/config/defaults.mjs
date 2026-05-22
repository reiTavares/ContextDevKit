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
 * `level` (1–5) gates which subsystems are active:
 *   1 Memory      — boot context + session log + ADRs + changelog
 *   2 Ledger      — drift detection (PostToolUse + Stop nudge)
 *   3 Multi       — claims, worktrees, derived indices, git hooks
 *   4 Squads      — specialized sub-agents
 *   5 Proactive   — simulate-impact gate, tech-debt sweep, contract drift
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

  /** L5 — Proactive Engineering. Inert unless `level >= 5`. */
  l5: {
    /** Editing any of these without a prior `/simulate-impact` is gated. */
    highRiskPaths: [],
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
