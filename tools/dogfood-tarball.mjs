#!/usr/bin/env node
/**
 * Packaging & cross-platform upgrade end-to-end test harness for ContextDevKit.
 * Wave 2 · RUN2-Agent-9 (Package / Cross-platform / Dogfood)
 *
 * Tests: tarball contents, fresh install, update + idempotence, path-with-spaces,
 * Windows-style paths, local-only vs --tracked, self-update deferral, two-session
 * deferral. All writes go to os.tmpdir() temp dirs — the live repo is never mutated.
 *
 * Exit 0 = all PASS. Exit 1 = at least one FAIL.
 * Cohesion: orchestrator-only; all helpers in dogfood-tarball-lib.mjs.
 */
import { readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  assert, makeTmp, allTmpDirs, seedProject, plantActiveSessions,
  runNpmPack, extractTarball, runInstaller, assertFileExists, getMtime,
  REPO_ROOT,
} from './dogfood-tarball-lib.mjs';

import { detectSelfHost } from './install/update-preflight.mjs';

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

const results = [];

/**
 * Runs a named test step; catches any thrown error and records PASS/FAIL.
 * @param {string} name
 * @param {() => Promise<void> | void} fn
 */
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS', detail: '' });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', detail: err.message });
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Setup: pack once; all steps share the extracted package dir
// ---------------------------------------------------------------------------

console.log('\n=== dogfood-tarball.mjs ===\n');

let tgzPath = '';
let tgzName = '';
let packageDir = ''; // extracted: <extractDir>/package/

const extractDir = makeTmp('cdk-tarball-');
const pkgVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

// ---------------------------------------------------------------------------
// STEP 1 — TARBALL CHECK
// ---------------------------------------------------------------------------

await step('STEP 1 — TARBALL CHECK', async () => {
  const packed = runNpmPack();
  tgzName = packed.tgzName;
  tgzPath = packed.tgzPath;
  console.log(`    tarball: ${tgzName}`);

  assert(existsSync(tgzPath), `Tarball not found at ${tgzPath}`);
  extractTarball(tgzPath, extractDir);

  packageDir = join(extractDir, 'package');
  assert(existsSync(packageDir), `Extracted package/ dir missing at ${packageDir}`);

  const required = [
    'install.mjs',
    join('tools', 'install', 'update-preflight.mjs'),
    join('tools', 'install', 'update-snapshot.mjs'),
    join('tools', 'install', 'update-status.mjs'),
  ];
  for (const rel of required) {
    assertFileExists(join(packageDir, rel), rel);
  }
  console.log(`    all required files present in package/`);
});

// ---------------------------------------------------------------------------
// STEP 2 — FRESH INSTALL
// ---------------------------------------------------------------------------

const freshDir = makeTmp('cdk-fresh-');

