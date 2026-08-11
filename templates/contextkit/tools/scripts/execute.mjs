#!/usr/bin/env node
/** Governed execution entrypoint: ContextDevKit authorizes, Compozy executes. */
import { readWorkflow } from './workflow-pack.mjs';
import { createAuthorizedExecutionEnvelope } from '../../runtime/execution/governed-execution-envelope.mjs';
import { executeGovernedEnvelope } from '../../runtime/execution/executor-dispatch.mjs';

const ROOT = process.cwd();

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function listOption(name) {
  const value = option(name);
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function usage() {
  return [
    'Usage: node cdx.mjs execute --workflow WF-#### --task T-### --objective "..." [options]',
    '',
    'Options:',
    '  --allowed-paths path[,path]   Override canonical task touch hints',
    '  --allowed-operations op[,op]  Permission kinds (default: *)',
    '  --allowed-commands cmd[,cmd]  Command allowlist (default: *)',
    '  --network allow|deny          Network policy (default: allow)',
    '  --agent name                  Compozy agent name',
    '  --compozy path                Absolute Compozy executable path',
    '  --timeout-ms number           Execution deadline',
  ].join('\n');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const workflowId = option('workflow');
  const taskId = option('task');
  const objective = option('objective');
  if (!workflowId || !taskId || !objective) throw new Error(usage());
  const workflow = readWorkflow(ROOT, workflowId);
  const task = workflow.tasks.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Task ${taskId} was not found in ${workflowId}`);
  const allowedPaths = listOption('allowed-paths');
  const envelope = createAuthorizedExecutionEnvelope(workflow, task, {
    objective,
    workspaceRoot: ROOT,
    allowedPaths,
    constraints: task.acceptance,
    executionPermissions: {
      mode: 'auto-approve',
      allowedOperations: listOption('allowed-operations').length ? listOption('allowed-operations') : ['*'],
      allowedCommands: listOption('allowed-commands').length ? listOption('allowed-commands') : ['*'],
      networkPolicy: option('network', 'allow'),
      environmentKeys: [],
    },
  });
  const timeoutValue = Number(option('timeout-ms'));
  const receipt = await executeGovernedEnvelope(envelope, {
    compozyOptions: {
      agentName: option('agent') || undefined,
      executable: option('compozy') || undefined,
      timeoutMs: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : undefined,
    },
  });
  console.log(JSON.stringify(receipt, null, 2));
  if (['blocked', 'governance_refused'].includes(receipt.executionState)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    schemaVersion: 1,
    executionState: 'governance_refused',
    selectedExecutor: null,
    governanceAuthority: 'contextdevkit',
    fallback: 'forbidden',
    reason: error.code ?? 'execute_failed',
    detail: error.message,
  }, null, 2));
  process.exitCode = 1;
});
