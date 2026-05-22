/**
 * Canonical path constants for the VibeDevKit platform.
 *
 * Single source of truth so every hook, script and slash command agrees on
 * where memory artifacts live. `.claude/` is fixed by Claude Code (it reads
 * settings/commands/agents from hardcoded locations). Everything else lives
 * under `vibekit/` — the rebrandable platform bounded context.
 *
 * To rebrand the platform folder (e.g. back to `devAItools/`), change
 * `PLATFORM_DIR` here and run the installer's `--rewire` step. Nothing else
 * references the literal folder name.
 */

/** Platform bounded-context folder (everything except `.claude/`). */
export const PLATFORM_DIR = 'vibekit';

/** Memory root — ADRs, sessions, glossary, indices. */
export const MEMORY_DIR = `${PLATFORM_DIR}/memory`;

/** One markdown file per work session. */
export const SESSIONS_DIR = `${MEMORY_DIR}/sessions`;

/** Auto-generated reverse-chronological index of sessions. */
export const SESSIONS_INDEX = `${MEMORY_DIR}/SESSIONS.md`;

/** Auto-generated aggregate of active workspace claims. */
export const WORKSPACE_INDEX = `${MEMORY_DIR}/WORKSPACE.md`;

/** Architecture Decision Records (immutable once accepted). */
export const DECISIONS_DIR = `${MEMORY_DIR}/decisions`;

/** Domain glossary — UI/business term ↔ code identifier. */
export const GLOSSARY = `${MEMORY_DIR}/GLOSSARY.md`;

/** L5 prediction artifacts (Blast Radius Reports). */
export const PREDICTIONS_DIR = `${MEMORY_DIR}/predictions`;

/** Factual release chronology (Keep a Changelog format). */
export const CHANGELOG = 'docs/CHANGELOG.md';

/** Platform config (level, ledger overrides, L5 params). */
export const CONFIG_FILE = `${PLATFORM_DIR}/config.json`;

/** Per-session ledger files (gitignored runtime state). */
export const LEDGER_DIR = '.claude/.sessions';

/** Per-session workspace claim files (gitignored runtime state). */
export const WORKSPACE_STATE_DIR = '.claude/.workspace';

/** On-demand full-project snapshot (gitignored). */
export const CONTEXT_SNAPSHOT = '.context-snapshot.md';
