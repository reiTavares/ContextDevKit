/**
 * Task-Compiler: related-slice builder (WF0022 / ADR-0087..0090).
 *
 * Single responsibility: resolve the MINIMAL related-file slice for a given
 * target path — the set of files and symbols an agent needs to safely edit
 * that path — and guard against partial closure (symbols defined outside the
 * slice). Compile-only: this module NEVER edits code.
 *
 * Design invariants:
 *   - DETERMINISTIC: no Date.now()/Math.random(). Pure functions; callers
 *     inject pre-scanned `modules` for tests (no real FS scan in tests).
 *   - ZERO HOT-PATH DEPS: node:* + relative imports only.
 *   - PARTIAL-NEVER-FULL: closureGuard can demote to partial but NEVER
 *     promotes partial to full (constitution §8, false-negative guard).
 *   - FROZEN OUTPUT: all returned slices are Object.freeze()'d so callers
 *     cannot accidentally mutate them downstream.
 *
 * [task-compiler] [token-economy] [WF0022]
 *
 * // consumes: project-map-core,project-map-symbols,project-map-insights
 */
import { readFileSync }                from 'node:fs';
import { resolve, dirname }           from 'node:path';
import { fileURLToPath }              from 'node:url';
import { scanProject }                from '../project-map-core.mjs';
import { extractSymbols }             from '../project-map-symbols.mjs';
import { subgraphFor, computeInsights } from '../project-map-insights.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for all slices produced by this module. */
export const TC_RELATED_SCHEMA_VERSION = 'cdk-tc-related/1';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Supported language label → extension used when guessing a file's language. */
const EXT_TO_LANG = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
  '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.vue': 'vue', '.svelte': 'svelte', '.py': 'python', '.go': 'go',
  '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.rb': 'ruby',
  '.php': 'php', '.cs': 'csharp',
};

/**
 * Derive a language label from a file path extension.
 * @param {string} filePath
 * @returns {string|null}
 */
function langFromPath(filePath) {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  return EXT_TO_LANG[filePath.slice(dot).toLowerCase()] ?? null;
}

/**
 * Infer import-resolution confidence from subgraph data.
 * @param {{deps:string[],importers:string[]}} subgraph
 * @returns {'derived'|'inferred'|'unknown'}
 */
function deriveConfidence(subgraph) {
  if (!subgraph) return 'unknown';
  const hasEdges = subgraph.deps.length > 0 || subgraph.importers.length > 0;
  return hasEdges ? 'derived' : 'inferred';
}

/**
 * Build the reasons list describing why files were included in the slice.
 * @param {string} targetModule
 * @param {{deps:string[],importers:string[]}} subgraph
 * @returns {string[]}
 */
function buildReasons(targetModule, subgraph) {
  const reasons = [`target: ${targetModule}`];
  if (subgraph?.deps?.length) reasons.push(`deps: ${subgraph.deps.join(', ')}`);
  if (subgraph?.importers?.length) reasons.push(`importers: ${subgraph.importers.join(', ')}`);
  return reasons;
}

/**
 * Gather all symbol names referenced in the given modules array.
 * Returns a Map<symbolName, ownerModulePath>.
 * @param {Array<{path:string,symbols:Array<{file:string,name:string}>}>} modules
 * @returns {Map<string,string>}
 */
function buildSymbolOwnerMap(modules) {
  const ownerMap = new Map();
  for (const mod of modules) {
    for (const sym of mod.symbols ?? []) {
      if (!ownerMap.has(sym.name)) ownerMap.set(sym.name, mod.path);
    }
  }
  return ownerMap;
}

/**
 * Collect symbol names appearing in a set of slice module paths.
 * @param {Array<{path:string,symbols:Array<{file:string,name:string}>}>} modules
 * @param {Set<string>} slicePaths
 * @returns {Set<string>}
 */
