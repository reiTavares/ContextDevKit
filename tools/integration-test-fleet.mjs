#!/usr/bin/env node
/**
 * W13 portability integration: injected fleet discovery plus clean non-Git
 * install/update on a path with spaces. The fixture never initializes Git and
 * redirects update backups into its own temporary root.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorktrees } from '../templates/contextkit/tools/scripts/registry/fleet.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (message) => console.log(`  ✓ ${message}`);
const bad = (message) => { failures += 1; console.error(`  ✗ ${message}`); };

/**
 * Run the source installer without a shell so Windows paths remain atomic.
 * @param {string} target non-Git project root
 * @param {string[]} [extraArgs] installer flags
 * @returns {import('node:child_process').SpawnSyncReturns<string>} child result
 */
function runInstaller(target, extraArgs = []) {
  return spawnSync(process.execPath, [resolve(KIT, 'install.mjs'), '--target', target, ...extraArgs], {
    cwd: KIT,
    encoding: 'utf-8',
    shell: false,
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, CONTEXTKIT_BACKUP_ROOT: dirname(target) },
  });
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'ContextDevKit W13 '));
const target = join(fixtureRoot, 'plain project with spaces');
try {
  console.log('\nW13 — non-Git installer and fleet portability\n');
  const porcelain = [
    'worktree C:/repos/main project',
    'branch refs/heads/main',
    '',
    'worktree D:/repos/feature project',
    'branch refs/heads/feature/w13',
    '',
  ].join('\n');
  const trees = listWorktrees(target, { executeGit: () => porcelain });
  trees.length === 2 && trees[1]?.path === 'D:/repos/feature project'
    ? ok('fleet parses injected Windows/path-with-spaces porcelain')
    : bad(`fleet fixture mismatch: ${JSON.stringify(trees)}`);
  listWorktrees(target, { executeGit: () => { throw new Error('git unavailable'); } }).length === 0
    ? ok('fleet degrades to local-only when Git is unavailable')
    : bad('fleet did not degrade to an empty optional enrichment');

  const installed = runInstaller(target, ['--yes', '--level', '3']);
  const installOutput = `${installed.stdout || ''}${installed.stderr || ''}`;
  installed.status === 0
    ? ok('clean install succeeds without .git')
    : bad(`clean non-Git install exited ${installed.status}: ${installOutput.slice(-1000)}`);
  !existsSync(join(target, '.git')) && existsSync(join(target, 'contextkit', '.engine-version'))
    ? ok('install creates the kit without manufacturing Git metadata')
    : bad('non-Git install artifact boundary is wrong');
  installOutput.includes('Install mode: NON-GIT') && !installOutput.includes('Install mode: LOCAL-ONLY')
    ? ok('installer reports the non-Git capability honestly')
    : bad('installer reported a Git-backed local-only mode for a non-Git target');

  const firstIndex = readFileSync(join(target, 'docs', 'README.md'), 'utf-8');
  const updated = runInstaller(target, ['--update', '--allow-active-sessions', '--allow-self-update']);
  const updateOutput = `${updated.stdout || ''}${updated.stderr || ''}`;
  updated.status === 0 && !updateOutput.includes('DEFERRED')
    ? ok('clean update succeeds without .git')
    : bad(`clean non-Git update exited ${updated.status}: ${updateOutput.slice(-1000)}`);
  const secondIndex = readFileSync(join(target, 'docs', 'README.md'), 'utf-8');
  firstIndex === secondIndex
    ? ok('docs reindex remains byte-idempotent in the non-Git install')
    : bad('docs index changed across an identical non-Git update');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n✓ W13 portability integration passed.\n' : `\n✗ ${failures} W13 portability check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
