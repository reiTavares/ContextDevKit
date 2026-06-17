/**
 * Integration tests for update-preflight.mjs (projectId / detectActiveSessions /
 * detectSelfHost / runPreflight). Snapshot + status helpers are covered by
 * integration-test-update-snapshot.mjs (split for the 280-line budget).
 *
 * Standalone: node tools/integration-test-update-preflight.mjs
 * Exit 0 = all pass. Exit 1 = at least one failure.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = fileURLToPath(new URL(import.meta.url)).replace(/[\\/][^\\/]+$/, '');
const PREFLIGHT_PATH = new URL(`file:///${__dir.replace(/\\/g, '/')}/install/update-preflight.mjs`).href;
const STATUS_PATH = new URL(`file:///${__dir.replace(/\\/g, '/')}/install/update-status.mjs`).href;

const { projectId, detectActiveSessions, detectSelfHost, runPreflight } = await import(PREFLIGHT_PATH);
const { DEFERRED_ACTIVE_SESSIONS, DEFERRED_SELF_UPDATE } = await import(STATUS_PATH);

let passed = 0;
let failed = 0;
async function test(id, fn) {
  try { await fn(); console.log(`  PASS  ${id}`); passed++; }
  catch (err) { console.error(`  FAIL  ${id}: ${err.message}`); failed++; }
}
const tempDirs = [];
function mktmp(prefix = 'cdk-test-') { const d = mkdtempSync(join(tmpdir(), prefix)); tempDirs.push(d); return d; }
function cleanup() { for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } }
function writeLedger(sessionDir, sessionId, ledgerObj) {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, `${sessionId}.json`), JSON.stringify(ledgerObj, null, 2));
}
const activeLedger = (id) => ({ sessionId: id, startedAt: Date.now(), modifications: [{ path: 'x.mjs', tool: 'Edit', at: Date.now() }], registered: false });

console.log('\nContextDevKit — update-preflight integration tests\n');

await test('T01  projectId: same path → same id', () => {
  const dir = mktmp();
  assert.equal(projectId(dir), projectId(dir), 'must be deterministic');
});

await test('T02  projectId: different paths → different ids', () => {
  assert.notEqual(projectId(mktmp('cdk-a-')), projectId(mktmp('cdk-b-')), 'must differ');
});

await test('T03  detectActiveSessions: unregistered + mods → active', async () => {
  const root = mktmp();
  writeLedger(join(root, '.claude', '.sessions'), 'sess-001', activeLedger('sess-001'));
  const result = await detectActiveSessions(root);
  assert.equal(result.length, 1);
  assert.equal(result[0].sessionId, 'sess-001');
});

await test('T04  detectActiveSessions: registered empty ledger → []', async () => {
  const root = mktmp();
  writeLedger(join(root, '.claude', '.sessions'), 'sess-002', { sessionId: 'sess-002', startedAt: Date.now(), modifications: [], registered: true, activeTask: null });
  assert.equal((await detectActiveSessions(root)).length, 0);
});

await test('T05  detectActiveSessions: no sessions dir → []', async () => {
  assert.deepEqual(await detectActiveSessions(mktmp()), []);
});

await test('T06  detectActiveSessions: corrupt ledger → active', async () => {
  const root = mktmp();
  const sessionsDir = join(root, '.claude', '.sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, 'bad-session.json'), 'THIS IS NOT JSON {{{');
  const result = await detectActiveSessions(root);
  assert.equal(result.length, 1);
  assert.match(result[0].reason, /corrupt|unreadable/);
});

await test('T07  detectActiveSessions: activeTask non-empty → active', async () => {
  const root = mktmp();
  writeLedger(join(root, '.claude', '.sessions'), 'sess-007', { sessionId: 'sess-007', startedAt: Date.now(), modifications: [], registered: true, activeTask: 'WF0033-X' });
  const result = await detectActiveSessions(root);
  assert.equal(result.length, 1);
  assert.match(result[0].reason, /activeTask/);
});

await test('T08  detectActiveSessions: registered + mods + no activeTask → NOT active', async () => {
  const root = mktmp();
  writeLedger(join(root, '.claude', '.sessions'), 'sess-008', { sessionId: 'sess-008', startedAt: Date.now(), modifications: [{ path: 'README.md', tool: 'Edit', at: Date.now() }], registered: true, activeTask: null });
  assert.equal((await detectActiveSessions(root)).length, 0);
});

await test('T09  detectSelfHost: target === kitRoot → true', () => {
  const dir = mktmp();
  assert.equal(detectSelfHost(dir, dir), true);
});

await test('T10  detectSelfHost: unrelated dirs → false', () => {
  assert.equal(detectSelfHost(mktmp('cdk-a-'), mktmp('cdk-b-')), false);
});

await test('T11  detectSelfHost: target has kit fingerprint → true', () => {
  const target = mktmp();
  writeFileSync(join(target, 'install.mjs'), '// installer');
  mkdirSync(join(target, 'templates', 'contextkit'), { recursive: true });
  assert.equal(detectSelfHost(target, mktmp('cdk-kit-')), true);
});

await test('T12  runPreflight: active sessions, no override → DEFERRED_ACTIVE_SESSIONS', async () => {
  const root = mktmp();
  writeLedger(join(root, '.claude', '.sessions'), 'sess-012', activeLedger('sess-012'));
  const result = await runPreflight(root, mktmp('cdk-kit-'), { update: true });
  assert.equal(result.status, DEFERRED_ACTIVE_SESSIONS);
  assert.ok(result.activeSessions.length > 0);
});

await test('T13  runPreflight: self-host, no override → DEFERRED_SELF_UPDATE', async () => {
  const root = mktmp();
  const result = await runPreflight(root, root, { update: true });
  assert.equal(result.status, DEFERRED_SELF_UPDATE);
  assert.equal(result.selfHost, true);
});

await test('T14  runPreflight: both risks + only allowSelfUpdate → DEFERRED_ACTIVE_SESSIONS', async () => {
  const root = mktmp();
  writeLedger(join(root, '.claude', '.sessions'), 'sess-014', activeLedger('sess-014'));
  const result = await runPreflight(root, root, { update: true, allowSelfUpdate: true });
  assert.equal(result.status, DEFERRED_ACTIVE_SESSIONS, 'un-overridden risk must still defer');
  assert.equal(result.selfHost, true);
});

await test('T15  runPreflight: both overrides → status null (proceed)', async () => {
  const root = mktmp();
  writeLedger(join(root, '.claude', '.sessions'), 'sess-015', activeLedger('sess-015'));
  const result = await runPreflight(root, root, { update: true, allowSelfUpdate: true, allowActiveSessions: true });
  assert.equal(result.status, null, 'both overrides must yield null (proceed)');
});

cleanup();
console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed.\n`);
process.exit(failed > 0 ? 1 : 0);
