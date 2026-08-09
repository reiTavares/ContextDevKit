#!/usr/bin/env node
/** Captures reproducible repository and npm package footprint metrics. */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditNpmPackage } from './package-audit.mjs';

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);

/** @param {string} root @returns {string[]} */
function listFiles(root) {
  const files = [];
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
        visit(resolve(path, entry.name));
      }
      return;
    }
    if (stat.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
  };
  visit(root);
  return files;
}

/** @param {string[]} files @param {RegExp} pattern @returns {number} */
function count(files, pattern) { return files.filter((path) => pattern.test(path)).length; }

/**
 * Captures metrics without claiming unmeasured timings as passes.
 * @param {{root:string, label?:string}} options
 * @returns {object}
 */
export function captureFootprint({ root, label = 'working-tree' }) {
  const absoluteRoot = resolve(root);
  const files = listFiles(absoluteRoot);
  const packageAudit = auditNpmPackage({ root: absoluteRoot });
  const packageJson = JSON.parse(readFileSync(resolve(absoluteRoot, 'package.json'), 'utf8'));
  return {
    schemaVersion: 1,
    label,
    capturedAt: new Date().toISOString(),
    repository: {
      fileCount: files.length,
      hookModuleCount: count(files, /^templates\/contextkit\/runtime\/hooks\/[^/]+\.mjs$/),
      commandFileCount: count(files, /^templates\/(?:claude\/commands|codex\/skills|antigravity\/workflows)\//),
      npmScriptCount: Object.keys(packageJson.scripts ?? {}).length,
    },
    package: {
      verdict: packageAudit.verdict,
      fileCount: packageAudit.fileCount ?? null,
      compressedBytes: packageAudit.packageSizeBytes ?? null,
      installedBytes: packageAudit.installFootprintBytes ?? null,
      violations: packageAudit.violations?.length ?? null,
    },
    performance: {
      quickSuiteMs: null,
      selfcheckMs: null,
      integrationMs: null,
      coldStartMs: null,
      mutationPreflightColdMs: null,
      mutationPreflightWarmP95Ms: null,
      status: 'not-measured-by-footprint-scan',
    },
  };
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const labelIndex = process.argv.indexOf('--label');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : '.';
  const label = labelIndex >= 0 ? process.argv[labelIndex + 1] : 'working-tree';
  process.stdout.write(`${JSON.stringify(captureFootprint({ root, label }), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`footprint: ${error.message}`); process.exitCode = 2; }
}
