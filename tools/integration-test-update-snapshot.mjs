/**
 * Integration tests for update-snapshot.mjs (snapshotCriticalState / newUpdateId)
 * + update-status.mjs predicate helpers. Split from
 * integration-test-update-preflight.mjs for the 280-line budget.
 *
 * Standalone: node tools/integration-test-update-snapshot.mjs
 * Exit 0 = all pass. Exit 1 = at least one failure.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = fileURLToPath(new URL(import.meta.url)).replace(/[\\/][^\\/]+$/, '');
const SNAPSHOT_PATH = new URL(`file:///${__dir.replace(/\\/g, '/')}/install/update-snapshot.mjs`).href;
const STATUS_PATH = new URL(`file:///${__dir.replace(/\\/g, '/')}/install/update-status.mjs`).href;

const { snapshotCriticalState, newUpdateId } = await import(SNAPSHOT_PATH);
const {
  UPDATED, DEFERRED_ACTIVE_SESSIONS, DEFERRED_SELF_UPDATE,
  FAILED_CONFLICT, FAILED_SNAPSHOT, FAILED_VALIDATION, isDeferred, isFailure,
} = await import(STATUS_PATH);

let passed = 0;
let failed = 0;
async function test(id, fn) {
  try { await fn(); console.log(`  PASS  ${id}`); passed++; }
  catch (err) { console.error(`  FAIL  ${id}: ${err.message}`); failed++; }
}
const tempDirs = [];
function mktmp(prefix = 'cdk-test-') { const d = mkdtempSync(join(tmpdir(), prefix)); tempDirs.push(d); return d; }
function cleanup() { for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } }

console.log('\nContextDevKit — update-snapshot / status integration tests\n');

// T16 — snapshotCriticalState: files copied, hashes match, ok true
await test('T16  snapshotCriticalState: files verified → ok true', async () => {
  const projectDir = mktmp('cdk-proj-');
  const backupRoot = mktmp('cdk-bkp-');

  await mkdir(join(projectDir, '.claude'), { recursive: true });
  await writeFile(join(projectDir, '.claude', 'settings.json'), JSON.stringify({ level: 6 }));
  const sessionsDir = join(projectDir, '.claude', '.sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, 'sess-016.json'), JSON.stringify({ registered: true }));
  const ctkDir = join(projectDir, 'contextkit');
  await mkdir(ctkDir, { recursive: true });
  await writeFile(join(ctkDir, 'config.json'), JSON.stringify({ level: 6 }));
  await writeFile(join(ctkDir, '.install-manifest.json'), JSON.stringify({ schema: 1, files: {} }));
  await writeFile(join(ctkDir, '.engine-version'), '3.1.2\n');

  const result = await snapshotCriticalState(projectDir, newUpdateId(), { root: backupRoot });
  assert.equal(result.ok, true, `snapshot ok must be true; skipped: ${JSON.stringify(result.skipped)}`);
  assert.ok(result.files.length >= 5, `expected ≥5 files, got ${result.files.length}`);
  assert.ok(result.dir.startsWith(backupRoot), 'backup dir must be under the test root');
  for (const f of result.files) {
    assert.ok(typeof f.sha256 === 'string' && f.sha256.length === 64, `bad sha256 for ${f.rel}`);
  }
});

// T17 — snapshotCriticalState: nothing written inside the project dir
await test('T17  snapshotCriticalState: no writes inside project dir', async () => {
  const projectDir = mktmp('cdk-proj2-');
  const backupRoot = mktmp('cdk-bkp2-');
  await mkdir(join(projectDir, '.claude'), { recursive: true });
  await writeFile(join(projectDir, '.claude', 'settings.json'), '{"level":3}');

  const before = readdirSync(projectDir).sort().join(',');
  await snapshotCriticalState(projectDir, newUpdateId(), { root: backupRoot });
  const after = readdirSync(projectDir).sort().join(',');
  assert.equal(before, after, 'project dir must be unchanged after snapshot');
});

// T18 — isDeferred / isFailure status helpers
await test('T18  isDeferred / isFailure predicates', () => {
  assert.equal(isDeferred(DEFERRED_ACTIVE_SESSIONS), true);
  assert.equal(isDeferred(DEFERRED_SELF_UPDATE), true);
  assert.equal(isDeferred(UPDATED), false);
  assert.equal(isDeferred(FAILED_SNAPSHOT), false);
  assert.equal(isFailure(FAILED_CONFLICT), true);
  assert.equal(isFailure(FAILED_SNAPSHOT), true);
  assert.equal(isFailure(FAILED_VALIDATION), true);
  assert.equal(isFailure(UPDATED), false);
  assert.equal(isFailure(DEFERRED_ACTIVE_SESSIONS), false);
});

cleanup();
console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed.\n`);
process.exit(failed > 0 ? 1 : 0);
