/**
 * Read-only projection of the canonical ContextDevKit v4 workflow/task authority.
 *
 * Consumers use this module instead of discovering Markdown cards or physical
 * status folders. It delegates validation to the workflow pack and tasks stores;
 * missing or corrupt authorities remain explicit diagnostics and never trigger a
 * compatibility read.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathsFor } from './config/paths.mjs';
import { readTasksDocument } from '../tools/scripts/tasks-store.mjs';
import { loadWorkflowPack } from '../tools/scripts/workflow-pack.mjs';

export const TASK_STATUSES = Object.freeze([
  'backlog',
  'working',
  'blocked',
  'testing',
  'done',
  'cancelled',
]);

const WORKFLOW_MARKER = 'workflow.json';
const BATCH_MARKER = 'batch.json';

/** Strip a leading UTF-8 BOM before JSON parsing. */
const stripBom = (text) => text.replace(/^\uFEFF/, '');

/**
 * Lists real direct-child directories without following symlinks or reparse
 * points. Canonical v4 scope roots are shallow, keeping statusline reads bounded.
 *
 * @param {string} root absolute collection root
 * @returns {string[]}
 */
function childDirectories(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(root, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolves canonical workflow and batch roots using the v4 memory layout only.
 * Operation/business-owned batches intentionally have no `batch.json`; their
 * validated tasks document carries the scope ref.
 *
 * @param {string} memoryRoot canonical memory root
 * @returns {{ workflowDirectories: string[], batchDirectories: string[] }}
 */
function discoverAuthorityDirectories(memoryRoot) {
  const neutralWorkflowRoot = resolve(memoryRoot, 'workflows');
  const workflowRoots = [neutralWorkflowRoot, resolve(neutralWorkflowRoot, 'done')];
  const ownedBatchDirectories = [];
  for (const collection of ['operations', 'business']) {
    for (const scopeDirectory of childDirectories(resolve(memoryRoot, collection))) {
      workflowRoots.push(resolve(scopeDirectory, 'workflows'));
      workflowRoots.push(resolve(scopeDirectory, 'done'));
      const batchDirectory = resolve(scopeDirectory, 'batch');
      if (existsSync(resolve(batchDirectory, 'tasks.json'))) ownedBatchDirectories.push(batchDirectory);
    }
  }
  const workflowDirectories = workflowRoots
    .flatMap((root) => childDirectories(root))
    .filter((directory) => existsSync(resolve(directory, WORKFLOW_MARKER)));
  const neutralBatchDirectories = childDirectories(resolve(memoryRoot, 'batches'))
    .filter((directory) => existsSync(resolve(directory, BATCH_MARKER)));
  return {
    workflowDirectories: [...new Set(workflowDirectories)].sort(),
    batchDirectories: [...new Set([...neutralBatchDirectories, ...ownedBatchDirectories])].sort(),
  };
}

/**
 * Converts an authority exception into a stable, non-sensitive diagnostic.
 *
 * @param {unknown} error
 * @param {string} authorityPath
 * @param {string} root
 * @returns {{ path: string, kind: string, message: string }}
 */
function authorityDiagnostic(error, authorityPath, root) {
  return {
    path: relative(root, authorityPath).replaceAll('\\', '/'),
    kind: typeof error?.name === 'string' ? error.name : 'AuthorityReadError',
    message: typeof error?.message === 'string' ? error.message : 'Canonical authority could not be read.',
  };
}

/**
 * Reads a JSON definition used only to label a batch projection. Task state is
 * always read through `readTasksDocument`.
 *
 * @param {string} path
 * @returns {object}
 * @throws {SyntaxError} when the definition is malformed
 */
function readBatchDefinition(path) {
  return JSON.parse(stripBom(readFileSync(path, 'utf-8')));
}

/** Return a zeroed projection for every canonical task status. */
function emptyCounts() {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
}

/** Return an empty task collection for every canonical status. */
function emptyTaskGroups() {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, []]));
}

/**
 * Builds one read-only snapshot from canonical workflow packs and batch task
 * documents. Dependencies are injectable for deterministic consumer tests; the
 * production defaults are the W05/W06 authorities.
 *
 * @param {string} root project root
 * @param {{
 *   loadPack?: typeof loadWorkflowPack,
 *   readTasks?: typeof readTasksDocument,
 * }} [dependencies]
 * @returns {{
 *   schemaVersion: 1,
 *   authority: 'v4-json',
 *   status: 'available'|'partial'|'corrupt'|'unavailable',
 *   workflows: object[],
 *   batches: object[],
 *   tasks: object[],
 *   tasksByStatus: Record<string, object[]>,
 *   counts: Record<string, number>,
 *   diagnostics: object[]
 * }}
 */
