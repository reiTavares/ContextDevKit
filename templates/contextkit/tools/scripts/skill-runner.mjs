#!/usr/bin/env node
/**
 * CDK-060 — Skill runner: capability-registry resolver for the Claude native host.
 *
 * Read-only. Resolves each registered capability to its Claude invocation alias
 * and entrypoint. NEVER spawns or executes anything — dispatch is the caller's
 * responsibility. Fail-open: any I/O error → "skipped" note, exit 0.
 *
 * Importable API:
 *   listSkills(registry)   → SkillEntry[]
 *   resolveSkill(id, reg)  → SkillEntry | null
 *
 * CLI:
 *   node skill-runner.mjs list
 *   node skill-runner.mjs resolve <id>
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Module bootstrap — resolve the capabilities module relative to this file
// so no 'contextkit/...' literal is hardcoded in resolve()/join() calls.
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the capabilities resolver, relative to this module. */
const CAPABILITIES_PATH = resolve(__dirname, '../../runtime/capabilities/resolve-capabilities.mjs');

/**
 * Lazily-populated module cache so CLI and API share one import call.
 * @type {{ loadRegistry: Function, DEFAULT_REGISTRY: object } | null}
 */
let _capabilitiesModule = null;

/**
 * Loads the capabilities module on first call, then returns the cached copy.
 * Never throws — returns null and emits a warning if the module is unavailable.
 *
 * @returns {Promise<{ loadRegistry: Function, DEFAULT_REGISTRY: object } | null>}
 */
