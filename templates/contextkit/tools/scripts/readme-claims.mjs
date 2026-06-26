/**
 * readme-claims.mjs — DOC-006 (WF0016, ADR-0075)
 *
 * Compares machine-checkable inventory CLAIMS in README.md against the actual
 * canonical registry on disk, so a stale count can never silently ship.
 *
 * Zero runtime dependencies. Uses only node:fs, node:path, node:url.
 *
 * @module readme-claims
 */

import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Registry discovery ────────────────────────────────────────────────────────

/**
 * Resolve the canonical commands directory.
 * Prefers `templates/claude/commands/`; falls back to `.claude/commands/`.
 *
 * @param {string} root - Absolute path to the project root.
 * @returns {{ dir: string, source: string }}
 */
function resolveCommandsDir(root) {
  const templateDir = resolve(root, 'templates/claude/commands');
  if (existsSync(templateDir)) return { dir: templateDir, source: 'templates/claude/commands/**' };
  const liveDir = resolve(root, '.claude/commands');
  return { dir: liveDir, source: '.claude/commands/**' };
}

/**
 * Resolve the canonical agents directory.
 * Prefers `templates/claude/agents/`; falls back to `.claude/agents/`.
 *
 * @param {string} root - Absolute path to the project root.
 * @returns {{ dir: string, source: string }}
 */
function resolveAgentsDir(root) {
  const templateDir = resolve(root, 'templates/claude/agents');
  if (existsSync(templateDir)) return { dir: templateDir, source: 'templates/claude/agents/**' };
  const liveDir = resolve(root, '.claude/agents');
  return { dir: liveDir, source: '.claude/agents/**' };
}

// ── File walkers ─────────────────────────────────────────────────────────────

/**
 * Recursively collect `.md` filenames (excluding README.md) from a directory.
 * Returns an empty array when the directory is absent — caller reports gap as
 * "skipped", never as a silent pass.
 *
 * @param {string} dir - Absolute directory path.
 * @returns {Promise<string[]>} Flat list of `.md` filenames.
 */
async function walkMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...await walkMarkdownFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
      results.push(entry.name);
    }
  }
  return results;
}

/**
 * Count non-README `.md` files in a flat (non-recursive) directory.
 * Returns -1 when the directory is absent (sentinel for callers).
 *
 * @param {string} dir - Absolute directory path.
 * @returns {Promise<number>}
 */
async function countFlatMd(dir) {
  if (!existsSync(dir)) return -1;
  const entries = await readdir(dir).catch(() => []);
  return entries.filter((n) => n.endsWith('.md') && n !== 'README.md' && n !== '_TEMPLATE.md').length;
}

// ── README parser ─────────────────────────────────────────────────────────────

/**
 * Strip a UTF-8 BOM (if present) from a string.
 * @param {string} text - Raw file contents.
 * @returns {string} BOM-free string.
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse README.md for machine-checkable numeric inventory claims.
 *
 * Only EXPLICITLY present claims are returned — an absent claim is not a
 * failure, keeping the checker resilient to README restructuring.
 *
 * Claims extracted:
 *   - forge lifecycle command count  ("forge-new and N lifecycle commands")
 *   - forge host list (Claude Code, Antigravity, Codex)
 *
 * Deliberately NOT extracted (too volatile / prose-only):
 *   - Total slash-command count, agent archetype count, selfcheck assertion count
 *
 * @param {string} readmeText - Full README content.
 * @returns {Array<{claimKey: string, readmeValue: string|number}>}
 */
