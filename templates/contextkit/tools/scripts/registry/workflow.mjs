/**
 * Workflow Registry foundation (BIZ-0001 / WF-0036, A1-T3).
 *
 * Scans EVERY workflow root (new top-level `memory/workflows/` plus per-context
 * workflows/ folders under business/ and operations/) and emits a generated,
 * sorted index of both formats (compatibility-plan §"Dual resolution"):
 *  - **new**   `WF-####-slug` dirs (meta from workflow-plan/state json);
 *  - **legacy** `NNNN-slug` dirs (status parsed from index.md; UNCHANGED).
 *
 * A1-T3 lays the FOUNDATION: a flat index + `resolveWorkflow(registry, idOrSlug)`
 * over the in-memory index. The cross-root resolver against disk and duplicate-id
 * / duplicate-path detection are A4 — a clean seam is left, not over-built.
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

/** Builds one index row for a new `WF-####` workflow folder. */
function newRow(dir, folder, id, slug, rel) {
  const plan = readPackJson(dir, folder, 'workflow-plan.json');
  const state = readPackJson(dir, folder, 'workflow-state.json');
  return {
    id,
    slug: plan.slug ?? slug,
    path: rel,
    format: 'new',
    status: state.overallStatus ?? null,
    title: plan.title ?? null,
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
  };
}

/** Indexes every workflow folder under one root into rows (new + legacy). */
function indexWorkflowRoot(dir, memoryDir) {
  const rows = [];
  for (const folder of workflowFolders(dir)) {
    const rel = resolve(dir, folder).slice(memoryDir.length + 1).split('\\').join('/');
    const asNew = folder.match(NEW_RE);
    if (asNew) {
      rows.push(newRow(dir, folder, asNew[1], asNew[2], rel));
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
  const memoryDir = pathsFor(root).memory;
  const workflows = workflowRoots(root)
    .flatMap((dir) => indexWorkflowRoot(dir, memoryDir))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: WORKFLOW_REGISTRY_VERSION,
    generator: 'registry/workflow.mjs',
    workflows,
  };
}

/**
 * Resolves a workflow row by exact id (`WF-0036`, `0033`) or slug, over an
 * in-memory registry. Foundation seam — the disk-walking cross-root resolver and
 * duplicate detection are A4. Returns the first match, or null.
 *
 * @param {object} registry - a built workflow registry.
 * @param {string} idOrSlug - a workflow id or slug.
 * @returns {object|null} the matching row, or null.
 */
export function resolveWorkflow(registry, idOrSlug) {
  if (!registry || !Array.isArray(registry.workflows) || !idOrSlug) return null;
  return registry.workflows.find((row) => row.id === idOrSlug || row.slug === idOrSlug) || null;
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
