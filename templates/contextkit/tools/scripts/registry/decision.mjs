/**
 * Decision Registry generator (BIZ-0001 / WF-0037, B1-T2).
 *
 * Scans every decisions root (compatibility-plan §"Dual resolution") and emits a
 * generated, sorted index of BOTH formats:
 *  - **new**    `ADR-####` files with YAML front matter v2 under
 *               `decisions/{business,operations}/` (parsed + validated by B1-T1);
 *  - **legacy** plain-markdown `NNNN-slug.md` ADRs at the `decisions/` top level
 *               and under `decisions/legacy/` — indexed LOGICALLY as
 *               `contextType:legacy, status:legacy, primaryContext:null` WITHOUT
 *               touching the files (the legacy filename regex is frozen).
 *
 * The registry is an INDEX, never primary state (source-of-truth-policy). Rebuild
 * is byte-idempotent. Pure `node:*`, zero runtime dependencies — it reuses the
 * A1 serialization helper and the B1-T1 schema classifier; the only cross-layer
 * import is `adr-digest-core` for canonical legacy parsing (same layer).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { stripBom } from '../../../runtime/work/enums.mjs';
import { classifyDecisionFile } from '../../../runtime/work/schema-decision.mjs';
import { serializeRegistry } from './serialize.mjs';
import { writeFileAtomicSync } from '../../../runtime/hooks/safe-io.mjs';
import { parseAdr } from '../adr-digest-core.mjs';

/** Schema version of the emitted decision-registry.json. */
export const DECISION_REGISTRY_VERSION = 1;

/** Markdown files in `dir` that are decision records (not README/_TEMPLATE). */
function decisionFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .filter((entry) => entry.name !== 'README.md' && entry.name !== '_TEMPLATE.md')
    .map((entry) => entry.name);
}

/** Defensive UTF-8 read with BOM strip; '' when missing/unreadable. */
function readText(target) {
  if (!existsSync(target)) return '';
  try {
    return stripBom(readFileSync(target, 'utf-8'));
  } catch {
    return '';
  }
}

/** Relative, forward-slashed path of `abs` under `memoryDir`. */
function relPath(abs, memoryDir) {
  return abs.slice(memoryDir.length + 1).split('\\').join('/');
}

