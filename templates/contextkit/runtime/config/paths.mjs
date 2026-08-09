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
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { parse, resolve } from 'node:path';

/** Platform bounded-context folder (everything except `.claude/`). */
export const PLATFORM_DIR = 'contextkit';

/** V4 authority pointer written only by the explicit offline migrator. */
export const AUTHORITY_MARKER_FILE = '.contextdevkit-authority.json';

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

/** Grok Build host folder - project hooks and MCP configuration. */
export const GROK_DIR = '.grok';

/** ContextDevKit-owned Grok hook projection, kept separate from user config. */
export const GROK_HOOKS_FILE = `${GROK_DIR}/hooks/contextdevkit.json`;

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

/**
 * Generated index of decisions across new + legacy roots. Canonical location is
 * the memory root. NOTE (§22/§33): the design implies a `decisions/`-nested
 * alias; `resolveDecisionRegistryPath` (task-intake.mjs) reads the nested copy
 * when present and falls back here, so the cache can migrate without a move.
 */
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

/** Platform config (level, governance modes, analysis and QA hints). */
export const CONFIG_FILE = `${PLATFORM_DIR}/config.json`;

/** Per-session workspace claim files (gitignored runtime state). */
export const WORKSPACE_STATE_DIR = '.claude/.workspace';

/** On-demand full-project snapshot (gitignored). */
export const CONTEXT_SNAPSHOT = '.context-snapshot.md';

/** Normalize a real path for case-insensitive Windows comparisons. */
function comparablePath(path) {
  const value = resolve(path);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/**
 * Resolve the single active memory root. A valid cutover marker points every
 * normal reader and writer at one verified v4 generation; an invalid marker is
 * refused instead of silently falling back to the pre-cutover tree.
 *
 * @param {string} projectRoot
 * @param {string} platformRoot
 * @returns {string}
 * @throws {Error} when a present marker is malformed or unsafe
 */
export function resolveActiveMemoryRoot(projectRoot, platformRoot = resolve(projectRoot, PLATFORM_DIR)) {
  const nativeMemoryRoot = resolve(projectRoot, MEMORY_DIR);
  const markerPath = resolve(platformRoot, AUTHORITY_MARKER_FILE);
  if (!existsSync(markerPath)) return nativeMemoryRoot;

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`ContextDevKit authority marker is unreadable: ${markerPath}: ${error.message}`);
  }
  const validHash = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value);
  if (marker?.schemaVersion !== 1
    || marker?.kind !== 'contextdevkit-authority'
    || marker?.authority !== 'v4'
    || marker?.oldWriterFence !== true
    || !Number.isInteger(marker?.revision)
    || marker.revision < 1
    || typeof marker?.generationRoot !== 'string'
    || !validHash(marker?.manifestHash)
    || !validHash(marker?.generationDigest)) {
    throw new Error(`ContextDevKit authority marker has an invalid v4 schema: ${markerPath}`);
  }

  const generationRoot = resolve(marker.generationRoot);
  const activeMemoryRoot = resolve(generationRoot, 'memory');
  if (parse(generationRoot).root.toLowerCase() !== parse(platformRoot).root.toLowerCase()) {
    throw new Error(`ContextDevKit authority generation must remain on the platform volume: ${generationRoot}`);
  }
  for (const [label, candidate] of [['generation', generationRoot], ['memory', activeMemoryRoot]]) {
    if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) {
      throw new Error(`ContextDevKit authority ${label} directory is unavailable: ${candidate}`);
    }
    if (lstatSync(candidate).isSymbolicLink()
      || comparablePath(realpathSync(candidate)) !== comparablePath(candidate)) {
      throw new Error(`ContextDevKit authority ${label} directory must not be a reparse path: ${candidate}`);
    }
  }
  return activeMemoryRoot;
}

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
  const platform = at(PLATFORM_DIR);
  const memory = resolveActiveMemoryRoot(root, platform);
  const inMemory = (rel) => resolve(memory, rel);
  return {
    root,
    platform,
    antigravity: at(ANTIGRAVITY_DIR),
    codex: at(CODEX_DIR),
    grok: at(GROK_DIR),
    grokHooks: at(GROK_HOOKS_FILE),
    codexSkills: at(CODEX_SKILLS_DIR),
    memory,
    sessions: inMemory('sessions'),
    sessionsIndex: inMemory('SESSIONS.md'),
    workspaceIndex: inMemory('WORKSPACE.md'),
    decisions: inMemory('decisions'),
    business: inMemory('business'),
    operations: inMemory('operations'),
    decisionsBusiness: inMemory('decisions/business'),
    decisionsOperations: inMemory('decisions/operations'),
    decisionsLegacy: inMemory('decisions/legacy'),
    workContextRegistry: inMemory('work-context-registry.json'),
    workflowRegistry: inMemory('workflow-registry.json'),
    decisionRegistry: inMemory('decision-registry.json'),
    glossary: inMemory('GLOSSARY.md'),
    predictions: inMemory('predictions'),
    projectMap: inMemory('project-map'),
    deliberations: inMemory('deliberations'),
    deliberationsIndex: inMemory('DELIBERATIONS.md'),
    changelog: at(CHANGELOG),
    config: at(CONFIG_FILE),
    workspaceStateDir: at(WORKSPACE_STATE_DIR),
    contextSnapshot: at(CONTEXT_SNAPSHOT),
    runtime: at(`${PLATFORM_DIR}/runtime`),
    tools: at(`${PLATFORM_DIR}/tools`),
    scripts: at(`${PLATFORM_DIR}/tools/scripts`),
    squads: at(`${PLATFORM_DIR}/squads`),
    workflows: at(`${PLATFORM_DIR}/workflows`),
    playbooks: at(`${PLATFORM_DIR}/workflows/playbooks`),
    detectors: at(`${PLATFORM_DIR}/detectors`),
    businessRules: inMemory('business-rules'),
    roadmap: inMemory('roadmap.md'),
    contractBaseline: inMemory('contract-baseline.json'),
    bestPractices: at(`${PLATFORM_DIR}/best-practices.md`),
    policy: at(`${PLATFORM_DIR}/policy`),
    complexityRubric: at(`${PLATFORM_DIR}/policy/complexity-rubric.json`),
    capabilityRegistry: at(`${PLATFORM_DIR}/policy/capability-registry.json`),
    workClassification: at(`${PLATFORM_DIR}/policy/work-classification.json`),
  };
}
