#!/usr/bin/env node
/** ContextDevKit 4 boundary-validation and installer-safety integration tests. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, installFixture, KIT, readJson, reporter, run } from './it-helpers.mjs';
import { loadConfigSync } from '../templates/contextkit/runtime/config/load.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\nContextDevKit integration test - v4 guards\n');

/** @param {string} prefix @returns {string} */
function scratch(prefix) {
  return mkdtempSync(join(tmpdir(), `contextkit-${prefix}-`));
}

function testMalformedConfig() {
  const root = scratch('config');
  try {
    mkdirSync(join(root, 'contextkit'), { recursive: true });
    writeFileSync(join(root, 'contextkit', 'config.json'), '{ invalid json', 'utf8');
    const config = loadConfigSync(root);
    config.governance?.failurePolicy === 'continue'
      && config.governance?.gates?.['architecture-debt'] === 'canary'
      ? ok('malformed config resolves to fail-open v4 defaults')
      : bad(`malformed config did not resolve safely: ${JSON.stringify(config.governance)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testCommitMessageHook(projectRoot) {
  const messagePath = join(projectRoot, '.git', 'COMMIT_EDITMSG');
  const hookPath = join(projectRoot, 'contextkit', 'runtime', 'git-hooks', 'commit-msg.mjs');
  writeFileSync(messagePath, 'not conventional\n', 'utf8');
  const invalid = run([hookPath, messagePath], { cwd: projectRoot });
  invalid.status !== 0
    ? ok('commit-msg rejects a non-Conventional message')
    : bad('commit-msg accepted a non-Conventional message');
  writeFileSync(messagePath, 'fix(runtime): preserve canonical state\n', 'utf8');
  const valid = run([hookPath, messagePath], { cwd: projectRoot });
  valid.status === 0
    ? ok('commit-msg accepts a Conventional message')
    : bad(`commit-msg rejected a valid message: ${valid.stderr}`);
}

function testSettingsRepair(projectRoot) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  writeFileSync(settingsPath, '{ broken', 'utf8');
  const rewire = run([join(KIT, 'install.mjs'), '--target', projectRoot, '--rewire', '--level', '5', '--yes'], { cwd: KIT });
  let repaired = null;
  try { repaired = readJson(settingsPath); } catch { /* asserted below */ }
  const preflight = (repaired?.hooks?.PreToolUse || [])
    .flatMap((group) => group.hooks || [])
    .map((hook) => String(hook.command || ''));
  rewire.status === 0 && preflight.length === 1 && preflight[0].includes('governance-write-preflight.mjs')
    ? ok('rewire repairs malformed host settings with one v4 preflight')
    : bad(`rewire did not repair host settings: ${rewire.stderr}`);
}

function testInstallerHookBackup() {
  const root = scratch('hook-backup');
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 'it@example.com'], root);
    git(['config', 'user.name', 'IT'], root);
    const hooksDirectory = join(root, '.git', 'hooks');
    mkdirSync(hooksDirectory, { recursive: true });
    writeFileSync(join(hooksDirectory, 'pre-commit'), '#!/bin/sh\necho "user hook"\n', 'utf8');
    const install = run([join(KIT, 'install.mjs'), '--target', root, '--level', '3', '--name', 'Hook Backup', '--yes'], { cwd: KIT });
    const backupPath = join(hooksDirectory, 'pre-commit.bak');
    install.status === 0 && existsSync(backupPath) && readFileSync(backupPath, 'utf8').includes('user hook')
      ? ok('installer backs up a pre-existing user git hook')
      : bad(`installer did not preserve the user hook: ${install.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

testMalformedConfig();
testInstallerHookBackup();
const fixture = installFixture(rep);
try {
  testCommitMessageHook(fixture.proj);
  testSettingsRepair(fixture.proj);
} catch (error) {
  bad(`guards crashed: ${error?.stack || error}`);
} finally {
  fixture.cleanup();
}

rep.finish('Integration (v4 guards)');
