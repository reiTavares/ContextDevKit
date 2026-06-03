#!/usr/bin/env node
/**
 * VibeDevKit integration test — GUARDS (git hooks + config robustness + installer).
 *
 * Covers the safety nets that REJECT bad input rather than produce features —
 * the parts most dangerous to leave untested:
 *   - commit-msg.mjs   Conventional-Commits validator (enforces rule 5)
 *   - pre-push.mjs     conflict block / warn / allow + the audited bypass
 *   - load.mjs         zero-dep loader: deep-merge + BOM + malformed-JSON fallback
 *   - uninstall.mjs    --uninstall / --purge (destructive — keeps memory)
 *   - concurrency-guard external-edit branch; gh-alerts mappers; malformed-settings
 *
 * Shared harness: it-helpers.mjs. Run: node tools/integration-test-guards.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, run, git, readJson, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 VibeDevKit integration test — guards\n');

const importKit = (rel) => import('file://' + join(KIT, rel).replaceAll('\\', '/'));
const tmp = (tag) => mkdtempSync(join(tmpdir(), `vibekit-${tag}-`));
const seedConfig = (root, obj, { bom = false } = {}) => {
  mkdirSync(join(root, 'vibekit'), { recursive: true });
  writeFileSync(join(root, 'vibekit', 'config.json'), (bom ? '﻿' : '') + (typeof obj === 'string' ? obj : JSON.stringify(obj)));
};

/** 017 — the zero-dep config loader's defensive behaviours (deep-merge / BOM / malformed). */
async function testConfigLoader() {
  const { loadConfigSync } = await importKit('templates/vibekit/runtime/config/load.mjs');

  const partial = tmp('cfg-a');
  seedConfig(partial, { level: 3, ledger: { important: ['only/'] } });
  const merged = loadConfigSync(partial);
  merged.level === 3 && merged.ledger.important.join() === 'only/' && merged.l5 && typeof merged.l5 === 'object'
    ? ok('loadConfigSync deep-merges a partial override over defaults') : bad(`deepMerge wrong: ${JSON.stringify(merged.ledger)}`);

  const bom = tmp('cfg-b');
  seedConfig(bom, { level: 4 }, { bom: true });
  loadConfigSync(bom).level === 4 ? ok('loadConfigSync strips a UTF-8 BOM before parse') : bad('BOM not stripped');

  const broken = tmp('cfg-c');
  seedConfig(broken, '{ not: valid json,,');
  const empty = tmp('cfg-d');
  JSON.stringify(loadConfigSync(broken)) === JSON.stringify(loadConfigSync(empty))
    ? ok('loadConfigSync falls back to defaults on malformed JSON (never throws)') : bad('malformed JSON did not fall back to defaults');

  for (const d of [partial, bom, broken, empty]) rmSync(d, { recursive: true, force: true });
}

/** 018 — gh-alerts pure mappers (GitHub alert shape → finding). */
async function testGhAlertMappers() {
  const gha = await importKit('templates/vibekit/tools/scripts/gh-alerts.mjs');
  const dep = gha.mapDependabotAlert({ security_advisory: { severity: 'high', summary: 'XSS', ghsa_id: 'GHSA-x' }, dependency: { package: { name: 'lodash' }, manifest_path: 'package.json' } });
  dep.kind === 'dependabot' && dep.severity === 4 && dep.path === 'package.json' && dep.message.includes('lodash') && dep.source === 'gh:dependabot:package.json'
    ? ok('mapDependabotAlert shapes a finding (severity + source)') : bad(`mapDependabotAlert wrong: ${JSON.stringify(dep)}`);
  const cs = gha.mapCodeScanningAlert({ rule: { id: 'js/xss', security_severity_level: 'critical', description: 'desc' }, most_recent_instance: { location: { path: 'src/a.js' } } });
  cs.kind === 'code-scanning' && cs.severity === 5 && cs.path === 'src/a.js'
    ? ok('mapCodeScanningAlert shapes a finding') : bad(`mapCodeScanningAlert wrong: ${JSON.stringify(cs)}`);
  gha.mapDependabotAlert({}).severity === 2 && gha.mapCodeScanningAlert({}).severity === 2
    ? ok('gh-alerts mappers default unknown severity to a safe floor') : bad('gh-alerts severity floor missing');
}

