/**
 * Pure, idempotent Markdown projections for Workflow v2 (ADR-0158 / ADR-0159).
 *
 * `workflow.json`, `workflow-state.json`, `pipeline/tasks.json`, and
 * `context-manifest.json` are the only inputs. Generated files are whole-file
 * projections and are never parsed as state authorities.
 */
import { join } from 'node:path';
import { readJsonSafe, writeIfChanged } from './io.mjs';
import { renderTasksMarkdown as renderCanonicalTasksMarkdown } from '../tasks-render.mjs';
import { readTasksDocument } from '../tasks-store.mjs';

/** Escape a value for a Markdown table cell. */
function escapeCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Render a list in one Markdown table cell. */
function listCell(values) {
  return Array.isArray(values) && values.length > 0
    ? values.map(escapeCell).join('<br>')
    : '—';
}

/** Render stable bullets without inventing missing values. */
function bulletList(values, emptyLabel = 'None declared.') {
  if (!Array.isArray(values) || values.length === 0) return [`- ${emptyLabel}`];
  return values.map((value) => `- ${String(value)}`);
}

/** Return tasks sorted by stable identity without mutating the authority. */
function sortedTasks(tasksDocument) {
  return [...(tasksDocument.tasks ?? [])]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

/** Render a deterministic task table for the continuation handoff. */
function taskTable(tasksDocument) {
  const tasks = sortedTasks(tasksDocument);
  const lines = [
    '| ID | Status | Priority | Depends on | Title |',
    '| --- | --- | --- | --- | --- |',
  ];
  if (tasks.length === 0) {
    lines.push('| — | — | — | — | No tasks declared |');
    return lines;
  }
  for (const task of tasks) {
    lines.push(`| ${escapeCell(task.id)} | ${escapeCell(task.status)} | ${escapeCell(task.priority)} | ${listCell(task.dependsOn)} | ${escapeCell(task.title)} |`);
  }
  return lines;
}

/** Derive backlog candidates whose declared dependencies are all done. */
function dependencyReadyTaskIds(tasksDocument) {
  const tasks = sortedTasks(tasksDocument);
  const statuses = new Map(tasks.map((task) => [task.id, task.status]));
  return tasks
    .filter((task) => task.status === 'backlog')
    .filter((task) => (task.dependsOn ?? []).every((dependency) => statuses.get(dependency) === 'done'))
    .map((task) => task.id);
}

/** Render one owner value without consulting directory placement. */
function ownerLabel(definition) {
  return definition.owner.kind === 'none'
    ? 'none'
    : `${definition.owner.kind}:${definition.owner.id}`;
}

/**
 * Render `pipeline/tasks.md` through the canonical task renderer.
 * @param {object} definition canonical workflow definition
 * @param {object} tasksDocument canonical tasks document
 * @returns {string} newline-terminated Markdown
 */
export function renderTasksMarkdown(definition, tasksDocument) {
  void definition;
  return renderCanonicalTasksMarkdown(tasksDocument);
}

/**
 * Render `index.md` from canonical Workflow v2 inputs.
 * @param {object} definition canonical workflow definition
 * @param {object} state canonical workflow aggregate state
 * @param {object} tasksDocument canonical tasks document
 * @returns {string} newline-terminated Markdown
 */
export function renderIndexMarkdown(definition, state, tasksDocument) {
  const statusCounts = new Map();
  for (const task of tasksDocument.tasks ?? []) {
    statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
  }
  const taskSummary = [...statusCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}: ${count}`)
    .join(' · ') || 'none';
  return [
    `# Workflow — ${escapeCell(definition.title)}`,
    '',
    '> Generated projection. Authorities: `workflow.json`, `workflow-state.json`, and `pipeline/tasks.json`.',
    '',
    `- **ID:** ${escapeCell(definition.id)}`,
    `- **Owner:** ${escapeCell(ownerLabel(definition))}`,
    `- **Status:** ${escapeCell(state.status)}`,
    `- **Phase:** ${escapeCell(state.phase)}`,
    `- **Revision:** ${state.revision}`,
    `- **Tasks:** ${taskSummary}`,
    `- **Blockers:** ${state.blockers.length > 0 ? listCell(state.blockers) : 'none'}`,
    `- **Last report:** ${escapeCell(state.lastReportRef) || 'none'}`,
    '',
  ].join('\n');
}

