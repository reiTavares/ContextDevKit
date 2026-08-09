/** Pure CLI views derived from canonical ContextDevKit 4 task records. */

const DISPLAY_ORDER = Object.freeze([
  'working',
  'blocked',
  'testing',
  'backlog',
  'done',
  'cancelled',
]);

const STATUS_LABELS = Object.freeze({
  backlog: 'Backlog',
  working: 'Working',
  blocked: 'Blocked',
  testing: 'Testing',
  done: 'Done',
  cancelled: 'Cancelled',
});

/** @param {unknown} value @returns {string} */
function escapeTableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** @param {string[]} values @returns {string} */
function renderReferences(values) {
  return values.length === 0 ? '-' : values.map(escapeTableCell).join('<br>');
}

/**
 * Counts unresolved dependencies from the same derived task collection.
 *
 * @param {{dependsOn?:string[]}} task
 * @param {Array<{id:string,status:string}>} tasks
 * @returns {number}
 */
function unresolvedDependencyCount(task, tasks) {
  const statusById = new Map(tasks.map((candidate) => [candidate.id, candidate.status]));
  return (task.dependsOn ?? []).filter((dependencyId) => {
    const dependencyStatus = statusById.get(dependencyId);
    return dependencyStatus && !['done', 'cancelled'].includes(dependencyStatus);
  }).length;
}

/**
 * Renders one status section without introducing another writable authority.
 *
 * @param {Array<object>} selectedTasks
 * @param {Array<object>} allTasks
 * @returns {string}
 */
function renderTable(selectedTasks, allTasks) {
  if (selectedTasks.length === 0) return '_(empty)_\n';
  const lines = [
    '| ID | Priority | Title | Dependencies | Evidence |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const task of selectedTasks) {
    const unresolvedCount = unresolvedDependencyCount(task, allTasks);
    const title = unresolvedCount > 0
      ? `${task.title} (blocked by ${unresolvedCount})`
      : task.title;
    lines.push(
      `| ${escapeTableCell(task.id)} | ${task.priority} | ${escapeTableCell(title)} | `
      + `${renderReferences(task.dependsOn)} | ${renderReferences(task.evidenceRefs)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Renders a complete read-only board from one or more canonical documents.
 *
 * @param {Array<object>} tasks
 * @returns {string}
 */
export function renderBoard(tasks) {
  const lines = [
    '# DevPipeline - derived task view',
    '',
    '> Read-only projection. Task definition and status live only in `pipeline/tasks.json`.',
    '',
    DISPLAY_ORDER.map((status) => `${STATUS_LABELS[status]} **${tasks.filter((task) => task.status === status).length}**`).join(' | '),
    '',
  ];
  for (const status of DISPLAY_ORDER) {
    lines.push(`## ${STATUS_LABELS[status]}`, '');
    lines.push(renderTable(tasks.filter((task) => task.status === status), tasks));
  }
  return lines.join('\n');
}

/** @param {object} task @returns {string} */
function renderDigestLine(task) {
  const rawTitle = String(task.title || '(untitled)');
  const title = rawTitle.length > 60 ? `${rawTitle.slice(0, 57)}...` : rawTitle;
  return `${task.id} ${task.priority} - ${title}`;
}

/**
 * Renders a bounded status summary for token-light CLI output.
 *
 * @param {Array<object>} tasks
 * @param {number} [backlogCap]
 * @returns {string}
 */
export function renderDigest(tasks, backlogCap = 8) {
  const byStatus = (status) => tasks.filter((task) => task.status === status);
  const backlog = byStatus('backlog');
  const lines = [
    DISPLAY_ORDER.map((status) => `${STATUS_LABELS[status]} ${byStatus(status).length}`).join(' | '),
  ];
  for (const status of ['working', 'blocked', 'testing']) {
    const selected = byStatus(status);
    lines.push(`${STATUS_LABELS[status]}: ${selected.length ? selected.map(renderDigestLine).join(' | ') : '(none)'}`);
  }
  lines.push(`Backlog (top ${Math.min(backlogCap, backlog.length)}):`);
  for (const task of backlog.slice(0, backlogCap)) lines.push(`  - ${renderDigestLine(task)}`);
  if (backlog.length > backlogCap) lines.push(`  ... +${backlog.length - backlogCap} more`);
  return lines.join('\n');
}
