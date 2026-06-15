/**
 * integration-test-receipts.mjs — CDK-022 / ADR-0072.
 * Table-driven integration tests for receipt-store.mjs. Mirrors reporter() from it-helpers.mjs.
 * T1 round-trip | T2 wrong branch | T3 wrong taskId | T4 expiry | T5 tampered paths
 * T6 failed | T7 skipped | T8 missing evidence | T9 bad taxonomy | T10 forge-resistance
 * T11 custom TTL | T12 multi-capability | T13 determinism | T14/T15 defensive reads
 * T16 newline in summary | T17 oversized summary
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const STORE_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs');
const rep = reporter();

let writeReceipt, readReceipt, readReceipts, isReceiptValid, computeFingerprint, RESULTS;
try {
  const mod = await import('file://' + STORE_PATH.replaceAll('\\', '/'));
  ({ writeReceipt, readReceipt, readReceipts, isReceiptValid, computeFingerprint, RESULTS } = mod);
} catch (err) {
  rep.bad(`Failed to import receipt-store.mjs: ${err?.message ?? err}`);
  rep.finish('receipts (CDK-022)');
}

const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-rcpt-'));
const clean = (r) => rmSync(r, { recursive: true, force: true });

const BASE = {
  capability: 'qa-signoff', taskId: 'task-42', sessionId: 'sess-abc',
  runId: 'run-1', command: '/qa-signoff', host: 'claude', result: 'passed',
  evidence: { exitCode: 0, summary: 'All green' },
  scope: { branch: 'feat/x', taskId: 'task-42', paths: ['src/a.mjs', 'src/b.mjs'] },
};

// T1. Round-trip
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE });
    const loaded = readReceipt(root, 'task-42', 'qa-signoff');
    loaded?.result === 'passed' && loaded?.capability === 'qa-signoff'
      ? rep.ok('T1. round-trip: readReceipt returns stored receipt')
      : rep.bad(`T1. round-trip: unexpected=${JSON.stringify(loaded)}`);
    stored.version === 1 && stored.createdAt > 0 && stored.expiresAt > stored.createdAt
      ? rep.ok('T1. round-trip: version=1, timestamps populated')
      : rep.bad('T1. round-trip: version/timestamps wrong');
    loaded.fingerprint === computeFingerprint(BASE.scope)
      ? rep.ok('T1. round-trip: fingerprint = computeFingerprint(scope)')
      : rep.bad('T1. round-trip: fingerprint mismatch');
  } finally { clean(root); }
}

// T2. Wrong branch
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE });
    const { valid, reason } = isReceiptValid(stored, { ...BASE.scope, branch: 'main' });
    !valid && reason.includes('branch mismatch')
      ? rep.ok('T2. wrong branch → branch mismatch')
      : rep.bad(`T2. wrong branch — valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// T3. Wrong taskId
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE });
    const { valid, reason } = isReceiptValid(stored, { ...BASE.scope, taskId: 'other-task' });
    !valid && reason.includes('taskId mismatch')
      ? rep.ok('T3. wrong taskId → taskId mismatch')
      : rep.bad(`T3. wrong taskId — valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// T4. TTL=0 → expired
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE, capability: 'ttl-cap' }, { ttlMs: 0 });
    const { valid, reason } = isReceiptValid(stored, BASE.scope, stored.expiresAt + 1);
    !valid && reason === 'expired'
      ? rep.ok('T4. expiry: ttlMs=0 receipt expired at expiresAt+1')
      : rep.bad(`T4. expiry — valid=${valid} reason=${reason}`);
    stored.expiresAt === stored.createdAt
      ? rep.ok('T4. expiry: expiresAt = createdAt + 0')
      : rep.bad('T4. expiry: expiresAt computation wrong');
  } finally { clean(root); }
}

// T5. Tampered paths → stale fingerprint
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE });
    const { valid, reason } = isReceiptValid(stored, { ...BASE.scope, paths: ['src/a.mjs', 'EVIL.mjs'] });
    !valid && reason === 'stale: fingerprint mismatch'
      ? rep.ok('T5. tampered paths → stale: fingerprint mismatch')
      : rep.bad(`T5. tampered paths — valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// T6. result='failed'
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE, result: 'failed' });
    const { valid, reason } = isReceiptValid(stored, BASE.scope);
    !valid && reason.includes('failed')
      ? rep.ok('T6. result=failed → not passed')
      : rep.bad(`T6. result=failed — valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// T7. result='skipped'
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE, result: 'skipped' });
    const { valid, reason } = isReceiptValid(stored, BASE.scope);
    !valid && reason.includes('skipped')
      ? rep.ok('T7. result=skipped → not passed')
      : rep.bad(`T7. result=skipped — valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// T8. Missing evidence → TypeError
{
  const root = tmp();
  try {
    let threw = false;
    try { writeReceipt(root, { ...BASE, evidence: null }); } catch (e) { threw = e instanceof TypeError; }
    threw ? rep.ok('T8. missing evidence → TypeError') : rep.bad('T8. missing evidence — no TypeError');
  } finally { clean(root); }
}

// T9. Out-of-taxonomy result → RangeError
{
  const root = tmp();
  try {
    let threw = false;
    try { writeReceipt(root, { ...BASE, result: 'superpass' }); } catch (e) { threw = e instanceof RangeError; }
    threw ? rep.ok('T9. bad taxonomy → RangeError') : rep.bad('T9. bad taxonomy — no RangeError');
  } finally { clean(root); }
}

// T10. Forge-resistance: wrong fingerprint rejected
{
  const root = tmp();
  try {
    const stored = writeReceipt(root, { ...BASE });
    const forged = { ...stored, fingerprint: 'cafebabe0000' };
    const { valid, reason } = isReceiptValid(forged, BASE.scope);
    !valid && reason === 'stale: fingerprint mismatch'
      ? rep.ok('T10. forge-resistance: wrong fingerprint → stale: fingerprint mismatch')
      : rep.bad(`T10. forge-resistance — valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// T11. Custom TTL honoured
{
  const root = tmp();
  try {
    const TTL = 7 * 24 * 60 * 60 * 1000;
    const stored = writeReceipt(root, { ...BASE, capability: 'ttl7d' }, { ttlMs: TTL });
    Math.abs(stored.expiresAt - stored.createdAt - TTL) < 100
      ? rep.ok('T11. custom TTL: expiresAt = createdAt + ttlMs (7d)')
      : rep.bad('T11. custom TTL: expiresAt wrong');
    isReceiptValid(stored, BASE.scope).valid
      ? rep.ok('T11. custom TTL: valid within TTL window')
      : rep.bad('T11. custom TTL: should be valid');
  } finally { clean(root); }
}

// T12. Multi-capability under one task
{
  const root = tmp();
  try {
    writeReceipt(root, { ...BASE, capability: 'cap-alpha' });
    writeReceipt(root, { ...BASE, capability: 'cap-beta' });
    const all = readReceipts(root, 'task-42');
    all.length >= 2 && all.some((r) => r.capability === 'cap-alpha') && all.some((r) => r.capability === 'cap-beta')
      ? rep.ok('T12. multi-cap: readReceipts returns both capabilities')
      : rep.bad(`T12. multi-cap: got ${all.length} receipt(s): ${JSON.stringify(all.map((r) => r.capability))}`);
  } finally { clean(root); }
}

// T13. Determinism: path order stable; different paths → different fingerprint
{
  const sA = { branch: 'main', taskId: 'x', paths: ['a.mjs', 'b.mjs'] };
  const sB = { branch: 'main', taskId: 'x', paths: ['b.mjs', 'a.mjs'] };
  const sC = { branch: 'main', taskId: 'x', paths: ['a.mjs', 'c.mjs'] };
  computeFingerprint(sA) === computeFingerprint(sB)
    ? rep.ok('T13. determinism: path order does not affect fingerprint')
    : rep.bad('T13. determinism: fingerprint unstable under path reorder');
  computeFingerprint(sA) !== computeFingerprint(sC)
    ? rep.ok('T13. determinism: different paths → different fingerprint')
    : rep.bad('T13. determinism: different paths → same fingerprint');
}

// T14. readReceipt returns null for missing file
{
  const root = tmp();
  try {
    readReceipt(root, 'no-task', 'no-cap') === null
      ? rep.ok('T14. defensive: readReceipt null for missing file')
      : rep.bad('T14. defensive: readReceipt should return null');
  } finally { clean(root); }
}

// T15. readReceipts returns [] for missing dir
{
  const root = tmp();
  try {
    const r = readReceipts(root, 'no-task');
    Array.isArray(r) && r.length === 0
      ? rep.ok('T15. defensive: readReceipts [] for missing dir')
      : rep.bad(`T15. defensive: readReceipts returned ${JSON.stringify(r)}`);
  } finally { clean(root); }
}

// T16. Newline in summary → RangeError
{
  const root = tmp();
  try {
    let threw = false;
    try { writeReceipt(root, { ...BASE, evidence: { exitCode: 0, summary: 'a\nb' } }); }
    catch (e) { threw = e instanceof RangeError; }
    threw ? rep.ok('T16. privacy: newline in summary → RangeError') : rep.bad('T16. privacy: newline summary — no RangeError');
  } finally { clean(root); }
}

// T17. Oversized summary → RangeError
{
  const root = tmp();
  try {
    let threw = false;
    try { writeReceipt(root, { ...BASE, evidence: { exitCode: 0, summary: 'x'.repeat(2001) } }); }
    catch (e) { threw = e instanceof RangeError; }
    threw ? rep.ok('T17. privacy: oversized summary → RangeError') : rep.bad('T17. privacy: oversized summary — no RangeError');
  } finally { clean(root); }
}

rep.finish('receipts (CDK-022)');