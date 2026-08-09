import assert from 'node:assert/strict';
import {
  planV3ToV4,
  resolveLegacyId,
  validateMigrationPlan,
  verifyStatusParity,
} from './tasks-migrate.mjs';

const shared = {
  status: 'backlog',
  priority: 'P2',
  ownerEvidence: { kind: 'none', id: null, confidence: 'absent', source: 'none' },
  references: [],
  sourceModifiedAt: '2026-08-08T00:00:00.000Z',
};
const inventory = {
  schemaVersion: 1,
  kind: 'contextdevkit-v3-inventory',
  sourceRoot: 'fixture',
  sourceDigest: 'sha256:fixture',
  inventoryHash: 'sha256:inventory',
  records: [
    { ...shared, recordKey: 'sha256:record-a', kind: 'lane-card', legacyId: '001', title: 'Task A', sourcePath: 'pipeline/backlog/001-a.md', contentHash: 'sha256:a', artifactContentHash: 'sha256:a' },
    { ...shared, recordKey: 'sha256:record-b', kind: 'lane-card', legacyId: '001', title: 'Task B', sourcePath: 'pipeline/backlog/001-b.md', contentHash: 'sha256:b', artifactContentHash: 'sha256:b' },
    { ...shared, recordKey: 'sha256:record-c', kind: 'lane-card', legacyId: '002', title: 'Task C', sourcePath: 'pipeline/conclusion/002.md', contentHash: 'sha256:c', artifactContentHash: 'sha256:c', status: 'conclusion' },
  ],
  workflows: [],
  sidecars: [],
  duplicates: [{ legacyId: '001', recordKeys: ['sha256:record-a', 'sha256:record-b'], sourcePaths: ['pipeline/backlog/001-a.md', 'pipeline/backlog/001-b.md'] }],
  ownerless: ['sha256:record-a', 'sha256:record-b', 'sha256:record-c'],
  projections: [],
  quarantinedInputs: [],
  security: { reparsePoints: [] },
};

const plan = planV3ToV4(inventory);
assert.equal(plan.manifest.conservation, true);
assert.equal(plan.manifest.counts.source, 3);
assert.equal(plan.manifest.counts.migrated, 3);
assert.equal(validateMigrationPlan(plan).taskCount, 3);
assert.equal(verifyStatusParity(plan).checked, 3);
assert.equal(plan.manifest.entries.find((entry) => entry.legacyId === '002').normalizedStatus, 'done');
assert.equal(new Set(plan.manifest.entries.filter((entry) => entry.legacyId === '001').map((entry) => entry.v4Id)).size, 2);
assert.throws(() => resolveLegacyId(plan, '001'), (error) => error.code === 'AMBIGUOUS_LEGACY_ID');

process.stdout.write('tasks-migrate v4: 8 checks passed\n');
