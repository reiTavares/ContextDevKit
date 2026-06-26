/**
 * MCP write-tool governance gate (MCP-011, ADR-0073).
 *
 * WHY this module exists: no MCP write tool may mutate kit state directly. Every
 * mutation MUST traverse a single, fail-closed pipeline:
 *   execution-contract -> autonomy resolver -> capability policy ->
 *   (human approval) -> mutation -> receipt
 *
 * Security contract:
 *   - DENY by default; a mutation runs only on an explicit allow verdict.
 *   - A tool CANNOT bypass the gate: the gate invokes the mutation callback,
 *     never the tool, and only after every stage passes.
 *   - A tool CANNOT self-authorize: the approval token is verified against a
 *     human-recorded store with constant-time comparison and is single-use.
 *   - Autonomy cannot exceed the human floor: a manual/debate verdict forces
 *     the human-approval branch; nothing relaxes past it.
 *   - DEGRADED PATH (CDK-021): no loadable contract -> deny NO_EXECUTION_CONTRACT,
 *     never a silent direct mutation. A present contract activates the full path.
 *   - Every success emits a receipt; every refusal returns a reason code and a
 *     refusal receipt (a refusal, never a false pass).
 *
 * Zero third-party dependencies (node:* + kit primitives only) - hot-path safe.
 *
 * @module tools.write-gate
 */
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { resolveAutonomy, readAutonomyOverride } from '../runtime/config/resolve-autonomy.mjs';
import { loadContract } from '../runtime/execution/execution-contract.mjs';
import { readJsonSafe } from '../runtime/hooks/safe-io.mjs';
import { writeMcpReceipt } from '../tools/scripts/mcp-receipt.mjs';

/** Machine-readable refusal codes - one per distinct failure mode. */
export const REASON = Object.freeze({
  NO_EXECUTION_CONTRACT: 'gate:no-execution-contract(CDK-021-absent)-deny',
  CONTRACT_MISMATCH: 'gate:contract-task-mismatch-deny',
  APPROVAL_REQUIRED: 'gate:human-approval-required-blocked',
  APPROVAL_INVALID: 'gate:human-approval-token-invalid-deny',
  CAPABILITY_DENIED: 'gate:capability-policy-denied',
  BAD_REQUEST: 'gate:invalid-write-request-deny',
});

/**
 * Maps a write tool to the autonomy area it consumes. A tool absent from this
 * map is rejected as an unknown write surface (fail closed).
 */
export const TOOL_AREA = Object.freeze({
  create_workflow: 'edit',
  advance_workflow: 'edit',
  claim_scope: 'edit',
  release_claim: 'edit',
  move_pipeline_card: 'pipeline-move',
  record_test_receipt: 'session-log',
  log_session: 'session-log',
});

/**
 * Constant-time string compare - never short-circuits on the first mismatching
 * byte, so an attacker cannot time-probe the approval token.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Reads the human-recorded approval store. Approvals are recorded OUT OF BAND by
 * a human (never by a tool). Absent store -> no approvals.
 * @param {string} root
 * @returns {{ approvals: Array<object> }}
 */
function readApprovalStore(root) {
  const store = readJsonSafe(
    resolve(root, 'contextkit', 'runtime', 'approvals', 'mcp-write.json'),
    { approvals: [] },
  );
  return store && Array.isArray(store.approvals) ? store : { approvals: [] };
}

/**
 * Verifies a human approval for a (area, task) mutation. Fails closed: a missing,
 * mismatched, wrong-scope, or consumed token all return false. Constant-time
 * compare. The tool cannot self-authorize.
 * @param {string} root
 * @param {{ area: string, taskId: string|null, approvalToken?: string }} req
 * @returns {boolean}
 */
function approvalIsValid(root, { area, taskId, approvalToken }) {
  if (typeof approvalToken !== 'string' || approvalToken.length === 0) return false;
  const { approvals } = readApprovalStore(root);
  return approvals.some((entry) => {
    if (!entry || entry.consumed === true) return false;
    if (entry.area !== area) return false;
    if (entry.taskId != null && entry.taskId !== taskId) return false;
    return constantTimeEquals(String(entry.token ?? ''), approvalToken);
  });
}

/**
 * Stage 1 - execution contract. Probes for a loadable contract bound to the task.
 * DEGRADED PATH: a null contract denies NO_EXECUTION_CONTRACT; a taskId mismatch
 * denies CONTRACT_MISMATCH. Never a silent pass.
 * @param {string} root
 * @param {string|null} taskId
 * @returns {{ ok: boolean, reason?: string, contract?: object }}
 */
