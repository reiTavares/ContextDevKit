/**
 * Workflow Registry (BIZ-0001 / WF-0036 — A1-T3 foundation + A4-T1 resolver).
 *
 * Scans EVERY workflow root (new top-level `memory/workflows/` plus per-context
 * workflows/ folders under business/ and operations/) and emits a generated,
 * sorted index of both formats (compatibility-plan §"Dual resolution"):
 *  - **new**   `WF-####-slug` dirs (meta from workflow-plan/state json);
 *  - **legacy** `NNNN-slug` dirs (status parsed from index.md; UNCHANGED).
 *
 * A1-T3 seam: `buildWorkflowRegistry` + the in-memory `resolveWorkflow(registry,
 * idOrSlug)` form + `writeWorkflowRegistry`.
 *
 * A4-T1 additions (frozen interface contract):
 *  - `resolveWorkflow(idOrSlug, root)` — disk-walking cross-root resolver; also
 *    accepts the legacy `(registry, idOrSlug)` signature for backward compat with
 *    the A1-T3 selftest; detects call form from the type of the first argument.
 *  - `detectWorkflowCollisions(root)` — duplicate-id + duplicate-path detection
 *    scanning every root; returns `{ duplicateIds: [], duplicatePaths: [] }`.
 *
 * Index, never primary state (source-of-truth-policy). Rebuild is byte-idempotent.
 * Pure `node:*`, zero runtime dependencies.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { stripBom } from '../../../runtime/work/enums.mjs';
import { serializeRegistry } from './serialize.mjs';
import { workflowRoots } from './ids.mjs';
import { writeFileAtomicSync } from '../../../runtime/hooks/safe-io.mjs';

/** Schema version of the emitted workflow-registry.json. */
export const WORKFLOW_REGISTRY_VERSION = 1;

const NEW_RE = /^(WF-\d{4})-(.+)$/;
const LEGACY_RE = /^(\d{4})-(.+)$/;

/** Child dir names under `dir`, excluding templates; [] when `dir` is absent. */
function workflowFolders(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_TEMPLATE')
    .map((entry) => entry.name);
}

/** Defensive JSON read of a workflow pack file; {} when missing/unreadable. */
function readPackJson(dir, folder, file) {
  const target = resolve(dir, folder, file);
  if (!existsSync(target)) return {};
  try {
    return JSON.parse(stripBom(readFileSync(target, 'utf-8'))) || {};
  } catch {
    return {};
  }
}

