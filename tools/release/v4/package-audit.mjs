#!/usr/bin/env node
/** Audits the actual npm tarball file list against the v4 positive allowlist. */
import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** @param {string} value @returns {string} */
function normalize(value) { return value.replaceAll('\\', '/').replace(/^\.\//, ''); }

/**
 * Resolves a file underneath root and rejects traversal/absolute paths.
 * @param {string} root
 * @param {string} path
 * @returns {string}
 */
export function resolvePackagePath(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)) throw new Error(`unsafe package path: ${String(path)}`);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) throw new Error(`package path escapes root: ${path}`);
  let cursor = absolutePath;
  while (cursor.startsWith(`${absoluteRoot}${sep}`)) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`package path traverses symbolic link: ${path}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    cursor = dirname(cursor);
  }
  return absolutePath;
}

/** @param {string} path @param {object} manifest @returns {string[]} */
function policyViolations(path, manifest) {
  const normalized = normalize(path);
  const violations = [];
  const allowed = manifest.rootFiles.includes(normalized) || manifest.trees.some((tree) => normalized.startsWith(tree.path));
  if (!allowed) violations.push('outside-allowlist');
  const segments = normalized.split('/');
  if (manifest.forbidden.pathSegments.some((segment) => segments.includes(segment))) violations.push('forbidden-segment');
  if (manifest.forbidden.suffixes.some((suffix) => normalized.endsWith(suffix))) violations.push('forbidden-suffix');
  if ((manifest.forbidden.nameContains ?? []).some((fragment) => basename(normalized).includes(fragment))) violations.push('forbidden-name-fragment');
  if (manifest.forbidden.basenames.includes(basename(normalized))) violations.push('forbidden-basename');
  if (manifest.forbidden.prefixes.some((prefix) => normalized.startsWith(prefix))) violations.push('forbidden-prefix');
  return violations;
}

/**
 * Audits an npm file list without invoking npm (used by focused tests too).
 * @param {{root:string, files:Array<{path:string,size?:number}>, manifest:object, statPath?:(path:string)=>object}} options
 * @returns {object}
 */
export function auditPackageFileList({ root, files, manifest, statPath = lstatSync }) {
  const violations = [];
  const normalizedFiles = [];
  const seenPaths = new Set();
  for (const entry of files) {
    const path = normalize(entry.path);
    if (seenPaths.has(path)) violations.push({ path, reasons: ['duplicate-package-path'] });
    seenPaths.add(path);
    let absolutePath;
    try { absolutePath = resolvePackagePath(root, path); }
    catch (error) {
      const reason = /symbolic link/.test(error.message) ? 'symbolic-link' : 'path-traversal';
      violations.push({ path, reasons: [reason], detail: error.message });
      continue;
    }
    const reasons = policyViolations(path, manifest);
    try {
      const stat = statPath(absolutePath);
      if (stat.isSymbolicLink() && !manifest.security.allowSymlinks) reasons.push('symbolic-link');
      if (stat.size > manifest.security.maxSingleFileBytes) reasons.push('file-too-large');
      if (Number(entry.size) > manifest.security.maxSingleFileBytes) reasons.push('packed-file-too-large');
    } catch (error) {
      reasons.push('source-missing');
    }
    if (reasons.length) violations.push({ path, reasons: [...new Set(reasons)].sort() });
    normalizedFiles.push(path);
  }
  const missingRequired = manifest.requiredFiles.filter((path) => !normalizedFiles.includes(path));
  for (const path of missingRequired) violations.push({ path, reasons: ['required-file-missing'] });
  return {
    fileCount: normalizedFiles.length,
    missingRequired,
    violations,
    verdict: violations.length ? 'refuse' : 'pass',
  };
}

/**
 * Runs npm pack --dry-run and audits the exact emitted file list.
 * @param {{root:string, manifestPath?:string}} options
 * @returns {object}
 */
export function auditNpmPackage({ root, manifestPath = 'templates/contextkit/package-files.json' }) {
  const absoluteRoot = resolve(root);
  const manifest = JSON.parse(readFileSync(resolvePackagePath(absoluteRoot, manifestPath), 'utf8'));
  const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const commandArguments = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd', 'pack', '--dry-run', '--json', '--ignore-scripts']
    : ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const packed = spawnSync(executable, commandArguments, {
    cwd: absoluteRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (packed.error || packed.status !== 0) {
    return { schemaVersion: 1, verdict: 'refuse', error: packed.error?.message ?? packed.stderr.trim(), violations: [] };
  }
  let payload;
  try { payload = JSON.parse(packed.stdout)[0]; }
  catch (error) { return { schemaVersion: 1, verdict: 'refuse', error: `invalid npm pack JSON: ${error.message}`, violations: [] }; }
  const audit = auditPackageFileList({ root: absoluteRoot, files: payload.files, manifest });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...audit,
    packageSizeBytes: payload.size,
    installFootprintBytes: payload.unpackedSize,
    filename: payload.filename,
    npmWarnings: packed.stderr.trim().split(/\r?\n/).filter(Boolean),
  };
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : '.';
  if (process.argv.some((arg) => arg.startsWith('--') && !['--root', '--check'].includes(arg))) throw new Error('usage: package-audit.mjs [--root <path>] [--check]');
  const report = auditNpmPackage({ root });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes('--check') && report.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`package-audit: ${error.message}`); process.exitCode = 2; }
}
