/**
 * Canonical level taxonomy — the SINGLE source of truth for ContextDevKit's
 * activation levels. Every place that names a level range or label imports from
 * here so they can never drift: `getLevel` (load.mjs), the optional config
 * schema (schema.mjs), the installer labels (tools/install/cli.mjs) and the
 * in-project `/context-level` helper. Zero third-party deps (hot-path safe).
 *
 * Levels 1–5 add Claude hooks; 6–7 are capability tiers (no new hook — commands
 * and tooling layered on the L5 gates). See ADR-0010.
 */

/** Lowest selectable level. */
export const MIN_LEVEL = 1;

/** Highest selectable level. Bump this (and add a LEVEL_LABELS entry) to add a tier. */
export const MAX_LEVEL = 7;

/**
 * Human-readable label per level — the ONE table. The installer and `/context-level`
 * both render from this; keep the wording here and nowhere else.
 */
export const LEVEL_LABELS = {
  1: 'L1 Memory — boot context, session log, ADRs, changelog',
  2: 'L2 Ledger — + drift detection (PostToolUse + Stop nudge)',
  3: 'L3 Multi — + claims, worktrees, derived indices, git hooks (recommended for a NEW/empty project)',
  4: 'L4 Squads — + specialized sub-agents (.claude/agents)',
  5: 'L5 Proactive — + simulate-impact gate, tech-debt sweep, contract drift',
  6: 'L6 Autonomy & Insight — + /ship pipeline, /retro learning loop, metrics',
  7: 'L7 Ecosystem & Scale — + fleet (multi-repo), agent-tuning, visual tests, playbooks, token/cost insight (recommended for an EXISTING project with code)',
};

/** True when `n` is an integer within the valid level range. */
export function isValidLevel(n) {
  return Number.isInteger(n) && n >= MIN_LEVEL && n <= MAX_LEVEL;
}

/** Clamps any number into the valid level range (rounds non-integers). */
export function clampLevel(n) {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, i));
}
