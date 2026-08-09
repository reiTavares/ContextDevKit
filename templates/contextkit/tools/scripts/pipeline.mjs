#!/usr/bin/env node
/**
 * ContextDevKit 4 task CLI.
 *
 * Command names are semantic aliases only. Every read and mutation is delegated
 * to the canonical `tasks-*` APIs; this entry point has no alternate authority.
 */
import { pathToFileURL } from 'node:url';
import { add } from './pipeline-add.mjs';
import { renderBoard, renderDigest } from './pipeline-board.mjs';
import { startTask, stopTask } from './pipeline-session.mjs';
import { autoTransition, move, qaApprove, qaReject } from './pipeline-transitions.mjs';
import {
  listTasks,
  readTasksDocument,
  repairTasksProjection,
} from './tasks-store.mjs';
import { assertTasksDocument } from './tasks-validate.mjs';

const USAGE = 'Usage: pipeline.mjs <add|list|board|move|start|stop|validate|sync|qa-reject|qa-approve|auto-transition> --tasks <scope-or-tasks.json>';

/** @param {object} receipt @param {(text:string)=>void} output @returns {void} */
function reportProjectionFailure(receipt, output) {
  if (receipt?.projection?.status === 'failed') {
    output(`Warning: canonical JSON committed, but tasks.md repair failed: ${receipt.projection.error?.message ?? 'unknown error'}`);
  }
}

/**
 * Removes one named option and its value from argv.
 *
 * @param {string[]} argv
 * @param {string} optionName
 * @returns {{value:string|undefined,argv:string[]}}
 */
function extractOption(argv, optionName) {
  const option = `--${optionName}`;
  const index = argv.indexOf(option);
  if (index < 0) return { value: undefined, argv: [...argv] };
  return {
    value: argv[index + 1],
    argv: [...argv.slice(0, index), ...argv.slice(index + 2)],
  };
}

/**
 * Parses the CLI boundary and requires an explicit canonical scope.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [environment]
 * @returns {{command:string,target:string,args:string[]}}
 * @throws {Error} when no canonical scope is supplied
 */
export function parsePipelineInvocation(argv, environment = process.env) {
  const [command = '', ...rawArgs] = argv;
  const tasksOption = extractOption(rawArgs, 'tasks');
  const scopeOption = extractOption(tasksOption.argv, 'scope');
  const target = tasksOption.value ?? scopeOption.value ?? environment.CONTEXTKIT_TASKS_SCOPE;
  if (!target) {
    throw new Error(`pipeline: --tasks <scope-or-tasks.json> is required; no global writable task store exists\n${USAGE}`);
  }
  return { command, target, args: scopeOption.argv };
}

/**
 * Dispatches one parsed invocation. Injectable handlers make the CLI testable
 * without replacing the canonical store implementation.
 *
 * @param {{command:string,target:string,args:string[]}} invocation
 * @param {{out?:(text:string)=>void,now?:string,session?:object,root?:string}} [environment]
 * @returns {Promise<object>}
 */
export async function dispatchPipelineCommand(invocation, environment = {}) {
  const output = environment.out ?? ((message) => process.stdout.write(`${message}\n`));
  const { command, target, args } = invocation;
  if (command === 'add') {
    const receipt = add({ target, argv: args, now: environment.now });
    output(`Added ${receipt.task.id} to ${receipt.task.status}`);
    reportProjectionFailure(receipt, output);
    return receipt;
  }
  if (command === 'list') {
    const document = readTasksDocument(target);
    const tasks = listTasks(document);
    if (args.includes('--json')) output(JSON.stringify(tasks, null, 2));
    else for (const task of tasks) output(`[${task.status}] ${task.id} ${task.priority} - ${task.title}`);
    return { document, tasks };
  }
  if (command === 'board') {
    const tasks = listTasks(readTasksDocument(target));
    output(args.includes('--digest') ? renderDigest(tasks) : renderBoard(tasks));
    return { tasks };
  }
  if (command === 'move') {
    const receipt = move({ target, argv: args });
    output(`Moved ${receipt.task.id} -> ${receipt.task.status}`);
    reportProjectionFailure(receipt, output);
    return receipt;
  }
  if (command === 'start' || command === 'stop') {
    const taskId = args[0];
    if (!taskId) throw new Error(`Usage: pipeline.mjs ${command} <id> --tasks <scope>`);
    const handler = command === 'start' ? startTask : stopTask;
    const receipt = await handler(target, taskId, environment.session ?? {});
    output(`${command === 'start' ? 'Started' : 'Stopped'} ${receipt.task.id} -> ${receipt.task.status}`);
    if (receipt.workspaceWarning) output(`Warning: ${receipt.workspaceWarning}`);
    reportProjectionFailure(receipt, output);
    return receipt;
  }
  if (command === 'validate') {
    const document = assertTasksDocument(readTasksDocument(target));
    output(`Validated ${document.tasks.length} canonical tasks at revision ${document.revision}.`);
    return { document };
  }
  if (command === 'sync') {
    const receipt = repairTasksProjection(target);
    output(`Repaired ${receipt.path}`);
    return receipt;
  }
  if (command === 'qa-reject' || command === 'qa-approve' || command === 'auto-transition') {
    const handler = command === 'qa-reject'
      ? qaReject
      : command === 'qa-approve' ? qaApprove : autoTransition;
    const receipt = handler({ target, argv: args, root: environment.root ?? process.cwd() });
    output(`${command} ${receipt.task.id} -> ${receipt.task.status}`);
    reportProjectionFailure(receipt, output);
    return receipt;
  }
  throw new Error(USAGE);
}

/** @returns {Promise<void>} */
export async function main() {
  try {
    const invocation = parsePipelineInvocation(process.argv.slice(2));
    await dispatchPipelineCommand(invocation);
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
