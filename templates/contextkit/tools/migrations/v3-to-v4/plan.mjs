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
import { optionalContextFiles, requiredContextFiles, WORKFLOW_PHASES } from '../../scripts/workflow/catalog.mjs';
import { renderIndexMarkdown } from '../../scripts/workflow/render.mjs';
import {
  validateContextManifest,
  validateWorkflowDefinition,
  validateWorkflowState,
} from '../../scripts/workflow/validate.mjs';

export const V4_TASK_STATUSES = TASK_STATUSES;

const STATUS_MAP = Object.freeze({
  backlog: 'backlog',
  pending: 'backlog',
  todo: 'backlog',
  deferred: 'backlog',
  not_started: 'backlog',
  'not-started': 'backlog',
  working: 'working',
  active: 'working',
  in_progress: 'working',
  'in-progress': 'working',
  blocked: 'blocked',
  testing: 'testing',
  qa: 'testing',
  review: 'testing',
  conclusion: 'done',
  concluded: 'done',
  complete: 'done',
  completed: 'done',
  done: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  skipped: 'cancelled',
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

/** Build explicit source-path mappings for duplicate workflow ids. */
function buildWorkflowMappings(inventory) {
  const workflows = (inventory.workflows || []).filter((workflow) => workflow.template !== true);
  const validIds = workflows.map((workflow) => workflow.workflowId).filter((id) => /^WF-\d{4,}$/.test(id));
  const reserved = new Set(validIds);
  const seenOriginal = new Set();
  let nextNumber = validIds.reduce((highest, id) => Math.max(highest, Number(id.slice(3))), 0) + 1;
  return workflows
    .slice()
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
    .map((workflow) => {
      let v4Id = workflow.workflowId;
      let idResolution = 'preserved';
      if (!/^WF-\d{4,}$/.test(v4Id) || seenOriginal.has(v4Id)) {
        while (reserved.has(`WF-${String(nextNumber).padStart(4, '0')}`)) nextNumber += 1;
        v4Id = `WF-${String(nextNumber).padStart(4, '0')}`;
        reserved.add(v4Id);
        nextNumber += 1;
        idResolution = 'namespaced';
      } else {
        seenOriginal.add(v4Id);
      }
      return { sourcePath: workflow.sourcePath, legacyId: workflow.workflowId, v4Id, idResolution };
    });
}

/** Return the authoritative normalized legacy workflow status. */
function legacyWorkflowStatus(workflow) {
  if (workflow.archivedDone) return 'done';
  const legacyState = workflow.state || {};
  return normalizeLegacyStatus(legacyState.overallStatus || legacyState.status || 'backlog') || 'backlog';
}

/** @param {object} workflow @param {string} workflowId @returns {string} */
function canonicalWorkflowDirectory(workflow, workflowId = workflow.workflowId) {
  const segments = toPortablePath(workflow.directoryPath).split('/').filter(Boolean);
  const doneIndex = segments.indexOf('done');
  const completed = legacyWorkflowStatus(workflow) === 'done';
  if (completed && doneIndex < 0) {
    const workflowsIndex = segments.lastIndexOf('workflows');
    const ownerScoped = segments.includes('operations') || segments.includes('business');
    if (workflowsIndex >= 0 && ownerScoped) segments.splice(workflowsIndex, 1, 'done');
    else if (workflowsIndex >= 0) segments.splice(workflowsIndex + 1, 0, 'done');
  } else if (!completed && doneIndex >= 0) {
    if (segments[doneIndex - 1] === 'workflows') segments.splice(doneIndex, 1);
    else segments.splice(doneIndex, 1, 'workflows');
  }
  const folderSlug = slug(workflow.plan?.slug || segments.at(-1).replace(/^(?:WF-)?\d+(?:-\d+)?-?/i, ''));
  segments[segments.length - 1] = `${workflowId}-${folderSlug}`;
  return segments.join('/');
}

/** Allocate a canonical neutral batch without colliding with an existing batch. */
function neutralBatchFor(inventory) {
  const highest = (inventory.existingBatchIds || []).reduce((current, id) => {
    const match = String(id).match(/^BATCH-(\d{4,})$/i);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  const id = `BATCH-${String(highest + 1).padStart(4, '0')}`;
  return { id, directory: `memory/batches/${id}-v3-ownerless` };
}

/** @param {object} inventory @param {object} ownerEvidence @param {object} neutralBatch @returns {string} */
function targetForOwner(inventory, ownerEvidence, neutralBatch, workflowMappingBySource) {
  if (ownerEvidence.kind === 'workflow') {
    const workflow = ownerEvidence.workflowSourcePath
      ? inventory.workflows.find((candidate) => candidate.sourcePath === ownerEvidence.workflowSourcePath)
      : inventory.workflows.find((candidate) => candidate.workflowId === ownerEvidence.id);
    const mapping = workflow ? workflowMappingBySource.get(workflow.sourcePath) : null;
    if (workflow && mapping) return `${canonicalWorkflowDirectory(workflow, mapping.v4Id)}/pipeline/tasks.json`;
    return `memory/workflows/${ownerEvidence.id.toUpperCase()}-imported/pipeline/tasks.json`;
  }
  if (ownerEvidence.kind === 'operation') {
    const prefix = `memory/operations/${ownerEvidence.id.toUpperCase()}`;
    const matching = inventory.workflows.find((workflow) => workflow.directoryPath.startsWith(`${prefix}-`));
    const matchingArtifact = inventory.memoryArtifacts?.find((artifact) => artifact.sourcePath.startsWith(`${prefix}-`));
    const ownerDirectory = matchingArtifact ? matchingArtifact.sourcePath.split('/').slice(0, 3).join('/')
      : matching ? matching.directoryPath.split('/').slice(0, 3).join('/') : `${prefix}-imported`;
    return `${ownerDirectory}/batch/tasks.json`;
  }
  if (ownerEvidence.kind === 'business') {
    const prefix = `memory/business/${ownerEvidence.id.toUpperCase()}`;
    const matching = inventory.workflows.find((workflow) => workflow.directoryPath.startsWith(`${prefix}-`));
    const matchingArtifact = inventory.memoryArtifacts?.find((artifact) => artifact.sourcePath.startsWith(`${prefix}-`));
    const ownerDirectory = matchingArtifact ? matchingArtifact.sourcePath.split('/').slice(0, 3).join('/')
      : matching ? matching.directoryPath.split('/').slice(0, 3).join('/') : `${prefix}-imported`;
    return `${ownerDirectory}/batch/tasks.json`;
  }
  return `${neutralBatch.directory}/tasks.json`;
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
    const {
      status: ignoredWaveStatus,
      state: ignoredWaveState,
      tasks: ignoredWaveTasks,
      ...waveTopology
    } = wave || {};
    void ignoredWaveStatus;
    void ignoredWaveState;
    void ignoredWaveTasks;
    return {
      ...waveTopology,
      id: String(wave?.id || '').trim(),
      dependsOn: Array.isArray(wave?.dependsOn) ? [...new Set(wave.dependsOn.map(String).filter(Boolean))] : [],
    };
  });
}

/** Map legacy workflow phase vocabulary into the closed v4 aggregate set. */
function normalizeWorkflowPhase(value, status) {
  if (status === 'done') return 'conclusion';
  const normalized = String(value || '').trim().toLowerCase();
  if (WORKFLOW_PHASES.includes(normalized)) return normalized;
  const aliases = {
    planning: 'intake', requirements: 'prd', product: 'prd', architecture: 'spec',
    design: 'spec', decision: 'adr', decisions: 'adr', tasks: 'pipeline',
    implementation: 'ship', qa: 'testing', completion: 'conclusion', complete: 'conclusion',
  };
  return aliases[normalized] || 'intake';
}

/** Preserve blockers as factual strings without retaining a second state schema. */
function normalizeBlockers(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (entry && typeof entry === 'object') return String(entry.reason || entry.message || stableJson(entry).trim());
    return String(entry || '').trim();
  }).filter(Boolean))];
}

