#!/usr/bin/env node
/**
 * governance-digest.mjs — a query-first projection of the governance memory
 * (ADR-0132 §2, WF-0070). Aggregates EVERY entity kind — Business, Operations,
 * Workflows, ADRs, Sessions, Deliberations — into one read-optimized digest so
 * the AI (and a teammate) can answer "what is the state of this project?" from
 * the real record instead of hunting files.
 *
 * REUSE OVER REBUILD (ADR-0132, constitution rule 9): this is a PROJECTION, not a
 * new store. Business/Operations/Workflows/ADRs come from the three canonical
 * registries (`registry/{work-context,workflow,decision}.mjs`); Sessions and
 * Deliberations are read from their memory dirs. Nothing here re-parses what a
 * registry already models.
 *
 * Deterministic (stable id sort, no clock in the body) and FAIL-OPEN (constitution
 * §8 / immutable rule 2): a missing or unreadable registry/dir degrades that
 * section to a "none / skipped" note — never throws, never a false pass.
 *
 * Zero runtime dependencies (`node:*` only). CLI: dry-run to stdout by default;
 * `--write` atomically writes `_contextkit/governance-digest.{md,json}`.
 *
 * @module tools/scripts/governance-digest
 */
import { readdirSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { buildWorkContextRegistry } from './registry/work-context.mjs';
import { buildWorkflowRegistry } from './registry/workflow.mjs';
import { buildDecisionRegistry } from './registry/decision.mjs';

/** How many of the most-recent sessions to surface (the digest is an aid, not a dump). */
const RECENT_SESSIONS = 8;

/**
 * Safely runs a registry builder, returning its rows or [] on any failure
 * (fail-open — a broken registry degrades to an empty section, never a throw).
 * @param {() => any} build - a registry build function.
 * @param {string} key - the array property to read off the result.
 * @returns {any[]} the rows, or [] when unavailable.
 */
function safeRows(build, key) {
  try {
    const registry = build();
    const rows = registry && Array.isArray(registry[key]) ? registry[key] : [];
    return rows;
  } catch {
    return [];
  }
}

/**
 * Lists entries of a memory subdir, newest first by mtime, capped. Fail-open:
 * a missing/unreadable dir yields []. Dotfiles and `_TEMPLATE`/`.gitkeep` are skipped.
 * @param {string} dir - absolute directory path.
 * @param {number} [limit] - max entries to return (default: all).
 * @returns {Array<{ name: string, mtimeMs: number }>}
 */
function recentEntries(dir, limit) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    try {
      const stat = statSync(join(dir, name));
      rows.push({ name, mtimeMs: stat.mtimeMs });
    } catch {
      /* unreadable entry — skip (fail-open) */
    }
  }
  rows.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}

/**
 * Builds the structured digest model from the registries + memory dirs.
 * Pure-ish: reads disk, never writes, never throws (each source is fail-open).
 * @param {string} root - project root.
 * @returns {object} the digest model (all entity kinds).
 */
export function buildDigestModel(root = process.cwd()) {
  const paths = pathsFor(root);
  const contexts = safeRows(() => buildWorkContextRegistry(root), 'contexts');
  const business = contexts.filter((c) => c.type === 'business').sort(byId);
  const operations = contexts.filter((c) => c.type === 'operation').sort(byId);
  const workflows = safeRows(() => buildWorkflowRegistry(root), 'workflows').slice().sort(byId);
  const adrs = safeRows(() => buildDecisionRegistry(root), 'decisions').slice().sort(byId);
  const sessions = recentEntries(paths.sessions, RECENT_SESSIONS);
  const deliberations = recentEntries(paths.deliberations);
  return { business, operations, workflows, adrs, sessions, deliberations };
}

/** Stable id comparator (deterministic order regardless of disk order). */
function byId(left, right) {
  return String(left.id || left.name || '').localeCompare(String(right.id || right.name || ''));
}

/**
 * Renders the digest model to deterministic markdown. No clock in the body so
 * two calls with the same disk state are byte-identical (the CLI stamps the
 * generation time in a trailer only when writing).
 * @param {object} model - from {@link buildDigestModel}.
 * @returns {string} the digest markdown.
 */
