#!/usr/bin/env node
/**
 * Playbook scope filter (CDK-053 / PKG-05).
 *
 * Extends the playbook registry with phase- and squad-scoped lookups. Playbooks
 * may declare their own `phases:` and `squads:` via simple YAML frontmatter at
 * the top of the `.md` file. This module parses that frontmatter with zero
 * external dependencies and exposes filtered views of the registry.
 *
 * Usage (CLI):
 *   node contextkit/tools/scripts/playbook-scope.mjs phase <phase>
 *   node contextkit/tools/scripts/playbook-scope.mjs squad <squad>
 *
 * Exported API (consumed by callers who already know the playbooks root):
 *   parsePlaybookMeta(text)         → { phases: string[], squads: string[] }
 *   playbooksByPhase(root, phase)   → [{file, title, phases, squads}]
 *   playbooksBySquad(root, squad)   → [{file, title, phases, squads}]
 *
 * Design notes:
 * - Fail-open on every I/O error: a missing dir, unreadable file, or malformed
 *   frontmatter yields an empty result rather than an uncaught exception.
 * - Unknown phase / squad → [] (not a throw) — the caller decides whether to
 *   treat "no playbooks found" as an error in their context.
 * - No yaml dependency. The frontmatter format is intentionally tiny: a leading
 *   `---` block with `phases:` / `squads:` list items (`- value`). Nothing
 *   else in the block is parsed; extra YAML keys are silently ignored.
 *
 * Zero third-party deps.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Extracts `phases` and `squads` from a simple YAML frontmatter block.
 *
 * Accepted block format (must appear at the very top of the file):
 *   ---
 *   phases:
 *     - adr
 *     - spec
 *   squads:
 *     - devteam
 *   ---
 *
 * Rules:
 * - The opening `---` must be on the first non-empty line.
 * - The closing `---` ends the block; everything after is ignored.
 * - Only list items under `phases:` and `squads:` keys are extracted.
 * - An item value is the trimmed string after the leading `- `.
 * - No frontmatter, or malformed block → `{ phases: [], squads: [] }`.
 *
 * @param {string} text - Raw file content.
 * @returns {{ phases: string[], squads: string[] }}
 */
export function parsePlaybookMeta(text) {
  const emptyResult = { phases: [], squads: [] };
  if (typeof text !== 'string') return emptyResult;

  const lines = text.split(/\r?\n/);

  // Find the opening delimiter — must be the first non-empty line.
  let startIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;
    if (trimmed === '---') {
      startIndex = i;
    }
    break;
  }
  if (startIndex === -1) return emptyResult;

  // Find the closing `---` that ends the frontmatter block.
  let endIndex = -1;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return emptyResult;

  const block = lines.slice(startIndex + 1, endIndex);

  const phases = /** @type {string[]} */ ([]);
  const squads = /** @type {string[]} */ ([]);

  /** @type {'phases' | 'squads' | null} */
  let activeKey = null;

  for (const raw of block) {
    const line = raw.trimEnd();

    // Key line — switches the collection target.
    if (/^\s*phases\s*:\s*$/.test(line)) {
      activeKey = 'phases';
      continue;
    }
    if (/^\s*squads\s*:\s*$/.test(line)) {
      activeKey = 'squads';
      continue;
    }

    // A new unrecognised key resets collection (defensive).
    if (/^\s*\w[\w-]*\s*:/.test(line) && !/^\s*-\s/.test(line)) {
      activeKey = null;
      continue;
    }

    // List item under the active key.
    const itemMatch = /^\s*-\s+(.+)$/.exec(line);
    if (itemMatch && activeKey) {
      const value = itemMatch[1].trim();
      if (value) {
        (activeKey === 'phases' ? phases : squads).push(value);
      }
    }
  }

  return { phases, squads };
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

/**
 * All playbook `.md` files found in `playbooksDir`, sorted alphabetically.
 *
 * @param {string} playbooksDir - Absolute path to the playbooks directory.
 * @returns {string[]} Sorted file names.
 */
