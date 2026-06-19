/**
 * Deterministic task-projection renderer for Operation packages (BIZ-0001 /
 * WF-0036, A1-T2). Projects DevPipeline cards into the `operation-tasks` managed
 * block of an Operation's `tasks.md`, preserving every human note OUTSIDE the
 * markers byte-for-byte (ADR-0067).
 *
 * Mirrors `workflow/render.mjs`: projection-only (no status invented — read off
 * the card frontmatter), fully deterministic (cards in id order, no timestamps
 * generated here), idempotent (re-rendering identical inputs is byte-identical),
 * and atomic via `writeIfChanged` (no mtime churn). Zero runtime dependencies —
 * `node:*` + sibling modules only (immutable rule 1).
 */
import { existsSync, readFileSync } from 'node:fs';
import { managedMarkers } from './workflow/io.mjs';
import { updateManagedBlock, writeIfChanged } from './work-io.mjs';
import { OPERATION_TASKS_BLOCK } from './work-templates.mjs';

/** Escape a cell value so a literal pipe never breaks the Markdown table. */
function escapeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * Renders the inner content of the `operation-tasks` block from a list of cards.
 * Sorted by `id` for a stable, byte-deterministic projection. An empty list
 * yields a neutral placeholder (never an empty block).
 *
 * @param {Array<{id?:string,title?:string,type?:string,priority?:string,stage?:string}>} cards
 *   normalized DevPipeline cards (see `pipeline-tasks.mjs#listTasks`).
 * @returns {string} markdown — the inner block content (no markers).
 */
export function renderOperationTasks(cards) {
  const list = Array.isArray(cards) ? cards : [];
  if (list.length === 0) return '_No cards linked to this Operation yet._';
  const sorted = [...list].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const lines = ['| Card | Title | Type | P | Stage |', '| --- | --- | --- | --- | --- |'];
  for (const card of sorted) {
    lines.push(
      `| ${escapeCell(card.id)} | ${escapeCell(card.title) || '—'} | ${escapeCell(card.type) || 'task'}` +
        ` | ${escapeCell(card.priority) || 'P2'} | ${escapeCell(card.stage) || 'backlog'} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Idempotently render `cards` into the `operation-tasks` managed block of
 * `tasksPath`, preserving content outside the markers. A missing file is treated
 * as empty (the block is appended). Writes atomically, only on a real change.
 *
 * @param {string} tasksPath - absolute path to the Operation's `tasks.md`.
 * @param {Array<object>} cards - normalized DevPipeline cards to project.
 * @returns {{ changed: boolean }} whether a write occurred (re-render → false).
 * @throws {TypeError} when `tasksPath` is missing.
 */
export function renderTasksFile(tasksPath, cards) {
  if (!tasksPath) throw new TypeError('renderTasksFile: tasksPath is required');
  const source = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf-8') : '';
  const next = updateManagedBlock(source, OPERATION_TASKS_BLOCK, renderOperationTasks(cards));
  return writeIfChanged(tasksPath, next);
}

/** Re-export the block markers so the templates + renderer agree on one id. */
export function operationTasksMarkers() {
  return managedMarkers(OPERATION_TASKS_BLOCK);
}
