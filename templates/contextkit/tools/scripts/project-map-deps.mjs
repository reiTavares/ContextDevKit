/**
 * Project-map DEPS — module dependency edges (blast-radius). [ADR-0040]
 *
 * Deterministic, zero-token: reads import statements (already collected by the
 * core scan) and resolves them to edges between mapped modules — "who imports
 * whom". Pure functions, no clock. v1 covers the JS/TS family
 * (relative + workspace-package-name); other languages' edges are deferred (a
 * flaky polyglot resolver is worse than none — classification + symbols stay
 * multi-language, only EDGES are JS/TS-first).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

/** Extensions whose imports we resolve into edges (must read these files). */
export const DEP_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);

const IMPORT_RES = [
  /\bfrom\s+['"]([^'"]+)['"]/g, // import … from 'X' · export … from 'X'
  /\bimport\s+['"]([^'"]+)['"]/g, // side-effect import 'X'
  /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('X') · import('X')
];

/**
 * Extract raw import specifiers from a JS/TS-family source file.
 * @param {string} text file contents
 * @returns {string[]} specifiers (e.g. './foo', '@app/db', 'react')
 */
export function extractImports(text) {
  const out = [];
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) out.push(m[1]);
  }
  return out;
}

/** Map each module's `package.json` name → module path (for workspace imports). */
function packageIndex(root, modules) {
  const index = new Map();
  for (const mod of modules) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(root, mod.path, 'package.json'), 'utf-8'));
      if (typeof pkg?.name === 'string' && pkg.name) index.set(pkg.name, mod.path);
    } catch {
      /* no package.json for this module */
    }
  }
  return index;
}

/** The mapped module whose directory contains `absPath` (most specific wins), or null. */
function owningModule(absPath, moduleAbs) {
  for (const { path, abs } of moduleAbs) {
    if (absPath === abs || absPath.startsWith(abs + sep)) return path;
  }
  return null;
}

/** Resolve one specifier to a target module path, or null (external / unresolved). */
function resolveSpec(spec, fileDir, moduleAbs, pkgIndex) {
  if (spec.startsWith('.')) {
    return owningModule(resolve(fileDir, spec), moduleAbs);
  }
  for (const [name, path] of pkgIndex) {
    if (spec === name || spec.startsWith(name + '/')) return path;
  }
  return null;
}

/**
 * Resolve every module's collected `imports` into a sorted, de-duplicated
 * `deps` array of OTHER module paths, then drop the raw `imports`. Mutates the
 * modules in place. Deps are deliberately NOT part of the structural signature
 * (ADR-0039) — keeping the staleness substrate simple and churn-free.
 *
 * @param {string} root project root
 * @param {Array<{path:string, imports?:Array<{dir:string, spec:string}>}>} modules
 */
export function linkDeps(root, modules) {
  const moduleAbs = modules
    .map((m) => ({ path: m.path, abs: resolve(root, m.path) }))
    .sort((a, b) => b.abs.length - a.abs.length); // most specific dir first
  const pkgIndex = packageIndex(root, modules);
  for (const mod of modules) {
    const deps = new Set();
    for (const { dir, spec } of mod.imports || []) {
      const target = resolveSpec(spec, dir, moduleAbs, pkgIndex);
      if (target && target !== mod.path) deps.add(target);
    }
    mod.deps = [...deps].sort();
    delete mod.imports;
  }
}