export function renderDigest(model) {
  const lines = ['# Governance digest', '',
    '> Query-first projection of `contextkit/memory/` (ADR-0132). Reused from the',
    '> work-context / workflow / decision registries + the sessions & deliberations',
    '> dirs. Regenerate with `node contextkit/tools/scripts/governance-digest.mjs --write`.', ''];

  lines.push(`## Business (${model.business.length})`, '');
  lines.push(...listOrNone(model.business, (b) => `- **${b.id}** — ${b.title || b.path || '(untitled)'} · _${b.status || 'unknown'}_`));

  lines.push('', `## Operations (${model.operations.length})`, '');
  lines.push(...listOrNone(model.operations, (o) => `- **${o.id}** — ${o.title || o.path || '(untitled)'} · _${o.status || 'unknown'}_`));

  lines.push('', `## Workflows (${model.workflows.length})`, '');
  lines.push(...listOrNone(model.workflows, (w) => {
    const owner = w.owner ? ` · owner ${w.owner}` : '';
    const title = w.title || w.slug || '(untitled)';
    return `- **${w.id}** — ${title} · _${w.status || 'unknown'}_${owner}`;
  }));

  lines.push('', `## ADRs (${model.adrs.length})`, '');
  lines.push(...listOrNone(dedupeById(model.adrs), (a) => `- **${a.id}** — ${a.title || '(untitled)'} · _${a.status || a.legacyStatus || 'unknown'}_`));

  lines.push('', `## Recent sessions (${model.sessions.length})`, '');
  lines.push(...listOrNone(model.sessions, (s) => `- ${s.name}`));

  lines.push('', `## Deliberations (${model.deliberations.length})`, '');
  lines.push(...listOrNone(model.deliberations, (d) => `- ${d.name}`));

  lines.push('');
  return lines.join('\n');
}

/** Renders each row, or a single "_none_" line when the list is empty. */
function listOrNone(rows, render) {
  if (!rows || rows.length === 0) return ['_none_'];
  return rows.map(render);
}

/**
 * Collapses duplicate ADR ids (the decision registry can list the same id under
 * multiple paths, e.g. a legacy + migrated copy). Keeps the first occurrence in
 * the already-sorted list, so output stays deterministic.
 * @param {any[]} rows - id-sorted ADR rows.
 * @returns {any[]} rows with duplicate ids removed.
 */
function dedupeById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * Builds and renders the digest for `root`. The single entry point used by both
 * the CLI and the selfcheck.
 * @param {string} [root] - project root.
 * @returns {string} the digest markdown.
 */
export function generateDigest(root = process.cwd()) {
  return renderDigest(buildDigestModel(root));
}

/**
 * Atomically writes the digest (markdown + structured JSON) under `_contextkit/`.
 * Creates the dir if needed. tmp + rename so a reader never sees a half-written
 * file. Best-effort: throws only on a genuine I/O failure the caller should see.
 * @param {string} root - project root.
 * @returns {{ md: string, json: string }} the written file paths.
 */
export function writeDigest(root = process.cwd()) {
  const dir = join(root, '_contextkit');
  mkdirSync(dir, { recursive: true });
  const model = buildDigestModel(root);
  const md = renderDigest(model);
  const mdPath = join(dir, 'governance-digest.md');
  const jsonPath = join(dir, 'governance-digest.json');
  const stamp = new Date().toISOString();
  atomicWrite(mdPath, `${md}\n<!-- generated ${stamp} -->\n`);
  atomicWrite(jsonPath, `${JSON.stringify({ generatedAt: stamp, ...model }, null, 2)}\n`);
  return { md: mdPath, json: jsonPath };
}

/** Writes `text` to `path` via a tmp file + rename (atomic on the same fs). */
function atomicWrite(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf-8');
  renameSync(tmp, path);
}

// CLI — dry-run (stdout) by default; --write persists under _contextkit/.
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/').split('/').pop() || '')) {
  const root = process.cwd();
  if (process.argv.includes('--write')) {
    const { md, json } = writeDigest(root);
    console.log(`✓ governance digest written:\n  ${md}\n  ${json}`);
  } else {
    process.stdout.write(generateDigest(root));
  }
}
