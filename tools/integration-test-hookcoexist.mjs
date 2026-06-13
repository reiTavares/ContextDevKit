#!/usr/bin/env node
/**
 * ContextDevKit integration test — HOOK-MANAGER COEXISTENCE (ADR-0063).
 *
 * Covers `detectExistingHooksManager(target)` in tools/install/git.mjs: the
 * install-time detector that SUGGESTS integration with an existing hook manager
 * (Husky, Lefthook, simple-git-hooks, custom core.hooksPath, non-kit .git/hooks)
 * instead of silently clobbering. Pure detection — no install side effects.
 *
 * Shared harness: it-helpers.mjs. Run: node tools/integration-test-hookcoexist.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, git, reporter } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — hook-manager coexistence\n');

const importKit = (rel) => import('file://' + join(KIT, rel).replaceAll('\\', '/'));
const tmp = (tag) => mkdtempSync(join(tmpdir(), `contextkit-hookco-${tag}-`));
const initRepo = (proj) => {
  git(['init', '-b', 'main'], proj);
  git(['config', 'user.email', 'it@example.com'], proj);
  git(['config', 'user.name', 'IT'], proj);
};

/** (a) clean repo → not detected; (b) .husky/ → husky; (c) simple-git-hooks → detected. */
async function testDetect() {
  const { detectExistingHooksManager } = await importKit('tools/install/git.mjs');

  // (a) clean repo — no manager.
  const clean = tmp('clean');
  initRepo(clean);
  try {
    const res = await detectExistingHooksManager(clean);
    res.detected === false ? ok('clean repo → detected:false') : bad(`clean repo wrongly flagged: ${JSON.stringify(res)}`);
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }

  // (b) repo with a .husky/ directory.
  const husky = tmp('husky');
  initRepo(husky);
  mkdirSync(join(husky, '.husky'), { recursive: true });
  writeFileSync(join(husky, '.husky', 'pre-push'), '#!/bin/sh\nnpm test\n');
  try {
    const res = await detectExistingHooksManager(husky);
    res.detected === true && res.type === 'husky' && /husky/i.test(res.suggestion || '')
      ? ok('.husky/ → detected:true, suggestion mentions husky') : bad(`husky detection wrong: ${JSON.stringify(res)}`);
  } finally {
    rmSync(husky, { recursive: true, force: true });
  }

  // (c) simple-git-hooks key in package.json.
  const sgh = tmp('sgh');
  initRepo(sgh);
  writeFileSync(join(sgh, 'package.json'), JSON.stringify({ name: 'x', 'simple-git-hooks': { 'pre-commit': 'lint' } }));
  try {
    const res = await detectExistingHooksManager(sgh);
    res.detected === true && res.type === 'simple-git-hooks' && (res.suggestion || '').includes('contextkit/runtime/git-hooks')
      ? ok('simple-git-hooks in package.json → detected:true (suggestion targets our hooks)') : bad(`simple-git-hooks detection wrong: ${JSON.stringify(res)}`);
  } finally {
    rmSync(sgh, { recursive: true, force: true });
  }

  // (d) custom core.hooksPath ≠ ours (we never set one).
  const hp = tmp('hookspath');
  initRepo(hp);
  git(['config', 'core.hooksPath', '.githooks'], hp);
  try {
    const res = await detectExistingHooksManager(hp);
    res.detected === true && res.type === 'core.hooksPath' && (res.details || '').includes('.githooks')
      ? ok('custom core.hooksPath → detected:true') : bad(`core.hooksPath detection wrong: ${JSON.stringify(res)}`);
  } finally {
    rmSync(hp, { recursive: true, force: true });
  }

  // (e) detection never throws on a non-repo path.
  const bare = tmp('bare');
  try {
    const res = await detectExistingHooksManager(bare);
    res && res.detected === false ? ok('non-repo path → detected:false (never throws)') : bad(`non-repo path wrong: ${JSON.stringify(res)}`);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
}

async function main() {
  await testDetect();
  rep.finish('Integration (hook coexistence)');
}

main().catch((err) => {
  bad(`hook-coexist crashed: ${err?.stack || err}`);
  rep.finish('Integration (hook coexistence)');
});
