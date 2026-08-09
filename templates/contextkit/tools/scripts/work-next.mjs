/** Read-only `work next` and `work map` adapters for Workflow v2. */
import { readWorkflow } from './workflow-pack.mjs';
import { resolveActiveContext } from '../../runtime/execution/active-context-resolver.mjs';
import { makeReceipt } from './work-io.mjs';

const PHASE_COMMANDS = Object.freeze({
  intake: 'author prd.md, then run `node cdx.mjs workflow advance <WF-ID>`',
  prd: 'author spec.md, then run `node cdx.mjs workflow advance <WF-ID>`',
  spec: 'record referenced decisions, then run `node cdx.mjs workflow advance <WF-ID>`',
  adr: 'update the roadmap, then run `node cdx.mjs workflow advance <WF-ID>`',
  roadmap: 'populate pipeline/tasks.json, then run `node cdx.mjs workflow advance <WF-ID>`',
  pipeline: 'implement the next canonical task',
  ship: 'run the required tests and QA sign-off',
  testing: 'record conclusion evidence and advance the workflow',
  conclusion: 'run `node cdx.mjs log-session` after the workflow is done',
});

/** @param {object} flags @param {string} root @returns {object|null} */
function resolveWorkflowView(flags, root) {
  const explicitRef = flags.workflow ?? flags.id;
  const active = explicitRef
    ? { state: 'confirmed', workflow: String(explicitRef) }
    : resolveActiveContext({ cwd: root, explicitIds: [] }, { root });
  if (active.state === 'ambiguous' || !active.workflow) return null;
  try { return readWorkflow(root, active.workflow); } catch { return null; }
}

/** @param {object} workflow @returns {string|null} */
function nextCommand(workflow) {
  if (workflow.status === 'done') return 'node cdx.mjs log-session';
  return PHASE_COMMANDS[workflow.currentPhase]?.replace('<WF-ID>', workflow.id) ?? null;
}

/** @param {{flags:object,root:string}} context @returns {object} */
export function handleNext({ flags, root }) {
  const workflow = resolveWorkflowView(flags, root);
  return makeReceipt({
    command: 'next',
    applied: false,
    writes: [],
    detail: {
      status: workflow ? 'ready' : 'skipped',
      workflowId: workflow?.id ?? null,
      nextCommand: workflow ? nextCommand(workflow) : null,
    },
  });
}

/** @param {{flags:object,root:string}} context @returns {object} */
export function handleMap({ flags, root }) {
  const workflow = resolveWorkflowView(flags, root);
  const lifecycleMap = workflow
    ? JSON.stringify({
        authority: 'workflow-v2',
        workflowId: workflow.id,
        status: workflow.status,
        phase: workflow.currentPhase,
        revision: workflow.revision,
        next: nextCommand(workflow),
      }, null, 2)
    : null;
  return makeReceipt({
    command: 'map',
    applied: false,
    writes: [],
    detail: { status: lifecycleMap ? 'ready' : 'skipped', lifecycleMap },
  });
}