/**
 * Render the mandatory host-neutral continuation contract.
 *
 * Checkout identity is observed at resume time through printed commands. The
 * renderer itself never reads Git, the clock, a host, the network, or authored
 * Markdown, so equivalent canonical inputs always produce equivalent bytes.
 *
 * @param {object} definition canonical workflow definition
 * @param {object} state canonical workflow aggregate state
 * @param {object} tasksDocument canonical tasks document
 * @param {object} manifest canonical context-loading manifest
 * @returns {string} newline-terminated Markdown
 */
export function renderContinuationMarkdown(definition, state, tasksDocument, manifest) {
  const activeTasks = state.activeTaskIds?.length > 0 ? state.activeTaskIds.join(', ') : 'none';
  const blockers = state.blockers?.length > 0 ? state.blockers.join('; ') : 'none';
  const qaEvidence = state.qa?.evidenceRefs?.length > 0 ? state.qa.evidenceRefs.join(', ') : 'none';
  const readyTasks = dependencyReadyTaskIds(tasksDocument);
  const requiredContext = [...(manifest.required ?? [])].map((ref) => `- \`${ref}\``);

  return [
    `# Continue ${definition.id} — ${definition.title}`,
    '',
    '> Generated projection. Do not edit this file. Authorities: `workflow.json`,',
    '> `workflow-state.json`, `pipeline/tasks.json`, and `context-manifest.json`.',
    `> Regenerate with: \`node cdx.mjs workflow render ${definition.id}\`.`,
    '',
    '## Objective',
    '',
    definition.objective,
    '',
    '## Canonical preflight',
    '',
    'Run from the project root, in this order, and stop on the first non-zero exit:',
    '',
    `    node cdx.mjs workflow validate ${definition.id}`,
    `    node cdx.mjs workflow load ${definition.id}`,
    '',
    'For Git-backed projects, observe the live checkout instead of trusting a stale handoff:',
    '',
    '    git rev-parse --show-toplevel',
    '    git branch --show-current',
    '    git rev-parse HEAD',
    '    git status --short',
    '',
    '## Identity and lifecycle',
    '',
    `- **Workflow:** ${definition.id} (${definition.slug})`,
    `- **Owner:** ${ownerLabel(definition)}`,
    `- **Status / phase:** ${state.status} / ${state.phase}`,
    `- **Workflow revision:** ${state.revision}`,
    `- **Task-store revision:** ${tasksDocument.revision}`,
    `- **Active tasks:** ${activeTasks}`,
    `- **Blockers:** ${blockers}`,
    `- **QA:** ${state.qa?.status ?? 'pending'}; evidence: ${qaEvidence}`,
    `- **Last report:** ${state.lastReportRef ?? 'none'}`,
    '',
    '## Scope',
    '',
    '### Included',
    '',
    ...bulletList(definition.scope?.included),
    '',
    '### Excluded',
    '',
    ...bulletList(definition.scope?.excluded),
    '',
    '## Acceptance',
    '',
    ...bulletList(definition.acceptance),
    '',
    '## Workflow dependencies',
    '',
    ...bulletList(definition.dependencies),
    '',
    '## Canonical task ledger',
    '',
    '> Task status and evidence are authoritative only in `pipeline/tasks.json`.',
    '',
    ...taskTable(tasksDocument),
    '',
    `- **Dependency-ready backlog candidates:** ${readyTasks.length > 0 ? readyTasks.join(', ') : 'none'}`,
    '',
    '## Required context',
    '',
    ...requiredContext,
    '',
    '## Resume rules',
    '',
    '1. Validate and load the complete pack before any mutation.',
    '2. Read every required context reference; do not replace missing evidence with assumptions.',
    '3. Continue an explicit active task first. Otherwise choose only a dependency-ready backlog task.',
    '4. Mutate task and workflow state only through canonical ContextDevKit commands with their CAS guards.',
    '5. Run the relevant automated tests and attach factual evidence before moving a task to done.',
    '6. Complete the workflow only when every task is terminal and explicit QA/report evidence exists.',
    '',
    '## Stop conditions',
    '',
    '- Stop if workflow validation fails, a required context file is absent, or JSON is corrupt.',
    '- Stop on a declared blocker or unmet workflow/task dependency.',
    '- Stop and ask one concise question when the requested scope conflicts with this workflow.',
    '',
    '## Prohibitions',
    '',
    '- Do not treat this Markdown projection as state authority.',
    '- Do not hand-edit `index.md`, `pipeline/tasks.md`, or `CONTINUATION-PROMPT.md`.',
    '- Do not fabricate test, QA, report, branch, worktree, or completion evidence.',
    '- Do not create a duplicate workflow or ADR when an existing canonical record governs the work.',
    '',
  ].join('\n');
}

