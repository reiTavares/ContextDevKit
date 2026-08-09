import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import {
  MigrationRefusedError,
  assertNoReparseHop,
  digestFiles,
  sha256,
  stableJson,
  toPortablePath,
} from './common.mjs';

const LEGACY_LANES = Object.freeze(['backlog', 'working', 'testing', 'conclusion']);
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

/** @param {string} raw @returns {Record<string, string>} */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return {};
  const fields = {};
  for (const line of raw.slice(3, end).split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) fields[key] = value;
  }
  return fields;
}

/** @param {string} raw @param {Record<string, string>} frontmatter @returns {string[]} */
function collectReferences(raw, frontmatter) {
  const references = new Set();
  for (const match of raw.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) references.add(match[1].trim());
  for (const key of ['evidence', 'evidenceRefs', 'report', 'reportRefs', 'links']) {
    if (!frontmatter[key]) continue;
    for (const value of frontmatter[key].split(',').map((item) => item.trim()).filter(Boolean)) references.add(value);
  }
  return [...references].sort();
}

/** @param {string} sourcePath @returns {{ kind: string, id: string|null, confidence: string, source: string }} */
function inferOwnerFromPath(sourcePath) {
  const portable = toPortablePath(sourcePath);
  const candidates = [
    ['business', /(?:^|\/)business\/((?:BIZ)-\d+)(?:-|\/)/i],
    ['operation', /(?:^|\/)operations\/((?:OP)-\d+)(?:-|\/)/i],
    ['workflow', /(?:^|\/)workflows\/(?:done\/)?((?:WF)-\d+)(?:-|\/)/i],
  ];
  for (const [kind, pattern] of candidates) {
    const match = portable.match(pattern);
    if (match) return { kind, id: match[1].toUpperCase(), confidence: 'inferred', source: 'sourcePath' };
  }
  return { kind: 'none', id: null, confidence: 'absent', source: 'none' };
}

/** @param {unknown} owner @param {string} workflow @param {string} sourcePath */
function resolveOwnerEvidence(owner, workflow, sourcePath) {
  if (owner && typeof owner === 'object' && typeof owner.id === 'string' && owner.id.trim()) {
    const normalizedKind = String(owner.kind || '').toLowerCase();
    const kind = normalizedKind === 'wf' ? 'workflow'
      : normalizedKind === 'op' ? 'operation'
        : normalizedKind === 'biz' ? 'business' : normalizedKind;
    if (['workflow', 'operation', 'business'].includes(kind)) {
      return { kind, id: owner.id.trim().toUpperCase(), confidence: 'explicit', source: 'owner' };
    }
  }
  if (typeof workflow === 'string' && /WF-?\d+/i.test(workflow)) {
    const match = workflow.match(/WF-?\d+/i)[0].replace(/^WF-?/i, 'WF-');
    return { kind: 'workflow', id: match.toUpperCase(), confidence: 'explicit', source: 'workflow' };
  }
  return inferOwnerFromPath(sourcePath);
}

/** @param {string} absolutePath @returns {string} */
function readBounded(absolutePath) {
  const byteLength = lstatSync(absolutePath).size;
  if (byteLength > MAX_SOURCE_BYTES) {
    throw new MigrationRefusedError(`legacy source exceeds ${MAX_SOURCE_BYTES} bytes: ${absolutePath}`, 'SOURCE_TOO_LARGE');
  }
  return readFileSync(absolutePath, 'utf8');
}

/**
 * Recursively enumerate regular files without following any link/reparse entry.
 * Reparse entries are returned as audit anomalies instead of traversed.
 *
 * @param {string} root
 * @returns {{ files: string[], reparsePoints: string[] }}
 */
function walkSafe(root) {
  const files = [];
  const reparsePoints = [];
  if (!existsSync(root)) return { files, reparsePoints };
  assertNoReparseHop(root, root, false);
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = resolve(current, entry.name);
      if (entry.isSymbolicLink()) {
        reparsePoints.push(candidate);
      } else if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile()) {
        files.push(candidate);
      }
    }
  }
  files.sort();
  reparsePoints.sort();
  return { files, reparsePoints };
}

