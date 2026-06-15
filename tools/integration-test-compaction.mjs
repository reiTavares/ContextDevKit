/**
 * integration-test-compaction.mjs — end-to-end tests for the
 * compaction-continuity.mjs hook (CDK-042, ADR-0072).
 *
 * Drives the hook as a subprocess via installFixture so the test runs against the
 * REAL installed hook. Hermetic: the fixture git branch is always 'main'.
 *
 * Coverage:
 *   CC1. L4 (below 5): silent, exit 0.
 *   CC2. PreCompact + active task + contract -> continuity record on disk.
 *   CC3. PreCompact -> advisory line on stdout (tag + taskId).
 *   CC4. PreCompact, NO active task -> silent.
 *   CC5. PreCompact, active task but NO contract -> silent.
 *   CC6. SessionStart source=compact + outstanding obligations -> advisory re-surfaced.
 *   CC7. SessionStart source=compact, all obligations satisfied -> silent.
 *   CC8. SessionStart, NO source (ordinary start) -> silent even with a record.
 *   CC9. Malformed stdin -> exit 0 (fail-open), no output.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installFixture, KIT, reporter } from './it-helpers.mjs';

const rep = reporter();

const imp = (rel) => import('file://' + resolve(KIT, rel).replaceAll('\\', '/'));
let saveContract, writeReceipt, readJsonSafe;
try {
  ({ saveContract } = await imp('templates/contextkit/runtime/execution/execution-contract.mjs'));
  ({ writeReceipt } = await imp('templates/contextkit/runtime/execution/receipt-store.mjs'));
  ({ readJsonSafe } = await imp('templates/contextkit/runtime/hooks/safe-io.mjs'));
} catch (err) {
  rep.bad(`Module import failed: ${err?.message ?? err}`);
  rep.finish('compaction-continuity (CDK-042)');
}

const TASK_ID = 'task-cc-it-001';
const SESSION_ID = 'sess-cc-test-01';
const BRANCH = 'main'; // matches installFixture's `git init -b main`
const scope = { branch: BRANCH, taskId: TASK_ID, paths: [] };

/** Minimal feature contract requiring gates before write and completion. */
const featureContract = {
  version: 1, taskId: TASK_ID, sessionId: SESSION_ID, branch: BRANCH, host: 'claude',
  signals: { tier: 'feature', domain: 'core', level: 5, needsAdr: false, paths: [] },
  requiredBeforeExploration: [], requiredBeforeWrite: ['impact-check'],
  requiredBeforeCompletion: ['tests'], recommended: [], createdAt: Date.now(), history: [],
};

/** Seeds the session ledger so the hook sees an activeTask. */
function seedLedger(proj, overrides = {}) {
  const sessDir = join(proj, '.claude', '.sessions');
  mkdirSync(sessDir, { recursive: true });
  const ledger = {
    sessionId: SESSION_ID, startedAt: Date.now(), modifications: [], registered: false,
    stopWarnedAt: null, activeTask: TASK_ID, ...overrides,
  };
  writeFileSync(join(sessDir, `${SESSION_ID}.json`), JSON.stringify(ledger, null, 2), 'utf-8');
}

/** Absolute path to the continuity record inside the fixture. */
const continuityPath = (proj) => join(proj, 'contextkit', 'pipeline', 'state', TASK_ID, 'compaction.json');

const preCompact = () => ({ session_id: SESSION_ID, hook_event_name: 'PreCompact' });
const sessionCompact = () => ({ session_id: SESSION_ID, hook_event_name: 'SessionStart', source: 'compact' });
const sessionOrdinary = () => ({ session_id: SESSION_ID, hook_event_name: 'SessionStart' });
const passReceipt = (capability, runId, command) => ({
  capability, taskId: TASK_ID, sessionId: SESSION_ID, runId, command, host: 'claude',
  result: 'passed', evidence: { exitCode: 0, summary: 'ok' }, scope,
});

const { proj, cfgPath, hook, cleanup } = installFixture(rep);