/** Builds one index row from a parsed v2 decision record. */
function newRow(data, rel) {
  const product = data.product && typeof data.product === 'object' ? data.product : {};
  return {
    id: data.id ?? null,
    path: rel,
    format: 'new',
    status: data.status ?? null,
    contextType: data.contextType ?? null,
    primaryContext: data.primaryContext ?? null,
    decisionKind: data.decisionKind ?? null,
    decisionScope: data.decisionScope ?? null,
    product: product.productId ?? null,
    capability: product.capability ?? null,
    governs: data.governs ?? null,
    supersedes: Array.isArray(data.supersedes) ? data.supersedes : [],
    supersededBy: data.supersededBy ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

/**
 * Builds one index row for a legacy plain-markdown ADR. Logical classification
 * only — the file is never modified. Reuses `parseAdr` for number/title/status.
 */
function legacyRow(filename, contents, rel) {
  const parsed = parseAdr(contents, filename);
  const number = parsed.number && parsed.number !== '????' ? parsed.number : filename.slice(0, 4);
  return {
    id: `ADR-${number}`,
    path: rel,
    format: 'legacy',
    status: 'legacy',
    contextType: 'legacy',
    primaryContext: null,
    decisionKind: null,
    decisionScope: null,
    product: null,
    capability: null,
    governs: null,
    supersedes: [],
    supersededBy: null,
    tags: [],
    legacyStatus: parsed.status || null,
    title: parsed.title || null,
  };
}

/** Indexes every decision file under one directory into rows (new + legacy). */
function indexDecisionDir(dir, memoryDir) {
  const rows = [];
  for (const filename of decisionFiles(dir)) {
    const abs = resolve(dir, filename);
    const contents = readText(abs);
    const verdict = classifyDecisionFile(filename, contents);
    const rel = relPath(abs, memoryDir);
    if (verdict.kind === 'new' && verdict.data) {
      rows.push(newRow(verdict.data, rel));
    } else if (verdict.kind === 'legacy') {
      rows.push(legacyRow(filename, contents, rel));
    }
  }
  return rows;
}

/** The decision roots scanned, in a stable order. */
function decisionRoots(root) {
  const paths = pathsFor(root);
  return [paths.decisions, paths.decisionsBusiness, paths.decisionsOperations, paths.decisionsLegacy];
}

/**
 * Builds the decision-registry payload across all roots, sorted by id.
 * Pure: scans disk, returns the object, writes nothing.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {object} `{ schemaVersion, generator, decisions }`.
 */
export function buildDecisionRegistry(root = process.cwd()) {
  const memoryDir = pathsFor(root).memory;
  const seen = new Set();
  const decisions = [];
  for (const dir of decisionRoots(root)) {
    for (const row of indexDecisionDir(dir, memoryDir)) {
      // The top-level decisions/ scan and the legacy/ subtree never overlap on
      // path; guard on path so a re-scan can never double-count.
      if (seen.has(row.path)) continue;
      seen.add(row.path);
      decisions.push(row);
    }
  }
  decisions.sort((left, right) => String(left.id).localeCompare(String(right.id)) || left.path.localeCompare(right.path));
  return {
    schemaVersion: DECISION_REGISTRY_VERSION,
    generator: 'registry/decision.mjs',
    decisions,
  };
}

/**
 * Resolves a decision row by exact id (`ADR-0102`) over an in-memory registry.
 * Foundation seam — B2 owns search/match scoring. Returns the first match or null.
 *
 * @param {object} registry - a built decision registry.
 * @param {string} id - an ADR id (`ADR-####`).
 * @returns {object|null} the matching row, or null.
 */
export function resolveDecision(registry, id) {
  if (!registry || !Array.isArray(registry.decisions) || !id) return null;
  return registry.decisions.find((row) => row.id === id) || null;
}

/**
 * Renders a deterministic one-line-per-decision catalog (sorted by id).
 *
 * @param {object} registry - a built decision registry.
 * @returns {string} catalog text (trailing newline included).
 */
export function renderDecisionCatalog(registry) {
  const rows = registry && Array.isArray(registry.decisions) ? registry.decisions : [];
  const lines = rows.map((row) => {
    const context = row.primaryContext ? `${row.primaryContext.type}:${row.primaryContext.id}` : row.contextType;
    const kind = row.decisionKind ? ` · ${row.decisionKind}` : '';
    return `- **${row.id}** · ${row.status} · ${context}${kind}`;
  });
  return `${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

/**
 * Generates the registry and atomically writes it to `pathsFor().decisionRegistry`.
 * Returns the canonical bytes written (for idempotency assertions).
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string} the canonical JSON text written.
 */
export function writeDecisionRegistry(root = process.cwd()) {
  const text = serializeRegistry(buildDecisionRegistry(root));
  writeFileAtomicSync(pathsFor(root).decisionRegistry, text);
  return text;
}

/**
 * Returns all registry rows whose triple matches the given components.
 * Pure: no I/O, no side effects. Added by B2-T2 (WF-0037) as a
 * query extension over the existing READ API — existing exports unchanged.
 *
 * A null/undefined argument for any component is treated as "match any"
 * (wildcard), so callers with a provisional context.id can still find
 * kind-only matches. All three set means exact-triple filtering.
 *
 * @param {object} registry - a built decision registry (`buildDecisionRegistry`).
 * @param {object|null|undefined} primaryContext - `{ type, id }` shape; null = any.
 * @param {string|null|undefined} decisionKind - closed-set kind string; null = any.
 * @param {string|null|undefined} decisionScope - closed-set scope string; null = any.
 * @returns {object[]} matching rows (may be empty), in registry sort order.
 */
export function queryByTriple(registry, primaryContext, decisionKind, decisionScope) {
  if (!registry || !Array.isArray(registry.decisions)) return [];
  return registry.decisions.filter((row) => {
    if (decisionKind != null && row.decisionKind !== decisionKind) return false;
    if (decisionScope != null && row.decisionScope !== decisionScope) return false;
    if (primaryContext != null) {
      const rc = row.primaryContext;
      if (!rc) return false;
      if (primaryContext.type != null && rc.type !== primaryContext.type) return false;
      if (primaryContext.id != null && rc.id !== primaryContext.id) return false;
    }
    return true;
  });
}
