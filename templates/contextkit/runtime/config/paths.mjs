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

/**
 * Antigravity host folder — the name is dictated by the `agy` binary, which
 * resolves skills/hooks strictly from `.agents/` at the workspace root
 * [ADR-0048]. Single-sourced here (rule 4); never hardcode it elsewhere.
 */
export const ANTIGRAVITY_DIR = '.agents';

/** Pre-ADR-0048 Antigravity host folder — kept only for legacy cleanup. */
export const ANTIGRAVITY_LEGACY_DIR = '.antigravity';

/** Codex host folder — project-local hooks and subagent TOML definitions. */
export const CODEX_DIR = '.codex';

/** Codex local skills live where Codex discovers project skills in this host. */
export const CODEX_SKILLS_DIR = `${ANTIGRAVITY_DIR}/skills`;

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

/**
 * Business-driven methodology roots (BIZ-0001 / WF-0036). Single-sourced off
 * `MEMORY_DIR`/`DECISIONS_DIR` so the platform folder name lives ONLY in
 * `PLATFORM_DIR` (immutable rule 4). See `architecture/schema-plan.md`.
 */

/** Business work contexts — one folder per `BIZ-####`. */
export const BUSINESS_DIR = `${MEMORY_DIR}/business`;

/** Operation work contexts — one folder per `OP-####`. */
export const OPERATIONS_DIR = `${MEMORY_DIR}/operations`;

/** Decision subtree for Business-owned ADRs (used by WF-0037). */
export const DECISIONS_BUSINESS_DIR = `${DECISIONS_DIR}/business`;

/** Decision subtree for Operation-owned ADRs (used by WF-0037). */
export const DECISIONS_OPERATIONS_DIR = `${DECISIONS_DIR}/operations`;

/** Decision subtree for legacy (pre-methodology) ADRs (used by WF-0037). */
export const DECISIONS_LEGACY_DIR = `${DECISIONS_DIR}/legacy`;

/** Generated index of work contexts (BIZ-#### ∪ OP-####). Built by A1-T3/B1. */
export const WORK_CONTEXT_REGISTRY = `${MEMORY_DIR}/work-context-registry.json`;

/** Generated index resolving WF-#### + legacy NNNN-slug workflows. Built later. */
export const WORKFLOW_REGISTRY = `${MEMORY_DIR}/workflow-registry.json`;

/** Generated index of decisions across new + legacy roots. Built later. */
export const DECISION_REGISTRY = `${MEMORY_DIR}/decision-registry.json`;

/** Domain glossary — UI/business term ↔ code identifier. */
export const GLOSSARY = `${MEMORY_DIR}/GLOSSARY.md`;

/** L5 prediction artifacts (Blast Radius Reports). */
export const PREDICTIONS_DIR = `${MEMORY_DIR}/predictions`;

/** Durable structural project map — modules/frontend/backend inventory (deterministic). */
export const PROJECT_MAP_DIR = `${MEMORY_DIR}/project-map`;

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
    antigravity: at(ANTIGRAVITY_DIR),
    codex: at(CODEX_DIR),
    codexSkills: at(CODEX_SKILLS_DIR),
    memory: at(MEMORY_DIR),
    sessions: at(SESSIONS_DIR),
    sessionsIndex: at(SESSIONS_INDEX),
    workspaceIndex: at(WORKSPACE_INDEX),
    decisions: at(DECISIONS_DIR),
    business: at(BUSINESS_DIR),
    operations: at(OPERATIONS_DIR),
    decisionsBusiness: at(DECISIONS_BUSINESS_DIR),
    decisionsOperations: at(DECISIONS_OPERATIONS_DIR),
    decisionsLegacy: at(DECISIONS_LEGACY_DIR),
    workContextRegistry: at(WORK_CONTEXT_REGISTRY),
    workflowRegistry: at(WORKFLOW_REGISTRY),
    decisionRegistry: at(DECISION_REGISTRY),
    glossary: at(GLOSSARY),
    predictions: at(PREDICTIONS_DIR),
    projectMap: at(PROJECT_MAP_DIR),
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
    capabilityRegistry: at(`${PLATFORM_DIR}/policy/capability-registry.json`),
    workClassification: at(`${PLATFORM_DIR}/policy/work-classification.json`),
  };
}
