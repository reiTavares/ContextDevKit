#!/usr/bin/env node
/**
 * Executable context manifest (CDK-052, PKG-05) — a DETERMINISTIC, METADATA-ONLY
 * map of the project's durable memory: which decisions, glossary terms, sessions,
 * project-map and playbooks EXIST and where they live. It answers "what context
 * is available for this objective?" WITHOUT reading a single file body — only
 * titles, ids, paths and counts cross the boundary.
 *
 * This is the NEW substrate other PKG-05 cards (and a future boot-hook activation)
 * may consume. It is advisory-first: this card ships the GENERATOR only and does
 * NOT inject into the SessionStart/boot hook — that is a separate, user-gated
 * activation. See the report for the exact (hook, config-flag) wiring.
 *
 * Hard guarantees (the contract downstream code relies on):
 *   - METADATA ONLY: never a file body, never source bytes, never prompt text.
 *   - DETERMINISTIC: same (root, objective) ⇒ byte-identical output. Fixed read
 *     order; stable sort by id/title/path; no `Date.now()`. The `signature` is a
 *     zero-dep string hash of the section contents (the map's identity), not time.
 *   - BOUNDED: at most {@link DEFAULT_CAP} total entries; an objective biases the
 *     selection toward entries whose title/path tokens overlap it.
 *   - FAIL-OPEN: any missing dir/file ⇒ that section is `[]` (or `null`); no throw.
 *
 * Usage:
 *   node contextkit/tools/scripts/context-manifest.mjs [objective...]        # print
 *   node contextkit/tools/scripts/context-manifest.mjs --write [objective...] # export
 */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { tokenize } from './memory-retrieve.mjs';
import {
  readDecisions,
  readSessions,
  readGlossary,
  readProjectMap,
  readPlaybooks,
} from './context-manifest-readers.mjs';

/** Manifest schema version — bump on a breaking shape change. */
export const MANIFEST_VERSION = 1;

/** Default hard cap on the TOTAL number of entries across all sections. */
export const DEFAULT_CAP = 50;

/**
 * Tiny zero-dep DJB2 string hash → 8-char hex. Used to derive the manifest
 * `signature` from its own content (NOT from a clock), so the same context yields
 * the same signature on every run. Not cryptographic — only a stable identity.
 *
 * @param {string} text
 * @returns {string} 8-char lowercase hex
 */