/** @param {string} platformRoot @param {string} absolutePath @returns {string} */
function sourcePath(platformRoot, absolutePath) {
  return toPortablePath(relative(platformRoot, absolutePath));
}

/** @param {string} platformRoot @param {string} absolutePath @param {string} lane */
function inventoryLaneCard(platformRoot, absolutePath, lane) {
  const raw = readBounded(absolutePath);
  const frontmatter = parseFrontmatter(raw);
  const fileId = basename(absolutePath).match(/^([A-Za-z]*-?\d+)/)?.[1] || '';
  const legacyId = String(frontmatter.id || fileId).trim();
  const portableSourcePath = sourcePath(platformRoot, absolutePath);
  const inferredOwner = resolveOwnerEvidence(null, frontmatter.workflow || '', portableSourcePath);
  const operationId = String(frontmatter.operation || '').match(/OP-?\d+/i)?.[0]?.replace(/^OP-?/i, 'OP-').toUpperCase();
  const businessId = String(frontmatter.business || '').match(/BIZ-?\d+/i)?.[0]?.replace(/^BIZ-?/i, 'BIZ-').toUpperCase();
  const ownerEvidence = inferredOwner.kind !== 'none' ? inferredOwner
    : operationId ? { kind: 'operation', id: operationId, confidence: 'explicit', source: 'operation' }
      : businessId ? { kind: 'business', id: businessId, confidence: 'explicit', source: 'business' }
        : inferredOwner;
  return {
    recordKey: sha256(`${portableSourcePath}\u001f${sha256(raw)}`),
    kind: 'lane-card',
    legacyId,
    sourcePath: portableSourcePath,
    contentHash: sha256(raw),
    artifactContentHash: sha256(raw),
    sourceModifiedAt: lstatSync(absolutePath).mtime.toISOString(),
    status: String(frontmatter.status || lane).trim().toLowerCase(),
    title: String(frontmatter.title || basename(absolutePath, '.md')).trim(),
    priority: String(frontmatter.priority || 'P2').trim(),
    ownerEvidence,
    workflowHint: String(frontmatter.workflow || '').trim(),
    operationHint: operationId || null,
    businessHint: businessId || null,
    references: collectReferences(raw, frontmatter),
    lane,
  };
}

/** @param {string} platformRoot @param {string} absolutePath @returns {object[]} */
function inventoryOwnerTasks(platformRoot, absolutePath) {
  const raw = readBounded(absolutePath);
  const portableSourcePath = sourcePath(platformRoot, absolutePath);
  const document = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!Array.isArray(document?.tasks)) return [];
  return document.tasks.map((task, index) => {
    const legacyId = String(task?.id || '').trim();
    const recordSource = `${portableSourcePath}#tasks/${index}`;
    return {
      recordKey: sha256(`${recordSource}\u001f${sha256(stableJson(task))}`),
      kind: 'owner-task',
      legacyId,
      sourcePath: recordSource,
      contentHash: sha256(stableJson(task)),
      artifactContentHash: sha256(raw),
      sourceModifiedAt: lstatSync(absolutePath).mtime.toISOString(),
      status: String(task?.status || 'not_started').trim().toLowerCase(),
      title: String(task?.title || legacyId || `legacy-task-${index}`).trim(),
      priority: String(task?.priority || 'P2').trim(),
      ownerEvidence: resolveOwnerEvidence(document.owner || task?.owner, task?.workflow || '', portableSourcePath),
      references: [...new Set([
        ...(Array.isArray(task?.evidenceRefs) ? task.evidenceRefs : []),
        ...(Array.isArray(task?.reportRefs) ? task.reportRefs : []),
      ].map(String))].sort(),
      dependsOn: Array.isArray(task?.dependsOn) ? task.dependsOn.map(String) : [],
      acceptance: Array.isArray(task?.acceptance) ? task.acceptance.map(String) : [],
      touchHints: Array.isArray(task?.touchHints) ? task.touchHints.map(String) : [],
    };
  });
}

