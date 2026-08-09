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
    ownerEvidence: resolveOwnerEvidence(null, frontmatter.workflow || '', portableSourcePath),
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
  const workflowId = String(plan.workflowId || plan.id || basename(workflowDirectory).match(/WF-?\d+/i)?.[0] || '')
    .replace(/^WF-?/i, 'WF-').toUpperCase();
  return {
    workflowId,
    sourcePath: portableSourcePath,
    directoryPath: sourcePath(platformRoot, workflowDirectory),
    contentHash: sha256(raw),
    sourceModifiedAt: lstatSync(planPath).mtime.toISOString(),
    stateSourcePath: stateRaw === null ? null : sourcePath(platformRoot, statePath),
    stateContentHash: stateRaw === null ? null : sha256(stateRaw),
    archivedDone: toPortablePath(workflowDirectory).split('/').includes('done'),
    ownerEvidence: resolveOwnerEvidence(plan.owner, '', portableSourcePath),
    plan,
    state,
  };
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
  }

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

  records.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  workflows.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  sidecars.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  projections.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  quarantinedInputs.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  const inventory = {
    schemaVersion: 1,
    kind: 'contextdevkit-v3-inventory',
    sourceRoot: toPortablePath(resolvedRoot),
    counts: {
      sourceRecords: records.length + quarantinedInputs.length,
      taskRecords: records.length,
      laneCards: records.filter((record) => record.kind === 'lane-card').length,
      ownerTasks: records.filter((record) => record.kind === 'owner-task').length,
      workflows: workflows.length,
      sidecars: sidecars.length,
      quarantinedInputs: quarantinedInputs.length,
    },
    records,
    workflows,
    sidecars,
    duplicates: duplicateGroups(records),
    workflowDuplicates: duplicateWorkflowGroups(workflows),
    ownerless: records.filter((record) => record.ownerEvidence.kind === 'none').map((record) => record.recordKey),
    projections,
    quarantinedInputs,
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