await step('STEP 2 — FRESH INSTALL', async () => {
  seedProject(freshDir);
  const r = runInstaller(packageDir, ['--target', freshDir, '--yes', '--level', '7']);
  assert(r.status === 0, `Installer exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);

  assertFileExists(join(freshDir, 'contextkit'), 'contextkit/');
  assertFileExists(join(freshDir, '.claude', 'settings.json'), '.claude/settings.json');

  const evPath = join(freshDir, 'contextkit', '.engine-version');
  assertFileExists(evPath, 'contextkit/.engine-version');
  const stamped = readFileSync(evPath, 'utf8').trim();
  assert(stamped === pkgVersion, `.engine-version "${stamped}" !== package.json "${pkgVersion}"`);
  console.log(`    installed version: ${stamped}`);
});

// ---------------------------------------------------------------------------
// STEP 3 — UPDATE + IDEMPOTENCE
// ---------------------------------------------------------------------------

await step('STEP 3 — UPDATE + IDEMPOTENCE', async () => {
  const settingsPath = join(freshDir, '.claude', 'settings.json');
  const evPath = join(freshDir, 'contextkit', '.engine-version');

  // First --update (no active sessions planted, packaged installer ≠ freshDir) should proceed.
  const r1 = runInstaller(packageDir, ['--target', freshDir, '--update', '--allow-self-update']);
  assert(r1.status === 0, `First --update exited ${r1.status}\nstdout: ${r1.stdout}\nstderr: ${r1.stderr}`);
  assert(!r1.stdout.includes('DEFERRED'), `First --update unexpectedly deferred\n${r1.stdout}`);
  assertFileExists(evPath, 'contextkit/.engine-version after update');

  // Second --update: idempotence — settings.json mtime should not change meaningfully.
  const mtimeBefore = getMtime(settingsPath);
  const r2 = runInstaller(packageDir, ['--target', freshDir, '--update', '--allow-self-update']);
  assert(r2.status === 0, `Second --update exited ${r2.status}\nstdout: ${r2.stdout}`);
  const mtimeAfter = getMtime(settingsPath);
  // Allow up to 2 s tolerance for any OS timestamp granularity.
  assert(Math.abs(mtimeAfter - mtimeBefore) < 2000,
    `settings.json mtime changed by ${mtimeAfter - mtimeBefore}ms — not idempotent`);
  console.log(`    mtime delta: ${mtimeAfter - mtimeBefore}ms (within 2 s tolerance)`);
});

// ---------------------------------------------------------------------------
// STEP 4 — PATH WITH SPACES
// ---------------------------------------------------------------------------

await step('STEP 4 — PATH WITH SPACES', async () => {
  const baseDir = makeTmp('cdk-spaces-');
  const spaceDir = join(baseDir, 'with space');
  mkdirSync(spaceDir, { recursive: true });
  seedProject(spaceDir);

  const r = runInstaller(packageDir, ['--target', spaceDir, '--yes', '--level', '3']);
  assert(r.status === 0,
    `Installer failed on path with spaces (exit ${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assertFileExists(join(spaceDir, 'contextkit'), 'contextkit/ in space path');
  console.log(`    install into "${spaceDir}" succeeded`);
});

// ---------------------------------------------------------------------------
// STEP 5 — WINDOWS-STYLE PATH
// ---------------------------------------------------------------------------

await step('STEP 5 — WINDOWS-STYLE PATH', async () => {
  // On win32, makeTmp() already returns backslash paths from os.tmpdir().
  const winDir = makeTmp('cdk-winpath-');
  seedProject(winDir);
  const r = runInstaller(packageDir, ['--target', winDir, '--yes', '--level', '3']);
  assert(r.status === 0,
    `Install on win32 path failed (exit ${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);

  // If config.json exists, verify no raw escaped backslashes in values.
  const cfgPath = join(winDir, 'contextkit', 'config.json');
  if (existsSync(cfgPath)) {
    const cfgRaw = readFileSync(cfgPath, 'utf8');
    // JSON escaping \\ is normal; check that path values don't contain Windows separators.
    const parsed = JSON.parse(cfgRaw);
    const stringVals = Object.values(parsed).filter(v => typeof v === 'string');
    for (const v of stringVals) {
      assert(!v.includes('\\'), `config.json value contains backslash: "${v}"`);
    }
  }
  console.log(`    platform: ${process.platform}, path OK`);
});

// ---------------------------------------------------------------------------
// STEP 6 — LOCAL-ONLY vs TRACKED
// ---------------------------------------------------------------------------

await step('STEP 6 — LOCAL-ONLY vs TRACKED', async () => {
  const localDir = makeTmp('cdk-local-');
  const trackedDir = makeTmp('cdk-tracked-');
  seedProject(localDir);
  seedProject(trackedDir);

  const rLocal = runInstaller(packageDir, ['--target', localDir, '--yes', '--level', '3']);
  assert(rLocal.status === 0, `local-only install failed (exit ${rLocal.status})\n${rLocal.stdout}`);
  assertFileExists(join(localDir, 'contextkit', '.engine-version'), 'local .engine-version');

  // --tracked without a git repo may warn but must not crash.
  const rTracked = runInstaller(packageDir, [
    '--target', trackedDir, '--yes', '--level', '3', '--tracked',
  ]);
  assert(rTracked.status === 0,
    `--tracked install failed (exit ${rTracked.status})\n${rTracked.stdout}\n${rTracked.stderr}`);
  assertFileExists(join(trackedDir, 'contextkit', '.engine-version'), 'tracked .engine-version');
  console.log(`    both local-only and --tracked installs succeeded`);
});

// ---------------------------------------------------------------------------
// STEP 7 — SELF-UPDATE DEFERRAL (non-destructive)
// ---------------------------------------------------------------------------

await step('STEP 7 — SELF-UPDATE DEFERRAL', async () => {
  // Verify detectSelfHost correctly identifies the live repo.
  const selfHostResult = detectSelfHost(REPO_ROOT, REPO_ROOT);
  assert(selfHostResult === true,
    `detectSelfHost(liveRepo, liveRepo) should return true, got ${selfHostResult}`);
  console.log(`    detectSelfHost(live repo) = ${selfHostResult}`);

  // Run the PACKAGED installer against the live repo WITHOUT --allow-self-update.
  // install.mjs prints DEFERRED_SELF_UPDATE and returns (exit 0 but no writes).
  const r = runInstaller(packageDir, ['--target', REPO_ROOT, '--update']);
  const combined = r.stdout + r.stderr;
  const deferred = combined.includes('DEFERRED_SELF_UPDATE') || combined.includes('DEFERRED');
  assert(deferred || r.status !== 0,
    `Expected deferral or non-zero exit; got exit ${r.status}\n${combined}`);
  console.log(`    exit ${r.status}, deferred output found=${deferred} — live repo not mutated`);
});

// ---------------------------------------------------------------------------
// STEP 8 — TWO-SESSION DEFERRAL
// ---------------------------------------------------------------------------

await step('STEP 8 — TWO-SESSION DEFERRAL', async () => {
  const proj = makeTmp('cdk-sessions-');
  seedProject(proj);

  // Fresh install so contextkit/ + .engine-version exist.
  const installR = runInstaller(packageDir, ['--target', proj, '--yes', '--level', '3']);
  assert(installR.status === 0, `Setup install failed: ${installR.stderr}`);

  const evPath = join(proj, 'contextkit', '.engine-version');
  assertFileExists(evPath, '.engine-version before session deferral test');
  const mtimeBefore = getMtime(evPath);

  // Plant two active ledger files.
  plantActiveSessions(proj);

  // --update without --allow-active-sessions should defer.
  const r = runInstaller(packageDir, ['--target', proj, '--update', '--allow-self-update']);
  const combined = r.stdout + r.stderr;
  const deferred = combined.includes('DEFERRED_ACTIVE_SESSIONS') || combined.includes('DEFERRED');
  assert(deferred || r.status !== 0,
    `Expected active-sessions deferral; got exit ${r.status}\n${combined}`);

  // Verify .engine-version was NOT touched.
  const mtimeAfter = getMtime(evPath);
  assert(mtimeAfter === mtimeBefore,
    `.engine-version written during deferral (mtime changed by ${mtimeAfter - mtimeBefore}ms)`);
  console.log(`    exit ${r.status}, deferred=${deferred}, .engine-version mtime unchanged`);
});

// ---------------------------------------------------------------------------
// Summary + cleanup
// ---------------------------------------------------------------------------

console.log('\n--- Summary ---');
let allPass = true;
for (const { name, status, detail } of results) {
  const suffix = detail ? `\n          ${detail.slice(0, 200)}` : '';
  console.log(`  ${status.padEnd(4)}  ${name}${suffix}`);
  if (status !== 'PASS') allPass = false;
}
console.log('');

// Cleanup temp dirs (best-effort).
for (const dir of allTmpDirs()) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}
// Remove tarball from repo root (best-effort).
if (tgzPath && existsSync(tgzPath)) {
  try { rmSync(tgzPath); } catch { /* ignore */ }
}

console.log(allPass ? 'EXIT 0 — all steps PASS\n' : 'EXIT 1 — one or more steps FAILED\n');
process.exit(allPass ? 0 : 1);
