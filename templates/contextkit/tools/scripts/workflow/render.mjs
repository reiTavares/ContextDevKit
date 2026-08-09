/**
 * Pure, idempotent Markdown projections for Workflow v2 (ADR-0158 / W05).
 *
 * `workflow.json`, `workflow-state.json`, and `pipeline/tasks.json` are the only
 * inputs. The generated files are replaced as whole projections and are never
 * parsed as state authorities.
 */
import { join } from 'node:path';
import { readJsonSafe, writeIfChanged } from './io.mjs';
import { renderTasksMarkdown as renderCanonicalTasksMarkdown } from '../tasks-render.mjs';
import { readTasksDocument } from '../tasks-store.mjs';

/** Escape a value for a Markdown table cell. */
function escapeCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Render a string list without introducing editable checkbox state. */
function listCell(values) {
  return Array.isArray(values) && values.length > 0
    ? values.map(escapeCell).join('<br>')
    : '—';
}

/**
 * Render `pipeline/tasks.md` through W06's single canonical task renderer.
 * @param {object} definition canonical workflow definition (identity only)
 * @param {object} tasksDocument canonical tasks document
 * @returns {string} newline-terminated Markdown
 */
export function renderTasksMarkdown(definition, tasksDocument) {
  void definition;
  return renderCanonicalTasksMarkdown(tasksDocument);
}

/**
 * Render the optional `index.md` projection from the three authorities.
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
  const owner = definition.owner.kind === 'none'
    ? 'none'
    : `${definition.owner.kind}:${definition.owner.id}`;
  return [
    `# Workflow — ${escapeCell(definition.title)}`,
    '',
    '> Generated projection. Authorities: `workflow.json`, `workflow-state.json`, and `pipeline/tasks.json`.',
    '',
    `- **ID:** ${escapeCell(definition.id)}`,
    `- **Owner:** ${escapeCell(owner)}`,
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
 * Read the canonical package inputs required by the projection writer.
 * @param {string} packDirectory absolute workflow directory
 * @returns {{definition:object,state:object,tasks:object}}
 * @throws {Error} when a canonical JSON input is missing or invalid
 */
function readProjectionInputs(packDirectory) {
  const definition = readJsonSafe(join(packDirectory, 'workflow.json'), null);
  const state = readJsonSafe(join(packDirectory, 'workflow-state.json'), null);
  if (!definition) throw new Error(`Workflow definition is missing or invalid at ${join(packDirectory, 'workflow.json')}`);
  if (!state) throw new Error(`Workflow state is missing or invalid at ${join(packDirectory, 'workflow-state.json')}`);
  const tasks = readTasksDocument(join(packDirectory, 'pipeline', 'tasks.json'));
  return { definition, state, tasks };
}

/**
 * Refresh `pipeline/tasks.md`; identical input performs no write.
 * @param {string} packDirectory absolute workflow directory
 * @returns {{changed:boolean}}
 */
export function refreshTasks(packDirectory) {
  const { definition, tasks } = readProjectionInputs(packDirectory);
  return writeIfChanged(
    join(packDirectory, 'pipeline', 'tasks.md'),
    renderTasksMarkdown(definition, tasks),
  );
}

/**
 * Refresh `index.md`; identical input performs no write.
 * @param {string} packDirectory absolute workflow directory
 * @returns {{changed:boolean}}
 */
export function refreshIndex(packDirectory) {
  const { definition, state, tasks } = readProjectionInputs(packDirectory);
  return writeIfChanged(
    join(packDirectory, 'index.md'),
    renderIndexMarkdown(definition, state, tasks),
  );
}

/**
 * Refresh every Markdown projection and report whether each file changed.
 * @param {string} packDirectory absolute workflow directory
 * @returns {{tasksChanged:boolean,indexChanged:boolean}}
 */
export function renderWorkflowPack(packDirectory) {
  const tasksChanged = refreshTasks(packDirectory).changed;
  const indexChanged = refreshIndex(packDirectory).changed;
  return { tasksChanged, indexChanged };
}