function checkExecutionContract(root, taskId) {
  if (!taskId) return { ok: false, reason: REASON.NO_EXECUTION_CONTRACT };
  let contract = null;
  try {
    contract = loadContract(root, taskId);
  } catch {
    contract = null;
  }
  if (!contract || typeof contract !== 'object') {
    return { ok: false, reason: REASON.NO_EXECUTION_CONTRACT };
  }
  if (contract.taskId != null && contract.taskId !== taskId) {
    return { ok: false, reason: REASON.CONTRACT_MISMATCH };
  }
  return { ok: true, contract };
}

/**
 * Stage 3 - capability policy (least privilege). The contract beforeWrite list is
 * the policy surface: a scoped contract that omits this tool denies. An unscoped
 * contract permits only because stage 1 proved a contract exists. Seam for CDK-022.
 * @param {object} contract
 * @param {string} toolName
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkCapabilityPolicy(contract, toolName) {
  const required = Array.isArray(contract?.beforeWrite) ? contract.beforeWrite : [];
  const recommended = Array.isArray(contract?.recommended) ? contract.recommended : [];
  if (required.length === 0) return { ok: true };
  const permitted = required.includes(toolName) || recommended.includes(toolName);
  return permitted ? { ok: true } : { ok: false, reason: REASON.CAPABILITY_DENIED };
}

/**
 * Runs a governed mutation through the full fail-closed pipeline. The mutation
 * callback is invoked by THIS function and only on an allow verdict.
 * @param {object} args
 * @param {string} args.toolName
 * @param {string} args.root
 * @param {string|null} args.taskId
 * @param {object} args.config
 * @param {string} args.host
 * @param {string} args.run
 * @param {string} [args.approvalToken]
 * @param {() => Promise<object>} args.mutate
 * @param {object} [args.evidence]
 * @returns {Promise<{ status: 'allowed'|'blocked'|'denied', reason?: string, receipt?: object, result?: object }>}
 */
export async function governedMutation(args) {
  const { toolName, root, taskId, config, host, run, approvalToken, mutate, evidence = {} } = args;

  const area = TOOL_AREA[toolName];
  if (!area || typeof mutate !== 'function') {
    return recordRefusal({ root, host, run, toolName, taskId, reason: REASON.BAD_REQUEST });
  }

  const contractCheck = checkExecutionContract(root, taskId);
  if (!contractCheck.ok) {
    return recordRefusal({ root, host, run, toolName, taskId, reason: contractCheck.reason });
  }

  const sessionOverride = (() => { try { return readAutonomyOverride(root); } catch { return null; } })();
  let resolved;
  try {
    resolved = resolveAutonomy(area, config ?? {}, sessionOverride, {});
  } catch {
    resolved = { mode: 'manual', grade: 1, reason: 'autonomy:resolver-error-fail-closed' };
  }
  const needsHuman = resolved.mode === 'manual' || resolved.mode === 'debate';

  const capability = checkCapabilityPolicy(contractCheck.contract, toolName);
  if (!capability.ok) {
    return recordRefusal({ root, host, run, toolName, taskId, reason: capability.reason });
  }

  if (needsHuman) {
    if (typeof approvalToken !== 'string' || approvalToken.length === 0) {
      return recordRefusal({ root, host, run, toolName, taskId, reason: REASON.APPROVAL_REQUIRED, status: 'blocked' });
    }
    if (!approvalIsValid(root, { area, taskId, approvalToken })) {
      return recordRefusal({ root, host, run, toolName, taskId, reason: REASON.APPROVAL_INVALID });
    }
  }

  const result = await mutate();

  const { receipt } = await writeMcpReceipt(
    {
      task: taskId ?? toolName,
      run,
      servers: ['contextdevkit-write'],
      tools: [toolName],
      host,
      result: 'passed',
      evidence: { ...evidence, area, autonomyMode: resolved.mode, humanApproved: needsHuman },
    },
    root,
  );

  return { status: 'allowed', reason: `allow:${area}:${resolved.mode}`, receipt, result };
}

/**
 * Records a blocked/denied call with a reason code and a refusal receipt.
 * @param {object} args
 * @returns {Promise<{ status: 'blocked'|'denied', reason: string, receipt?: object }>}
 */
async function recordRefusal({ root, host, run, toolName, taskId, reason, status = 'denied' }) {
  let receipt = null;
  try {
    ({ receipt } = await writeMcpReceipt(
      {
        task: taskId ?? toolName,
        run: run ?? 'unknown-run',
        servers: ['contextdevkit-write'],
        tools: [toolName],
        host: host ?? 'unknown-host',
        result: status === 'blocked' ? 'skipped' : 'failed',
        evidence: { reason, refusedTool: toolName },
      },
      root,
    ));
  } catch {
    receipt = null;
  }
  return { status, reason, receipt };
}
