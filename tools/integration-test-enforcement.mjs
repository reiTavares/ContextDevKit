/**
 * integration-test-enforcement.mjs - CDK-023 / ADR-0072 — Bypass store tests (B-series).
 *
 * Table-driven end-to-end integration tests for bypass-store.mjs:
 * B1 round-trip | B2 valid scope | B3 expired | B4 capability mismatch
 * B5 taskId mismatch (scope isolation) | B6 branch mismatch | B7 grade-4 floor
 * B8 human-approval no approvedBy | B9 writeBypass throw | B10 readBypasses
 *
 * The E-series (enforcement modes + decide()) lives in integration-test-enforcement-modes.mjs.
 * Both are appended to package.json test script.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const BYPASS_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/bypass-store.mjs');
const rep = reporter();
const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-bp-'));
const clean = (r) => rmSync(r, { recursive: true, force: true });

let writeBypass, readBypass, readBypasses, isBypassValid;
try {
  const mod = await import('file://' + BYPASS_PATH.replaceAll('\\', '/'));
  ({ writeBypass, readBypass, readBypasses, isBypassValid } = mod);
} catch (err) {
  rep.bad(`bypass-store import failed: ${err?.message ?? err}`);
  rep.finish('bypass-store (CDK-023)');
}

const baseBp = (overrides = {}) => ({
  capability: 'qa-signoff', taskId: 'task-42', branch: 'feat/x',
  reason: 'approved by team', actor: 'human-dev', approvedBy: 'alice',
  ...overrides,
});

// B1. Round-trip: write then read returns same record.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp());
    const loaded = readBypass(root, 'task-42', 'qa-signoff');
    loaded?.capability === 'qa-signoff' && loaded?.actor === 'human-dev'
      ? rep.ok('B1. round-trip: readBypass returns stored record')
      : rep.bad(`B1. round-trip: unexpected=${JSON.stringify(loaded)}`);
    stored.version === 1 && stored.createdAt > 0 && stored.expiresAt > stored.createdAt
      ? rep.ok('B1. round-trip: version=1, timestamps populated')
      : rep.bad('B1. round-trip: timestamps wrong');
  } finally { clean(root); }
}

// B2. isBypassValid: valid bypass in matching scope -> valid.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp());
    const { valid } = isBypassValid(stored, { capability: 'qa-signoff', taskId: 'task-42', branch: 'feat/x' });
    valid ? rep.ok('B2. isBypassValid: matching scope -> valid') : rep.bad('B2. isBypassValid: should be valid');
  } finally { clean(root); }
}

// B3. Expired bypass -> invalid.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp(), { ttlMs: 0 });
    const { valid, reason } = isBypassValid(stored, { capability: 'qa-signoff', taskId: 'task-42', branch: 'feat/x' }, stored.expiresAt + 1);
    !valid && reason === 'expired'
      ? rep.ok('B3. expired bypass -> invalid reason=expired')
      : rep.bad(`B3. expired: valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// B4. Capability mismatch -> invalid.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp());
    const { valid, reason } = isBypassValid(stored, { capability: 'OTHER', taskId: 'task-42', branch: 'feat/x' });
    !valid && reason.includes('capability mismatch')
      ? rep.ok('B4. capability mismatch -> invalid')
      : rep.bad(`B4. capability mismatch: valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// B5. TaskId mismatch (scope isolation) -> invalid.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp());
    const { valid, reason } = isBypassValid(stored, { capability: 'qa-signoff', taskId: 'OTHER-TASK', branch: 'feat/x' });
    !valid && reason.includes('taskId mismatch')
      ? rep.ok('B5. taskId mismatch -> invalid (scope isolation)')
      : rep.bad(`B5. taskId mismatch: valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// B6. Branch mismatch -> invalid.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp());
    const { valid, reason } = isBypassValid(stored, { capability: 'qa-signoff', taskId: 'task-42', branch: 'main' });
    !valid && reason.includes('branch mismatch')
      ? rep.ok('B6. branch mismatch -> invalid (scope isolation)')
      : rep.bad(`B6. branch mismatch: valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// B7. Grade-4 human-floor: actor='auto' + requiresHumanApproval=true -> invalid.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp({ actor: 'auto', approvedBy: 'self' }));
    const { valid, reason } = isBypassValid(stored, { capability: 'qa-signoff', taskId: 'task-42', branch: 'feat/x', requiresHumanApproval: true });
    !valid && reason.includes('auto cannot self-authorize')
      ? rep.ok('B7. grade-4 floor: auto bypass of human-approval cap -> invalid')
      : rep.bad(`B7. grade-4 floor: valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// B8. Human-approval with no approvedBy -> invalid.
{
  const root = tmp();
  try {
    const stored = writeBypass(root, baseBp({ actor: 'human', approvedBy: undefined }));
    const { valid, reason } = isBypassValid(stored, { capability: 'qa-signoff', taskId: 'task-42', branch: 'feat/x', requiresHumanApproval: true });
    !valid && reason.includes('approvedBy must be')
      ? rep.ok('B8. human-approval: missing approvedBy -> invalid')
      : rep.bad(`B8. approvedBy missing: valid=${valid} reason=${reason}`);
  } finally { clean(root); }
}

// B9. writeBypass throws TypeError on missing required field.
{
  const root = tmp();
  try {
    let threw = false;
    try { writeBypass(root, { capability: 'x', taskId: 'y', branch: 'z' }); } catch (e) { threw = e instanceof TypeError; }
    threw ? rep.ok('B9. writeBypass: missing reason -> TypeError') : rep.bad('B9. writeBypass: no TypeError on missing field');
  } finally { clean(root); }
}

// B10. readBypasses returns all bypasses for a task; missing dir returns [].
{
  const root = tmp();
  try {
    writeBypass(root, baseBp({ capability: 'cap-alpha' }));
    writeBypass(root, baseBp({ capability: 'cap-beta' }));
    const all = readBypasses(root, 'task-42');
    all.length >= 2 && all.some((b) => b.capability === 'cap-alpha') && all.some((b) => b.capability === 'cap-beta')
      ? rep.ok('B10. readBypasses: returns multiple bypasses for a task')
      : rep.bad(`B10. readBypasses: got ${all.length}: ${JSON.stringify(all.map((b) => b.capability))}`);
    readBypasses(root, 'no-such-task').length === 0
      ? rep.ok('B10. readBypasses: missing dir -> []')
      : rep.bad('B10. readBypasses: missing dir should return []');
  } finally { clean(root); }
}

rep.finish('bypass-store (CDK-023)');