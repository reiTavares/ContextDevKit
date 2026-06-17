/**
 * Integration test — Adversarial ledger-preservation matrix (3.1.2, P0-01 + P0-02).
 *
 * Cohesion note: six subprocess scenarios + detectActiveSessions classifier
 * assertions share fixture-building helpers and the session-start runner; splitting
 * would scatter shared state. Structural tolerance (constitution §1) applies.
 *
 * Six adversarial session-start scenarios (each its own temp project):
 *   ADV-01  two active sessions (both unregistered + mods)
 *   ADV-02  a paused session older than 15 min (old startedAt + old mods)
 *   ADV-03  a registered session
 *   ADV-04  session "in another worktree" (ledger with cwd/worktree marker fields)
 *   ADV-05  session waiting for user authorization (activeTask set, no recent mods)
 *   ADV-06  legacy ledger — NO closedAt, minimal schema, unknown extra fields
 *
 * For EACH: assert the ledger file STILL EXISTS after session-start runs.
 * Also: detectActiveSessions classifier must match the hook's conservative rules.
 *
 * Run: node tools/integration-test-session-adversarial.mjs  (exit 0 = pass)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSION_START = resolve(KIT, 'templates/contextkit/runtime/hooks/session-start.mjs');
const LEDGER_REL = '.claude/.sessions';
const toUrl = (p) => 'file:///' + resolve(p).replaceAll('\\', '/');
const OLD_TS = Date.now() - 20 * 60 * 1000;
const NOW_TS = Date.now();
const rep = reporter();
const { ok, bad } = rep;

console.log('\n🌀 Integration test — session ledger adversarial matrix (P0-01 / P0-02)\n');

/** Creates a minimal throwaway temp project with a sessions dir. */
function makeTempProject() {
  const proj = mkdtempSync(join(tmpdir(), 'ckit-adv-'));
  const sessionsDir = join(proj, LEDGER_REL);
  mkdirSync(sessionsDir, { recursive: true });
  return { proj, sessionsDir, cleanup: () => rmSync(proj, { recursive: true, force: true }) };
}

/** Writes a ledger JSON file into the sessions directory. */
function writeLedger(sessionsDir, sessionId, ledgerData) {
  writeFileSync(join(sessionsDir, `${sessionId}.json`), JSON.stringify(ledgerData, null, 2), 'utf-8');
}

