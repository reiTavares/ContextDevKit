#!/usr/bin/env node
/**
 * Integration test — P0-06, P0-03, P0-04: updater failure-boundary assertions.
 *
 * Four behavioural scenarios — no internal mocking framework required.
 * All temp state lives under os.tmpdir(); cleaned up on exit.
 *
 * ENGINE-VERSION-LAST (P0-06)
 *   After a successful install .engine-version exists and equals the kit version.
 *   Structural ordering guarantee: engine.mjs's copyEngine must NOT stamp
 *   .engine-version (grep for '.engine-version' inside copyEngine is absent);
 *   stampEngineVersion must exist in the same file.
 *
 * SNAPSHOT-INTEGRITY (P0-03)
 *   snapshotCriticalState() with real critical files → ok === true.
 *   A corrupted/missing source still yields a structured result (ok false or a
 *   skipped entry), never an unhandled throw.
 *
 * DEFER-ZERO-WRITES (P0-04)
 *   A project with an ACTIVE ledger (unregistered + modifications) causes
 *   --update to exit 0 with DEFERRED message AND leaves the project tree
 *   fingerprint completely unchanged (zero writes).
 *
 * HONEST-STATUS
 *   The deferred run's stdout contains 'DEFERRED_ACTIVE_SESSIONS' and does
 *   NOT contain 'UPDATED to'.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, run, git, readJson, reporter } from './it-helpers.mjs';
import { snapshotCriticalState, newUpdateId } from './install/update-snapshot.mjs';

const rep = reporter();
console.log('\n🌀 ContextDevKit integration test — updater failure boundaries\n');

const kitVersion = readJson(join(KIT, 'package.json')).version;
const engineMjs = join(KIT, 'tools', 'install', 'engine.mjs');

/**
 * Initialises a bare git repo at `dir`.
 * @param {string} dir
 */
function initGit(dir) {
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'it@example.com'], dir);
  git(['config', 'user.name', 'IT'], dir);
}

/**
 * Runs a fresh install at `level` 7 with --yes.
 * @param {string} proj
 */
function freshInstall(proj) {
  return run([join(KIT, 'install.mjs'), '--target', proj, '--level', '7', '--yes']);
}

/**
 * Builds a sorted fingerprint of all file paths + mtimes under `dir`.
 * Used to verify zero writes.
 * @param {string} dir
 * @returns {string}
 */
function fingerprint(dir) {
  const entries = [];
  function walk(d) {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        entries.push(`${full}:${statSync(full).mtimeMs}`);
      }
    }
  }
  walk(dir);
  return entries.sort().join('\n');
}

// ── ENGINE-VERSION-LAST (P0-06) ───────────────────────────────────────────
(() => {
  const proj = mkdtempSync(join(tmpdir(), 'contextkit-evlast-'));
  try {
    initGit(proj);
    const inst = freshInstall(proj);
    inst.status === 0
      ? rep.ok('ENGINE-VERSION-LAST: fresh install exits 0')
      : rep.bad(`ENGINE-VERSION-LAST: install failed (${inst.status}): ${inst.stderr}`);

    // .engine-version exists and equals the kit version after a successful install.
    const evPath = join(proj, 'contextkit', '.engine-version');
    const ev = existsSync(evPath) ? readFileSync(evPath, 'utf-8').trim() : null;
    ev === kitVersion
      ? rep.ok(`ENGINE-VERSION-LAST: .engine-version == "${kitVersion}" after install (P0-06)`)
      : rep.bad(`ENGINE-VERSION-LAST: .engine-version mismatch — expected "${kitVersion}", got "${ev}"`);

    // Structural: copyEngine in engine.mjs must NOT reference '.engine-version'.
    // stampEngineVersion must appear in the same file.
    let engineSrc;
    try {
      engineSrc = readFileSync(engineMjs, 'utf-8');
    } catch (err) {
      rep.bad(`ENGINE-VERSION-LAST: cannot read engine.mjs: ${err.message}`);
      return;
    }
    const copyEngineFn = engineSrc.match(/async function copyEngine[\s\S]*?^}/m)?.[0] ?? '';
    !copyEngineFn.includes('.engine-version')
      ? rep.ok('ENGINE-VERSION-LAST: copyEngine does NOT stamp .engine-version (ordering guarantee)')
      : rep.bad('ENGINE-VERSION-LAST: copyEngine contains .engine-version — ordering guarantee VIOLATED');

    engineSrc.includes('stampEngineVersion')
      ? rep.ok('ENGINE-VERSION-LAST: stampEngineVersion export present in engine.mjs')
      : rep.bad('ENGINE-VERSION-LAST: stampEngineVersion missing from engine.mjs');
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
})();