/** First `**Status:**` / `Status:` value from a legacy index.md, or null. */
function legacyStatus(dir, folder) {
  const indexPath = resolve(dir, folder, 'index.md');
  if (!existsSync(indexPath)) return null;
  try {
    const match = readFileSync(indexPath, 'utf-8').match(/^\**Status:\**\s*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Derives the owner id (`BIZ-####` or `OP-####`) from an absolute dir path, or
 * null for the top-level workflows root (which holds legacy + unowned new WFs).
 * Owner-detection is path-based and never reads files — pure string parsing.
 *
 * @param {string} dir - absolute path of the workflow-containing directory.
 * @param {object} paths - result of `pathsFor(root)`.
 * @returns {string|null}
 */
function ownerFromDir(dir, paths) {
  const forward = dir.split('\\').join('/');
  const bizFwd = paths.business.split('\\').join('/');
  const opsFwd = paths.operations.split('\\').join('/');
  const bizMatch = forward.match(new RegExp(`${escapeRe(bizFwd)}/(BIZ-\\d{4}-[^/]+)/`));
  if (bizMatch) return bizMatch[1].match(/^(BIZ-\d{4})/)[1];
  const opsMatch = forward.match(new RegExp(`${escapeRe(opsFwd)}/(OP-\\d{4}-[^/]+)/`));
  if (opsMatch) return opsMatch[1].match(/^(OP-\d{4})/)[1];
  return null;
}

/** Escapes a string for safe use as a regex literal. */
function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds one index row for a new `WF-####` workflow folder. */
function newRow(dir, folder, id, slug, rel, paths) {
  const plan = readPackJson(dir, folder, 'workflow-plan.json');
  const state = readPackJson(dir, folder, 'workflow-state.json');
  const owner = ownerFromDir(resolve(dir, folder), paths);
  return {
    id,
    slug: plan.slug ?? slug,
    path: rel,
    format: 'new',
    status: state.overallStatus ?? null,
    title: plan.title ?? null,
    owner,
    origin: plan.origin ?? owner,
  };
}

/** Builds one index row for a legacy `NNNN-slug` workflow folder. */
function legacyRow(dir, folder, number, slug, rel) {
  return {
    id: number,
    slug,
    path: rel,
    format: 'legacy',
    status: legacyStatus(dir, folder),
    title: null,
    owner: null,
    origin: null,
  };
}

/** Indexes every workflow folder under one root into rows (new + legacy). */
function indexWorkflowRoot(dir, memoryDir, paths) {
  const rows = [];
  for (const folder of workflowFolders(dir)) {
    const rel = resolve(dir, folder).slice(memoryDir.length + 1).split('\\').join('/');
    const asNew = folder.match(NEW_RE);
    if (asNew) {
      rows.push(newRow(dir, folder, asNew[1], asNew[2], rel, paths));
      continue;
    }
    const asLegacy = folder.match(LEGACY_RE);
    if (asLegacy) rows.push(legacyRow(dir, folder, asLegacy[1], asLegacy[2], rel));
  }
  return rows;
}

/**
 * Builds the workflow-registry payload across all roots, sorted by id.
 * Pure: scans disk, returns the object, writes nothing.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {object} `{ schemaVersion, generator, workflows }`.
 */
export function buildWorkflowRegistry(root = process.cwd()) {
  const paths = pathsFor(root);
  const memoryDir = paths.memory;
  const workflows = workflowRoots(root)
    .flatMap((dir) => indexWorkflowRoot(dir, memoryDir, paths))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: WORKFLOW_REGISTRY_VERSION,
    generator: 'registry/workflow.mjs',
    workflows,
  };
}

/**
 * Resolves a workflow by id or slug, walking every workflow root on disk.
 *
 * **A4-T1 (new form — disk-walking):** `resolveWorkflow(idOrSlug, root?)`
 *   Scans all roots from `workflowRoots(root)`, returns the first matching row
 *   as `{ id, format, path, owner, origin }`, or null when not found.
 *
 * **Backward-compat (A1-T3 in-memory form):** `resolveWorkflow(registry, idOrSlug)`
 *   When the first argument is an object with a `workflows` array, the old
 *   in-memory search is used — preserving the selftest contract exactly.
 *
 * The frozen A4-T1 interface contract is:
 *   `resolveWorkflow(idOrSlug: string, root?: string) → { id, format, path, owner, origin } | null`
 *
 * @param {string|object} idOrSlugOrRegistry - workflow id/slug, OR a registry object (legacy form).
 * @param {string} [rootOrSlug] - project root when using the new form; or id/slug when using the legacy form.
 * @returns {{ id: string, format: 'new'|'legacy', path: string, owner: string|null, origin: string|null }|null}
 */
export function resolveWorkflow(idOrSlugOrRegistry, rootOrSlug) {
  // Legacy backward-compat form: resolveWorkflow(registry, idOrSlug).
  if (idOrSlugOrRegistry !== null && typeof idOrSlugOrRegistry === 'object' && Array.isArray(idOrSlugOrRegistry.workflows)) {
    const idOrSlug = rootOrSlug;
    if (!idOrSlug) return null;
    const hit = idOrSlugOrRegistry.workflows.find((row) => row.id === idOrSlug || row.slug === idOrSlug);
    return hit || null;
  }
  // New A4-T1 form: resolveWorkflow(idOrSlug, root?).
  const idOrSlug = idOrSlugOrRegistry;
  if (typeof idOrSlug !== 'string' || !idOrSlug) return null;
  const root = (typeof rootOrSlug === 'string' && rootOrSlug) ? rootOrSlug : process.cwd();
  const registry = buildWorkflowRegistry(root);
  const hit = registry.workflows.find((row) => row.id === idOrSlug || row.slug === idOrSlug);
  if (!hit) return null;
  return { id: hit.id, format: hit.format, path: hit.path, owner: hit.owner ?? null, origin: hit.origin ?? null };
}

/**
 * Scans every workflow root and detects collisions: duplicate ids (same `WF-####`
 * or `NNNN` in more than one root) and duplicate physical paths (the same folder
 * resolved in more than one root — which violates the one-canonical-owner rule).
 *
 * Collisions are reported without throwing; the caller decides what to do.
 * An empty project returns `{ duplicateIds: [], duplicatePaths: [] }`.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {{ duplicateIds: string[], duplicatePaths: string[] }}
 */
export function detectWorkflowCollisions(root = process.cwd()) {
  const registry = buildWorkflowRegistry(root);
  const idsSeen = new Map();
  const pathsSeen = new Map();
  for (const row of registry.workflows) {
    const idKey = String(row.id);
    idsSeen.set(idKey, (idsSeen.get(idKey) || 0) + 1);
    const pathKey = String(row.path);
    pathsSeen.set(pathKey, (pathsSeen.get(pathKey) || 0) + 1);
  }
  const duplicateIds = [...idsSeen.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort();
  const duplicatePaths = [...pathsSeen.entries()].filter(([, count]) => count > 1).map(([p]) => p).sort();
  return { duplicateIds, duplicatePaths };
}

/**
 * Generates the registry and atomically writes it to `pathsFor().workflowRegistry`.
 * Returns the canonical bytes written (for idempotency assertions).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the canonical JSON text written.
 */
export function writeWorkflowRegistry(root = process.cwd()) {
  const text = serializeRegistry(buildWorkflowRegistry(root));
  writeFileAtomicSync(pathsFor(root).workflowRegistry, text);
  return text;
}
