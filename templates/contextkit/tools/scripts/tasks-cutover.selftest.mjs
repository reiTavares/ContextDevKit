import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inventoryV3, planV3ToV4, stageV4Generation } from './tasks-migrate.mjs';
import {
  OldWriterFenced,
  assertV3WriterAllowed,
  cutoverToV4,
  freezeV3Writers,
  readAuthorityMarker,
  rollbackV4,
} from './tasks-cutover.mjs';

const sandboxRoot = resolve(tmpdir(), `contextdevkit-cutover-${process.pid}`);
const platformRoot = resolve(sandboxRoot, 'project', 'kit-root');
const workspaceRoot = resolve(sandboxRoot, 'project', 'migration-workspace');
rmSync(sandboxRoot, { recursive: true, force: true });
mkdirSync(platformRoot, { recursive: true });

try {
  const plan = planV3ToV4(inventoryV3(platformRoot));
  const stageReceipt = stageV4Generation({ platformRoot, workspaceRoot, plan });
  assert.throws(() => cutoverToV4({ platformRoot, plan, stageReceipt, expectedRevision: 0 }), (error) => error.code === 'V3_NOT_FROZEN');
  const fence = freezeV3Writers({ platformRoot, sourceDigest: plan.manifest.sourceDigest, expectedRevision: 0, stamp: 'freeze' });
  assert.equal(fence.frozen, true);
  assert.throws(() => assertV3WriterAllowed(platformRoot, 'move', 'legacy'), OldWriterFenced);
  const cutover = cutoverToV4({ platformRoot, plan, stageReceipt, expectedRevision: 0, stamp: 'cutover' });
  assert.equal(cutover.authority, 'v4');
  assert.equal(cutover.oldWriterFence, true);
  assert.equal(readAuthorityMarker(platformRoot).revision, 1);
  assert.throws(() => cutoverToV4({ platformRoot, plan, stageReceipt, expectedRevision: 0 }), (error) => error.code === 'MARKER_CAS_CONFLICT');
  const rollback = rollbackV4({ platformRoot, plan, expectedRevision: 1, stamp: 'rollback' });
  assert.equal(rollback.authority, 'v4');
  assert.equal(rollback.oldWriterFence, true);
  assert.equal(rollback.revision, 2);
  assert.throws(() => assertV3WriterAllowed(platformRoot, 'write', 'legacy'), OldWriterFenced);
  process.stdout.write('tasks-cutover v4: 11 checks passed\n');
} finally {
  rmSync(sandboxRoot, { recursive: true, force: true });
}