try {
  // CC1. L4 inert.
  console.log('\nCC1. L4 inert guard...');
  writeFileSync(cfgPath, JSON.stringify({ level: 4 }), 'utf-8');
  seedLedger(proj);
  saveContract(proj, TASK_ID, featureContract);
  (() => {
    const out = hook('compaction-continuity.mjs', preCompact());
    (out === '' || !out.includes('compaction-continuity'))
      ? rep.ok('CC1. L4: hook silent (inert below L5)')
      : rep.bad(`CC1. expected silence, got: ${out.slice(0, 200)}`);
  })();
  writeFileSync(cfgPath, JSON.stringify({ level: 5 }), 'utf-8'); // restore L5

  // CC2. PreCompact writes the continuity record.
  console.log('\nCC2. PreCompact writes continuity record...');
  seedLedger(proj);
  saveContract(proj, TASK_ID, featureContract);
  hook('compaction-continuity.mjs', preCompact());
  (() => {
    const recPath = continuityPath(proj);
    if (!existsSync(recPath)) { rep.bad(`CC2. compaction.json not written at ${recPath}`); return; }
    rep.ok('CC2. compaction.json written to state substrate');
    const rec = readJsonSafe(recPath, null);
    rec && rec.taskId === TASK_ID && Array.isArray(rec.obligations?.requiredBeforeCompletion)
      && typeof rec.summary === 'string' && rec.summary.length > 0 && typeof rec.savedAt === 'number'
      ? rep.ok('CC2. record well-formed (taskId, obligations, summary, savedAt)')
      : rep.bad(`CC2. record malformed: ${JSON.stringify(rec)?.slice(0, 200)}`);
  })();

  // CC3. PreCompact emits an advisory line.
  console.log('\nCC3. PreCompact emits advisory line...');
  seedLedger(proj);
  saveContract(proj, TASK_ID, featureContract);
  (() => {
    const out = hook('compaction-continuity.mjs', preCompact());
    out.includes('compaction-continuity') && out.includes(TASK_ID)
      ? rep.ok('CC3. advisory line has tag + taskId')
      : rep.bad(`CC3. expected advisory line, got: ${out.slice(0, 200)}`);
  })();

  // CC4. PreCompact, no active task -> silent.
  console.log('\nCC4. PreCompact, no active task -> silent...');
  seedLedger(proj, { activeTask: undefined });
  saveContract(proj, TASK_ID, featureContract);
  (() => {
    const out = hook('compaction-continuity.mjs', preCompact());
    (out === '' || !out.includes('compaction-continuity'))
      ? rep.ok('CC4. no active task -> silent')
      : rep.bad(`CC4. expected silence, got: ${out.slice(0, 200)}`);
  })();

  // CC5. PreCompact, active task but no contract -> silent.
  console.log('\nCC5. PreCompact, no contract -> silent...');
  seedLedger(proj, { activeTask: 'task-no-contract-999' });
  (() => {
    const out = hook('compaction-continuity.mjs', preCompact());
    (out === '' || !out.includes('compaction-continuity'))
      ? rep.ok('CC5. no contract -> silent')
      : rep.bad(`CC5. expected silence, got: ${out.slice(0, 200)}`);
  })();

  // CC6. SessionStart compact source + outstanding obligations -> advisory re-surfaced.
  console.log('\nCC6. SessionStart compact source -> advisory re-surfaced...');
  seedLedger(proj);
  saveContract(proj, TASK_ID, featureContract);
  hook('compaction-continuity.mjs', preCompact()); // writes compaction.json
  seedLedger(proj); // fresh ledger, same activeTask, no receipts -> outstanding
  (() => {
    const out = hook('compaction-continuity.mjs', sessionCompact());
    out.includes('compaction-continuity') && out.includes(TASK_ID)
      ? rep.ok('CC6. compact source -> advisory re-surfaced (tag + taskId)')
      : rep.bad(`CC6. expected advisory, got: ${out.slice(0, 300)}`);
  })();

  // CC7. SessionStart compact source, all obligations satisfied -> silent.
  console.log('\nCC7. SessionStart compact source, all satisfied -> silent...');
  writeReceipt(proj, passReceipt('impact-check', 'run-cc-w', '/simulate-impact'));
  writeReceipt(proj, passReceipt('tests', 'run-cc-c', '/tests'));
  seedLedger(proj);
  (() => {
    const out = hook('compaction-continuity.mjs', sessionCompact());
    (out === '' || !out.includes('compaction-continuity'))
      ? rep.ok('CC7. all satisfied -> silent (no outstanding obligations)')
      : rep.bad(`CC7. expected silence, got: ${out.slice(0, 200)}`);
  })();

  // CC8. SessionStart with no source -> silent.
  console.log('\nCC8. SessionStart, no source -> silent...');
  seedLedger(proj);
  (() => {
    const out = hook('compaction-continuity.mjs', sessionOrdinary());
    (out === '' || !out.includes('compaction-continuity'))
      ? rep.ok('CC8. ordinary SessionStart -> silent')
      : rep.bad(`CC8. expected silence, got: ${out.slice(0, 200)}`);
  })();

  // CC9. Malformed stdin -> exit 0 (fail-open), no output.
  console.log('\nCC9. Malformed stdin -> fail-open...');
  (() => {
    const hookFile = join(proj, 'contextkit', 'runtime', 'hooks', 'compaction-continuity.mjs');
    const result = spawnSync(process.execPath, [hookFile], {
      cwd: proj, input: 'not-valid-json{{{', encoding: 'utf-8', timeout: 15_000,
    });
    result.status === 0
      ? rep.ok('CC9. malformed stdin -> exit 0 (fail-open)')
      : rep.bad(`CC9. expected exit 0, got ${result.status}: ${result.stderr?.slice(0, 100)}`);
    (!result.stdout || result.stdout.trim() === '' || !result.stdout.includes('decision'))
      ? rep.ok('CC9. malformed stdin -> silent')
      : rep.bad(`CC9. unexpected output: ${result.stdout.slice(0, 200)}`);
  })();

} finally {
  cleanup();
}

rep.finish('compaction-continuity (CDK-042)');