export function hashContent(text) {
  let hash = 5381;
  const str = String(text);
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // `>>> 0` coerces to an unsigned 32-bit int so the hex is stable across runs.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Score an entry against the objective tokens: number of tokens that appear as a
 * substring of the entry's title or path (lowercased). Zero when no objective.
 *
 * @param {{title?:string, path?:string}} entry
 * @param {string[]} tokens
 * @returns {number}
 */
function scoreEntry(entry, tokens) {
  if (!tokens.length) return 0;
  const hay = `${entry.title || ''} ${entry.path || ''}`.toLowerCase();
  return tokens.filter((t) => hay.includes(t)).length;
}

/**
 * Apply the objective bias + cap to a section's entries. SELECTION RULE:
 *   1. With an objective, entries are sorted by descending token-overlap score,
 *      then by the section's lexical key (id/title/path) for determinism.
 *   2. Without an objective (or for ties), entries keep their lexical order — for
 *      decisions/sessions that is ascending id (most-recent last but stable), for
 *      glossary/playbooks ascending term/path.
 * The cap is split proportionally is NOT used; instead a global cap is applied by
 * the caller after merging — see {@link resolveManifest}.
 *
 * @param {Array} entries
 * @param {string[]} tokens
 * @param {(e:any)=>string} keyOf lexical sort key for stable tie-breaking
 * @returns {Array}
 */
function biasSection(entries, tokens, keyOf) {
  return [...entries].sort((a, b) => scoreEntry(b, tokens) - scoreEntry(a, tokens) || keyOf(a).localeCompare(keyOf(b)));
}

/**
 * Resolve the full DETERMINISTIC, METADATA-ONLY context manifest for `root`.
 *
 * @param {string} root project root
 * @param {string} [objective] free-text objective to bias selection (optional)
 * @param {{cap?:number}} [options]
 * @returns {Promise<object>} the manifest (see module JSDoc for the schema)
 */
export async function resolveManifest(root, objective, options = {}) {
  const paths = pathsFor(root);
  const cap = Number.isInteger(options.cap) && options.cap > 0 ? options.cap : DEFAULT_CAP;
  const generatedFor = objective ? String(objective) : null;
  const tokens = tokenize(generatedFor || '');

  // Fixed read order (decisions → glossary → sessions → projectMap → playbooks).
  const [decisions, glossary, sessions, projectMap, playbooks] = await Promise.all([
    readDecisions(paths.decisions),
    readGlossary(paths.glossary),
    readSessions(paths.sessions),
    readProjectMap(paths.projectMap),
    readPlaybooks(paths.playbooks),
  ]);

  // Bias each list section toward the objective, then enforce the GLOBAL cap by
  // proportional round-robin so no single section starves the others.
  const sections = {
    decisions: biasSection(decisions, tokens, (e) => e.id || e.path),
    glossary: biasSection(glossary, tokens, (e) => e.term || e.path),
    sessions: biasSection(sessions, tokens, (e) => e.id || e.path),
    projectMap,
    playbooks: biasSection(playbooks, tokens, (e) => e.title || e.path),
  };
  applyGlobalCap(sections, cap);

  const signature = hashContent(JSON.stringify(stableForHash(sections)));
  return { version: MANIFEST_VERSION, generatedFor, cap, signature, sections };
}

/** The list sections in a fixed order — the round-robin trim order. */
const LIST_KEYS = ['decisions', 'sessions', 'glossary', 'playbooks'];

/**
 * Enforce the global entry cap across the list sections via round-robin, so the
 * total of all entries (plus 1 for a present projectMap) never exceeds `cap`.
 * Mutates `sections` in place. Deterministic: drops from the tail of each list.
 */
function applyGlobalCap(sections, cap) {
  const mapWeight = sections.projectMap ? 1 : 0;
  const budget = Math.max(0, cap - mapWeight);
  let total = LIST_KEYS.reduce((sum, k) => sum + sections[k].length, 0);
  // Trim round-robin from the largest sections until within budget.
  while (total > budget) {
    const longest = LIST_KEYS.filter((k) => sections[k].length > 0)
      .sort((a, b) => sections[b].length - sections[a].length || a.localeCompare(b))[0];
    if (!longest) break;
    sections[longest].pop();
    total -= 1;
  }
}

/** Normalize sections to a clock-free, order-stable shape for the signature hash. */
function stableForHash(sections) {
  return {
    decisions: sections.decisions.map((e) => `${e.id}|${e.title}|${e.path}`).sort(),
    glossary: sections.glossary.map((e) => `${e.term}|${e.path}`).sort(),
    sessions: sections.sessions.map((e) => `${e.id}|${e.title}|${e.path}`).sort(),
    projectMap: sections.projectMap ? `${sections.projectMap.manifestPath}|${sections.projectMap.moduleCount}` : null,
    playbooks: sections.playbooks.map((e) => `${e.title}|${e.path}`).sort(),
  };
}

/**
 * Render a manifest to a compact, inspectable markdown block. Metadata only —
 * the same guarantee as {@link resolveManifest}: ids, titles, paths, counts.
 *
 * @param {object} manifest the object returned by {@link resolveManifest}
 * @returns {string}
 */
export function renderManifest(manifest) {
  const { sections } = manifest;
  const lines = ['## 🗺️ Context manifest (metadata only — what exists & where)'];
  lines.push('', `_version ${manifest.version} · signature \`${manifest.signature}\` · cap ${manifest.cap}` +
    `${manifest.generatedFor ? ` · for: ${manifest.generatedFor}` : ''}_`);
  if (sections.decisions.length) {
    lines.push('', `**Decisions (${sections.decisions.length}):**`,
      ...sections.decisions.map((e) => `- **${e.id}** ${e.title} · \`${e.path}\``));
  }
  if (sections.sessions.length) {
    lines.push('', `**Sessions (${sections.sessions.length}):**`,
      ...sections.sessions.map((e) => `- **${e.id}** ${e.title} · \`${e.path}\``));
  }
  if (sections.glossary.length) {
    lines.push('', `**Glossary (${sections.glossary.length}):**`,
      ...sections.glossary.map((e) => `- ${e.term} · \`${e.path}\``));
  }
  if (sections.projectMap) {
    lines.push('', `**Project map:** ${sections.projectMap.moduleCount} modules · \`${sections.projectMap.manifestPath}\``);
  }
  if (sections.playbooks.length) {
    lines.push('', `**Playbooks (${sections.playbooks.length}):**`,
      ...sections.playbooks.map((e) => `- ${e.title} · \`${e.path}\``));
  }
  if (lines.length === 3) lines.push('', '_No context artifacts found._');
  return lines.join('\n');
}

/**
 * Export the manifest to `context-manifest.md` (+ `.json`) under the memory dir.
 * Atomic per file (write tmp + rename). Returns the markdown file path.
 *
 * @param {string} root
 * @param {string} [objective]
 * @param {{cap?:number}} [options]
 * @returns {Promise<string>} absolute path of the written markdown file
 */
export async function exportManifest(root, objective, options = {}) {
  const manifest = await resolveManifest(root, objective, options);
  const memoryDir = pathsFor(root).memory;
  await mkdir(memoryDir, { recursive: true });
  const mdPath = resolve(memoryDir, 'context-manifest.md');
  const jsonPath = resolve(memoryDir, 'context-manifest.json');
  await atomicWrite(mdPath, renderManifest(manifest) + '\n');
  await atomicWrite(jsonPath, JSON.stringify(manifest, null, 2) + '\n');
  return mdPath;
}

/** Atomic single-file write: tmp + rename, so a reader never sees a half file. */
async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, filePath);
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const objective = argv.filter((a) => a !== '--write').join(' ').trim() || undefined;
  if (write) {
    const out = await exportManifest(process.cwd(), objective);
    console.log(`✅ Context manifest written to ${out}`);
    return;
  }
  const manifest = await resolveManifest(process.cwd(), objective);
  console.log(renderManifest(manifest));
}

// CLI only when executed directly — this module is also importable by other cards.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('❌ context-manifest failed:', err?.message ?? err);
    process.exit(1);
  });
}