// ── SNAPSHOT-INTEGRITY (P0-03) ────────────────────────────────────────────
await (async () => {
  const proj = mkdtempSync(join(tmpdir(), 'contextkit-snap-'));
  const backupRoot = mkdtempSync(join(tmpdir(), 'contextkit-snap-backup-'));
  // Seed the minimal critical files so snapshotCriticalState has something to copy.
  mkdirSync(join(proj, '.claude'), { recursive: true });
  mkdirSync(join(proj, 'contextkit'), { recursive: true });
  writeFileSync(join(proj, '.claude', 'settings.json'), '{"permissions":[]}\n');
  writeFileSync(join(proj, 'contextkit', 'config.json'), '{"level":7}\n');
  writeFileSync(join(proj, 'contextkit', '.engine-version'), `${kitVersion}\n`);

  try {
    // Normal path: all files present → ok === true.
    const snapOk = await snapshotCriticalState(proj, newUpdateId(), { root: backupRoot });
    snapOk.ok === true
      ? rep.ok(`SNAPSHOT-INTEGRITY: snapshot ok with real files (${snapOk.files.length} copied)`)
      : rep.bad(`SNAPSHOT-INTEGRITY: unexpected ok=false with real files: ${JSON.stringify(snapOk.skipped)}`);
    Array.isArray(snapOk.files) && snapOk.files.length > 0
      ? rep.ok('SNAPSHOT-INTEGRITY: files array is populated')
      : rep.bad('SNAPSHOT-INTEGRITY: files array is empty');

    // Corrupt/missing source: point at a nonexistent directory.
    let threwOnBadInput = false;
    let badResult;
    try {
      badResult = await snapshotCriticalState(
        join(tmpdir(), 'contextkit-nonexistent-' + Date.now()),
        newUpdateId(),
        { root: backupRoot },
      );
    } catch {
      threwOnBadInput = true;
    }
    !threwOnBadInput
      ? rep.ok('SNAPSHOT-INTEGRITY: missing source dir does not throw (structured result)')
      : rep.bad('SNAPSHOT-INTEGRITY: missing source dir threw instead of returning a structured result');

    // When source is absent the result may have ok === true (no files to copy)
    // or ok === false; either way it must be a valid structured object.
    if (!threwOnBadInput) {
      const isStructured =
        badResult !== null &&
        typeof badResult === 'object' &&
        typeof badResult.ok === 'boolean' &&
        Array.isArray(badResult.files) &&
        Array.isArray(badResult.skipped);
      isStructured
        ? rep.ok('SNAPSHOT-INTEGRITY: bad-input result has the expected {ok,files,skipped} shape')
        : rep.bad(`SNAPSHOT-INTEGRITY: bad-input result malformed: ${JSON.stringify(badResult)}`);
    }

    // opts.root missing (null home dir path) → ok === false, structured result.
    let threwOnNoRoot = false;
    let noRootResult;
    try {
      // Force homedir() to fail by passing an empty-string root.
      // snapshotCriticalState treats an empty opts.root as if homedir() returned ''.
      noRootResult = await snapshotCriticalState(proj, newUpdateId(), { root: '' });
    } catch {
      threwOnNoRoot = true;
    }
    !threwOnNoRoot
      ? rep.ok('SNAPSHOT-INTEGRITY: empty opts.root does not throw (structured result)')
      : rep.bad('SNAPSHOT-INTEGRITY: empty opts.root threw instead of returning structured result');
    if (!threwOnNoRoot) {
      noRootResult.ok === false && Array.isArray(noRootResult.skipped) && noRootResult.skipped.length > 0
        ? rep.ok('SNAPSHOT-INTEGRITY: empty opts.root → ok:false with skipped[] entry')
        : rep.bad(`SNAPSHOT-INTEGRITY: empty opts.root result unexpected: ${JSON.stringify(noRootResult)}`);
    }
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  }
})();

