#!/usr/bin/env node
/**
 * Integration test — P0-01: SessionStart must NEVER permanently delete a ledger.
 *
 * Regression test for the proven incident root cause: `analyzePriorLedgers()`
 * used to call `rm(ledgerPathFor(sessionId))` when a ledger was resolved
 * (registered OR no pending important paths). After an `--update`-triggered
 * restart, recently-resolved sessions were silently wiped.
 *
 * This test asserts the core invariant after the fix:
 *   Every ledger file present before SessionStart runs is still present after.
 *
 * Ledger fixtures:
 *   (a) OLD resolved (registered:true, modifications older than 15 min)
 *   (b) No pending important paths, not registered, old
 *   (c) Fresh/empty ledger (no modifications)
 *   (d) Concurrent-live ledger (very recent modifications)
 *   (e) Ledger WITH pending important paths → reported as drift, NOT deleted
 *
 * Run:  node tools/integration-test-session-safety.mjs  (exit 0 = pass)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSION_START = resolve(KIT, 'templates/contextkit/runtime/hooks/session-start.mjs');

/** Ledger directory relative to the project root — mirrors LEDGER_DIR in paths.mjs. */
const LEDGER_REL = '.claude/.sessions';

const rep = reporter();
const { ok, bad } = rep;

console.log('\n🌀 Integration test — session ledger safety (P0-01)\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a minimal throwaway temp project rooted at a mkdtemp directory.
 * Returns the project path and a cleanup function.
 *
 * @returns {{ proj: string, sessionsDir: string, cleanup: () => void }}
 */
function makeTempProject() {
  const proj = mkdtempSync(join(tmpdir(), 'ckit-ss-safety-'));
  const sessionsDir = join(proj, LEDGER_REL);
  mkdirSync(sessionsDir, { recursive: true });
  return { proj, sessionsDir, cleanup: () => rmSync(proj, { recursive: true, force: true }) };
}

/**
 * Writes a ledger JSON file into the sessions directory.
 *
 * @param {string} sessionsDir
 * @param {string} sessionId
 * @param {object} ledgerData
 * @returns {string} full path to the written file
 */
function writeLedgerFile(sessionsDir, sessionId, ledgerData) {
  const filePath = join(sessionsDir, `${sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(ledgerData, null, 2), 'utf-8');
  return filePath;
}

/**
 * Runs session-start.mjs as a subprocess with `cwd` set to `proj`.
 * Sends a JSON payload via stdin as Claude Code does. Returns stdout + stderr.
 *
 * @param {string} proj project root (cwd for the hook)
 * @param {string} sessionId the booting session's id
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runSessionStart(proj, sessionId) {
  const payload = JSON.stringify({ session_id: sessionId, hook_event_name: 'SessionStart' });
  const result = spawnSync(process.execPath, [SESSION_START], {
    cwd: proj,
    input: payload,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// Timestamps: old = >15 min ago; recent = now.
const OLD_TS = Date.now() - 20 * 60 * 1000; // 20 minutes ago
const NOW_TS = Date.now();

// ── Main test block ───────────────────────────────────────────────────────────

const { proj, sessionsDir, cleanup } = makeTempProject();

try {
  // ── Fixture (a): old resolved ledger — registered:true, modifications old ──
  const sidA = 'aaa-old-registered';
  writeLedgerFile(sessionsDir, sidA, {
    sessionId: sidA,
    startedAt: OLD_TS - 60_000,
    modifications: [
      { path: 'contextkit/memory/sessions/2026-06-01-foo.md', tool: 'Write', at: OLD_TS - 30_000 },
    ],
    registered: true,
    stopWarnedAt: null,
    simulations: [],
    squads: [],
    routing: null,
  });

  // ── Fixture (b): old ledger — no pending important paths, not registered ───
  const sidB = 'bbb-no-pending';
  writeLedgerFile(sessionsDir, sidB, {
    sessionId: sidB,
    startedAt: OLD_TS - 90_000,
    modifications: [
      // Registration file only — isRegistrationFile → not "important pending"
      { path: 'contextkit/memory/sessions/2026-06-02-bar.md', tool: 'Write', at: OLD_TS - 60_000 },
    ],
    registered: false,
    stopWarnedAt: null,
    simulations: [],
    squads: [],
    routing: null,
  });

  // ── Fixture (c): fresh/empty ledger (no modifications) ───────────────────
  const sidC = 'ccc-fresh-empty';
  writeLedgerFile(sessionsDir, sidC, {
    sessionId: sidC,
    startedAt: NOW_TS - 5_000,
    modifications: [],
    registered: false,
    stopWarnedAt: null,
    simulations: [],
    squads: [],
    routing: null,
  });

  // ── Fixture (d): concurrent-live — very recent modifications ─────────────
  const sidD = 'ddd-concurrent-live';
  writeLedgerFile(sessionsDir, sidD, {
    sessionId: sidD,
    startedAt: NOW_TS - 10_000,
    modifications: [
      { path: 'templates/contextkit/runtime/hooks/ledger.mjs', tool: 'Edit', at: NOW_TS - 2_000 },
    ],
    registered: false,
    stopWarnedAt: null,
    simulations: [],
    squads: [],
    routing: null,
  });

  // ── Fixture (e): unresolved drift — has pending important paths ───────────
  // Path must match the DEFAULT important prefixes (src/, lib/, etc.) because
  // the temp project has no contextkit/config.json.
  const sidE = 'eee-drift-pending';
  const pendingPath = 'src/core/session-manager.ts';
  writeLedgerFile(sessionsDir, sidE, {
    sessionId: sidE,
    startedAt: OLD_TS - 120_000,
    modifications: [
      { path: pendingPath, tool: 'Edit', at: OLD_TS - 60_000 },
    ],
    registered: false,
    stopWarnedAt: null,
    simulations: [],
    squads: [],
    routing: null,
  });

  // ── Run SessionStart as the "new" booting session ─────────────────────────
  const currentSid = 'fff-current-boot-session';
  const result = runSessionStart(proj, currentSid);

  result.status === 0
    ? ok('session-start exits 0 (fail-open rule 2)')
    : bad(`session-start exited ${result.status} (must be 0): ${result.stderr.slice(0, 200)}`);

  // ── Core invariant: every pre-existing ledger still exists ────────────────
  const fixtures = [
    { sid: sidA, label: '(a) old registered' },
    { sid: sidB, label: '(b) no-pending not-registered' },
    { sid: sidC, label: '(c) fresh/empty' },
    { sid: sidD, label: '(d) concurrent-live' },
    { sid: sidE, label: '(e) drift-pending' },
  ];

  let allSurvived = true;
  for (const { sid, label } of fixtures) {
    const ledgerPath = join(sessionsDir, `${sid}.json`);
    if (existsSync(ledgerPath)) {
      ok(`ledger ${label} still exists after SessionStart`);
    } else {
      bad(`ledger ${label} was DELETED by SessionStart — regression of P0-01`);
      allSurvived = false;
    }
  }

  if (allSurvived) {
    ok('INVARIANT HOLDS: SessionStart deleted no ledger files');
  }

  // ── Drift detection: fixture (e) must appear in the boot banner ───────────
  // The banner renders Session `<first-8-chars-of-sid>` and the pending paths.
  // path-classification uses the DEFAULT important prefixes in a bare temp project
  // (no contextkit/config.json), so pendingPath starts with "src/" — default-important.
  const bannerMentionsSid = result.stdout.includes(sidE.slice(0, 8));
  const bannerMentionsPath = result.stdout.includes(pendingPath);
  bannerMentionsSid || bannerMentionsPath
    ? ok(`drift detection: fixture (e) referenced in boot banner (sid or path)`)
    : bad(`drift detection: fixture (e) [${sidE}] not referenced in banner — drift detection broken\nstdout: ${result.stdout.slice(0, 400)}`);

} finally {
  cleanup();
}

rep.finish('session ledger safety (P0-01)');
