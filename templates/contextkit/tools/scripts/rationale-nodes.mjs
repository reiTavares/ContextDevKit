#!/usr/bin/env node
/**
 * Rationale nodes + cites edges (SR1, WF-0073/BIZ-0004) — the LINKS verb.
 *
 * Deterministic, ZERO-EGRESS: reads only the local `memory/decisions/` corpus
 * and the repo source, and links code to the ADRs that govern it. Every ADR file
 * (`ADR-####-*.md`) becomes an `adr:####` rationale node; every `ADR-####`
 * reference found in a source file becomes a `cites` edge `file:<path> ->
 * adr:####` (DETERMINISTIC evidence per the GC0 table — a literal citation, not
 * a scraped guess). A `cites` target that has no matching ADR node is dropped
 * (never a dangling edge, never a fabricated rationale).
 *
 * This is the ContextDevKit moat that a descriptive code-graph cannot match: the
 * ADR store is real and populated. Zero non-`node:` imports beyond the sibling
 * dense-index walker; no network; no clock; no Math.random.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const DETERMINISTIC = 'DETERMINISTIC';
const ADR_FILE_RE = /^ADR-(\d{4})[-.].*\.md$/i;
const ADR_REF_RE = /ADR-(\d{4})/g;

/** Directories never scanned for citations (mirror project-map-dense EXCLUDE). */
const EXCLUDE = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
  'vendor', 'target', '.venv', 'venv', '__pycache__', '.cache', 'coverage',
  '.idea', '.vscode', 'contextkit', '.claude', '.agents', '.codex',
]);
/** Source extensions scanned for ADR citations. */
const SRC_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte', '.py', '.go', '.rs', '.rb']);

/**
 * Collects every ADR id declared in the decisions corpus, as `adr:####`
 * rationale nodes. Reads all decisions subtrees; tolerates a missing dir.
 * @param {string} root project root
 * @returns {{ nodes: Array<{id:string, kind:string, label:string, sourceFile:string}>, ids: Set<string> }}
 */
export function buildRationaleNodes(root) {
  const paths = pathsFor(root);
  const dirs = [paths.decisions, paths.decisionsBusiness, paths.decisionsOperations, paths.decisionsLegacy]
    .filter((d) => typeof d === 'string');
  const nodes = [];
  const ids = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const m = ADR_FILE_RE.exec(name);
      if (!m) continue;
      const num = m[1];
      const id = `adr:${num}`;
      if (ids.has(id)) continue;
      ids.add(id);
      nodes.push({ id, kind: 'rationale', label: `ADR-${num}`, sourceFile: relative(root, join(dir, name)).split(sep).join('/') });
    }
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, ids };
}

/** Recursively collects repo-relative source-file paths, excluding EXCLUDE dirs. */
function walkSources(root, absDir, acc) {
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (EXCLUDE.has(ent.name)) continue;
      walkSources(root, join(absDir, ent.name), acc);
    } else if (SRC_EXT.has(extname(ent.name).toLowerCase())) {
      acc.push(relative(root, join(absDir, ent.name)).split(sep).join('/'));
    }
  }
}

/** A `cites` edge — DETERMINISTIC, a literal ADR reference in source (GC0 table). */
function citesEdge(source, target) {
  return { source, target, relation: 'cites', resolution: 'EXTRACTED', confidenceScore: null, evidenceClass: DETERMINISTIC };
}

/**
 * Scans repo source for `ADR-####` references and emits `cites` edges from the
 * citing file node to the `adr:####` node — but ONLY when that ADR node exists
 * (an unknown ADR reference is dropped, never a dangling edge / fabricated node).
 * Deterministic (sorted, deduped).
 *
 * @param {string} root project root
 * @param {Set<string>} adrIds the known `adr:####` ids from buildRationaleNodes
 * @returns {Array<{source:string, target:string, relation:string, resolution:string,
 *   confidenceScore:null, evidenceClass:string}>}
 */
export function buildCitesEdges(root, adrIds) {
  const files = [];
  try { if (statSync(root).isDirectory()) walkSources(root, root, files); } catch { return []; }
  files.sort();
  const seen = new Set();
  const edges = [];
  for (const rel of files) {
    let text;
    try { text = readFileSync(join(root, rel), 'utf-8'); } catch { continue; }
    ADR_REF_RE.lastIndex = 0;
    let m;
    const citedHere = new Set();
    while ((m = ADR_REF_RE.exec(text))) {
      const target = `adr:${m[1]}`;
      if (!adrIds.has(target) || citedHere.has(target)) continue;
      citedHere.add(target);
      const key = `file:${rel} ${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(citesEdge(`file:${rel}`, target));
    }
  }
  edges.sort((a, b) => (a.source + ' ' + a.target).localeCompare(b.source + ' ' + b.target));
  return edges;
}

/**
 * The full rationale layer: `adr:####` nodes + `cites` edges. Deterministic +
 * zero egress. Degrades to empty (never throws) when the decisions corpus is
 * absent — an empty rationale layer is honest, never a fabricated citation.
 *
 * @param {string} root project root
 * @returns {{ nodes: object[], edges: object[], evidenceClass: string }}
 */
export function buildRationaleLayer(root) {
  const { nodes, ids } = buildRationaleNodes(root);
  const edges = buildCitesEdges(root, ids);
  return { nodes, edges, evidenceClass: DETERMINISTIC };
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'rationale-nodes.mjs') {
  const layer = buildRationaleLayer(process.cwd());
  process.stdout.write(JSON.stringify({ adrNodes: layer.nodes.length, citesEdges: layer.edges.length }, null, 2) + '\n');
}