function sliceSymbolNames(modules, slicePaths) {
  const names = new Set();
  for (const mod of modules) {
    if (!slicePaths.has(mod.path)) continue;
    for (const sym of mod.symbols ?? []) names.add(sym.name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

/**
 * Resolve the minimal related-file slice for a target path.
 *
 * Callers may pass a pre-scanned `opts.modules` array (test injection) to
 * avoid a real filesystem scan. When not provided, `scanProject(root)` is
 * called. The project root is resolved from `opts.root`; if absent, it
 * falls back to the worktree root inferred from this file's location
 * (`import.meta.url`), but NEVER hardcodes 'contextkit/'.
 *
 * @param {string} targetPath - repo-relative path to the file/module of interest
 * @param {{
 *   root?: string,
 *   modules?: Array<object>
 * }} [opts={}]
 * @returns {Readonly<{
 *   schemaVersion: string,
 *   target: string,
 *   files: string[],
 *   symbols: Array<{file:string,name:string}>,
 *   subgraph: object|null,
 *   coverage: 'full'|'partial',
 *   closure: boolean,
 *   confidence: 'derived'|'inferred'|'unknown',
 *   reasons: string[]
 * }>}
 */
export function relatedSlice(targetPath, opts = {}) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new TypeError('relatedSlice: targetPath must be a non-empty string');
  }

  // Resolve modules: prefer injected fixture, fall back to real scan.
  let modules;
  if (opts?.modules) {
    modules = opts.modules;
  } else {
    const root = opts?.root ?? dirname(dirname(dirname(dirname(dirname(
      fileURLToPath(import.meta.url)
    )))));
    const projectMap = scanProject(resolve(root));
    modules = projectMap.modules;
  }

  const subgraph = subgraphFor(modules, targetPath);
  const targetModule = subgraph?.module ?? targetPath;

  // Collect slice: the target module + its deps + its importers.
  const slicePaths = new Set([targetModule]);
  if (subgraph?.deps?.length) for (const d of subgraph.deps) slicePaths.add(d);
  if (subgraph?.importers?.length) for (const i of subgraph.importers) slicePaths.add(i);

  const sliceModules = modules.filter((m) => slicePaths.has(m.path));
  const symbols = sliceModules.flatMap((m) => m.symbols ?? []);
  const files   = sliceModules.map((m) => m.path).sort();

  const confidence = deriveConfidence(subgraph);
  const reasons    = buildReasons(targetModule, subgraph);

  // Run closure guard to determine coverage.
  const sliceRecord = Object.freeze({ files, symbols, _modules: modules, _slicePaths: slicePaths });
  const guard = closureGuard(sliceRecord);

  return Object.freeze({
    schemaVersion: TC_RELATED_SCHEMA_VERSION,
    target:        targetPath,
    files:         Object.freeze(files),
    symbols:       Object.freeze(symbols),
    subgraph:      subgraph ? Object.freeze(subgraph) : null,
    coverage:      guard.coverage,
    closure:       guard.closed,
    confidence,
    reasons:       Object.freeze(reasons),
  });
}

/**
 * Determine whether a slice is closed (all referenced symbols defined within).
 *
 * Invariant: partial can NEVER be reported as full.
 * A symbol referenced in slice files whose definition lives OUTSIDE the slice
 * makes coverage 'partial' and closed=false.
 *
 * @param {{
 *   files: string[],
 *   symbols: Array<{file:string,name:string}>,
 *   _modules?: Array<object>,
 *   _slicePaths?: Set<string>
 * }} slice
 * @returns {Readonly<{closed:boolean, missing:string[], coverage:'full'|'partial'}>}
 */
export function closureGuard(slice) {
  if (!slice || typeof slice !== 'object') {
    throw new TypeError('closureGuard: slice must be an object');
  }

  const allModules  = slice._modules ?? [];
  const slicePaths  = slice._slicePaths ?? new Set(slice.files ?? []);
  const sliceFiles  = new Set(slice.files ?? []);

  // All symbols DEFINED inside the slice.
  const insideNames = sliceSymbolNames(allModules, slicePaths);

  // All symbols DEFINED anywhere in the project (for out-of-slice detection).
  const ownerMap = buildSymbolOwnerMap(allModules);

  // Symbols present in slice files but DEFINED outside the slice.
  const missingSet = new Set();
  for (const sym of slice.symbols ?? []) {
    const owner = ownerMap.get(sym.name);
    // If owner is known and outside the slice → missing.
    if (owner !== undefined && !slicePaths.has(owner) && !sliceFiles.has(owner)) {
      missingSet.add(sym.name);
    }
  }

  const missing  = [...missingSet].sort();
  const closed   = missing.length === 0;
  const coverage = closed ? 'full' : 'partial';

  return Object.freeze({ closed, missing, coverage });
}

/**
 * Render a related-slice result as a human-readable summary string.
 *
 * @param {Readonly<object>} result - value returned by relatedSlice()
 * @returns {string}
 */
export function presentRelated(result) {
  if (!result || typeof result !== 'object') return 'related-slice: invalid';

  const fileCount   = result.files?.length ?? 0;
  const symbolCount = result.symbols?.length ?? 0;
  const missing     = result.closure === false
    ? ` | missing: ${result.symbols?.filter((s) => !result.files?.includes(s.file))
        .map((s) => s.name).slice(0, 5).join(', ')}`
    : '';

  return [
    `related-slice [${result.schemaVersion}]`,
    `  target    : ${result.target}`,
    `  files     : ${fileCount}  symbols: ${symbolCount}`,
    `  coverage  : ${result.coverage}  closure: ${result.closure}`,
    `  confidence: ${result.confidence}`,
    `  reasons   : ${(result.reasons ?? []).join(' | ')}${missing}`,
  ].join('\n');
}