/** @param {string} platformRoot @param {string} planPath @returns {object} */
function inventoryWorkflow(platformRoot, planPath) {
  const raw = readBounded(planPath);
  const plan = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const workflowDirectory = dirname(planPath);
  const statePath = resolve(workflowDirectory, 'workflow-state.json');
  const stateRaw = existsSync(statePath) ? readBounded(statePath) : null;
  const state = stateRaw === null ? null : JSON.parse(stateRaw.replace(/^\uFEFF/, ''));
  const portableSourcePath = sourcePath(platformRoot, planPath);
  const rawWorkflowId = String(plan.workflowId || plan.id || basename(workflowDirectory).match(/WF-?\d+/i)?.[0] || '').trim();
  const numericWorkflowId = rawWorkflowId.match(/^(?:WF-?)?(\d+)$/i)?.[1];
  const workflowId = numericWorkflowId
    ? `WF-${numericWorkflowId.padStart(4, '0')}`
    : rawWorkflowId.toUpperCase();
  return {
    workflowId,
    sourcePath: portableSourcePath,
    directoryPath: sourcePath(platformRoot, workflowDirectory),
    contentHash: sha256(raw),
    sourceModifiedAt: lstatSync(planPath).mtime.toISOString(),
    stateSourcePath: stateRaw === null ? null : sourcePath(platformRoot, statePath),
    stateContentHash: stateRaw === null ? null : sha256(stateRaw),
    archivedDone: toPortablePath(workflowDirectory).split('/').includes('done'),
    template: toPortablePath(workflowDirectory).split('/').includes('_TEMPLATE') || /\{\{[^}]+\}\}/.test(rawWorkflowId),
    ownerEvidence: resolveOwnerEvidence(plan.owner, '', portableSourcePath),
    plan,
    state,
  };
}