// ── DEFER-ZERO-WRITES + HONEST-STATUS ────────────────────────────────────
(() => {
  const proj = mkdtempSync(join(tmpdir(), 'contextkit-defer-'));
  try {
    initGit(proj);
    const inst = freshInstall(proj);
    inst.status === 0
      ? rep.ok('DEFER-ZERO-WRITES: fresh install exits 0')
      : rep.bad(`DEFER-ZERO-WRITES: install failed (${inst.status}): ${inst.stderr}`);

    // Inject an ACTIVE ledger: unregistered + non-empty modifications array.
    // The installer does NOT create .sessions; seed the directory explicitly.
    const sessionsDir = join(proj, '.claude', '.sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const activeLedger = JSON.stringify({
      sessionId: 'test-active-session',
      registered: false,
      modifications: ['some-file.md'],
      activeTask: null,
    }, null, 2);
    writeFileSync(join(sessionsDir, 'test-active-session.json'), activeLedger, 'utf-8');

    // Capture project tree fingerprint BEFORE the deferred --update.
    const fp1 = fingerprint(proj);

    // Run --update WITHOUT --allow-active-sessions.
    const deferredRun = run([join(KIT, 'install.mjs'), '--target', proj, '--update']);

    // Must exit 0 (deferral is a safe stop, not an error).
    deferredRun.status === 0
      ? rep.ok('DEFER-ZERO-WRITES: deferred --update exits 0')
      : rep.bad(`DEFER-ZERO-WRITES: deferred run exited ${deferredRun.status} (expected 0)`);

    // Fingerprint MUST be unchanged (zero writes).
    const fp2 = fingerprint(proj);
    fp1 === fp2
      ? rep.ok('DEFER-ZERO-WRITES: project tree fingerprint unchanged after deferred --update (zero writes)')
      : rep.bad('DEFER-ZERO-WRITES: project tree changed during a deferred --update (writes detected)');

    // HONEST-STATUS: stdout must contain DEFERRED_ACTIVE_SESSIONS.
    const stdout = deferredRun.stdout ?? '';
    stdout.includes('DEFERRED_ACTIVE_SESSIONS')
      ? rep.ok("HONEST-STATUS: stdout contains 'DEFERRED_ACTIVE_SESSIONS'")
      : rep.bad(`HONEST-STATUS: stdout missing 'DEFERRED_ACTIVE_SESSIONS': ${stdout.slice(0, 300)}`);

    // HONEST-STATUS: stdout must NOT contain 'UPDATED to'.
    !stdout.includes('UPDATED to')
      ? rep.ok("HONEST-STATUS: stdout does NOT contain 'UPDATED to' on a deferred run")
      : rep.bad("HONEST-STATUS: stdout contains 'UPDATED to' on a deferred run — false success claim");

    // .engine-version must be unchanged (the prior install version, not a new stamp).
    const evPath = join(proj, 'contextkit', '.engine-version');
    const ev = existsSync(evPath) ? readFileSync(evPath, 'utf-8').trim() : null;
    ev === kitVersion
      ? rep.ok('DEFER-ZERO-WRITES: .engine-version unchanged after deferred update')
      : rep.bad(`DEFER-ZERO-WRITES: .engine-version changed during deferred update: "${ev}"`);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
})();

rep.finish('Integration (updater failure boundaries, P0-03/04/06)');
