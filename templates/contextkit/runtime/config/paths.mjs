/**
 * Canonical path constants for the ContextDevKit platform.
 *
 * Single source of truth so every hook, script and slash command agrees on
 * where memory artifacts live. `.claude/` is fixed by Claude Code (it reads
 * settings/commands/agents from hardcoded locations). Everything else lives
 * under `contextkit/` — the rebrandable platform bounded context.
 *
 * To rebrand the platform folder (e.g. back to `devAItools/`), change
 * `PLATFORM_DIR` here and run the installer's `--rewire` step. Nothing else
 * references the literal folder name.
 */
import { resolve } from 'node:path';

/** Platform bounded-context folder (everything except `.claude/`). */
export const PLATFORM_DIR = 'contextkit';

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

/** Multi-agent deliberation artifacts (ADR-0035) — pre-decision debate, feeds ADRs. */
export const DELIBERATIONS_DIR = `${MEMORY_DIR}/deliberations`;

/** Auto-generated reverse-chronological index of deliberations. */
export const DELIBERATIONS_INDEX = `${MEMORY_DIR}/DELIBERATIONS.md`;

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

/**
 * Resolves every canonical location to an ABSOLUTE path under `root`. This is the
 * single helper scripts/hooks use instead of hardcoding `resolve(ROOT, 'contextkit/…')`
 * literals — so the platform folder name lives only in `PLATFORM_DIR` (immutable
 * rule 4). One-off files under memory use `resolve(p.memory, '<name>')`.
 *
 * @param {string} [root] project root (default cwd)
 */
export function pathsFor(root = process.cwd()) {
  const at = (rel) => resolve(root, rel);
  return {
    root,
    platform: at(PLATFORM_DIR),
    memory: at(MEMORY_DIR),
    sessions: at(SESSIONS_DIR),
    sessionsIndex: at(SESSIONS_INDEX),
    workspaceIndex: at(WORKSPACE_INDEX),
    decisions: at(DECISIONS_DIR),
    glossary: at(GLOSSARY),
    predictions: at(PREDICTIONS_DIR),
    deliberations: at(DELIBERATIONS_DIR),
    deliberationsIndex: at(DELIBERATIONS_INDEX),
    changelog: at(CHANGELOG),
    config: at(CONFIG_FILE),
    ledgerDir: at(LEDGER_DIR),
    workspaceStateDir: at(WORKSPACE_STATE_DIR),
    contextSnapshot: at(CONTEXT_SNAPSHOT),
    pipeline: at(`${PLATFORM_DIR}/pipeline`),
    runtime: at(`${PLATFORM_DIR}/runtime`),
    tools: at(`${PLATFORM_DIR}/tools`),
    scripts: at(`${PLATFORM_DIR}/tools/scripts`),
    squads: at(`${PLATFORM_DIR}/squads`),
    workflows: at(`${PLATFORM_DIR}/workflows`),
    playbooks: at(`${PLATFORM_DIR}/workflows/playbooks`),
    detectors: at(`${PLATFORM_DIR}/detectors`),
    businessRules: at(`${MEMORY_DIR}/business-rules`),
    roadmap: at(`${MEMORY_DIR}/roadmap.md`),
    contractBaseline: at(`${MEMORY_DIR}/contract-baseline.json`),
    bestPractices: at(`${PLATFORM_DIR}/best-practices.md`),
    policy: at(`${PLATFORM_DIR}/policy`),
    complexityRubric: at(`${PLATFORM_DIR}/policy/complexity-rubric.json`),
  };
}