/** Inventory a pre-plan workflow shell from its authored index frontmatter. */
function inventoryWorkflowShell(platformRoot, indexPath) {
  const raw = readBounded(indexPath);
  const frontmatter = parseFrontmatter(raw);
  const workflowDirectory = dirname(indexPath);
  const directoryName = basename(workflowDirectory);
  const workflowNumber = directoryName.match(/^WF-(\d+)/i)?.[1] || String(frontmatter.number || '').match(/\d+/)?.[0];
  const workflowId = workflowNumber ? `WF-${workflowNumber.padStart(4, '0')}` : '';
  const portableSourcePath = sourcePath(platformRoot, indexPath);
  const archivedDone = toPortablePath(workflowDirectory).split('/').includes('done');
  const ownerMatch = String(frontmatter.owner || '').match(/^(OP|BIZ)-?\d+/i)?.[0];
  const owner = ownerMatch
    ? {
      kind: ownerMatch.toUpperCase().startsWith('OP') ? 'operation' : 'business',
      id: ownerMatch.replace(/^(OP|BIZ)-?/i, (_, prefix) => `${prefix.toUpperCase()}-`).toUpperCase(),
    }
    : { kind: 'none', id: null };
  const headingTitle = raw.match(/^# Workflow\s*-\s*(.+)$/m)?.[1]?.trim();
  const purpose = raw.match(/^## Purpose\s*\r?\n+([^#\r\n].+)$/m)?.[1]?.trim();
  const observedTimestamp = frontmatter.started || lstatSync(indexPath).mtime.toISOString();
  const phase = String(frontmatter.currentPhase || 'intake').trim().toLowerCase();
  const shellStatus = archivedDone || String(frontmatter.conclusion || '').toLowerCase() === 'done'
    ? 'done'
    : frontmatter.started ? 'working' : 'backlog';
  return {
    workflowId,
    sourcePath: portableSourcePath,
    directoryPath: sourcePath(platformRoot, workflowDirectory),
    contentHash: sha256(raw),
    sourceModifiedAt: lstatSync(indexPath).mtime.toISOString(),
    stateSourcePath: null,
    stateContentHash: null,
    archivedDone,
    template: /\{\{[^}]+\}\}|<[^>]+>/.test(workflowId),
    shell: true,
    ownerEvidence: owner,
    plan: {
      schemaVersion: 1,
      workflowId,
      slug: frontmatter.slug || directoryName.replace(/^WF-\d+-?/i, ''),
      title: headingTitle || frontmatter.slug || directoryName,
      objective: purpose || headingTitle || frontmatter.slug || directoryName,
      owner,
      createdAt: observedTimestamp,
      updatedAt: lstatSync(indexPath).mtime.toISOString(),
      waves: [],
    },
    state: {
      schemaVersion: 1,
      workflowId,
      overallStatus: shellStatus,
      phase,
      revision: 0,
      startedAt: frontmatter.started || null,
      updatedAt: lstatSync(indexPath).mtime.toISOString(),
    },
  };
}

/** @param {object} workflow @returns {object[]} */
function inventoryWorkflowTasks(workflow) {
  const records = [];
  const taskStates = workflow.state?.taskStates && typeof workflow.state.taskStates === 'object'
    ? workflow.state.taskStates
    : {};
  for (let waveIndex = 0; waveIndex < (workflow.plan?.waves || []).length; waveIndex += 1) {
    const wave = workflow.plan.waves[waveIndex];
    for (let taskIndex = 0; taskIndex < (wave?.tasks || []).length; taskIndex += 1) {
      const task = wave.tasks[taskIndex] || {};
      const legacyId = String(task.id || '').trim();
      const stateValue = taskStates[legacyId];
      const stateStatus = typeof stateValue === 'string'
        ? stateValue
        : stateValue?.status || stateValue?.state || null;
      const source = `${workflow.sourcePath}#waves/${waveIndex}/tasks/${taskIndex}`;
      const taskBytes = stableJson(task);
      records.push({
        recordKey: sha256(`${source}\u001f${sha256(taskBytes)}`),
        kind: 'workflow-task',
        legacyId,
        sourcePath: source,
        contentHash: sha256(taskBytes),
        artifactContentHash: workflow.contentHash,
        sourceModifiedAt: workflow.sourceModifiedAt,
        status: String(stateStatus || task.status || task.state || (workflow.archivedDone ? 'done' : 'not_started')).trim().toLowerCase(),
        title: String(task.title || task.name || legacyId || `legacy-workflow-task-${taskIndex}`).trim(),
        priority: String(task.priority || 'P2').trim(),
        ownerEvidence: {
          kind: 'workflow',
          id: workflow.workflowId,
          confidence: 'explicit',
          source: 'workflow-plan',
          workflowSourcePath: workflow.sourcePath,
        },
        references: [...new Set([
          ...(Array.isArray(task.evidenceRefs) ? task.evidenceRefs : []),
          ...(Array.isArray(task.reportRefs) ? task.reportRefs : []),
          ...(typeof task.evidence === 'string' ? [task.evidence] : []),
        ].map(String).filter(Boolean))].sort(),
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
        acceptance: Array.isArray(task.acceptance)
          ? task.acceptance.map(String)
          : Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.map(String) : [],
        touchHints: Array.isArray(task.touchHints) ? task.touchHints.map(String) : [],
      });
    }
  }
  return records;
}

/** Resolve one workflow source without guessing across duplicate workflow ids. */
function workflowForRecord(record, workflows) {
  if (record.ownerEvidence.kind === 'workflow' && record.ownerEvidence.workflowSourcePath) {
    return workflows.find((workflow) => workflow.sourcePath === record.ownerEvidence.workflowSourcePath) || null;
  }
  const artifactPath = record.sourcePath.split('#')[0];
  const directoryMatches = workflows.filter((workflow) => artifactPath.startsWith(`${workflow.directoryPath}/`));
  if (directoryMatches.length === 1) return directoryMatches[0];
  if (record.ownerEvidence.kind === 'workflow') {
    const idMatches = workflows.filter((workflow) => workflow.workflowId === record.ownerEvidence.id);
    if (idMatches.length === 1) return idMatches[0];
  }
  const workflowHint = String(record.workflowHint || '').trim().toLowerCase();
  if (!workflowHint) return null;
  const hintMatches = workflows.filter((workflow) => [
    workflow.workflowId,
    workflow.plan?.slug,
    basename(workflow.directoryPath).replace(/^WF-\d+-?/i, ''),
  ].some((candidate) => String(candidate || '').toLowerCase() === workflowHint));
  return hintMatches.length === 1 ? hintMatches[0] : null;
}

/**
 * Collapse stale owner-task projections into their workflow-plan identity while
 * retaining every observed representation and content hash for audit/rollback.
 */
function reconcileWorkflowTaskRepresentations(records, workflows) {
  const boundRecords = records.map((record) => {
    const workflow = workflowForRecord(record, workflows);
    if (!workflow || record.ownerEvidence.workflowSourcePath) return record;
    return {
      ...record,
      ownerEvidence: {
        kind: 'workflow',
        id: workflow.workflowId,
        confidence: record.ownerEvidence.kind === 'workflow' ? record.ownerEvidence.confidence : 'inferred',
        source: record.ownerEvidence.kind === 'workflow' ? record.ownerEvidence.source : 'workflow-hint',
        workflowSourcePath: workflow.sourcePath,
      },
    };
  });
  const groups = new Map();
  for (const record of boundRecords) {
    const workflowSourcePath = record.ownerEvidence.workflowSourcePath;
    const groupKey = workflowSourcePath && record.legacyId
      ? `${workflowSourcePath}\u001f${record.legacyId}`
      : `record\u001f${record.recordKey}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(record);
  }

  const reconciled = [];
  for (const group of groups.values()) {
    const workflowRepresentations = group.filter((record) => record.kind === 'workflow-task');
    if (group.length === 1 || workflowRepresentations.length !== 1) {
      reconciled.push(...group);
      continue;
    }
    const canonical = workflowRepresentations[0];
    const sourceRepresentations = group
      .map((record) => ({
        kind: record.kind,
        sourcePath: record.sourcePath,
        contentHash: record.contentHash,
        artifactContentHash: record.artifactContentHash,
        status: record.status,
      }))
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    const sourceModifiedAt = group
      .map((record) => record.sourceModifiedAt)
      .filter((timestamp) => timestamp && !Number.isNaN(Date.parse(timestamp)))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || canonical.sourceModifiedAt;
    reconciled.push({
      ...canonical,
      recordKey: sha256(stableJson(sourceRepresentations)),
      kind: 'reconciled-workflow-task',
      contentHash: sha256(stableJson(sourceRepresentations)),
      sourceModifiedAt,
      priority: group.find((record) => record.priority && record.priority !== 'P2')?.priority || canonical.priority,
      references: [...new Set(group.flatMap((record) => record.references || []))].sort(),
      acceptance: [...new Set(group.flatMap((record) => record.acceptance || []))],
      touchHints: [...new Set(group.flatMap((record) => record.touchHints || []))],
      sourceRepresentations,
      reconciliation: {
        strategy: 'workflow-plan-authority',
        representationCount: sourceRepresentations.length,
        observedStatuses: [...new Set(sourceRepresentations.map((representation) => representation.status))].sort(),
      },
    });
  }
  return reconciled;
}

/** @param {object[]} records @returns {object[]} */
function duplicateGroups(records) {
  const groups = new Map();
  for (const record of records) {
    if (!record.legacyId) continue;
    if (!groups.has(record.legacyId)) groups.set(record.legacyId, []);
    groups.get(record.legacyId).push(record);
  }
  return [...groups.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([legacyId, matches]) => ({
      legacyId,
      recordKeys: matches.map((match) => match.recordKey).sort(),
      sourcePaths: matches.map((match) => match.sourcePath).sort(),
    }))
    .sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/** @param {object[]} workflows @returns {object[]} */
function duplicateWorkflowGroups(workflows) {
  const groups = new Map();
  for (const workflow of workflows) {
    if (!workflow.workflowId) continue;
    if (!groups.has(workflow.workflowId)) groups.set(workflow.workflowId, []);
    groups.get(workflow.workflowId).push(workflow.sourcePath);
  }
  return [...groups.entries()]
    .filter(([, sourcePaths]) => sourcePaths.length > 1)
    .map(([workflowId, sourcePaths]) => ({ workflowId, sourcePaths: sourcePaths.sort() }))
    .sort((left, right) => left.workflowId.localeCompare(right.workflowId));
}

/** @param {object[]} records @param {string} tasksMarkdownPath @param {string} platformRoot */
function inspectProjection(records, tasksMarkdownPath, platformRoot) {
  const raw = readBounded(tasksMarkdownPath);
  const missingIds = records.filter((record) => record.legacyId && !raw.includes(record.legacyId))
    .map((record) => record.legacyId).sort();
  return {
    sourcePath: sourcePath(platformRoot, tasksMarkdownPath),
    contentHash: sha256(raw),
    status: missingIds.length === 0 ? 'consistent' : 'divergent',
    reasons: missingIds.map((id) => `missing task id ${id}`),
  };
}

/**
 * Build a deterministic, read-only inventory of every v3 task/workflow authority.
 * Invalid artifacts and reparse points are conserved as quarantined inputs.
 *
 * @param {string} platformRoot
 * @returns {object}
 */
export function inventoryV3(platformRoot) {
  const resolvedRoot = resolve(platformRoot);
  if (!existsSync(resolvedRoot)) throw new MigrationRefusedError(`platform root does not exist: ${resolvedRoot}`, 'ROOT_MISSING');
  assertNoReparseHop(resolvedRoot, resolvedRoot, false);

  const records = [];
  const workflows = [];
  const sidecars = [];
  const projections = [];
  const quarantinedInputs = [];
  const sourceContents = {};
  const { files, reparsePoints } = walkSafe(resolvedRoot);

  for (const absolutePath of files) {
    const portablePath = sourcePath(resolvedRoot, absolutePath);
    const segments = portablePath.split('/');
    try {
      const laneIndex = segments.indexOf('pipeline') >= 0 ? segments.indexOf('pipeline') + 1 : -1;
      if (laneIndex > 0 && LEGACY_LANES.includes(segments[laneIndex]) && absolutePath.endsWith('.md')) {
        const record = inventoryLaneCard(resolvedRoot, absolutePath, segments[laneIndex]);
        records.push(record);
        sourceContents[portablePath] = readBounded(absolutePath);
      } else if (basename(absolutePath) === 'workflow-plan.json') {
        workflows.push(inventoryWorkflow(resolvedRoot, absolutePath));
        sourceContents[portablePath] = readBounded(absolutePath);
      } else if (basename(absolutePath) === 'tasks.json') {
        const taskRecords = inventoryOwnerTasks(resolvedRoot, absolutePath);
        if (taskRecords.length > 0) {
          records.push(...taskRecords);
          sourceContents[portablePath] = readBounded(absolutePath);
        }
      } else if (basename(absolutePath) === 'state.json' && segments.includes('pipeline')) {
        const raw = readBounded(absolutePath);
        const state = JSON.parse(raw.replace(/^\uFEFF/, ''));
        sidecars.push({
          sourcePath: portablePath,
          contentHash: sha256(raw),
          taskId: String(state.taskId || state.id || basename(dirname(absolutePath))),
          blocker: state.blocker || null,
        });
        sourceContents[portablePath] = raw;
      }
    } catch (error) {
      const raw = (() => { try { return readBounded(absolutePath); } catch { return ''; } })();
      quarantinedInputs.push({
        sourcePath: portablePath,
        contentHash: sha256(raw),
        reason: error instanceof Error ? error.message : String(error),
      });
      sourceContents[portablePath] = raw;
    }
  }

  const plannedWorkflowDirectories = new Set(workflows.map((workflow) => workflow.directoryPath));
  for (const absolutePath of files.filter((filePath) => basename(filePath) === 'index.md')) {
    const workflowDirectory = dirname(absolutePath);
    const portableDirectory = sourcePath(resolvedRoot, workflowDirectory);
    if (!/^WF-\d+(?:-|$)/i.test(basename(workflowDirectory))) continue;
    if (plannedWorkflowDirectories.has(portableDirectory)) continue;
    if (existsSync(resolve(workflowDirectory, 'workflow.json'))) continue;
    try {
      const workflow = inventoryWorkflowShell(resolvedRoot, absolutePath);
      workflows.push(workflow);
      plannedWorkflowDirectories.add(portableDirectory);
      sourceContents[workflow.sourcePath] = readBounded(absolutePath);
    } catch (error) {
      const raw = (() => { try { return readBounded(absolutePath); } catch { return ''; } })();
      quarantinedInputs.push({
        sourcePath: sourcePath(resolvedRoot, absolutePath),
        contentHash: sha256(raw),
        reason: error instanceof Error ? error.message : String(error),
      });
      sourceContents[sourcePath(resolvedRoot, absolutePath)] = raw;
    }
  }

  for (const workflow of workflows) {
    const directoryPrefix = `${workflow.directoryPath}/`;
    workflow.relatedFiles = files
      .map((absolutePath) => ({ absolutePath, portablePath: sourcePath(resolvedRoot, absolutePath) }))
      .filter(({ portablePath }) => portablePath.startsWith(directoryPrefix))
      .map(({ absolutePath, portablePath }) => {
        const raw = readBounded(absolutePath);
        sourceContents[portablePath] = raw;
        return { sourcePath: portablePath, contentHash: sha256(raw) };
      })
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    records.push(...inventoryWorkflowTasks(workflow));
  }
  const taskRepresentationCounts = {
    total: records.length,
    laneCards: records.filter((record) => record.kind === 'lane-card').length,
    ownerTasks: records.filter((record) => record.kind === 'owner-task').length,
    workflowTasks: records.filter((record) => record.kind === 'workflow-task').length,
  };
  const reconciledRecords = reconcileWorkflowTaskRepresentations(records, workflows);
  records.splice(0, records.length, ...reconciledRecords);

  const recordsByDirectory = new Map();
  for (const record of records) {
    const pathOnly = record.sourcePath.split('#')[0];
    const directory = dirname(pathOnly);
    if (!recordsByDirectory.has(directory)) recordsByDirectory.set(directory, []);
    recordsByDirectory.get(directory).push(record);
  }
  for (const absolutePath of files.filter((filePath) => basename(filePath) === 'tasks.md')) {
    const portablePath = sourcePath(resolvedRoot, absolutePath);
    const projectionDirectory = dirname(portablePath);
    const siblings = [...(recordsByDirectory.get(projectionDirectory) || [])];
    const workflow = workflows.find((candidate) => candidate.directoryPath === projectionDirectory);
    if (workflow) {
      for (const wave of workflow.plan?.waves || []) {
        for (const task of wave?.tasks || []) {
          if (task?.id) siblings.push({ legacyId: String(task.id) });
        }
      }
      for (const taskId of Object.keys(workflow.state?.taskStates || {})) siblings.push({ legacyId: taskId });
    }
    projections.push(inspectProjection(siblings, absolutePath, resolvedRoot));
  }

  const workflowDirectoryPrefixes = workflows.map((workflow) => `${workflow.directoryPath}/`);
  const ownerTaskArtifactPaths = new Set(records
    .filter((record) => record.kind === 'owner-task')
    .map((record) => record.sourcePath.split('#')[0]));
  const quarantinedArtifactPaths = new Set(quarantinedInputs.map((entry) => entry.sourcePath));
  const memoryArtifacts = [];
  const retiredMemoryArtifacts = [];
  for (const absolutePath of files) {
    const portablePath = sourcePath(resolvedRoot, absolutePath);
    if (!portablePath.startsWith('memory/')) continue;
    if (portablePath.startsWith('memory/project-map/')) continue;
    if (workflowDirectoryPrefixes.some((prefix) => portablePath.startsWith(prefix))) continue;
    if (ownerTaskArtifactPaths.has(portablePath)) continue;

    const siblingTasksJson = `${dirname(portablePath)}/tasks.json`;
    const isRetiredProjection = basename(portablePath) === 'tasks.md'
      && (ownerTaskArtifactPaths.has(siblingTasksJson) || quarantinedArtifactPaths.has(siblingTasksJson));
    const isRetiredChecksum = portablePath === 'memory/workflow-state-checksum-manifest.json';
    const isQuarantinedTaskStore = basename(portablePath) === 'tasks.json'
      && quarantinedArtifactPaths.has(portablePath);
    const raw = readBounded(absolutePath);
    sourceContents[portablePath] = raw;
    const artifact = { sourcePath: portablePath, contentHash: sha256(raw) };
    if (isRetiredProjection || isRetiredChecksum || isQuarantinedTaskStore) {
      retiredMemoryArtifacts.push(artifact);
    } else {
      memoryArtifacts.push(artifact);
    }
  }

  records.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  workflows.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  sidecars.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  projections.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  quarantinedInputs.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  memoryArtifacts.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  retiredMemoryArtifacts.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  const existingBatchIds = [...new Set(files
    .map((absolutePath) => sourcePath(resolvedRoot, absolutePath).match(/^memory\/batches\/(BATCH-\d{4,})(?:-|\/)/i)?.[1]?.toUpperCase())
    .filter(Boolean))].sort();

  const legacyPipelineFiles = files
    .map((absolutePath) => ({ absolutePath, portablePath: sourcePath(resolvedRoot, absolutePath) }))
    .filter(({ portablePath }) => portablePath.startsWith('pipeline/'))
    .map(({ absolutePath, portablePath }) => {
      const raw = readBounded(absolutePath);
      sourceContents[portablePath] = raw;
      return {
        sourcePath: portablePath,
        relativePath: portablePath.slice('pipeline/'.length),
        contentHash: sha256(raw),
      };
    })
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  const inventory = {
    schemaVersion: 1,
    kind: 'contextdevkit-v3-inventory',
    sourceRoot: toPortablePath(resolvedRoot),
    counts: {
      sourceRecords: records.length + quarantinedInputs.length,
      taskRecords: records.length,
      taskRepresentations: taskRepresentationCounts.total,
      laneCards: taskRepresentationCounts.laneCards,
      ownerTasks: taskRepresentationCounts.ownerTasks,
      workflowTasks: taskRepresentationCounts.workflowTasks,
      reconciledWorkflowTasks: records.filter((record) => record.kind === 'reconciled-workflow-task').length,
      workflows: workflows.length,
      sidecars: sidecars.length,
      quarantinedInputs: quarantinedInputs.length,
      preservedMemoryArtifacts: memoryArtifacts.length,
      retiredMemoryArtifacts: retiredMemoryArtifacts.length,
      legacyPipelineFiles: legacyPipelineFiles.length,
    },
    records,
    workflows,
    sidecars,
    duplicates: duplicateGroups(records),
    workflowDuplicates: duplicateWorkflowGroups(workflows),
    ownerless: records.filter((record) => record.ownerEvidence.kind === 'none').map((record) => record.recordKey),
    projections,
    quarantinedInputs,
    memoryArtifacts,
    retiredMemoryArtifacts,
    existingBatchIds,
    legacyPipelineDirectory: legacyPipelineFiles.length > 0 ? {
      sourcePath: 'pipeline',
      fileHashes: Object.fromEntries(legacyPipelineFiles.map((file) => [file.relativePath, file.contentHash])),
    } : null,
    security: {
      reparsePoints: reparsePoints.map((path) => sourcePath(resolvedRoot, path)),
    },
  };
  const sourceContentDigest = digestFiles(sourceContents);
  inventory.sourceDigest = sha256(stableJson({
    sourceContentDigest,
    reparsePoints: inventory.security.reparsePoints,
    quarantinedInputs: inventory.quarantinedInputs,
  }));
  inventory.inventoryHash = sha256(stableJson(inventory));
  return inventory;
}

export { LEGACY_LANES };