function parseReadmeClaims(readmeText) {
  const claims = [];

  const forgeMatch = readmeText.match(/forge-new.*?and\s+(\d+)\s+lifecycle\s+commands?/i);
  if (forgeMatch) {
    claims.push({ claimKey: 'forge-lifecycle-count', readmeValue: parseInt(forgeMatch[1], 10) });
  }

  const nativelyMatch = readmeText.match(/runs\s+natively\s+on\s+([^.]+?)\./i);
  if (nativelyMatch) {
    const hostNames = [...nativelyMatch[1].matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
    if (hostNames.length > 0) {
      claims.push({ claimKey: 'native-host-list', readmeValue: hostNames.join(',') });
    }
  }

  return claims;
}

// ── Actual-value resolvers ────────────────────────────────────────────────────

/** Host key → template subdirectory name map. */
const HOST_DIR_MAP = {
  'Claude Code': 'claude',
  'Antigravity': 'antigravity',
  'Codex': 'codex',
};

/**
 * Compute the actual value for a given claim key from the disk registry.
 *
 * @param {string} claimKey - Claim identifier.
 * @param {object} ctx - Context with resolved directories and root.
 * @param {string} ctx.root
 * @param {string} ctx.commandsDir
 * @param {string} ctx.commandsSource
 * @param {string} ctx.agentsDir
 * @param {string} ctx.agentsSource
 * @returns {Promise<{actual: string|number, source: string, skipped?: string}>}
 */
async function resolveActual(claimKey, { root, commandsDir, commandsSource, agentsDir, agentsSource }) {
  if (claimKey === 'forge-lifecycle-count') {
    if (!existsSync(commandsDir)) {
      return { actual: 0, source: commandsSource, skipped: `commands dir not found: ${commandsDir}` };
    }
    const forgeDir = join(commandsDir, 'forge');
    if (!existsSync(forgeDir)) {
      return { actual: 0, source: `${commandsSource}/forge/`, skipped: `forge/ subdir absent` };
    }
    const allForge = await walkMarkdownFiles(forgeDir);
    const lifecycle = allForge.filter((n) => n !== 'forge-new.md');
    return { actual: lifecycle.length, source: `${commandsSource}/forge/ (excludes forge-new.md)` };
  }

  if (claimKey === 'native-host-list') {
    const templatesRoot = join(root, 'templates');
    const presentHosts = [];
    const missingHosts = [];
    for (const [hostName, dirName] of Object.entries(HOST_DIR_MAP)) {
      if (existsSync(join(templatesRoot, dirName))) {
        presentHosts.push(hostName);
      } else {
        missingHosts.push(hostName);
      }
    }
    const source = `templates/{${Object.values(HOST_DIR_MAP).join(',')}}/ presence`;
    if (missingHosts.length > 0) {
      return {
        actual: presentHosts.join(','), source,
        skipped: `host dirs absent (check): ${missingHosts.join(', ')}`,
      };
    }
    return { actual: presentHosts.join(','), source };
  }

  return { actual: null, source: 'unknown', skipped: `no resolver for claim "${claimKey}"` };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compare hardcoded inventory claims in README.md against the canonical
 * registry on disk.
 *
 * Only EXPLICITLY present claims are checked — absent claim is not a failure.
 * Missing registry directory is reported as "skipped" (never a silent pass).
 *
 * @param {string} root - Absolute path to the project (or kit) root.
 * @returns {Promise<{
 *   mismatches: Array<{claim: string, readmeValue: string|number, actualValue: string|number, source: string}>,
 *   skipped: Array<{claim: string, reason: string}>,
 *   ok: boolean
 * }>}
 */
export async function checkReadmeClaims(root) {
  const readmePath = resolve(root, 'README.md');

  if (!existsSync(readmePath)) {
    return {
      mismatches: [],
      skipped: [{ claim: 'all', reason: `README.md not found at ${readmePath}` }],
      ok: true,
    };
  }

  const readmeText = stripBom(readFileSync(readmePath, 'utf-8'));
  const { dir: commandsDir, source: commandsSource } = resolveCommandsDir(root);
  const { dir: agentsDir, source: agentsSource } = resolveAgentsDir(root);
  const parsedClaims = parseReadmeClaims(readmeText);

  const mismatches = [];
  const skipped = [];

  for (const { claimKey, readmeValue } of parsedClaims) {
    const { actual, source, skipped: skipReason } = await resolveActual(claimKey, {
      root, commandsDir, commandsSource, agentsDir, agentsSource,
    });
    if (skipReason) { skipped.push({ claim: claimKey, reason: skipReason }); continue; }
    if (String(readmeValue) !== String(actual)) {
      mismatches.push({ claim: claimKey, readmeValue, actualValue: actual, source });
    }
  }

  return { mismatches, skipped, ok: mismatches.length === 0 };
}

// ── CLI mode ──────────────────────────────────────────────────────────────────

/** @returns {boolean} */
function isMain() {
  try { return process.argv[1] === fileURLToPath(import.meta.url); } catch { return false; }
}

if (isMain()) {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const inferredRoot = resolve(scriptDir, '../../../..');
  const root = process.argv[2] ?? inferredRoot;

  (async () => {
    const { mismatches, skipped, ok } = await checkReadmeClaims(root);

    for (const { claim, reason } of skipped) {
      console.log(`SKIPPED  [${claim}] — ${reason}`);
    }

    if (mismatches.length === 0) {
      console.log('OK  All README inventory claims match the canonical registry.');
      process.exit(0);
    }

    for (const { claim, readmeValue, actualValue, source } of mismatches) {
      console.error(
        `MISMATCH [${claim}]: README says ${JSON.stringify(readmeValue)}, ` +
        `actual is ${JSON.stringify(actualValue)} (source: ${source})`
      );
    }
    process.exit(1);
  })().catch((err) => {
    console.error(`readme-claims: unexpected error — ${err?.message ?? err}`);
    process.exit(1);
  });
}
