#!/usr/bin/env node
/**
 * Graph extraction — regex tier (GC1-T2, WF-0071/BIZ-0004).
 *
 * Builds the node/edge set for the structural knowledge graph from the
 * EXISTING dense symbol index (`project-map-dense.mjs`) and the committed
 * module manifest (`manifest.json`) — no new tree walk (reuse, not re-scan).
 *
 * Two tiers:
 *   - `loadTreeSitter()` — optional AST parser (absent-safe; WF-0074 installs
 *     the WASM grammars). Returns null today — that is expected and correct.
 *   - `extractSymbols(root)` — the regex tier, always available. Emits:
 *       - `contains` edges: module→file, file→symbol (DETERMINISTIC, from the
 *         dense index hierarchy — id-derived, not inferred).
 *       - `imports` edges: module→module (GRAPH_DERIVED, from manifest deps).
 *
 * Id scheme + evidence-class table are frozen by GC0 (gc0-report.md §1/§2) —
 * mirror them here verbatim; do not hand-stamp evidenceClass elsewhere.
 *
 * Zero non-`node:` imports beyond the two sibling scripts (constitution rule 1).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { buildDenseIndex } from './project-map-dense.mjs';

/** Evidence class for id-hierarchy-derived edges (`contains`), per GC0 §2. */
const DETERMINISTIC = 'DETERMINISTIC';
/** Evidence class for manifest-derived edges (`imports`), per GC0 §2. */
const GRAPH_DERIVED = 'GRAPH_DERIVED';

/**
 * Optional tree-sitter parser — absent-safe dynamic import (mirrors the
 * `loadParser` pattern in `contract-scan.mjs`). Returns null when the
 * dependency isn't installed (expected in this environment; WF-0074 wires
 * the WASM grammars). Never throws.
 * @returns {Promise<unknown|null>}
 */
export async function loadTreeSitter() {
  try {
    return await import('web-tree-sitter');
  } catch {
    return null;
  }
}

/** Node id for a module (GC0 §1: `mod:<repo-path>`). */
function moduleNodeId(modulePath) {
  return `mod:${modulePath}`;
}

/** Node id for a file (GC0 §1: `file:<repo-path>`). */
function fileNodeId(filePath) {
  return `file:${filePath}`;
}

/** Node id for a symbol (GC0 §1: `sym:<file-path>#<name>`). */
function symbolNodeId(filePath, name) {
  return `sym:${filePath}#${name}`;
}

/** A `contains` edge — DETERMINISTIC, id-hierarchy derived (GC0 §2). */
function containsEdge(source, target) {
  return { source, target, relation: 'contains', resolution: 'EXTRACTED', confidenceScore: null, evidenceClass: DETERMINISTIC };
}

/** An `imports` edge — GRAPH_DERIVED, from the committed manifest (GC0 §2). */
function importsEdge(source, target) {
  return { source, target, relation: 'imports', resolution: 'EXTRACTED', confidenceScore: null, evidenceClass: GRAPH_DERIVED };
}

/**
 * Reads the committed module manifest (`manifest.json`), tolerating a missing
 * or unparsable file by returning an empty module list — never throws (mirrors
 * `blast-radius.mjs`'s degrade contract). Strips a leading UTF-8 BOM
 * (constitution rule 4) before `JSON.parse`.
 * @param {string} root project root
 * @returns {Array<{path:string, deps?:string[]}>}
 */
function readManifestModules(root) {
  const manifestPath = join(pathsFor(root).projectMap, 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.modules) ? parsed.modules : [];
  } catch {
    return [];
  }
}

/**
 * Regex-tier graph extraction: one `mod:`/`file:`/`sym:` node per module,
 * file and symbol the dense index finds, `contains` edges through that
 * hierarchy, and `imports` edges from the manifest's module-level deps.
 * Every edge endpoint is guaranteed a node (a manifest dep with no
 * dense-indexed files still gets a bare module node) — never a dangling edge.
 *
 * Returns nodes/edges in discovery order — NOT sorted; the writer
 * (`project-map-graph.mjs::writeCommittedProjection`) sorts for the
 * committed projection.
 *
 * @param {string} root project root
 * @returns {{nodes: Array<{id:string, kind:string, label:string, sourceFile?:string}>,
 *   edges: Array<{source:string, target:string, relation:string, resolution:string,
 *   confidenceScore:null, evidenceClass:string}>}}
 */
export function extractSymbols(root) {
  const dense = buildDenseIndex(root);
  const nodesById = new Map();
  const edges = [];

  const upsertNode = (id, kind, label, sourceFile) => {
    if (nodesById.has(id)) return;
    const node = { id, kind, label };
    if (sourceFile) node.sourceFile = sourceFile;
    nodesById.set(id, node);
  };

  for (const { module, files } of dense.byModule) {
    upsertNode(moduleNodeId(module), 'module', module);
    for (const { file, symbols } of files) {
      upsertNode(fileNodeId(file), 'file', file, file);
      edges.push(containsEdge(moduleNodeId(module), fileNodeId(file)));
      for (const name of symbols) {
        const symId = symbolNodeId(file, name);
        upsertNode(symId, 'function', name, file);
        edges.push(containsEdge(fileNodeId(file), symId));
      }
    }
  }

  for (const mod of readManifestModules(root)) {
    upsertNode(moduleNodeId(mod.path), 'module', mod.path);
    for (const dep of mod.deps || []) {
      upsertNode(moduleNodeId(dep), 'module', dep);
      edges.push(importsEdge(moduleNodeId(mod.path), moduleNodeId(dep)));
    }
  }

  return { nodes: [...nodesById.values()], edges };
}