/** 015 — commit-msg Conventional-Commits validator (exit 0 allow / 1 block). */
function testCommitMsg(proj) {
  const hook = join(proj, 'vibekit', 'runtime', 'git-hooks', 'commit-msg.mjs');
  const check = (msg) => {
    const f = join(proj, '_msg.txt');
    writeFileSync(f, msg + '\n');
    return run([hook, f], { cwd: proj }).status;
  };
  const cases = [
    ['feat(api): add endpoint', 0, 'valid type(scope)'],
    ['fix: correct thing', 0, 'valid no-scope'],
    ['added a thing', 1, 'missing type → blocked'],
    ['fix: trailing period.', 1, 'trailing period → blocked'],
    ["Merge branch 'x'", 0, 'merge commit allowed'],
    ['wip: messy [skip-cc]', 0, '[skip-cc] bypass allowed'],
  ];
  for (const [msg, want, label] of cases) {
    check(msg) === want ? ok(`commit-msg ${label}`) : bad(`commit-msg "${label}" expected exit ${want}`);
  }
}

/** 018 — concurrency-guard branch 2: the file changed on disk since we last wrote it. */
function testConcurrencyExternalEdit(proj) {
  const hook = (name, payload) => run([join(proj, 'vibekit', 'runtime', 'hooks', name)], { cwd: proj, input: JSON.stringify(payload) });
  const rel = 'src/ext.js';
  const abs = join(proj, rel);
  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(abs, 'v1\n');
  hook('track-edits.mjs', { session_id: 'extsess', tool_name: 'Write', tool_input: { file_path: rel } });
  // Force a strictly-newer mtime to simulate an external edit after we recorded ours.
  const future = new Date(Date.now() + 10_000);
  utimesSync(abs, future, future);
  const out = hook('concurrency-guard.mjs', { session_id: 'extsess', tool_name: 'Write', tool_input: { file_path: rel } }).stdout || '';
  out.includes('changed on disk') ? ok('concurrency-guard warns on an external on-disk edit') : bad(`concurrency-guard external-edit branch silent: ${out}`);
}

/** 018 — installer recreates a malformed .claude/settings.json instead of crashing. */
function testMalformedSettingsRecovery(proj) {
  const settings = join(proj, '.claude', 'settings.json');
  writeFileSync(settings, '{ this is : not json ,,');
  const res = run([join(KIT, 'install.mjs'), '--target', proj, '--update']);
  let parsed = null;
  try {
    parsed = readJson(settings);
  } catch {
    /* stays null */
  }
  res.status === 0 && parsed && parsed.hooks
    ? ok('installer recovers from a malformed settings.json (--update)') : bad(`malformed-settings recovery failed (status ${res.status})`);
}