export function readAuthoritySnapshot(root, dependencies = {}) {
  const loadPack = dependencies.loadPack ?? loadWorkflowPack;
  const readTasks = dependencies.readTasks ?? readTasksDocument;
  const memoryRoot = pathsFor(root).memory;
  if (!existsSync(memoryRoot)) {
    return {
      schemaVersion: 1,
      authority: 'v4-json',
      status: 'unavailable',
      workflows: [],
      batches: [],
      tasks: [],
      tasksByStatus: emptyTaskGroups(),
      counts: emptyCounts(),
      diagnostics: [{ path: relative(root, memoryRoot).replaceAll('\\', '/'), kind: 'AuthorityNotFound', message: 'Canonical memory root is unavailable.' }],
    };
  }

  const { workflowDirectories, batchDirectories } = discoverAuthorityDirectories(memoryRoot);
  const diagnostics = [];

  const workflows = [];
  const batches = [];
  const tasks = [];

  for (const workflowDir of workflowDirectories) {
    try {
      const pack = loadPack(root, workflowDir);
      if (pack?.definition?.active === false) continue;
      const tasksPath = resolve(workflowDir, 'pipeline', 'tasks.json');
      const tasksDocument = readTasks(tasksPath);
      const workflowId = pack.definition?.id ?? tasksDocument.scopeRef ?? null;
      const projectedTasks = tasksDocument.tasks.map((task) => ({
        ...task,
        scopeRef: tasksDocument.scopeRef,
        authorityPath: relative(root, tasksPath).replaceAll('\\', '/'),
      }));
      workflows.push({
        id: workflowId,
        title: pack.definition?.title ?? '',
        slug: pack.definition?.slug ?? '',
        status: pack.state?.status ?? null,
        phase: pack.state?.phase ?? null,
        revision: pack.state?.revision ?? null,
        taskCount: projectedTasks.length,
        path: relative(root, workflowDir).replaceAll('\\', '/'),
      });
      tasks.push(...projectedTasks);
    } catch (error) {
      diagnostics.push(authorityDiagnostic(error, workflowDir, root));
    }
  }

  for (const batchDir of batchDirectories) {
    try {
      const definitionPath = resolve(batchDir, BATCH_MARKER);
      const definition = existsSync(definitionPath) ? readBatchDefinition(definitionPath) : {};
      if (definition.active === false) continue;
      const tasksPath = resolve(batchDir, 'tasks.json');
      const tasksDocument = readTasks(tasksPath);
      const projectedTasks = tasksDocument.tasks.map((task) => ({
        ...task,
        scopeRef: tasksDocument.scopeRef,
        authorityPath: relative(root, tasksPath).replaceAll('\\', '/'),
      }));
      batches.push({
        id: definition.id ?? tasksDocument.scopeRef ?? null,
        title: definition.title ?? '',
        revision: tasksDocument.revision ?? null,
        taskCount: projectedTasks.length,
        path: relative(root, batchDir).replaceAll('\\', '/'),
      });
      tasks.push(...projectedTasks);
    } catch (error) {
      diagnostics.push(authorityDiagnostic(error, batchDir, root));
    }
  }

  const tasksByStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, []]));
  for (const task of tasks) {
    if (Object.hasOwn(tasksByStatus, task.status)) tasksByStatus[task.status].push(task);
  }
  const counts = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, tasksByStatus[status].length]),
  );
  const discoveredCount = workflowDirectories.length + batchDirectories.length;
  const readableCount = workflows.length + batches.length;
  const status = discoveredCount === 0
    ? 'unavailable'
    : diagnostics.length === 0
      ? 'available'
    : readableCount > 0
      ? 'partial'
      : 'corrupt';

  return {
    schemaVersion: 1,
    authority: 'v4-json',
    status,
    workflows,
    batches,
    tasks,
    tasksByStatus,
    counts,
    diagnostics,
  };
}

/**
 * Loads a complete governed workflow context for boot, handoff, and MCP readers.
 * No legacy artifact is consulted on failure.
 *
 * @param {string} root project root
 * @param {string} workflowRef WF id, slug, or canonical path
 * @param {{ loadPack?: typeof loadWorkflowPack }} [dependencies]
 * @returns {{ status: 'available'|'corrupt', workflowRef: string, pack?: object, diagnostic?: object }}
 */
export function readGovernedWorkflowContext(root, workflowRef, dependencies = {}) {
  const loadPack = dependencies.loadPack ?? loadWorkflowPack;
  try {
    return { status: 'available', workflowRef, pack: loadPack(root, workflowRef) };
  } catch (error) {
    return {
      status: 'corrupt',
      workflowRef,
      diagnostic: authorityDiagnostic(error, resolve(root, String(workflowRef)), root),
    };
  }
}

/**
 * Renders the complete validated pack as one host-neutral context block.
 * Reports are relevance-bounded and ordered by the canonical workflow loader.
 *
 * @param {{ status: string, workflowRef: string, pack?: object, diagnostic?: object }} context
 * @returns {string}
 */
export function renderGovernedWorkflowContext(context) {
  if (!context || context.status !== 'available' || !context.pack) {
    const diagnostic = context?.diagnostic;
    return `Workflow context ${context?.workflowRef ?? '(unknown)'} is ${context?.status ?? 'unavailable'}${diagnostic?.message ? `: ${diagnostic.message}` : '.'}`;
  }
  const pack = context.pack;
  const documents = pack.documents ?? {};
  const sections = [
    `## Governed workflow context - ${context.workflowRef}`,
    '',
    '### workflow.json',
    '```json',
    JSON.stringify(pack.definition, null, 2),
    '```',
    '',
    '### workflow-state.json',
    '```json',
    JSON.stringify(pack.state, null, 2),
    '```',
    '',
    '### pipeline/tasks.json',
    '```json',
    JSON.stringify(pack.tasks, null, 2),
    '```',
  ];
  for (const [name, content] of [
    ['prd.md', documents.prd],
    ['spec.md', documents.spec],
    ['decisions.md', documents.decisions],
    ['CONTINUATION-PROMPT.md', documents.continuation],
  ]) {
    if (typeof content !== 'string' || content.length === 0) continue;
    sections.push('', `### ${name}`, content);
  }
  for (const report of Array.isArray(pack.reports) ? pack.reports : []) {
    sections.push('', `### ${report.ref}`, report.content);
  }
  return sections.join('\n');
}
