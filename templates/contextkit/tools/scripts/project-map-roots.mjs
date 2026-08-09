#!/usr/bin/env node
/**
 * Typed, portable Project Map root resolution.
 *
 * Source and governance memory are different scan domains. Source exclusions
 * must not make an explicitly selected governance root disappear, even when
 * the platform directory is gitignored or excluded from the source walk.
 */
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, posix, resolve, win32 } from 'node:path';
import { MEMORY_DIR, PLATFORM_DIR } from '../../runtime/config/paths.mjs';

/** @typedef {'source'|'governance'} ProjectMapRootKind */
/** @typedef {'tree'|'file'} ProjectMapRootEntryType */
/**
 * @typedef {object} ProjectMapRoot
 * @property {ProjectMapRootKind} kind
 * @property {string} path Project-relative, forward-slashed path.
 * @property {ProjectMapRootEntryType} entryType
 * @property {boolean} available
 * @property {{deep:string[], rootRelative:string[]}} excludes
 */

/** Governance inputs outside the generated project-map projection itself. */
export const GOVERNANCE_SCAN_ROOTS = Object.freeze([
  MEMORY_DIR,
  `${PLATFORM_DIR}/pipeline/tasks.json`,
]);

/** Backward-compatible name for callers that only need the memory root list. */
export const MEMORY_SCAN_ROOTS = GOVERNANCE_SCAN_ROOTS;

/** @returns {{deep:Set<string>, rootRelative:Set<string>}} */
export function defaultExcludes() {
  return {
    deep: new Set([
      'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
      '.turbo', '.expo', '.svelte-kit', 'coverage', '__pycache__', '.pytest_cache',
      'target', 'vendor', '.venv', 'venv', 'bin', 'obj', '.cache', '.idea', '.vscode',
      '.claude', '.agents', '.antigravity', '.tmp',
    ]),
    rootRelative: new Set([PLATFORM_DIR]),
  };
}

/**
 * Normalizes a configured project-relative path and rejects escapes/absolute
 * paths. Windows separators are accepted on every host and never leak into the
 * returned portable contract.
 * @param {unknown} candidate
 * @returns {string|null}
 */
export function normalizeRootPath(candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  const portable = candidate.trim().replaceAll('\\', '/');
  if (isAbsolute(portable) || win32.isAbsolute(candidate)) return null;
  const normalized = posix.normalize(portable).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized === '' ? '.' : normalized;
}

/** @param {Set<string>} values @returns {string[]} */
function sorted(values) {
  return [...values].sort();
}

/**
 * Creates a serializable root descriptor. Absolute machine paths are resolved
 * only by consumers, never persisted in the root contract.
 * @param {ProjectMapRootKind} kind
 * @param {string} path
 * @param {ProjectMapRootEntryType} entryType
 * @param {{deep:Set<string>,rootRelative:Set<string>}} excludes
 * @returns {ProjectMapRoot}
 */
function rootDescriptor(kind, path, entryType, excludes, available = true) {
  return Object.freeze({
    kind,
    path,
    entryType,
    available,
    excludes: Object.freeze({
      deep: Object.freeze(sorted(excludes.deep)),
      rootRelative: Object.freeze(sorted(excludes.rootRelative)),
    }),
  });
}

/**
 * Returns existing governance roots. No Git command is consulted: explicit
 * filesystem roots remain visible in ZIP/tarball/non-Git installations.
 * @param {string} root
 * @returns {ProjectMapRoot[]}
 */
export function governanceRoots(root) {
  const governanceExcludes = {
    deep: new Set(['node_modules', '.git', '.hg', '.svn', '.tmp']),
    // Avoid indexing the graph into itself. All other governed memory is walked.
    rootRelative: new Set([`${MEMORY_DIR}/project-map`]),
  };
  const roots = [];
  for (const candidate of GOVERNANCE_SCAN_ROOTS) {
    let available = false;
    let entryType = candidate.endsWith('.json') ? 'file' : 'tree';
    try {
      const absolute = resolve(root, candidate);
      available = existsSync(absolute);
      if (available) entryType = statSync(absolute).isDirectory() ? 'tree' : 'file';
    } catch {
      available = false;
    }
    roots.push(rootDescriptor('governance', candidate, entryType, governanceExcludes, available));
  }
  return roots;
}

