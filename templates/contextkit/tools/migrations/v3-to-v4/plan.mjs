import { basename, dirname, isAbsolute } from 'node:path';
import { MigrationRefusedError, sha256, stableJson, toPortablePath } from './common.mjs';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  createTaskRecord,
  createTasksDocument,
} from '../../scripts/tasks-schema.mjs';
import { renderTasksMarkdown } from '../../scripts/tasks-render.mjs';
import { assertTasksDocument } from '../../scripts/tasks-validate.mjs';

export const V4_TASK_STATUSES = TASK_STATUSES;

const STATUS_MAP = Object.freeze({
  backlog: 'backlog',
  not_started: 'backlog',
  'not-started': 'backlog',
  working: 'working',
  blocked: 'blocked',
  testing: 'testing',
  conclusion: 'done',
  concluded: 'done',
  complete: 'done',
  completed: 'done',
  done: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
});

/** @param {string} legacyStatus @param {object|null} [sidecar] @returns {string|null} */
export function normalizeLegacyStatus(legacyStatus, sidecar = null) {
  if (sidecar?.blocker) return 'blocked';
  return STATUS_MAP[String(legacyStatus || '').trim().toLowerCase()] || null;
}

/** @param {string} value @returns {string} */
function slug(value) {
  return String(value || 'legacy')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'legacy';
}

/** @param {string} legacyId @returns {string} */
function baseTaskId(legacyId) {
  const raw = String(legacyId || '').trim();
  if (/^T-\d+$/i.test(raw)) return raw.toUpperCase();
  if (/^\d+$/.test(raw)) return `T-${raw.padStart(3, '0')}`;
  return `T-${slug(raw).toUpperCase()}`;
}

/** @param {object} workflow @returns {string} */
function canonicalWorkflowDirectory(workflow) {
  const segments = toPortablePath(workflow.directoryPath).split('/').filter(Boolean);
  const doneIndex = segments.indexOf('done');
  if (doneIndex >= 0) segments.splice(doneIndex, 1);
  return segments.join('/');
}

/** @param {object} inventory @param {object} ownerEvidence @returns {string} */
function targetForOwner(inventory, ownerEvidence) {
  if (ownerEvidence.kind === 'workflow') {
    const workflow = inventory.workflows.find((candidate) => candidate.workflowId === ownerEvidence.id);
    if (workflow) return `${canonicalWorkflowDirectory(workflow)}/pipeline/tasks.json`;
    return `memory/workflows/${ownerEvidence.id.toUpperCase()}-imported/pipeline/tasks.json`;
  }
  if (ownerEvidence.kind === 'operation') {
    const prefix = `memory/operations/${ownerEvidence.id.toUpperCase()}`;
    const matching = inventory.workflows.find((workflow) => workflow.directoryPath.startsWith(`${prefix}-`));
    const ownerDirectory = matching ? matching.directoryPath.split('/workflows/')[0] : `${prefix}-imported`;
    return `${ownerDirectory}/batch/tasks.json`;
  }
  if (ownerEvidence.kind === 'business') {
    const prefix = `memory/business/${ownerEvidence.id.toUpperCase()}`;
    const matching = inventory.workflows.find((workflow) => workflow.directoryPath.startsWith(`${prefix}-`));
    const ownerDirectory = matching ? matching.directoryPath.split('/workflows/')[0] : `${prefix}-imported`;
    return `${ownerDirectory}/batch/tasks.json`;
  }
  return 'memory/batches/BATCH-V3-OWNERLESS/tasks.json';
}

/** @param {object} inventory @returns {Map<string, object>} */
function sidecarsByTaskId(inventory) {
  const map = new Map();
  for (const sidecar of inventory.sidecars || []) {
    if (!map.has(sidecar.taskId)) map.set(sidecar.taskId, sidecar);
  }
  return map;
}

/** @param {object} inventory @returns {Map<string, object>} */
function duplicatesByRecord(inventory) {
  const map = new Map();
  for (const group of inventory.duplicates || []) {
    for (const recordKey of group.recordKeys) map.set(recordKey, group);
  }
  return map;
}

/** @param {object} record @param {object|null} duplicateGroup @returns {{ id: string, resolution: string }} */
function resolveTaskId(record, duplicateGroup) {
  const baseId = baseTaskId(record.legacyId);
  if (!duplicateGroup) return { id: baseId, resolution: 'preserved' };
  return { id: `${baseId}-${record.recordKey.slice(-8).toUpperCase()}`, resolution: 'namespaced' };
}