/**
 * Read the canonical package inputs required by projection writers.
 * @param {string} packDirectory absolute workflow directory
 * @returns {{definition:object,state:object,tasks:object,manifest:object}}
 * @throws {Error} when a canonical JSON input is missing or invalid
 */
function readProjectionInputs(packDirectory) {
  const definition = readJsonSafe(join(packDirectory, 'workflow.json'), null);
  const state = readJsonSafe(join(packDirectory, 'workflow-state.json'), null);
  const manifest = readJsonSafe(join(packDirectory, 'context-manifest.json'), null);
  if (!definition) throw new Error(`Workflow definition is missing or invalid at ${join(packDirectory, 'workflow.json')}`);
  if (!state) throw new Error(`Workflow state is missing or invalid at ${join(packDirectory, 'workflow-state.json')}`);
  if (!manifest) throw new Error(`Workflow context manifest is missing or invalid at ${join(packDirectory, 'context-manifest.json')}`);
  const tasks = readTasksDocument(join(packDirectory, 'pipeline', 'tasks.json'));
  return { definition, state, tasks, manifest };
}

/** Refresh `pipeline/tasks.md`; identical input performs no write. */
export function refreshTasks(packDirectory) {
  const { definition, tasks } = readProjectionInputs(packDirectory);
  return writeIfChanged(join(packDirectory, 'pipeline', 'tasks.md'), renderTasksMarkdown(definition, tasks));
}

/** Refresh `index.md`; identical input performs no write. */
export function refreshIndex(packDirectory) {
  const { definition, state, tasks } = readProjectionInputs(packDirectory);
  return writeIfChanged(join(packDirectory, 'index.md'), renderIndexMarkdown(definition, state, tasks));
}

/** Refresh `CONTINUATION-PROMPT.md`; identical input performs no write. */
export function refreshContinuation(packDirectory) {
  const { definition, state, tasks, manifest } = readProjectionInputs(packDirectory);
  return writeIfChanged(
    join(packDirectory, 'CONTINUATION-PROMPT.md'),
    renderContinuationMarkdown(definition, state, tasks, manifest),
  );
}

/**
 * Refresh every Markdown projection.
 * @param {string} packDirectory absolute workflow directory
 * @returns {{tasksChanged:boolean,indexChanged:boolean,continuationChanged:boolean}}
 */
export function renderWorkflowPack(packDirectory) {
  const tasksChanged = refreshTasks(packDirectory).changed;
  const indexChanged = refreshIndex(packDirectory).changed;
  const continuationChanged = refreshContinuation(packDirectory).changed;
  return { tasksChanged, indexChanged, continuationChanged };
}