/** Runs session-start.mjs as a subprocess with `cwd` set to `proj`. */
function runSessionStart(proj, sessionId) {
  const payload = JSON.stringify({ session_id: sessionId, hook_event_name: 'SessionStart' });
  const r = spawnSync(process.execPath, [SESSION_START], { cwd: proj, input: payload, encoding: 'utf-8', timeout: 30_000 });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Core invariant: assert each ledger survives session-start. */
function assertAllSurvived(sessionsDir, fixtures, scenario) {
  for (const { sid, label } of fixtures) {
    existsSync(join(sessionsDir, `${sid}.json`))
      ? ok(`${scenario}: ledger ${label} still exists after SessionStart`)
      : bad(`${scenario}: ledger ${label} DELETED by SessionStart — P0-01 regression`);
  }
}

// ── ADV-01: two active sessions (both unregistered + mods) ───────────────────
await (async () => {
  const { proj, sessionsDir, cleanup } = makeTempProject();
  try {
    writeLedger(sessionsDir, 'adv01-a', { sessionId: 'adv01-a', startedAt: NOW_TS - 5_000,
      modifications: [{ path: 'src/core/a.ts', tool: 'Edit', at: NOW_TS - 3_000 }],
      registered: false, stopWarnedAt: null, simulations: [], squads: [], routing: null });
    writeLedger(sessionsDir, 'adv01-b', { sessionId: 'adv01-b', startedAt: NOW_TS - 8_000,
      modifications: [{ path: 'src/core/b.ts', tool: 'Edit', at: NOW_TS - 4_000 }],
      registered: false, stopWarnedAt: null, simulations: [], squads: [], routing: null });
    const res = runSessionStart(proj, 'adv01-boot');
    res.status === 0 ? ok('ADV-01: session-start exits 0 (fail-open)') : bad(`ADV-01: exit ${res.status}`);
    assertAllSurvived(sessionsDir, [{ sid: 'adv01-a', label: 'active-A' }, { sid: 'adv01-b', label: 'active-B' }], 'ADV-01');
  } finally { cleanup(); }
})();

// ── ADV-02: paused session older than 15 min ──────────────────────────────────
await (async () => {
  const { proj, sessionsDir, cleanup } = makeTempProject();
  try {
    writeLedger(sessionsDir, 'adv02-paused', { sessionId: 'adv02-paused', startedAt: OLD_TS - 30_000,
      modifications: [{ path: 'src/legacy-module.ts', tool: 'Edit', at: OLD_TS - 10_000 }],
      registered: false, stopWarnedAt: null, simulations: [], squads: [], routing: null });
    const res = runSessionStart(proj, 'adv02-boot');
    res.status === 0 ? ok('ADV-02: session-start exits 0') : bad(`ADV-02: exit ${res.status}`);
    assertAllSurvived(sessionsDir, [{ sid: 'adv02-paused', label: 'paused-old (>15 min)' }], 'ADV-02');
  } finally { cleanup(); }
})();

// ── ADV-03: a registered session ──────────────────────────────────────────────
await (async () => {
  const { proj, sessionsDir, cleanup } = makeTempProject();
  try {
    writeLedger(sessionsDir, 'adv03-reg', { sessionId: 'adv03-reg', startedAt: OLD_TS - 60_000,
      modifications: [{ path: 'contextkit/memory/sessions/2026-06-01.md', tool: 'Write', at: OLD_TS - 30_000 }],
      registered: true, stopWarnedAt: null, simulations: [], squads: [], routing: null });
    const res = runSessionStart(proj, 'adv03-boot');
    res.status === 0 ? ok('ADV-03: session-start exits 0') : bad(`ADV-03: exit ${res.status}`);
    assertAllSurvived(sessionsDir, [{ sid: 'adv03-reg', label: 'registered (resolved)' }], 'ADV-03');
  } finally { cleanup(); }
})();

// ── ADV-04: session "in another worktree" (ledger with cwd/worktree marker) ──
await (async () => {
  const { proj, sessionsDir, cleanup } = makeTempProject();
  try {
    writeLedger(sessionsDir, 'adv04-wt', { sessionId: 'adv04-wt', startedAt: NOW_TS - 12_000,
      modifications: [{ path: 'src/feature-x.ts', tool: 'Edit', at: NOW_TS - 6_000 }],
      registered: false, stopWarnedAt: null, simulations: [], squads: [], routing: null,
      cwd: '/different/worktree/path', worktree: true });
    const res = runSessionStart(proj, 'adv04-boot');
    res.status === 0 ? ok('ADV-04: session-start exits 0') : bad(`ADV-04: exit ${res.status}`);
    assertAllSurvived(sessionsDir, [{ sid: 'adv04-wt', label: 'other-worktree ledger' }], 'ADV-04');
  } finally { cleanup(); }
})();

// ── ADV-05: session waiting for user authorization (activeTask set, no mods) ──
await (async () => {
  const { proj, sessionsDir, cleanup } = makeTempProject();
  try {
    writeLedger(sessionsDir, 'adv05-auth', { sessionId: 'adv05-auth', startedAt: OLD_TS - 5_000,
      modifications: [], registered: false, stopWarnedAt: null, simulations: [], squads: [], routing: null,
      activeTask: 'WF0034-CDK-305-awaiting-human-merge', taskCounter: 2 });
    const res = runSessionStart(proj, 'adv05-boot');
    res.status === 0 ? ok('ADV-05: session-start exits 0') : bad(`ADV-05: exit ${res.status}`);
    assertAllSurvived(sessionsDir, [{ sid: 'adv05-auth', label: 'awaiting-auth (activeTask set)' }], 'ADV-05');
  } finally { cleanup(); }
})();

// ── ADV-06: legacy ledger — no closedAt, minimal schema, unknown extra fields ─
await (async () => {
  const { proj, sessionsDir, cleanup } = makeTempProject();
  try {
    writeFileSync(join(sessionsDir, 'adv06-legacy.json'), JSON.stringify({
      sessionId: 'adv06-legacy', startedAt: OLD_TS - 120_000,
      modifications: [{ path: 'lib/old-module.js', tool: 'Write', at: OLD_TS - 90_000 }],
      legacyField: 'pre-3.0.0-schema', anotherUnknownField: { nested: true, value: 42 },
    }, null, 2), 'utf-8');
    const res = runSessionStart(proj, 'adv06-boot');
    res.status === 0 ? ok('ADV-06: session-start exits 0') : bad(`ADV-06: exit ${res.status}`);
    assertAllSurvived(sessionsDir, [{ sid: 'adv06-legacy', label: 'legacy-minimal schema' }], 'ADV-06');
  } finally { cleanup(); }
})();

// ── detectActiveSessions classifier contract ──────────────────────────────────
await (async () => {
  let detectActiveSessions;
  try {
    ({ detectActiveSessions } = await import(toUrl(join(KIT, 'tools/install/update-preflight.mjs'))));
    ok('CLASSIFIER: update-preflight.mjs imports cleanly');
  } catch (err) {
    bad(`CLASSIFIER: import failed: ${err?.message ?? err}`);
    return;
  }

  // C1: two active (unregistered + mods) → both classified active
  await (async () => {
    const { proj, sessionsDir, cleanup } = makeTempProject();
    try {
      writeLedger(sessionsDir, 'cls-a1', { sessionId: 'cls-a1', startedAt: NOW_TS,
        modifications: [{ path: 'src/x.ts', tool: 'Edit', at: NOW_TS }], registered: false, activeTask: null });
      writeLedger(sessionsDir, 'cls-a2', { sessionId: 'cls-a2', startedAt: NOW_TS,
        modifications: [{ path: 'src/y.ts', tool: 'Edit', at: NOW_TS }], registered: false, activeTask: null });
      const found = await detectActiveSessions(proj);
      found.length === 2 ? ok('CLASSIFIER C1: two unregistered+mods → 2 active') : bad(`CLASSIFIER C1: expected 2, got ${found.length}`);
    } finally { cleanup(); }
  })();

  // C2: registered empty → NOT active
  await (async () => {
    const { proj, sessionsDir, cleanup } = makeTempProject();
    try {
      writeLedger(sessionsDir, 'cls-reg', { sessionId: 'cls-reg', startedAt: OLD_TS,
        modifications: [], registered: true, activeTask: null });
      const found = await detectActiveSessions(proj);
      found.length === 0 ? ok('CLASSIFIER C2: registered+empty → NOT active') : bad(`CLASSIFIER C2: expected 0, got ${found.length}`);
    } finally { cleanup(); }
  })();

  // C3: activeTask set → active (conservative: when uncertain, lean active)
  await (async () => {
    const { proj, sessionsDir, cleanup } = makeTempProject();
    try {
      writeLedger(sessionsDir, 'cls-task', { sessionId: 'cls-task', startedAt: OLD_TS,
        modifications: [], registered: false, activeTask: 'awaiting-merge-authorization' });
      const found = await detectActiveSessions(proj);
      found.length === 1 && found[0].reason.includes('activeTask')
        ? ok('CLASSIFIER C3: activeTask set → classified active')
        : bad(`CLASSIFIER C3: expected 1 active with activeTask reason, got ${JSON.stringify(found)}`);
    } finally { cleanup(); }
  })();

  // C4: legacy minimal schema (no registered field) + mods → classified active
  await (async () => {
    const { proj, sessionsDir, cleanup } = makeTempProject();
    try {
      writeLedger(sessionsDir, 'cls-leg', { sessionId: 'cls-leg', startedAt: OLD_TS,
        modifications: [{ path: 'lib/x.js', tool: 'Write', at: OLD_TS }], legacyField: 'pre-3.0.0' });
      const found = await detectActiveSessions(proj);
      found.length === 1 ? ok('CLASSIFIER C4: legacy minimal schema + mods → classified active') : bad(`CLASSIFIER C4: expected 1, got ${found.length}`);
    } finally { cleanup(); }
  })();
})();

rep.finish('session ledger adversarial matrix (P0-01 / P0-02)');