/** @param {object[]} waves @returns {object[]} */
function sanitizeWorkflowWaves(waves) {
  return (Array.isArray(waves) ? waves : []).map((wave) => {
    const { status: ignoredWaveStatus, state: ignoredWaveState, ...waveTopology } = wave || {};
    void ignoredWaveStatus;
    void ignoredWaveState;
    return {
      ...waveTopology,
      tasks: (Array.isArray(wave?.tasks) ? wave.tasks : []).map((task) => {
        const { status: ignoredTaskStatus, state: ignoredTaskState, ...taskTopology } = task || {};
        void ignoredTaskStatus;
        void ignoredTaskState;
        return taskTopology;
      }),
    };
  });
}

/**
 * Refuse a bare v3 id when more than one source record owns it.
 *
 * @param {object} plan
 * @param {string} legacyId
 * @returns {object}
 */
export function resolveLegacyId(plan, legacyId) {
  const matches = plan.manifest.entries.filter((entry) => entry.legacyId === legacyId);
  if (matches.length === 0) throw new MigrationRefusedError(`legacy id not found: ${legacyId}`, 'LEGACY_ID_NOT_FOUND');
  if (matches.length > 1) {
    throw new MigrationRefusedError(
      `ambiguous legacy id ${legacyId}; use one explicit sourcePath or v4Id`,
      'AMBIGUOUS_LEGACY_ID',
    );
  }
  return matches[0];
}

/** @param {object} workflow @param {object[]} activeTaskIds @returns {Record<string, string>} */
function workflowFiles(workflow, activeTaskIds) {
  const directory = canonicalWorkflowDirectory(workflow);
  const legacyPlan = workflow.plan || {};
  const legacyState = workflow.state || {};
  const workflowStatus = workflow.archivedDone
    ? 'done'
    : normalizeLegacyStatus(legacyState.overallStatus || legacyState.status || 'backlog') || 'backlog';
  const owner = workflow.ownerEvidence.kind === 'none'
    ? null
    : { kind: workflow.ownerEvidence.kind, id: workflow.ownerEvidence.id };
  const definition = {
    schemaVersion: 2,
    id: workflow.workflowId,
    title: legacyPlan.title || legacyPlan.slug || basename(directory),
    slug: legacyPlan.slug || slug(basename(directory).replace(/^WF-?\d+-?/i, '')),
    owner,
    objective: legacyPlan.objective || '',
    scope: legacyPlan.scope || { included: [], excluded: [] },
    acceptance: Array.isArray(legacyPlan.acceptance) ? legacyPlan.acceptance : [],
    dependencies: Array.isArray(legacyPlan.dependencies) ? legacyPlan.dependencies : [],
    structure: { mode: 'workflow', waves: sanitizeWorkflowWaves(legacyPlan.waves) },
    artifacts: {
      prd: 'prd.md', spec: 'spec.md', decisions: 'decisions.md', tasks: 'pipeline/tasks.json',
      state: 'workflow-state.json', reports: 'reports/',
    },
    createdAt: legacyPlan.createdAt || workflow.sourceModifiedAt,
    updatedAt: legacyPlan.updatedAt || workflow.sourceModifiedAt,
    migration: { sourceVersion: '3.x', sourcePath: workflow.sourcePath, contentHash: workflow.contentHash },
  };
  const state = {
    schemaVersion: 2,
    workflowId: workflow.workflowId,
    status: workflowStatus,
    phase: workflowStatus === 'done' ? 'completion' : (legacyState.phase || 'planning'),
    revision: Number.isInteger(legacyState.revision) ? legacyState.revision : 0,
    activeTaskIds: workflowStatus === 'done' ? [] : activeTaskIds,
    blockers: Array.isArray(legacyState.blockers) ? legacyState.blockers : [],
    qa: legacyState.qa && typeof legacyState.qa === 'object'
      ? legacyState.qa : { status: 'pending', evidenceRefs: [] },
    lastReportRef: legacyState.lastReportRef || null,
    startedAt: legacyState.startedAt || null,
    updatedAt: legacyState.updatedAt || null,
    completedAt: workflowStatus === 'done' ? (legacyState.completedAt || legacyState.updatedAt || null) : null,
    migration: { archivedDone: workflow.archivedDone, sourcePath: workflow.sourcePath },
  };
  return {
    [`${directory}/workflow.json`]: stableJson(definition),
    [`${directory}/workflow-state.json`]: stableJson(state),
  };
}