/** Normalize legacy QA state without manufacturing a passing verdict. */
function normalizeQa(value) {
  const allowed = new Set(['pending', 'passed', 'failed', 'skipped']);
  const status = allowed.has(value?.status) ? value.status : 'pending';
  return {
    status,
    evidenceRefs: Array.isArray(value?.evidenceRefs)
      ? [...new Set(value.evidenceRefs.map(String).filter(Boolean))]
      : [],
  };
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
function workflowFiles(workflow, activeTaskIds, workflowId) {
  const directory = canonicalWorkflowDirectory(workflow, workflowId);
  const legacyPlan = workflow.plan || {};
  const legacyState = workflow.state || {};
  const workflowStatus = legacyWorkflowStatus(workflow);
  const owner = ['business', 'operation'].includes(workflow.ownerEvidence.kind)
    ? { kind: workflow.ownerEvidence.kind, id: workflow.ownerEvidence.id }
    : { kind: 'none', id: null };
  const observedTimestamp = legacyPlan.updatedAt || legacyPlan.createdAt
    || legacyState.updatedAt || workflow.sourceModifiedAt;
  const title = legacyPlan.title || legacyPlan.slug || basename(directory);
  const definition = {
    schemaVersion: 2,
    id: workflowId,
    title,
    slug: legacyPlan.slug || slug(basename(directory).replace(/^WF-?\d+-?/i, '')),
    owner,
    objective: legacyPlan.objective || `Migrate ${workflowId}: ${title}`,
    scope: legacyPlan.scope || { included: [], excluded: [] },
    acceptance: Array.isArray(legacyPlan.acceptance) ? legacyPlan.acceptance : [],
    dependencies: Array.isArray(legacyPlan.dependencies) ? legacyPlan.dependencies : [],
    structure: { mode: 'workflow', waves: sanitizeWorkflowWaves(legacyPlan.waves) },
    artifacts: {
      prd: 'prd.md', spec: 'spec.md', decisions: 'decisions.md', tasks: 'pipeline/tasks.json',
      state: 'workflow-state.json', reports: 'reports/',
    },
    createdAt: legacyPlan.createdAt || workflow.sourceModifiedAt,
    updatedAt: observedTimestamp,
    migration: { sourceVersion: '3.x', sourcePath: workflow.sourcePath, contentHash: workflow.contentHash },
  };
  const state = {
    schemaVersion: 2,
    workflowId,
    status: workflowStatus,
    phase: normalizeWorkflowPhase(legacyState.phase, workflowStatus),
    revision: Number.isInteger(legacyState.revision) ? legacyState.revision : 0,
    activeTaskIds: workflowStatus === 'done' ? [] : activeTaskIds,
    blockers: normalizeBlockers(legacyState.blockers),
    qa: normalizeQa(legacyState.qa),
    lastReportRef: null,
    startedAt: legacyState.startedAt || null,
    updatedAt: legacyState.updatedAt || observedTimestamp,
    completedAt: workflowStatus === 'done' ? (legacyState.completedAt || observedTimestamp) : null,
    migration: { archivedDone: workflow.archivedDone, sourcePath: workflow.sourcePath },
  };
  return {
    [`${directory}/workflow.json`]: stableJson(definition),
    [`${directory}/workflow-state.json`]: stableJson(state),
    [`${directory}/context-manifest.json`]: stableJson({
      schemaVersion: 1,
      workflowId,
      required: requiredContextFiles(),
      optional: optionalContextFiles(),
    }),
  };
}

/** @param {string} targetPath @param {object[]} tasks @param {object} neutralBatch @returns {object} */
function taskDocument(targetPath, tasks, neutralBatch) {
  const workflowMatch = targetPath.match(/\/(WF-\d+)(?:-[^/]*)?\/pipeline\/tasks\.json$/i);
  const neutralBatchMatch = targetPath === `${neutralBatch.directory}/tasks.json`;
  const scopeRef = workflowMatch?.[1]?.toUpperCase()
    || (neutralBatchMatch ? neutralBatch.id : dirname(targetPath));
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
  const neutralBatch = neutralBatchFor(inventory);
  const workflowMappings = buildWorkflowMappings(inventory);
  const workflowMappingBySource = new Map(
    workflowMappings.map((mapping) => [mapping.sourcePath, mapping]),
  );
  const ambiguousWorkflowIds = new Set((inventory.workflowDuplicates || []).map((group) => group.workflowId));
  const sidecarMap = sidecarsByTaskId(inventory);
  const taskGroups = new Map();
  const entries = [];

  for (const record of inventory.records || []) {
    const sidecar = sidecarMap.get(record.legacyId) || null;
    const status = normalizeLegacyStatus(record.status, sidecar);
    const ambiguousWorkflowOwner = record.ownerEvidence.kind === 'workflow'
      && ambiguousWorkflowIds.has(record.ownerEvidence.id)
      && !record.ownerEvidence.workflowSourcePath;
    if (!record.legacyId || !status || ambiguousWorkflowOwner) {
      entries.push({
        recordKey: record.recordKey,
        legacyId: record.legacyId || null,
        sourcePath: record.sourcePath,
        sourceContentHash: record.contentHash,
        sourceArtifactHash: record.artifactContentHash || record.contentHash,
        sourceRepresentations: record.sourceRepresentations || null,
        reconciliation: record.reconciliation || null,
        disposition: 'quarantined',
        reason: !record.legacyId ? 'missing legacy id'
          : ambiguousWorkflowOwner ? `ambiguous workflow id: ${record.ownerEvidence.id}`
            : `unknown legacy status: ${record.status}`,
      });
      continue;
    }
    const duplicateGroup = duplicateMap.get(record.recordKey) || null;
    const identity = resolveTaskId(record, duplicateGroup);
    const targetPath = targetForOwner(
      inventory,
      record.ownerEvidence,
      neutralBatch,
      workflowMappingBySource,
    );
    const sourceTimestamp = record.sourceModifiedAt || options.migrationStamp;
    if (!sourceTimestamp || Number.isNaN(Date.parse(sourceTimestamp))) {
      entries.push({
        recordKey: record.recordKey,
        legacyId: record.legacyId,
        sourcePath: record.sourcePath,
        sourceContentHash: record.contentHash,
        sourceArtifactHash: record.artifactContentHash || record.contentHash,
        sourceRepresentations: record.sourceRepresentations || null,
        reconciliation: record.reconciliation || null,
        disposition: 'quarantined',
        reason: 'missing observed source timestamp',
      });
      continue;
    }
    const task = createTaskRecord({
      id: identity.id,
      batchId: record.ownerEvidence.kind === 'none' ? neutralBatch.id : null,
      title: record.title,
      status,
      priority: TASK_PRIORITIES.includes(record.priority) ? record.priority : 'P2',
      dependsOn: record.dependsOn || [],
      acceptance: record.acceptance || [],
      touchHints: record.touchHints || [],
      evidenceRefs: [...new Set([
        ...(record.references || []),
        ...(record.sourceRepresentations || [{ sourcePath: record.sourcePath }])
          .map((representation) => `migration:v3:${representation.sourcePath}`),
      ])],
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
      sourceRepresentations: record.sourceRepresentations || null,
      reconciliation: record.reconciliation || null,
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
    const normalizedDependenciesByTaskId = new Map();
    const rejectionReasonByTaskId = new Map();
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
        rejectionReasonByTaskId.set(task.id, dependencyFailure);
      } else {
        normalizedDependenciesByTaskId.set(task.id, [...new Set(normalizedDependencies)]);
      }
    }
    let dependencyRejectionChanged = true;
    while (dependencyRejectionChanged) {
      dependencyRejectionChanged = false;
      for (const [taskId, dependencyIds] of normalizedDependenciesByTaskId) {
        if (rejectionReasonByTaskId.has(taskId)) continue;
        const rejectedDependencyId = dependencyIds.find((dependencyId) => rejectionReasonByTaskId.has(dependencyId));
        if (!rejectedDependencyId) continue;
        rejectionReasonByTaskId.set(taskId, `dependency was quarantined: ${rejectedDependencyId}`);
        dependencyRejectionChanged = true;
      }
    }
    for (const task of tasks) {
      const rejectionReason = rejectionReasonByTaskId.get(task.id);
      if (!rejectionReason) {
        task.dependsOn = normalizedDependenciesByTaskId.get(task.id) || [];
        continue;
      }
      const manifestEntry = entriesByV4Id.get(task.id);
      manifestEntry.disposition = 'quarantined';
      manifestEntry.reason = rejectionReason;
      delete manifestEntry.targetPath;
      delete manifestEntry.v4Id;
      delete manifestEntry.normalizedStatus;
    }
    taskGroups.set(targetPath, tasks.filter((task) => !rejectionReasonByTaskId.has(task.id)));
  }

  const targetFiles = {};
  const copyFiles = [];
  for (const [targetPath, tasks] of [...taskGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    tasks.sort((left, right) => left.id.localeCompare(right.id));
    const document = taskDocument(targetPath, tasks, neutralBatch);
    targetFiles[targetPath] = stableJson(document);
    targetFiles[targetPath.replace(/tasks\.json$/, 'tasks.md')] = renderTasksMarkdown(document);
  }
  if (taskGroups.has(`${neutralBatch.directory}/tasks.json`)) {
    targetFiles[`${neutralBatch.directory}/batch.json`] = stableJson({
      schemaVersion: 2,
      id: neutralBatch.id,
      title: 'Migrated ownerless work',
      active: true,
      createdAt: options.migrationStamp || null,
    });
    targetFiles[`${neutralBatch.directory}/reports/.gitkeep`] = '';
  }
  for (const workflow of inventory.workflows || []) {
    if (workflow.template === true) continue;
    const workflowMapping = workflowMappingBySource.get(workflow.sourcePath);
    if (!workflowMapping) continue;
    const targetDirectory = canonicalWorkflowDirectory(workflow, workflowMapping.v4Id);
    const activeTaskIds = entries
      .filter((entry) => entry.disposition === 'migrated' && entry.targetPath?.startsWith(`${targetDirectory}/`))
      .filter((entry) => entry.normalizedStatus !== 'done' && entry.normalizedStatus !== 'cancelled')
      .map((entry) => entry.v4Id).sort();
    Object.assign(targetFiles, workflowFiles(workflow, activeTaskIds, workflowMapping.v4Id));
    const tasksPath = `${targetDirectory}/pipeline/tasks.json`;
    if (!targetFiles[tasksPath]) {
      const document = taskDocument(tasksPath, [], neutralBatch);
      targetFiles[tasksPath] = stableJson(document);
      targetFiles[tasksPath.replace(/tasks\.json$/, 'tasks.md')] = renderTasksMarkdown(document);
    }
    const sourceDirectoryPrefix = `${workflow.directoryPath}/`;
    const targetDirectoryPrefix = `${targetDirectory}/`;
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
    const hasPlannedPath = (targetPath) => Object.prototype.hasOwnProperty.call(targetFiles, targetPath)
      || copyFiles.some((entry) => entry.targetPath === targetPath);
    for (const documentName of ['prd.md', 'spec.md', 'decisions.md']) {
      const targetPath = `${targetDirectoryPrefix}${documentName}`;
      if (!hasPlannedPath(targetPath)) {
        targetFiles[targetPath] = `# ${documentName.replace(/\.md$/, '').toUpperCase()}\n\n> Migration note: no legacy ${documentName} was present; content was not inferred.\n`;
      }
    }
    const reportsPrefix = `${targetDirectoryPrefix}reports/`;
    if (![...Object.keys(targetFiles), ...copyFiles.map((entry) => entry.targetPath)]
      .some((targetPath) => targetPath.startsWith(reportsPrefix))) {
      targetFiles[`${reportsPrefix}.gitkeep`] = '';
    }
    const definition = JSON.parse(targetFiles[`${targetDirectoryPrefix}workflow.json`]);
    const state = JSON.parse(targetFiles[`${targetDirectoryPrefix}workflow-state.json`]);
    const tasks = JSON.parse(targetFiles[tasksPath]);
    targetFiles[`${targetDirectoryPrefix}index.md`] = renderIndexMarkdown(definition, state, tasks);
  }
  for (const artifact of inventory.memoryArtifacts || []) {
    if (Object.prototype.hasOwnProperty.call(targetFiles, artifact.sourcePath)) continue;
    if (copyFiles.some((entry) => entry.targetPath === artifact.sourcePath)) continue;
    copyFiles.push({
      sourcePath: artifact.sourcePath,
      sourceContentHash: artifact.contentHash,
      targetPath: artifact.sourcePath,
    });
  }

  entries.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const counts = {
    source: entries.length,
    migrated: entries.filter((entry) => entry.disposition === 'migrated').length,
    quarantined: entries.filter((entry) => entry.disposition === 'quarantined').length,
    sourceRepresentations: (inventory.counts?.taskRepresentations || inventory.records?.length || 0)
      + (inventory.quarantinedInputs?.length || 0),
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
    workflowMappings,
    quarantinedWorkflows: (inventory.workflows || [])
      .filter((workflow) => workflow.template === true)
      .map((workflow) => ({
        workflowId: workflow.workflowId,
        sourcePath: workflow.sourcePath,
        reason: 'template artifact',
      })),
    ownerless: inventory.ownerless,
    divergentProjections: (inventory.projections || []).filter((projection) => projection.status === 'divergent'),
    reparsePoints: inventory.security?.reparsePoints || [],
    neutralBatch: taskGroups.has(`${neutralBatch.directory}/tasks.json`) ? neutralBatch : null,
    preservedMemoryArtifacts: inventory.memoryArtifacts || [],
    legacyArtifacts: [
      ...(inventory.workflows || []).flatMap((workflow) => [
        {
          sourcePath: workflow.sourcePath,
          sourceArtifactHash: workflow.contentHash,
          kind: workflow.shell === true ? 'workflow-index' : 'workflow-plan',
        },
        ...(workflow.stateSourcePath
          ? [{ sourcePath: workflow.stateSourcePath, sourceArtifactHash: workflow.stateContentHash, kind: 'workflow-state' }]
          : []),
      ]),
      ...(inventory.sidecars || []).map((sidecar) => ({
        sourcePath: sidecar.sourcePath,
        sourceArtifactHash: sidecar.contentHash,
        kind: 'sidecar',
      })),
      ...(inventory.retiredMemoryArtifacts || []).map((artifact) => ({
        sourcePath: artifact.sourcePath,
        sourceArtifactHash: artifact.contentHash,
        kind: 'retired-memory-artifact',
      })),
    ].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    legacyDirectories: [
      ...(inventory.workflows || []).map((workflow) => ({
        sourcePath: workflow.directoryPath,
        kind: workflow.archivedDone ? 'done-workflow' : 'active-workflow',
        fileHashes: Object.fromEntries((workflow.relatedFiles || [])
          .map((file) => [file.sourcePath.slice(workflow.directoryPath.length + 1), file.contentHash])
          .sort(([left], [right]) => left.localeCompare(right))),
      })),
      ...(inventory.legacyPipelineDirectory
        ? [{ ...inventory.legacyPipelineDirectory, kind: 'legacy-pipeline-root' }]
        : []),
    ].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
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
    if (targetPath.endsWith('.md') || targetPath.endsWith('/.gitkeep')) continue;
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
    } else if (targetPath.endsWith('/workflow.json')) {
      const verdict = validateWorkflowDefinition(document);
      if (!verdict.valid) {
        throw new MigrationRefusedError(`invalid v4 workflow schema: ${targetPath}: ${verdict.errors.map((entry) => entry.message).join('; ')}`, 'WORKFLOW_SCHEMA');
      }
    } else if (targetPath.endsWith('/workflow-state.json')) {
      const verdict = validateWorkflowState(document);
      if (!verdict.valid) {
        throw new MigrationRefusedError(`invalid v4 workflow state: ${targetPath}: ${verdict.errors.map((entry) => entry.message).join('; ')}`, 'WORKFLOW_STATE_SCHEMA');
      }
    } else if (targetPath.endsWith('/context-manifest.json')) {
      const verdict = validateContextManifest(document);
      if (!verdict.valid) {
        throw new MigrationRefusedError(`invalid v4 context manifest: ${targetPath}: ${verdict.errors.map((entry) => entry.message).join('; ')}`, 'CONTEXT_MANIFEST_SCHEMA');
      }
    } else if (targetPath.endsWith('/batch.json')) {
      if (document.schemaVersion !== 2 || !/^BATCH-\d{4,}$/.test(document.id) || document.active !== true) {
        throw new MigrationRefusedError(`invalid v4 batch schema: ${targetPath}`, 'BATCH_SCHEMA');
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
