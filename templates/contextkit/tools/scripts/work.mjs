#!/usr/bin/env node
/**
 * `work` — the single public CLI entry point for the Business / Operation /
 * Workflow domain layer (BIZ-0001 / WF-0036). Atomic, idempotent, receipt-
 * producing; mutators are DRY-RUN BY DEFAULT (constitution §8 — `--apply` writes).
 *
 * THIN DISPATCHER ONLY (constitution §2): this file parses argv and routes to a
 * command handler in a `work-*` helper module. Logic lives in those modules.
 * Commands are introduced wave-by-wave; the seam below lists the full surface
 * (spec §"Interfaces / contracts") but only wires the commands that EXIST today
 * (A1-T2: `operation`, `render`). Unimplemented commands are NOT stubbed
 * (constitution §9) — they report a clear "not yet wired in this wave" message.
 *
 * Zero runtime dependencies — `node:*` + sibling modules only (immutable rule 1).
 *
 * @example node work.mjs operation "Rotate the staging API key" --mode direct --apply
 * @example node work.mjs render --operation OP-0001
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { parseArgs, resolvePosture, formatReceipt, makeReceipt } from './work-io.mjs';
import { runOperationCreate } from './work-operation.mjs';
import { renderTasksFile } from './work-render.mjs';
import { parseFrontmatter, listTasks } from './pipeline-tasks.mjs';

/** Full command surface (spec §"Interfaces / contracts"); some land later. */
const FUTURE_COMMANDS = Object.freeze([
  'intake',
  'approve',
  'revise',
  'reject',
  'status',
  'link',
  'unlink',
  'promote',
  'reconcile',
  'start',
  'close',
  'validate',
]);

/**
 * Selects the DevPipeline cards that belong to one Operation. A card is matched
 * when its frontmatter `operation` field equals `opId` (case-insensitive). Pure
 * read; a missing pipeline directory yields an empty projection (never throws).
 *
 * @param {string} root - project root.
 * @param {string} opId - the `OP-####` id whose cards to collect.
 * @returns {Array<object>} normalized cards for the projection.
 */
function cardsForOperation(root, opId) {
  const pipeDir = pathsFor(root).pipeline;
  if (!existsSync(pipeDir)) return [];
  const wanted = String(opId).toLowerCase();
  const cards = listTasks(pipeDir).filter((card) => {
    const file = join(pipeDir, card.stage, card.file);
    const frontmatter = parseFrontmatter(readFileSync(file, 'utf-8'));
    return String(frontmatter.operation || '').toLowerCase() === wanted;
  });
  return cards;
}

/**
 * Handles `render` — projects an Operation's DevPipeline cards into its
 * `tasks.md` managed block. Idempotent + atomic; preserves human notes.
 *
 * @param {object} ctx - `{ flags, root }`.
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} when `--operation` (the OP-#### id) is missing.
 */
function handleRender({ flags, root }) {
  const opId = flags.operation || flags.id;
  if (typeof opId !== 'string' || !opId) throw new Error('render: --operation OP-#### is required');
  const tasksPath = resolveTasksPath(root, String(opId));
  const renderOutcome = renderTasksFile(tasksPath, cardsForOperation(root, opId));
  return makeReceipt({
    command: 'render',
    applied: renderOutcome.changed,
    writes: renderOutcome.changed ? [tasksPath] : [],
    detail: { operation: opId, idempotentNoop: !renderOutcome.changed, path: tasksPath },
  });
}

/**
 * Resolves an Operation's `tasks.md` path from an id or full folder name, so
 * `render` works with either `OP-0001` or `OP-0001-rotate-key`. When only the
 * bare id is given, the first matching `OP-####-*` folder is used.
 *
 * @param {string} root - project root.
 * @param {string} idOrDir - `OP-####` id or full folder name.
 * @returns {string} absolute path to the Operation's `tasks.md`.
 */
function resolveTasksPath(root, idOrDir) {
  const operationsRoot = pathsFor(root).operations;
  const direct = join(operationsRoot, idOrDir, 'tasks.md');
  if (existsSync(direct) || !existsSync(operationsRoot)) return direct;
  const prefix = `${idOrDir}-`;
  const match = readdirSync(operationsRoot).find((name) => name === idOrDir || name.startsWith(prefix));
  return match ? join(operationsRoot, match, 'tasks.md') : direct;
}

/**
 * Dispatches one parsed invocation to its handler.
 * @param {object} parsed - `{ command, positionals, flags }`.
 * @param {{ root?: string }} [env] - injectable environment (tests pass a root).
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} on an unknown / not-yet-wired command.
 */
export function dispatch(parsed, env = {}) {
  const root = env.root || process.cwd();
  const { apply } = resolvePosture(parsed.flags);
  switch (parsed.command) {
    case 'operation':
      return runOperationCreate({ ...parsed, apply, root });
    case 'render':
      return handleRender({ flags: parsed.flags, root });
    default:
      if (FUTURE_COMMANDS.includes(parsed.command)) {
        throw new Error(`work: command "${parsed.command}" is part of WF-0036 but not yet wired in this wave`);
      }
      throw new Error(`work: unknown command "${parsed.command || ''}". Try: operation | render`);
  }
}

/** CLI bootstrap — parse argv, dispatch, print a receipt (JSON or human). */
function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { json } = resolvePosture(parsed.flags);
  try {
    const receipt = dispatch(parsed);
    process.stdout.write(json ? `${JSON.stringify(receipt, null, 2)}\n` : `${formatReceipt(receipt)}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('work.mjs')) {
  main();
}