/**
 * Existing governance roots only, retained for discovery callers.
 * @param {string} root
 * @returns {ProjectMapRoot[]}
 */
export function memoryRoots(root) {
  return governanceRoots(root).filter((entry) => entry.available);
}

/**
 * Resolves typed source/governance roots plus a per-root exclusion predicate.
 * Malformed configuration degrades to the default source root without throwing.
 * @param {object|null|undefined} config
 * @param {string} root
 * @returns {{roots:ProjectMapRoot[],sourceRoots:ProjectMapRoot[],governanceRoots:ProjectMapRoot[],
 *   excludes:{deep:Set<string>,rootRelative:Set<string>},
 *   isExcluded(scanRoot:ProjectMapRoot|string, relPath?:string, entryName?:string):boolean}}
 */
export function resolveRoots(config, root) {
  const sourceExcludes = defaultExcludes();
  try {
    const configuredExcludes = config?.projectMap?.excludes;
    if (Array.isArray(configuredExcludes)) {
      for (const entry of configuredExcludes) {
        if (typeof entry !== 'string' || entry.length === 0) continue;
        const portable = entry.replaceAll('\\', '/');
        if (portable.endsWith('/')) {
          const normalized = portable.replace(/\/+$/, '');
          if (normalized) sourceExcludes.rootRelative.add(normalized);
        } else {
          const bare = portable.split('/').filter(Boolean).at(-1);
          if (bare) sourceExcludes.deep.add(bare);
        }
      }
    }
  } catch {
    // Defaults remain authoritative when config cannot be read.
  }

  let configuredPaths = ['.'];
  try {
    const configured = config?.projectMap?.roots;
    if (Array.isArray(configured) && configured.length > 0) {
      const valid = [...new Set(configured.map(normalizeRootPath).filter(Boolean))];
      if (valid.length === configured.length) configuredPaths = valid;
    }
  } catch {
    // Defaults remain authoritative when config cannot be read.
  }

  const sourceRoots = configuredPaths.map((path) => {
    let available = false;
    try { available = statSync(resolve(root, path)).isDirectory(); } catch { /* recorded on descriptor */ }
    return rootDescriptor('source', path, 'tree', sourceExcludes, available);
  });
  const governedRoots = governanceRoots(root);
  const roots = Object.freeze([...sourceRoots, ...governedRoots]);

  /**
   * @param {ProjectMapRoot|string} scanRootOrRel
   * @param {string} [relPathOrName]
   * @param {string} [entryName]
   * @returns {boolean}
   */
  function isExcluded(scanRootOrRel, relPathOrName, entryName) {
    // Two-argument compatibility: isExcluded(relPath, entryName).
    const descriptor = typeof scanRootOrRel === 'object' && scanRootOrRel !== null
      ? scanRootOrRel
      : sourceRoots[0];
    const relPath = typeof scanRootOrRel === 'object' && scanRootOrRel !== null
      ? String(relPathOrName ?? '')
      : String(scanRootOrRel ?? '');
    const bareName = typeof scanRootOrRel === 'object' && scanRootOrRel !== null
      ? String(entryName ?? '')
      : String(relPathOrName ?? '');
    const portable = relPath.replaceAll('\\', '/');
    if (descriptor.excludes.deep.includes(bareName)) return true;
    return descriptor.excludes.rootRelative.some((excluded) => portable === excluded || portable.startsWith(`${excluded}/`));
  }

  return { roots, sourceRoots, governanceRoots: governedRoots, excludes: sourceExcludes, isExcluded };
}

if (process.argv[1]?.split(/[\\/]/).pop() === 'project-map-roots.mjs') {
  let config = null;
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(resolve(process.cwd(), PLATFORM_DIR, 'config.json'), 'utf-8');
    config = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    // A missing config is a supported non-Git/package state.
  }
  const resolved = resolveRoots(config, process.cwd());
  process.stdout.write(JSON.stringify({ roots: resolved.roots }, null, 2) + '\n');
}