async function getCapabilitiesModule() {
  if (_capabilitiesModule !== null) return _capabilitiesModule;
  try {
    const { pathToFileURL } = await import('node:url');
    _capabilitiesModule = await import(pathToFileURL(CAPABILITIES_PATH).href);
    return _capabilitiesModule;
  } catch (importError) {
    console.error(`[skill-runner] skipped: cannot load capabilities module — ${importError?.message ?? importError}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Typed shapes (JSDoc only — no runtime overhead)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SkillEntry
 * @property {string} id                - Capability id from the registry.
 * @property {string} claudeInvocation  - The Claude slash-command alias (e.g. '/state').
 * @property {string} entrypoint        - Script entrypoint path as declared in registry.
 * @property {number} minLevel          - Minimum ContextDevKit level required.
 * @property {string[]} [prerequisites] - Ids of capabilities that must run first.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns every capability in the registry that carries a Claude alias,
 * sorted by id (stable/deterministic — mirrors resolveCapabilities ordering).
 *
 * @param {object} registry - Capability registry object (version + capabilities[]).
 * @returns {SkillEntry[]}
 */
export function listSkills(registry) {
  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  return capabilities
    .filter(hasClaudeAlias)
    .map(toSkillEntry)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Resolves a single capability by id. Returns the full SkillEntry when found,
 * or null when the id is absent from the registry (fail-open — never throws).
 *
 * RESOLVE ONLY — this function never spawns, executes, or schedules anything.
 *
 * @param {string} skillId  - The capability id to look up.
 * @param {object} registry - Capability registry object (version + capabilities[]).
 * @returns {SkillEntry | null}
 */
export function resolveSkill(skillId, registry) {
  if (typeof skillId !== 'string' || skillId.length === 0) return null;
  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  const found = capabilities.find((cap) => cap?.id === skillId && hasClaudeAlias(cap));
  return found ? toSkillEntryFull(found) : null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a registry entry has a non-empty Claude alias.
 *
 * @param {object} entry - Raw capability registry entry.
 * @returns {boolean}
 */
function hasClaudeAlias(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.aliases?.claude === 'string' &&
    entry.aliases.claude.length > 0 &&
    typeof entry.entrypoint === 'string' &&
    entry.entrypoint.length > 0
  );
}

/**
 * Maps a registry entry to the minimal SkillEntry shape (list view).
 *
 * @param {object} entry - Raw capability registry entry (pre-validated by hasClaudeAlias).
 * @returns {SkillEntry}
 */
function toSkillEntry(entry) {
  return {
    id: String(entry.id),
    claudeInvocation: entry.aliases.claude,
    entrypoint: entry.entrypoint,
    minLevel: typeof entry.minLevel === 'number' ? entry.minLevel : 1,
  };
}

/**
 * Maps a registry entry to the full SkillEntry shape (resolve view, includes prerequisites).
 *
 * @param {object} entry - Raw capability registry entry (pre-validated by hasClaudeAlias).
 * @returns {SkillEntry}
 */
function toSkillEntryFull(entry) {
  return {
    ...toSkillEntry(entry),
    prerequisites: Array.isArray(entry.prerequisites) ? entry.prerequisites : [],
  };
}

// ---------------------------------------------------------------------------
// CLI rendering helpers
// ---------------------------------------------------------------------------

/**
 * Renders the full skills list as an aligned text table.
 *
 * @param {SkillEntry[]} skills - Sorted skill entries from listSkills().
 */
function printSkillTable(skills) {
  if (skills.length === 0) {
    console.log('  (no skills with Claude aliases found in registry)');
    return;
  }
  const header = `${'ID'.padEnd(20)} ${'CLAUDE INVOCATION'.padEnd(22)} ${'MIN-L'.padEnd(6)} ENTRYPOINT`;
  const rule = '-'.repeat(header.length);
  console.log(`\n${header}\n${rule}`);
  for (const skill of skills) {
    const lvl = String(skill.minLevel).padEnd(6);
    console.log(`${skill.id.padEnd(20)} ${skill.claudeInvocation.padEnd(22)} ${lvl} ${skill.entrypoint}`);
  }
  console.log('');
}

/**
 * Renders a single skill resolution as labeled key-value output.
 *
 * @param {SkillEntry} skill - The resolved SkillEntry.
 */
function printSkillResolution(skill) {
  console.log(`\n  id               : ${skill.id}`);
  console.log(`  claudeInvocation : ${skill.claudeInvocation}`);
  console.log(`  entrypoint       : ${skill.entrypoint}`);
  console.log(`  minLevel         : ${skill.minLevel}`);
  if (skill.prerequisites && skill.prerequisites.length > 0) {
    console.log(`  prerequisites    : ${skill.prerequisites.join(', ')}`);
  } else {
    console.log('  prerequisites    : (none)');
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Runs the CLI when this module is the direct entrypoint.
 * Exits 0 in all cases (fail-open); reports "skipped" on missing data.
 */
async function runCli() {
  const [, , command, ...args] = process.argv;

  if (command !== 'list' && command !== 'resolve') {
    console.error('  Usage: node skill-runner.mjs list');
    console.error('         node skill-runner.mjs resolve <id>');
    process.exit(0);
  }

  const mod = await getCapabilitiesModule();
  if (!mod) {
    console.error('  [skill-runner] skipped: capabilities module unavailable.');
    process.exit(0);
  }

  const { loadRegistry } = mod;
  let registry;
  try {
    registry = loadRegistry(process.cwd());
  } catch (loadError) {
    console.error(`  [skill-runner] skipped: registry load failed — ${loadError?.message ?? loadError}`);
    process.exit(0);
  }

  if (command === 'list') {
    const skills = listSkills(registry);
    console.log(`\n  Native Claude skills (${skills.length} total)\n`);
    printSkillTable(skills);
    return;
  }

  // command === 'resolve'
  const targetId = args[0];
  if (typeof targetId !== 'string' || targetId.length === 0) {
    console.error('  [skill-runner] skipped: resolve requires an <id> argument.');
    process.exit(0);
  }

  const resolved = resolveSkill(targetId, registry);
  if (resolved === null) {
    console.log(`\n  [skill-runner] unknown skill: '${targetId}' — not found in registry.\n`);
    process.exit(0);
  }

  console.log(`\n  Resolved skill: ${resolved.id}`);
  printSkillResolution(resolved);
}

// Run CLI only when invoked directly (not when imported as a module).
const isDirectEntrypoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectEntrypoint) {
  runCli().catch((fatalError) => {
    console.error(`[skill-runner] fatal: ${fatalError?.message ?? fatalError}`);
    process.exit(0); // fail-open
  });
}
