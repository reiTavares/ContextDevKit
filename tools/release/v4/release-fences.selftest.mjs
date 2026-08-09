#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { buildLegacyInventory, renderLegacyInventoryMarkdown, resolveContainedPath } from '../../../templates/contextkit/tools/scripts/legacy-inventory.mjs';
import { analyzeLegacyReachability, resolveModuleSpecifier } from '../../../templates/contextkit/tools/scripts/legacy-reachability.mjs';
import { traceModuleLoads } from '../../../templates/contextkit/tools/scripts/module-load-trace.mjs';
import { auditPackageFileList, resolvePackagePath } from './package-audit.mjs';

const root = mkdtempSync(resolve(tmpdir(), 'contextdevkit-v4-release-fence-test-'));
let symlinkChecks = 'skipped (platform permission)';
const write = (path, content) => {
  const absolutePath = resolve(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
};

try {
  write('package.json', '{"type":"module"}\n');
  write('install.mjs', "import './templates/runtime/composer.mjs';\n");
  write('templates/runtime/composer.mjs', "export const registeredHook = 'pipeline-session.mjs';\n");
  write('templates/runtime/entry.mjs', "import './pipeline-session.mjs';\nexport const ready = true;\n");
  write('templates/runtime/pipeline-session.mjs', "export function autoAdvanceSessionTasks() {}\n");
  write('tools/selfcheck-source-cases-recent.mjs', "export const old = 'Stop hook auto-advances session tasks';\n");

  assert.throws(() => resolveContainedPath(root, '../escape'), /escapes repository root/);
  assert.throws(() => resolvePackagePath(root, '../escape'), /escapes root/);
  assert.equal(resolveModuleSpecifier(root, 'templates/runtime/entry.mjs', '../../../escape.mjs'), null);

  const inventory = buildLegacyInventory({ root, scanRoots: ['install.mjs', 'templates', 'tools'] });
  assert.equal(inventory.complete, true);
  assert.ok(inventory.items.some((item) => item.path === 'templates/runtime/pipeline-session.mjs' && item.releaseBlocking));
  assert.match(renderLegacyInventoryMarkdown(inventory), /Retained consumers/);

  const reachability = analyzeLegacyReachability({
    root,
    entrypoints: ['install.mjs'],
    legacyPaths: ['templates/runtime/pipeline-session.mjs'],
  });
  assert.equal(reachability.verdict, 'refuse');
  assert.deepEqual(reachability.reachable[0].chain, ['install.mjs', 'templates/runtime/composer.mjs', 'templates/runtime/pipeline-session.mjs']);

  const dynamicTrace = traceModuleLoads({
    root,
    scenarios: [['direct', 'templates/runtime/entry.mjs']],
    legacyPaths: ['templates/runtime/pipeline-session.mjs'],
  });
  assert.equal(dynamicTrace.verdict, 'refuse');
  assert.deepEqual(dynamicTrace.scenarios[0].legacyLoaded, ['templates/runtime/pipeline-session.mjs']);

  const manifest = {
    rootFiles: ['package.json'],
    trees: [{ path: 'templates/' }],
    requiredFiles: ['package.json'],
    forbidden: { pathSegments: ['fixtures'], suffixes: ['.selftest.mjs'], basenames: ['.env'], prefixes: ['tools/selfcheck'] },
    security: { allowSymlinks: false, maxSingleFileBytes: 1024 * 1024 },
  };
  const safeAudit = auditPackageFileList({ root, files: [{ path: 'package.json' }, { path: 'templates/runtime/entry.mjs' }], manifest });
  assert.equal(safeAudit.verdict, 'pass');
  const leakageAudit = auditPackageFileList({ root, files: [{ path: 'tools/selfcheck-source-cases-recent.mjs' }, { path: '../escape' }], manifest });
  assert.equal(leakageAudit.verdict, 'refuse');
  assert.ok(leakageAudit.violations.some((violation) => violation.reasons.includes('path-traversal')));

  const injectedSymlinkAudit = auditPackageFileList({
    root,
    files: [{ path: 'package.json' }, { path: 'templates/runtime/entry.mjs' }],
    manifest,
    statPath: (path) => path.endsWith('entry.mjs') ? { isSymbolicLink: () => true, size: 1 } : lstatSync(path),
  });
  assert.ok(injectedSymlinkAudit.violations.some((violation) => violation.reasons.includes('symbolic-link')));

  try {
    mkdirSync(resolve(root, 'outside'));
    symlinkSync(resolve(root, 'outside'), resolve(root, 'templates/junction'), 'junction');
    assert.throws(() => resolveContainedPath(root, 'templates/junction/escape.mjs'), /symbolic link/);
    const symlinkInventory = buildLegacyInventory({ root, scanRoots: ['templates'] });
    assert.equal(symlinkInventory.complete, false);
    assert.deepEqual(symlinkInventory.symlinksRejected, ['templates/junction']);
    symlinkChecks = 'passed';
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  }

  console.log(`release-fences: core assertions passed; symlink checks ${symlinkChecks}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