function listPlaybookFiles(playbooksDir) {
  try {
    return readdirSync(playbooksDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Returns the first `# ` heading in a playbook file as the human title.
 * Falls back to the bare file name when no heading is found.
 *
 * @param {string} playbooksDir
 * @param {string} file
 * @returns {string}
 */
function titleOf(playbooksDir, file) {
  try {
    const heading = readFileSync(join(playbooksDir, file), 'utf-8')
      .split('\n')
      .find((l) => l.startsWith('# '));
    return heading ? heading.replace(/^#\s+/, '').trim() : file;
  } catch {
    return file;
  }
}

/**
 * Reads and indexes all playbooks under `playbooksDir`, extracting frontmatter
 * metadata for each. Defensive: silently skips unreadable files.
 *
 * @param {string} playbooksDir - Absolute path to the playbooks directory.
 * @returns {Array<{ file: string, title: string, phases: string[], squads: string[] }>}
 */
function indexPlaybooks(playbooksDir) {
  const files = listPlaybookFiles(playbooksDir);
  /** @type {Array<{ file: string, title: string, phases: string[], squads: string[] }>} */
  const entries = [];

  for (const file of files) {
    let text = '';
    try {
      text = readFileSync(join(playbooksDir, file), 'utf-8');
    } catch {
      // Unreadable file — degrade gracefully.
    }
    const { phases, squads } = parsePlaybookMeta(text);
    entries.push({ file, title: titleOf(playbooksDir, file), phases, squads });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Public filtering API
// ---------------------------------------------------------------------------

/**
 * Returns every playbook whose declared `phases` list includes `phase`.
 * Unknown or empty phase → `[]` (not a throw).
 *
 * @param {string} playbooksDir - Absolute path to the playbooks directory.
 * @param {string} phase - Phase name to filter by (e.g. `"adr"`, `"ship"`).
 * @returns {Array<{ file: string, title: string, phases: string[], squads: string[] }>}
 */
export function playbooksByPhase(playbooksDir, phase) {
  if (!phase || typeof phase !== 'string') return [];
  try {
    return indexPlaybooks(playbooksDir).filter((pb) => pb.phases.includes(phase));
  } catch {
    return [];
  }
}

/**
 * Returns every playbook whose declared `squads` list includes `squad`.
 * Unknown or empty squad → `[]` (not a throw).
 *
 * @param {string} playbooksDir - Absolute path to the playbooks directory.
 * @param {string} squad - Squad name to filter by (e.g. `"devteam"`, `"qa-team"`).
 * @returns {Array<{ file: string, title: string, phases: string[], squads: string[] }>}
 */
export function playbooksBySquad(playbooksDir, squad) {
  if (!squad || typeof squad !== 'string') return [];
  try {
    return indexPlaybooks(playbooksDir).filter((pb) => pb.squads.includes(squad));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Formats a filtered list for terminal output.
 *
 * @param {Array<{ file: string, title: string, phases: string[], squads: string[] }>} items
 * @param {string} label - Heading label (e.g. "phase: adr").
 */
function printList(items, label) {
  if (items.length === 0) {
    console.log(`No playbooks found for ${label}.`);
    return;
  }
  console.log(`Playbooks for ${label} (${items.length}):\n`);
  for (const { file, title, phases, squads } of items) {
    const slug = file.replace(/\.md$/, '');
    const meta = [
      phases.length ? `phases: ${phases.join(', ')}` : '',
      squads.length ? `squads: ${squads.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    console.log(`  ${slug} — ${title}`);
    if (meta) console.log(`    [${meta}]`);
  }
}

async function main() {
  // Resolve the playbooks directory relative to the project root (cwd), mirroring
  // how playbook.mjs uses pathsFor(ROOT).playbooks.
  const { pathsFor } = await import('../../runtime/config/paths.mjs');
  const P = pathsFor(process.cwd());

  const [cmd, value] = process.argv.slice(2);

  if (cmd === 'phase') {
    printList(playbooksByPhase(P.playbooks, value), `phase: ${value ?? '(none)'}`);
    return;
  }
  if (cmd === 'squad') {
    printList(playbooksBySquad(P.playbooks, value), `squad: ${value ?? '(none)'}`);
    return;
  }

  console.error('Usage: playbook-scope.mjs phase <phase> | squad <squad>');
  process.exit(1);
}

// Top-level await is available in ESM; keep main() async for the dynamic import.
main().catch((err) => {
  console.error(`playbook-scope: unexpected error — ${err?.message ?? err}`);
  // Fail-open: exit 0 so we never block real work on a scope-filter failure.
});
