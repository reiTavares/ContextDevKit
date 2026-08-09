#!/usr/bin/env node
/**
 * `work` — the single public CLI entry point for the Business / Operation /
 * Workflow domain layer (BIZ-0001 / WF-0036). Atomic, idempotent, receipt-
 * producing; mutators are DRY-RUN BY DEFAULT (constitution §8 — `--apply` writes).
 *
 * THIN DISPATCHER ONLY (constitution §2): this file parses argv and routes to a
 * command handler in a `work-*` helper module. Logic lives in those modules.
 * The `render` alias repairs `tasks.md` only from the canonical JSON store; it
 * never discovers or parses status directories or Markdown cards.
 *
 * Zero runtime dependencies — `node:*` + sibling modules only (immutable rule 1).
 *
 * @example node work.mjs operation "Rotate the staging API key" --mode direct --apply
 * @example node work.mjs render --operation OP-0001
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { parseArgs, resolvePosture, formatReceipt, makeReceipt } from './work-io.mjs';
import { runOperationCreate } from './work-operation.mjs';
import { repairTasksProjection, resolveTasksDocumentPath } from './tasks-store.mjs';
import {
  handleBusinessCreate,
  handleBusinessTransition,
  handleBusinessStatus,
} from './work-business-dispatch.mjs';
import { handleIntake } from './work-intake.mjs';
import { handleLink, handleUnlink } from './work-link.mjs';
import { handleStart, handleClose, handlePromote } from './work-lifecycle-cmd.mjs';
import { handleReconcile } from './work-reconcile.mjs';
import { handleValidate } from './work-validate.mjs';
import { handleNext, handleMap } from './work-next.mjs';

/**
 * Resolves the canonical batch task-store path for one Operation.
 *
 * @param {string} root project root
 * @param {string} idOrDir OP id or full directory name
 * @returns {string}
 */
function batchScopeForOperation(root, idOrDir) {
  const operationsRoot = pathsFor(root).operations;
  const direct = join(operationsRoot, idOrDir);
  if (existsSync(direct) || !existsSync(operationsRoot)) return join(direct, 'batch', 'tasks.json');
  const prefix = `${idOrDir}-`;
  const match = readdirSync(operationsRoot).find((name) => name === idOrDir || name.startsWith(prefix));
  return join(match ? join(operationsRoot, match) : direct, 'batch', 'tasks.json');
}

/**
 * Repairs `tasks.md` solely from the canonical JSON authority.
 *
 * @param {{flags:object,root:string,apply:boolean}} context
 * @returns {ReturnType<typeof makeReceipt>}
 */
function handleRender({ flags, root, apply }) {
  const explicitTarget = flags.tasks || flags.scope;
  const operationId = flags.operation || flags.id;
  if (!explicitTarget && (typeof operationId !== 'string' || !operationId)) {
    throw new Error('render: --tasks <scope> or --operation OP-#### is required');
  }
  const target = explicitTarget || batchScopeForOperation(root, String(operationId));
  const tasksPath = resolveTasksDocumentPath(target);
  const projectionPath = join(tasksPath, '..', 'tasks.md');
  const outcome = apply
    ? repairTasksProjection(target)
    : { path: projectionPath, status: 'planned' };
  return makeReceipt({
    command: 'render',
    applied: apply,
    writes: apply ? [outcome.path] : [],
    detail: {
      operation: operationId || null,
      tasksPath,
      projectionPath: outcome.path,
      dryRun: !apply,
      status: outcome.status,
    },
  });
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
      return handleRender({ flags: parsed.flags, root, apply });
    case 'business':
      return handleBusinessCreate({ positionals: parsed.positionals, flags: parsed.flags, apply, root });
    case 'approve':
    case 'revise':
    case 'reject':
      return handleBusinessTransition({ command: parsed.command, flags: parsed.flags, apply, root });
    case 'status':
      return handleBusinessStatus({ flags: parsed.flags, root });
    case 'intake':
      return handleIntake({ positionals: parsed.positionals, flags: parsed.flags, apply, root });
    case 'link':
      return handleLink({ flags: parsed.flags, apply, root });
    case 'unlink':
      return handleUnlink({ flags: parsed.flags, apply, root });
    case 'promote':
      return handlePromote({ flags: parsed.flags, apply, root });
    case 'reconcile':
      return handleReconcile({ flags: parsed.flags, apply, root });
    case 'start':
      return handleStart({ flags: parsed.flags, apply, root });
    case 'close':
      return handleClose({ flags: parsed.flags, apply, root });
    case 'validate':
      return handleValidate({ flags: parsed.flags, apply, root });
    case 'next':
      return handleNext({ flags: parsed.flags, root });
    case 'map':
      return handleMap({ flags: parsed.flags, root });
    default:
      throw new Error(
        `work: unknown command "${parsed.command || ''}". ` +
        `Try: operation | render | approve | revise | reject | status | ` +
        `business | intake | link | unlink | promote | reconcile | start | close | validate | next | map`,
      );
  }
}

/** CLI bootstrap — parse argv, dispatch, print a receipt (JSON or human). */
function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { json } = resolvePosture(parsed.flags);
  try {
    const receipt = dispatch(parsed);
    if (parsed.command === 'next') {
      if (receipt.detail?.nextCommand) process.stdout.write(`${receipt.detail.nextCommand}\n`);
    } else if (parsed.command === 'map') {
      if (receipt.detail?.lifecycleMap) process.stdout.write(`${receipt.detail.lifecycleMap}\n`);
    } else {
      process.stdout.write(json ? `${JSON.stringify(receipt, null, 2)}\n` : `${formatReceipt(receipt)}\n`);
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('work.mjs')) {
  main();
}
