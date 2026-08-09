import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, parse, resolve } from 'node:path';
import {
  MigrationRefusedError,
  OldWriterFenced,
  assertSameVolume,
  assertV3WriterAllowed,
  atomicWriteFile,
  cutoverToV4,
  freezeV3Writers,
  inventoryV3,
  planV3ToV4,
  readAuthorityMarker,
  resolveContainedPath,
  resolveLegacyId,
  retireV3Sources,
  rollbackV4,
  sha256,
  stageV4Generation,
  validateMigrationPlan,
  verifyGeneration,
  verifyStatusParity,
} from '../../../templates/contextkit/tools/migrations/v3-to-v4/index.mjs';
import { runCli } from '../../../templates/contextkit/tools/migrations/v3-to-v4/cli.mjs';
import { readTasksDocument } from '../../../templates/contextkit/tools/scripts/tasks-store.mjs';

let passed = 0;

/** @param {string} name @param {() => void|Promise<void>} check */
async function test(name, check) {
  await check();
  passed += 1;
  process.stdout.write(`  ok ${passed} - ${name}\n`);
}

/** @param {string} filePath @param {string} contents */
function write(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

/** @param {string} id @param {string} status @param {string} workflow @param {string} title */
function card(id, status, workflow, title) {
  return `---\nid: ${id}\nstatus: ${status}\nworkflow: ${workflow}\npriority: P1\nevidence: reports/proof.md\n---\n# ${title}\n[proof](reports/proof.md)\n`;
}

/** @param {string} platformRoot */
function buildFixture(platformRoot) {
  write(resolve(platformRoot, 'pipeline/backlog/001-ownerless.md'), card('001', 'backlog', '', 'Ownerless'));
  write(resolve(platformRoot, 'pipeline/working/001-owned.md'), card('001', 'working', 'WF-0001', 'Duplicate'));
  write(resolve(platformRoot, 'pipeline/testing/002-blocked.md'), card('002', 'testing', 'WF-0001', 'Blocked'));
  write(resolve(platformRoot, 'pipeline/conclusion/003-done.md'), card('003', 'conclusion', 'WF-0001', 'Done'));
  write(resolve(platformRoot, 'pipeline/backlog/005-unknown.md'), card('005', 'mystery', 'WF-0001', 'Unknown'));
  write(resolve(platformRoot, 'pipeline/state/002/state.json'), '{"taskId":"002","blocker":{"reason":"dependency"}}\n');

  const workflowRoot = resolve(platformRoot, 'memory/operations/OP-0001-demo/done/WF-0001-demo');
  write(resolve(workflowRoot, 'workflow-plan.json'), JSON.stringify({
    schemaVersion: 1,
    workflowId: 'WF-0001',
    slug: 'demo',
    waves: [{ id: 'W1', tasks: [{ id: '001', title: 'Owned' }] }],
  }, null, 2));
  write(resolve(workflowRoot, 'workflow-state.json'), JSON.stringify({
    schemaVersion: 1,
    workflowId: 'WF-0001',
    revision: 7,
    overallStatus: 'done',
  }, null, 2));
  write(resolve(workflowRoot, 'prd.md'), '# PRD\n');
  write(resolve(workflowRoot, 'spec.md'), '# SPEC\n');
  write(resolve(workflowRoot, 'decisions.md'), '# Decisions\n');
  write(resolve(workflowRoot, 'tasks.md'), '| id | status |\n| 999 | stale |\n');

  write(resolve(platformRoot, 'memory/business/BIZ-0001-demo/tasks.json'), JSON.stringify({
    schemaVersion: 1,
    owner: { kind: 'BIZ', id: 'BIZ-0001' },
    tasks: [
      { id: '004', title: 'Business task', status: 'done', evidenceRefs: ['reports/biz.md'] },
      { id: '006', title: 'Dependent task', status: 'working', dependsOn: ['004'] },
    ],
  }, null, 2));
  write(resolve(platformRoot, 'memory/workflows/WF-9999-bad/tasks.json'), '{not-json');
}

const sandboxRoot = resolve(tmpdir(), `contextdevkit-v3-v4-${process.pid}`);
const platformRoot = resolve(sandboxRoot, 'project', 'kit-root');
const workspaceRoot = resolve(sandboxRoot, 'project', 'migration-workspace');
rmSync(sandboxRoot, { recursive: true, force: true });
mkdirSync(platformRoot, { recursive: true });
buildFixture(platformRoot);

try {
  let inventory;
  let plan;
  let receipt;

  await test('dry-run inventory is complete and writes no workspace', () => {
    inventory = inventoryV3(platformRoot);
    assert.equal(existsSync(workspaceRoot), false);
    assert.equal(inventory.counts.laneCards, 5);
    assert.equal(inventory.counts.ownerTasks, 2);
    assert.equal(inventory.counts.workflows, 1);
    assert.equal(inventory.counts.sidecars, 1);
    assert.equal(inventory.duplicates.length, 1);
    assert.equal(inventory.ownerless.length, 1);
    assert.equal(inventory.projections.some((projection) => projection.status === 'divergent'), true);
    assert.equal(inventory.quarantinedInputs.length, 1);
  });

  await test('default CLI is dry-run-only', async () => {
    const cliReceipt = await runCli(['--platform-root', platformRoot]);
    assert.equal(cliReceipt.action, 'dry-run');
    assert.equal(cliReceipt.writes, 0);
    assert.equal(existsSync(workspaceRoot), false);
  });

  await test('plan conserves source records and validates schema/hash/parity', () => {
    plan = planV3ToV4(inventory, { migrationStamp: '2026-08-08T00:00:00Z' });
    assert.equal(plan.manifest.counts.source, plan.manifest.counts.migrated + plan.manifest.counts.quarantined);
    assert.equal(plan.manifest.conservation, true);
    assert.equal(validateMigrationPlan(plan).ok, true);
    assert.equal(verifyStatusParity(plan).checked, plan.manifest.counts.migrated);
  });

  await test('duplicate ids are namespaced and bare ambiguous lookup refuses', () => {
    const duplicates = plan.manifest.entries.filter((entry) => entry.legacyId === '001');
    assert.equal(duplicates.length, 2);
    assert.equal(new Set(duplicates.map((entry) => entry.v4Id)).size, 2);
    assert.equal(duplicates.every((entry) => entry.idResolution === 'namespaced'), true);
    assert.throws(() => resolveLegacyId(plan, '001'), (error) => error.code === 'AMBIGUOUS_LEGACY_ID');
  });

  await test('ambiguous workflow ids are quarantined instead of guessed', () => {
    const ambiguousInventory = structuredClone(inventory);
    const duplicateWorkflow = structuredClone(ambiguousInventory.workflows[0]);
    duplicateWorkflow.sourcePath = 'memory/workflows/WF-0001-second/workflow-plan.json';
    duplicateWorkflow.directoryPath = 'memory/workflows/WF-0001-second';
    duplicateWorkflow.relatedFiles = [];
    ambiguousInventory.workflows.push(duplicateWorkflow);
    ambiguousInventory.workflowDuplicates = [{
      workflowId: 'WF-0001',
      sourcePaths: [ambiguousInventory.workflows[0].sourcePath, duplicateWorkflow.sourcePath].sort(),
    }];
    const ambiguousPlan = planV3ToV4(ambiguousInventory);
    assert.equal(ambiguousPlan.manifest.quarantinedWorkflows.length, 2);
    assert.equal(ambiguousPlan.manifest.entries
      .filter((entry) => entry.sourcePath.includes('001-owned') || entry.legacyId === '002' || entry.legacyId === '003')
      .every((entry) => entry.disposition === 'quarantined'), true);
  });

  await test('ownerless task migrates to an explicit neutral batch', () => {
    const ownerless = plan.manifest.entries.find((entry) => entry.sourcePath.includes('ownerless'));
    assert.equal(ownerless.ownerResolution, 'neutral-batch');
    assert.equal(ownerless.targetPath, 'memory/batches/BATCH-V3-OWNERLESS/tasks.json');
  });

  await test('status normalization honors blocker and done semantics', () => {
    assert.equal(plan.manifest.entries.find((entry) => entry.legacyId === '002').normalizedStatus, 'blocked');
    assert.equal(plan.manifest.entries.find((entry) => entry.legacyId === '003').normalizedStatus, 'done');
    assert.equal(plan.manifest.entries.find((entry) => entry.legacyId === '005').disposition, 'quarantined');
  });

  await test('legacy dependencies resolve to canonical ids inside one scope', () => {
    const targetPath = plan.manifest.entries.find((entry) => entry.legacyId === '006').targetPath;
    const document = JSON.parse(plan.targetFiles[targetPath]);
    assert.deepEqual(document.tasks.find((task) => task.id === 'T-006').dependsOn, ['T-004']);
  });

  await test('done workflow returns to canonical path and preserves documents', () => {
    const targets = Object.keys(plan.manifest.targetFileHashes);
    assert.equal(targets.some((path) => path.includes('/done/')), false);
    assert.equal(targets.some((path) => path.endsWith('/WF-0001-demo/prd.md')), true);
    const statePath = targets.find((path) => path.endsWith('/WF-0001-demo/workflow-state.json'));
    assert.equal(JSON.parse(plan.targetFiles[statePath]).status, 'done');
  });

  await test('target traversal is refused', () => {
    assert.throws(() => resolveContainedPath(platformRoot, '../escape'), (error) => error.code === 'PATH_ESCAPE');
    const tampered = structuredClone(plan);
    tampered.targetFiles['../escape.json'] = '{}\n';
    assert.throws(() => validateMigrationPlan(tampered), MigrationRefusedError);
  });

  await test('reparse points are inventoried but never traversed', () => {
    const external = resolve(sandboxRoot, 'external');
    mkdirSync(external, { recursive: true });
    write(resolve(external, 'tasks.json'), '{"tasks":[{"id":"777"}]}');
    const linkPath = resolve(platformRoot, 'memory/linked');
    try {
      symlinkSync(external, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      const linkedInventory = inventoryV3(platformRoot);
      assert.equal(linkedInventory.security.reparsePoints.includes('memory/linked'), true);
      assert.equal(linkedInventory.records.some((record) => record.legacyId === '777'), false);
    } finally {
      rmSync(linkPath, { recursive: true, force: true });
    }
  });

  await test('atomic file write leaves previous bytes on injected failure', () => {
    const target = resolve(sandboxRoot, 'atomic.json');
    write(target, 'old\n');
    assert.throws(() => atomicWriteFile(target, 'new\n', {
      beforeRename() { throw new Error('injected rename failure'); },
    }), /injected rename failure/);
    assert.equal(readFileSync(target, 'utf8'), 'old\n');
  });

  await test('source CAS refuses staging after any v3 mutation', () => {
    const source = resolve(platformRoot, 'pipeline/backlog/001-ownerless.md');
    const original = readFileSync(source, 'utf8');
    writeFileSync(source, `${original}\nchanged`);
    assert.throws(
      () => stageV4Generation({ platformRoot, workspaceRoot, plan }),
      (error) => error.code === 'SOURCE_CAS_CONFLICT',
    );
    writeFileSync(source, original);
  });

  await test('generation rename failure is cleanly resumable', () => {
    assert.throws(() => stageV4Generation({
      platformRoot,
      workspaceRoot,
      plan,
      hooks: { beforeGenerationRename() { throw new Error('injected generation rename failure'); } },
    }), /injected generation rename failure/);
    const candidate = resolve(workspaceRoot, 'generations', `v4-${plan.manifest.migrationId}`);
    assert.equal(existsSync(candidate), false);
  });

  await test('stage validates candidate and exercises a verified v4 rollback', () => {
    receipt = stageV4Generation({ platformRoot, workspaceRoot, plan });
    assert.equal(receipt.rollbackExercised, true);
    assert.equal(receipt.schemaValidated, true);
    assert.equal(receipt.parityValidated, true);
    verifyGeneration(receipt.candidateRoot, plan);
    verifyGeneration(receipt.rollbackRoot, plan);
    for (const targetPath of Object.keys(plan.targetFiles).filter((path) => path.endsWith('/tasks.json'))) {
      const document = readTasksDocument(resolve(receipt.candidateRoot, targetPath));
      assert.equal(document.schemaVersion, 2);
      assert.equal(Array.isArray(document.events), true);
      assert.equal(document.tasks.every((task) => !Object.hasOwn(task, 'migration')), true);
    }
  });

  await test('staging is idempotent after a complete receipt', () => {
    const second = stageV4Generation({ platformRoot, workspaceRoot, plan });
    assert.equal(second.idempotent, true);
    assert.equal(second.generationDigest, receipt.generationDigest);
  });

  await test('cutover refuses before the v3 writer freeze', () => {
    assert.throws(
      () => cutoverToV4({ platformRoot, plan, stageReceipt: receipt, expectedRevision: 0 }),
      (error) => error.code === 'V3_NOT_FROZEN',
    );
  });

  await test('freeze is monotonic, CAS-protected, and immediately fences v3', () => {
    const frozen = freezeV3Writers({
      platformRoot, sourceDigest: plan.manifest.sourceDigest, expectedRevision: 0, stamp: 'freeze',
    });
    assert.equal(frozen.frozen, true);
    assert.throws(() => assertV3WriterAllowed(platformRoot, 'move', 'pipeline/backlog/001.md'), OldWriterFenced);
    assert.throws(
      () => freezeV3Writers({ platformRoot, sourceDigest: plan.manifest.sourceDigest, expectedRevision: 0 }),
      (error) => error.code === 'MARKER_CAS_CONFLICT',
    );
  });

  await test('an active cross-process marker writer refuses a competing CAS', () => {
    const lockPath = resolve(platformRoot, '.contextdevkit-authority.json.lock');
    mkdirSync(lockPath);
    try {
      assert.throws(
        () => cutoverToV4({ platformRoot, plan, stageReceipt: receipt, expectedRevision: 0 }),
        (error) => error.code === 'MARKER_CAS_CONFLICT',
      );
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  await test('tampered candidate blocks authority flip', () => {
    const targetPath = Object.keys(plan.targetFiles)[0];
    const candidateFile = resolve(receipt.candidateRoot, targetPath);
    const rollbackFile = resolve(receipt.rollbackRoot, targetPath);
    writeFileSync(candidateFile, 'tampered\n');
    assert.throws(
      () => cutoverToV4({ platformRoot, plan, stageReceipt: receipt, expectedRevision: 0 }),
      (error) => error.code === 'STAGED_GENERATION_HASH',
    );
    cpSync(rollbackFile, candidateFile, { force: true });
  });

  await test('cutover atomically activates only v4 with a monotonic marker', () => {
    const marker = cutoverToV4({
      platformRoot, plan, stageReceipt: receipt, expectedRevision: 0, stamp: 'cutover',
    });
    assert.equal(marker.authority, 'v4');
    assert.equal(marker.oldWriterFence, true);
    assert.equal(marker.revision, 1);
    assert.equal(readAuthorityMarker(platformRoot).authority, 'v4');
    assert.throws(
      () => cutoverToV4({ platformRoot, plan, stageReceipt: receipt, expectedRevision: 0 }),
      (error) => error.code === 'MARKER_CAS_CONFLICT',
    );
  });

  await test('rollback refuses a tampered bundle', () => {
    const targetPath = Object.keys(plan.targetFiles)[0];
    const rollbackFile = resolve(receipt.rollbackRoot, targetPath);
    const original = readFileSync(rollbackFile);
    writeFileSync(rollbackFile, 'tampered\n');
    assert.throws(
      () => rollbackV4({ platformRoot, plan, expectedRevision: 1 }),
      (error) => error.code === 'STAGED_GENERATION_HASH',
    );
    writeFileSync(rollbackFile, original);
  });

  await test('rollback restores verified v4 and never re-enables v3', () => {
    const marker = rollbackV4({ platformRoot, plan, expectedRevision: 1, stamp: 'rollback' });
    assert.equal(marker.authority, 'v4');
    assert.equal(marker.oldWriterFence, true);
    assert.equal(marker.revision, 2);
    assert.equal(marker.rollbackOfRevision, 1);
    assert.throws(() => assertV3WriterAllowed(platformRoot, 'write', 'legacy'), OldWriterFenced);
  });

  await test('retirement is hash-gated, audited, and idempotent', () => {
    const retirement = retireV3Sources({ platformRoot, workspaceRoot, plan });
    assert.equal(retirement.retired.length > 0, true);
    const second = retireV3Sources({ platformRoot, workspaceRoot, plan });
    assert.equal(second.alreadyRetired.length, retirement.retired.length);
    assert.equal(existsSync(resolve(retirement.bundleRoot, 'pipeline/backlog/001-ownerless.md')), true);
    assert.throws(() => assertV3WriterAllowed(platformRoot, 'move', 'legacy'), OldWriterFenced);
  });

  await test('cross-volume atomic rename is refused when two volumes exist', () => {
    if (process.platform !== 'win32' || parse(platformRoot).root.toLowerCase() === 'z:\\') return;
    assert.throws(() => assertSameVolume(platformRoot, 'Z:\\not-present'), (error) => error.code === 'CROSS_VOLUME_WRITE');
  });

  await test('public scripts expose no rollback-to-v3 API', async () => {
    const migrateEntry = await import('../../../templates/contextkit/tools/scripts/tasks-migrate.mjs');
    const cutoverEntry = await import('../../../templates/contextkit/tools/scripts/tasks-cutover.mjs');
    assert.equal('rollbackMigration' in migrateEntry, false);
    assert.equal('rollbackCutover' in cutoverEntry, false);
    assert.equal(typeof cutoverEntry.rollbackV4, 'function');
  });

  process.stdout.write(`\nv3-to-v4 migration: ${passed} focused checks passed\n`);
} finally {
  rmSync(sandboxRoot, { recursive: true, force: true });
}