/** @param {string} targetPath @param {object[]} tasks @returns {object} */
function taskDocument(targetPath, tasks) {
  const workflowMatch = targetPath.match(/\/(WF-\d+)(?:-[^/]*)?\/pipeline\/tasks\.json$/i);
  const scopeRef = workflowMatch?.[1]?.toUpperCase()
    || (targetPath.includes('BATCH-V3-OWNERLESS') ? 'BATCH-V3-OWNERLESS' : dirname(targetPath));
  return createTasksDocument(scopeRef, { revision: 0, tasks, events: [] });
}

/**
 * Build the complete v4 generation without writing. Every source task record is
 * either migrated or explicitly quarantined; duplicate ids are namespaced.
 *
 * @param {object} inventory
 * @param {{ migrationStamp?: string }} [options]
 * @returns {object}
 */
export function planV3ToV4(inventory, options = {}) {
  if (inventory?.kind !== 'contextdevkit-v3-inventory') {
    throw new MigrationRefusedError('expected a contextdevkit-v3-inventory', 'INVENTORY_SCHEMA');
  }
  const duplicateMap = duplicatesByRecord(inventory);
  const ambiguousWorkflowIds = new Set((inventory.workflowDuplicates || []).map((group) => group.workflowId));
  const sidecarMap = sidecarsByTaskId(inventory);
  const taskGroups = new Map();
  const entries = [];

  for (const record of inventory.records || []) {
    const sidecar = sidecarMap.get(record.legacyId) || null;
    const status = normalizeLegacyStatus(record.status, sidecar);
    const ambiguousWorkflowOwner = record.ownerEvidence.kind === 'workflow'
      && ambiguousWorkflowIds.has(record.ownerEvidence.id);
    if (!record.legacyId || !status || ambiguousWorkflowOwner) {
      entries.push({
        recordKey: record.recordKey,
        legacyId: record.legacyId || null,
        sourcePath: record.sourcePath,
        sourceContentHash: record.contentHash,
        sourceArtifactHash: record.artifactContentHash || record.contentHash,
        disposition: 'quarantined',
        reason: !record.legacyId ? 'missing legacy id'
          : ambiguousWorkflowOwner ? `ambiguous workflow id: ${record.ownerEvidence.id}`
            : `unknown legacy status: ${record.status}`,
      });
      continue;
    }
    const duplicateGroup = duplicateMap.get(record.recordKey) || null;
    const identity = resolveTaskId(record, duplicateGroup);
    const targetPath = targetForOwner(inventory, record.ownerEvidence);
    const sourceTimestamp = record.sourceModifiedAt || options.migrationStamp;
    if (!sourceTimestamp || Number.isNaN(Date.parse(sourceTimestamp))) {
      entries.push({
        recordKey: record.recordKey,
        legacyId: record.legacyId,
        sourcePath: record.sourcePath,
        sourceContentHash: record.contentHash,
        sourceArtifactHash: record.artifactContentHash || record.contentHash,
        disposition: 'quarantined',
        reason: 'missing observed source timestamp',
      });
      continue;
    }
    const task = createTaskRecord({
      id: identity.id,
      batchId: record.ownerEvidence.kind === 'none' ? 'BATCH-V3-OWNERLESS' : null,
      title: record.title,
      status,
      priority: TASK_PRIORITIES.includes(record.priority) ? record.priority : 'P2',
      dependsOn: record.dependsOn || [],
      acceptance: record.acceptance || [],
      touchHints: record.touchHints || [],
      evidenceRefs: [...new Set([...(record.references || []), `migration:v3:${record.sourcePath}`])],
      reportRefs: [],
      createdAt: sourceTimestamp,
      updatedAt: sourceTimestamp,
    }, { now: sourceTimestamp });
    if (!taskGroups.has(targetPath)) taskGroups.set(targetPath, []);
    taskGroups.get(targetPath).push(task);
    entries.push({
      recordKey: record.recordKey,
      legacyId: record.legacyId,
      sourcePath: record.sourcePath,
      sourceContentHash: record.contentHash,
      sourceArtifactHash: record.artifactContentHash || record.contentHash,
      disposition: 'migrated',
      v4Id: identity.id,
      targetPath,
      idResolution: identity.resolution,
      ownerResolution: record.ownerEvidence.kind === 'none' ? 'neutral-batch' : record.ownerEvidence.confidence,
      normalizedStatus: status,
    });
  }
  for (const quarantined of inventory.quarantinedInputs || []) {
    entries.push({
      recordKey: sha256(`${quarantined.sourcePath}\u001f${quarantined.contentHash}`),
      legacyId: null,
      sourcePath: quarantined.sourcePath,
      sourceContentHash: quarantined.contentHash,
      sourceArtifactHash: quarantined.contentHash,
      disposition: 'quarantined',
      reason: quarantined.reason,
    });
  }

  const recordsByKey = new Map((inventory.records || []).map((record) => [record.recordKey, record]));
  for (const [targetPath, tasks] of taskGroups) {
    const targetEntries = entries.filter((entry) => entry.disposition === 'migrated' && entry.targetPath === targetPath);
    const entriesByV4Id = new Map(targetEntries.map((entry) => [entry.v4Id, entry]));
    const entriesByLegacyId = new Map();
    for (const entry of targetEntries) {
      if (!entriesByLegacyId.has(entry.legacyId)) entriesByLegacyId.set(entry.legacyId, []);
      entriesByLegacyId.get(entry.legacyId).push(entry);
    }
    const rejectedTaskIds = new Set();
    for (const task of tasks) {
      const manifestEntry = entriesByV4Id.get(task.id);
      const sourceRecord = recordsByKey.get(manifestEntry.recordKey);
      const normalizedDependencies = [];
      let dependencyFailure = null;
      for (const dependencyId of sourceRecord.dependsOn || []) {
        if (entriesByV4Id.has(dependencyId)) {
          normalizedDependencies.push(dependencyId);
          continue;
        }
        const matches = entriesByLegacyId.get(dependencyId) || [];
        if (matches.length !== 1) {
          dependencyFailure = matches.length > 1
            ? `ambiguous dependency id: ${dependencyId}` : `missing dependency id: ${dependencyId}`;
          break;
        }
        normalizedDependencies.push(matches[0].v4Id);
      }
      if (dependencyFailure) {
        manifestEntry.disposition = 'quarantined';
        manifestEntry.reason = dependencyFailure;
        delete manifestEntry.targetPath;
        delete manifestEntry.v4Id;
        delete manifestEntry.normalizedStatus;
        rejectedTaskIds.add(task.id);
      } else {
        task.dependsOn = [...new Set(normalizedDependencies)];
      }
    }
    taskGroups.set(targetPath, tasks.filter((task) => !rejectedTaskIds.has(task.id)));
  }

  const targetFiles = {};
  const copyFiles = [];
  for (const [targetPath, tasks] of [...taskGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    tasks.sort((left, right) => left.id.localeCompare(right.id));
    const document = taskDocument(targetPath, tasks);
    targetFiles[targetPath] = stableJson(document);
    targetFiles[targetPath.replace(/tasks\.json$/, 'tasks.md')] = renderTasksMarkdown(document);
  }
  for (const workflow of inventory.workflows || []) {
    if (ambiguousWorkflowIds.has(workflow.workflowId)) continue;
    const activeTaskIds = entries
      .filter((entry) => entry.disposition === 'migrated' && entry.targetPath?.startsWith(`${canonicalWorkflowDirectory(workflow)}/`))
      .filter((entry) => entry.normalizedStatus !== 'done' && entry.normalizedStatus !== 'cancelled')
      .map((entry) => entry.v4Id).sort();
    Object.assign(targetFiles, workflowFiles(workflow, activeTaskIds));
    const tasksPath = `${canonicalWorkflowDirectory(workflow)}/pipeline/tasks.json`;
    if (!targetFiles[tasksPath]) {
      const document = taskDocument(tasksPath, []);
      targetFiles[tasksPath] = stableJson(document);
      targetFiles[tasksPath.replace(/tasks\.json$/, 'tasks.md')] = renderTasksMarkdown(document);
    }
    const sourceDirectoryPrefix = `${workflow.directoryPath}/`;
    const targetDirectoryPrefix = `${canonicalWorkflowDirectory(workflow)}/`;
    const generatedOrRetiredNames = new Set([
      'workflow-plan.json', 'workflow-state.json', 'tasks.json', 'tasks.md', 'index.md',
    ]);
    for (const relatedFile of workflow.relatedFiles || []) {
      const relativePath = relatedFile.sourcePath.slice(sourceDirectoryPrefix.length);
      if (!relativePath || generatedOrRetiredNames.has(basename(relativePath))) continue;
      const targetPath = `${targetDirectoryPrefix}${relativePath}`;
      if (Object.prototype.hasOwnProperty.call(targetFiles, targetPath)) continue;
      copyFiles.push({
        sourcePath: relatedFile.sourcePath,
        sourceContentHash: relatedFile.contentHash,
        targetPath,
      });
    }
  }

  entries.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const counts = {
    source: entries.length,
    migrated: entries.filter((entry) => entry.disposition === 'migrated').length,
    quarantined: entries.filter((entry) => entry.disposition === 'quarantined').length,
  };
  copyFiles.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
  const targetFileHashes = Object.fromEntries([
    ...Object.entries(targetFiles).map(([targetPath, contents]) => [targetPath, sha256(contents)]),
    ...copyFiles.map((entry) => [entry.targetPath, entry.sourceContentHash]),
  ].sort(([left], [right]) => left.localeCompare(right)));
  const generationDigest = sha256(stableJson(targetFileHashes));
  const manifestBase = {
    schemaVersion: 1,
    kind: 'contextdevkit-v3-to-v4-manifest',
    migrationId: inventory.sourceDigest.replace(/^sha256:/, '').slice(0, 20),
    migrationStamp: options.migrationStamp || null,
    sourceRoot: inventory.sourceRoot,
    sourceDigest: inventory.sourceDigest,
    inventoryHash: inventory.inventoryHash,
    generationDigest,
    targetFileHashes,
    counts,
    conservation: counts.source === counts.migrated + counts.quarantined,
    duplicates: inventory.duplicates,
    workflowDuplicates: inventory.workflowDuplicates || [],
    quarantinedWorkflows: (inventory.workflows || [])
      .filter((workflow) => ambiguousWorkflowIds.has(workflow.workflowId))
      .map((workflow) => ({ workflowId: workflow.workflowId, sourcePath: workflow.sourcePath, reason: 'ambiguous workflow id' })),
    ownerless: inventory.ownerless,
    divergentProjections: (inventory.projections || []).filter((projection) => projection.status === 'divergent'),
    reparsePoints: inventory.security?.reparsePoints || [],
    legacyArtifacts: [
      ...(inventory.workflows || []).flatMap((workflow) => [
        { sourcePath: workflow.sourcePath, sourceArtifactHash: workflow.contentHash, kind: 'workflow-plan' },
        ...(workflow.stateSourcePath
          ? [{ sourcePath: workflow.stateSourcePath, sourceArtifactHash: workflow.stateContentHash, kind: 'workflow-state' }]
          : []),
      ]),
      ...(inventory.sidecars || []).map((sidecar) => ({
        sourcePath: sidecar.sourcePath,
        sourceArtifactHash: sidecar.contentHash,
        kind: 'sidecar',
      })),
    ].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    legacyDirectories: (inventory.workflows || []).map((workflow) => ({
      sourcePath: workflow.directoryPath,
      kind: workflow.archivedDone ? 'done-workflow' : 'active-workflow',
      fileHashes: Object.fromEntries((workflow.relatedFiles || [])
        .map((file) => [file.sourcePath.slice(workflow.directoryPath.length + 1), file.contentHash])
        .sort(([left], [right]) => left.localeCompare(right))),
    })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    entries,
  };
  const manifestHash = sha256(stableJson(manifestBase));
  const plan = { manifest: { ...manifestBase, manifestHash }, targetFiles, copyFiles };
  validateMigrationPlan(plan);
  return plan;
}

/** @param {object} plan @returns {{ ok: true, taskCount: number, fileCount: number }} */
export function validateMigrationPlan(plan) {
  const manifest = plan?.manifest;
  const targetFiles = plan?.targetFiles;
  const copyFiles = Array.isArray(plan?.copyFiles) ? plan.copyFiles : [];
  if (!manifest || manifest.kind !== 'contextdevkit-v3-to-v4-manifest' || !targetFiles || typeof targetFiles !== 'object') {
    throw new MigrationRefusedError('invalid migration plan shape', 'PLAN_SCHEMA');
  }
  if (manifest.conservation !== true || manifest.counts.source !== manifest.counts.migrated + manifest.counts.quarantined) {
    throw new MigrationRefusedError('migration conservation failed', 'CONSERVATION');
  }
  const expectedManifestHash = sha256(stableJson(Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'manifestHash'),
  )));
  if (expectedManifestHash !== manifest.manifestHash) {
    throw new MigrationRefusedError('manifest hash mismatch', 'MANIFEST_HASH');
  }
  const expectedTargetHashes = Object.fromEntries([
    ...Object.entries(targetFiles).map(([targetPath, contents]) => [targetPath, sha256(contents)]),
    ...copyFiles.map((entry) => [entry.targetPath, entry.sourceContentHash]),
  ].sort(([left], [right]) => left.localeCompare(right)));
  if (stableJson(expectedTargetHashes) !== stableJson(manifest.targetFileHashes)
    || sha256(stableJson(expectedTargetHashes)) !== manifest.generationDigest) {
    throw new MigrationRefusedError('generation hash mismatch', 'GENERATION_HASH');
  }
  const seenTaskIds = new Set();
  let taskCount = 0;
  for (const [targetPath, contents] of Object.entries(targetFiles)) {
    if (isAbsolute(targetPath) || targetPath.startsWith('/') || targetPath.includes('..') || targetPath.includes('\\')) {
      throw new MigrationRefusedError(`unsafe target path: ${targetPath}`, 'TARGET_PATH');
    }
    if (targetPath.endsWith('/tasks.md')) continue;
    const document = JSON.parse(contents.replace(/^\uFEFF/, ''));
    if (targetPath.endsWith('/tasks.json')) {
      try { assertTasksDocument(document); } catch (error) {
        throw new MigrationRefusedError(`invalid v4 tasks schema: ${targetPath}: ${error.message}`, 'TASKS_SCHEMA');
      }
      for (const task of document.tasks) {
        if (!V4_TASK_STATUSES.includes(task.status)) {
          throw new MigrationRefusedError(`invalid v4 task status ${task.status}`, 'TASK_STATUS');
        }
        const globalIdentity = `${targetPath}\u001f${task.id}`;
        if (seenTaskIds.has(globalIdentity)) throw new MigrationRefusedError(`duplicate v4 task id ${task.id}`, 'V4_DUPLICATE');
        seenTaskIds.add(globalIdentity);
        taskCount += 1;
      }
    } else if (targetPath.endsWith('/workflow.json') && document.schemaVersion !== 2) {
      throw new MigrationRefusedError(`invalid v4 workflow schema: ${targetPath}`, 'WORKFLOW_SCHEMA');
    } else if (targetPath.endsWith('/workflow-state.json')) {
      if (document.schemaVersion !== 2 || !V4_TASK_STATUSES.includes(document.status)) {
        throw new MigrationRefusedError(`invalid v4 workflow state: ${targetPath}`, 'WORKFLOW_STATE_SCHEMA');
      }
    }
  }
  for (const entry of copyFiles) {
    if (!entry.sourcePath || !entry.sourceContentHash || !entry.targetPath
      || isAbsolute(entry.targetPath) || entry.targetPath.startsWith('/')
      || entry.targetPath.includes('..') || entry.targetPath.includes('\\')) {
      throw new MigrationRefusedError(`invalid copy operation: ${stableJson(entry).trim()}`, 'COPY_SCHEMA');
    }
    if (Object.prototype.hasOwnProperty.call(targetFiles, entry.targetPath)) {
      throw new MigrationRefusedError(`copy target collides with generated file: ${entry.targetPath}`, 'TARGET_COLLISION');
    }
  }
  if (taskCount !== manifest.counts.migrated) {
    throw new MigrationRefusedError(
      `task parity failed: ${taskCount} generated != ${manifest.counts.migrated} migrated`,
      'TASK_PARITY',
    );
  }
  return { ok: true, taskCount, fileCount: Object.keys(targetFiles).length + copyFiles.length };
}

/** @param {object} plan @returns {{ ok: true, checked: number }} */
export function verifyStatusParity(plan) {
  const statusByTargetIdentity = new Map();
  for (const [targetPath, contents] of Object.entries(plan.targetFiles)) {
    if (!targetPath.endsWith('/tasks.json')) continue;
    const document = JSON.parse(contents);
    for (const task of document.tasks) statusByTargetIdentity.set(`${targetPath}\u001f${task.id}`, task.status);
  }
  let checked = 0;
  for (const entry of plan.manifest.entries.filter((candidate) => candidate.disposition === 'migrated')) {
    if (statusByTargetIdentity.get(`${entry.targetPath}\u001f${entry.v4Id}`) !== entry.normalizedStatus) {
      throw new MigrationRefusedError(`status parity failed for ${entry.sourcePath}`, 'STATUS_PARITY');
    }
    checked += 1;
  }
  return { ok: true, checked };
}