/** 016 — pre-push conflict gate: allow disjoint, warn on auto-merge, block real conflict, bypass. */
function testPrePush() {
  const fx = installFixture(rep);
  const { proj } = fx;
  const remote = tmp('remote');
  const clone = tmp('clone');
  const hook = join(proj, 'vibekit', 'runtime', 'git-hooks', 'pre-push.mjs');
  const pp = (env) => run([hook], { cwd: proj, env: { ...process.env, ...env } });
  const commit = (cwd, m) => {
    git(['add', '-A'], cwd);
    git(['commit', '-m', m, '--no-verify'], cwd);
  };
  try {
    writeFileSync(join(proj, 'shared.txt'), 'a\nb\nc\nd\ne\n');
    writeFileSync(join(proj, 'mergeable.txt'), '1\n2\n3\n4\n5\n');
    writeFileSync(join(proj, 'other.txt'), 'x\n');
    commit(proj, 'feat: base');
    git(['init', '--bare', '-b', 'main', remote]);
    git(['remote', 'add', 'origin', remote], proj);
    git(['push', '-u', 'origin', 'main'], proj);
    // Origin diverges (via a clone): change shared.txt line c + mergeable.txt line 1.
    git(['clone', remote, clone]);
    git(['config', 'user.email', 'it@example.com'], clone);
    git(['config', 'user.name', 'IT'], clone);
    writeFileSync(join(clone, 'shared.txt'), 'a\nb\nREMOTE_C\nd\ne\n');
    writeFileSync(join(clone, 'mergeable.txt'), 'REMOTE_1\n2\n3\n4\n5\n');
    commit(clone, 'feat: remote change');
    git(['push', 'origin', 'main'], clone);

    // allow: local touches only other.txt → no overlap with origin.
    writeFileSync(join(proj, 'other.txt'), 'y\n');
    commit(proj, 'feat: local disjoint');
    const allow = pp();
    allow.status === 0 && !/both changed|BLOCKED/.test(allow.stderr || '') ? ok('pre-push ALLOWS a disjoint push') : bad(`pre-push didn't allow disjoint (status ${allow.status})`);

    // warn: local edits mergeable.txt line 5 (origin edited line 1) → auto-merge → exit 0 + notice.
    writeFileSync(join(proj, 'mergeable.txt'), '1\n2\n3\n4\nLOCAL_5\n');
    commit(proj, 'feat: local mergeable');
    const warn = pp();
    warn.status === 0 && /both changed/.test(warn.stderr || '') ? ok('pre-push WARNS on an auto-mergeable overlap') : bad(`pre-push warn case wrong (status ${warn.status})`);

    // block: local edits shared.txt line c (origin made it REMOTE_C) → real conflict.
    writeFileSync(join(proj, 'shared.txt'), 'a\nb\nLOCAL_C\nd\ne\n');
    commit(proj, 'feat: local conflict');
    pp().status === 1 ? ok('pre-push BLOCKS a real conflict') : bad('pre-push did not block a real conflict');

    // bypass: same conflicting state, audited override.
    pp({ VIBE_ALLOW_CONFLICT_PUSH: '1' }).status === 0 ? ok('pre-push bypass (VIBE_ALLOW_CONFLICT_PUSH) allows') : bad('pre-push bypass did not allow');
  } catch (err) {
    bad(`pre-push setup crashed: ${err?.message ?? err}`);
  } finally {
    fx.cleanup();
    rmSync(remote, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
}

/** 014 — uninstall removes wiring (keeps memory); purge removes engine (keeps memory + CLAUDE.md). */
function testUninstall() {
  const fx1 = installFixture(rep);
  try {
    run([join(KIT, 'install.mjs'), '--target', fx1.proj, '--uninstall']);
    const settings = readJson(join(fx1.proj, '.claude', 'settings.json'));
    const wired = Object.values(settings.hooks || {}).some((groups) => (groups || []).some((g) => (g.hooks || []).some((h) => String(h.command).includes('vibekit/runtime/hooks'))));
    !wired ? ok('uninstall strips VibeDevKit hook wiring from settings.json') : bad('uninstall left hook wiring behind');
    !existsSync(join(fx1.proj, '.git', 'hooks', 'pre-push')) ? ok('uninstall removes the git hooks') : bad('uninstall left git hooks');
    existsSync(join(fx1.proj, 'vibekit', 'runtime')) && existsSync(join(fx1.proj, 'CLAUDE.md')) ? ok('uninstall keeps the engine + CLAUDE.md (non-purge)') : bad('uninstall wrongly removed engine/CLAUDE.md');
  } finally {
    fx1.cleanup();
  }
  const fx2 = installFixture(rep);
  try {
    run([join(KIT, 'install.mjs'), '--target', fx2.proj, '--uninstall', '--purge']);
    !existsSync(join(fx2.proj, 'vibekit', 'runtime')) && !existsSync(join(fx2.proj, '.claude', 'commands'))
      ? ok('purge removes the engine + commands') : bad('purge left engine/commands');
    existsSync(join(fx2.proj, 'vibekit', 'memory')) && existsSync(join(fx2.proj, 'CLAUDE.md'))
      ? ok('purge KEEPS memory + CLAUDE.md (no data loss)') : bad('purge destroyed memory/CLAUDE.md');
  } finally {
    fx2.cleanup();
  }
}

/** 038 — installer follows .git pointer in worktrees (`.git` is a file, not a dir).
 *  Simulates the worktree layout by writing a `.git` file with `gitdir: <path>`
 *  and asserting hooks land in the pointed-at directory, not at `<target>/.git/hooks/`. */
function testInstallerWorktreeGitPointer() {
  const target = tmp('wtgit');
  const gitdir = tmp('wtgit-gitdir');
  mkdirSync(join(gitdir, 'hooks'), { recursive: true });
  // Write the `.git` file pointer that git itself writes in a worktree.
  writeFileSync(join(target, '.git'), `gitdir: ${gitdir.replaceAll('\\', '/')}\n`);
  // The installer needs a package.json / minimal project to run cleanly.
  writeFileSync(join(target, 'package.json'), '{"name":"wt-fixture"}');
  try {
    const r = run([join(KIT, 'install.mjs'), '--target', target, '--level', '3', '--name', 'Worktree', '--yes']);
    r.status === 0 ? ok('installer succeeds against a worktree-shaped .git (bug 038 fixed)') : bad(`installer failed in worktree: ${r.stderr || r.stdout}`);
    existsSync(join(gitdir, 'hooks', 'pre-commit'))
      ? ok('installer writes hooks into the resolved gitdir, not into `<target>/.git/hooks/`') : bad('hooks not found in resolved gitdir');
    const installed = existsSync(join(gitdir, 'hooks', 'pre-commit')) ? readFileSync(join(gitdir, 'hooks', 'pre-commit'), 'utf-8') : '';
    installed.includes('vibekit/runtime/git-hooks')
      ? ok('installed hook in worktree points at vibekit/runtime') : bad(`hook body wrong: ${installed}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(gitdir, { recursive: true, force: true });
  }
}

// Compozy follow-through lifecycle tests (workflow/041, distill-detect/043,
// resume/046) live in the sibling `integration-test-compozy.mjs`.

/** 021 — installer backs up a pre-existing non-ours git hook instead of clobbering it. */
function testInstallerHookBackup() {
  const proj = tmp('hookbk');
  git(['init', '-b', 'main'], proj);
  git(['config', 'user.email', 'it@example.com'], proj);
  git(['config', 'user.name', 'IT'], proj);
  const hooksDir = join(proj, '.git', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "my custom hook"\n');
  try {
    run([join(KIT, 'install.mjs'), '--target', proj, '--level', '3', '--name', 'HookBak', '--yes']);
    const installed = readFileSync(join(hooksDir, 'pre-commit'), 'utf-8');
    const backup = existsSync(join(hooksDir, 'pre-commit.bak')) ? readFileSync(join(hooksDir, 'pre-commit.bak'), 'utf-8') : '';
    installed.includes('vibekit/runtime/git-hooks') && backup.includes('my custom hook')
      ? ok('installer backs up an existing non-ours git hook (.bak)') : bad(`installer hook backup failed: backup="${backup.trim()}"`);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
}

async function main() {
  await testConfigLoader();
  await testGhAlertMappers();
  testInstallerHookBackup();
  testInstallerWorktreeGitPointer();
  const fx = installFixture(rep);
  try {
    testCommitMsg(fx.proj);
    testConcurrencyExternalEdit(fx.proj);
    testMalformedSettingsRecovery(fx.proj);
  } finally {
    fx.cleanup();
  }
  testPrePush();
  testUninstall();
  rep.finish('Integration (guards)');
}

main().catch((err) => {
  bad(`guards crashed: ${err?.stack || err}`);
  rep.finish('Integration (guards)');
});
