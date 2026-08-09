/** Pure, idempotent Markdown projection for the canonical v4 task store. */
import { assertTasksDocument } from './tasks-validate.mjs';

/** @param {unknown} value @returns {string} */
function escapeTableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** @param {string[]} values @returns {string} */
function renderList(values) {
  return values.length === 0 ? '-' : values.map(escapeTableCell).join('<br>');
}

/**
 * Renders `pipeline/tasks.md` solely from the validated JSON authority.
 *
 * @param {object} document
 * @returns {string}
 * @throws {TypeError} when the source document is invalid
 */
export function renderTasksMarkdown(document) {
  assertTasksDocument(document);
  const lines = [
    '# Tasks',
    '',
    '> Generated projection. Do not edit; `pipeline/tasks.json` is authoritative.',
    '',
    `Scope: ${document.scopeRef}`,
    '',
    `Revision: ${document.revision}`,
    '',
    '| Done | ID | Title | Status | Priority | Dependencies | Acceptance | Evidence | Last report |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const task of document.tasks) {
    const completionMark = task.status === 'done' && task.evidenceRefs.length > 0 ? '[x]' : '[ ]';
    const latestReport = task.reportRefs.at(-1) ?? '-';
    lines.push(
      `| ${completionMark} | ${escapeTableCell(task.id)} | ${escapeTableCell(task.title)} | ${task.status} | ${task.priority} | `
      + `${renderList(task.dependsOn)} | ${renderList(task.acceptance)} | ${renderList(task.evidenceRefs)} | ${escapeTableCell(latestReport)} |`,
    );
  }
  if (document.tasks.length === 0) lines.push('| - | - | _No tasks_ | - | - | - | - | - | - |');
  return `${lines.join('\n')}\n`;
}
