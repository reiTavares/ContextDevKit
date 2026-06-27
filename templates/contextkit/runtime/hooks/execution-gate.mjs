#!/usr/bin/env node
/**
 * execution-gate.mjs — PreToolUse hook: unified capability execution gate (CDK-032, ADR-0072).
 *
 * Advisory-first design: in advisory mode (the v1 default) this hook NEVER
 * blocks. It only emits a stderr warning so the agent sees the nudge without
 * the tool call being interrupted. The deny path is wired and will activate
 * when the project's enforcement.mode is raised to 'guarded' or 'strict'.
 *
 * Silence rule: the hook writes nothing when the gate produces no reason codes.
 * A hook that adds noise on every tool call breaks agent flow.
 *
 * Fail-open: any unhandled error exits 0 silently (immutable rule 2 — a broken
 * hook MUST NEVER block real work).
 *
 * Inert below Level 5: exits 0 immediately.
 *
 * Unregistered task (no taskId → no contract): exits 0 immediately. The gate
 * is silent until a contract exists.
 */
import { getLevel, loadConfig } from '../config/load.mjs';
import { loadContract } from '../execution/execution-contract.mjs';
import { resolveEnforcementMode } from '../execution/enforcement-modes.mjs';
import { evaluateAction, toolMoment } from '../execution/evaluate-action.mjs';
import { emitAdvisory, emitBlockDecision, hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';
import { readLedger, writeLedger } from './ledger.mjs';
import { listWorkflows, currentBranch, PHASES } from '../../tools/scripts/workflow-pack.mjs';
import { pathsFor } from '../config/paths.mjs';
import { existsSync, readdirSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildEconomyAdvisory } from '../../tools/scripts/economy/gate-advisory.mjs';
import { resolveGateAction } from './gate-enforcement-decision.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/**
 * Extracts the taskId from the hook payload. Best-effort: reads
 * `tool_input.taskId` or `tool_input.task_id`. Returns null when absent.
 *
 * @param {any} payload parsed stdin JSON
 * @returns {string|null}
 */
function extractTaskId(payload) {
  const input = payload?.tool_input ?? {};
  if (typeof input.taskId === 'string' && input.taskId) return input.taskId;
  if (typeof input.task_id === 'string' && input.task_id) return input.task_id;
  return null;
}

/**
 * Returns true when there is an active (pre-ship) workflow on the current branch.
 * Mirrors the `getActiveWorkflowBeforeShip` pattern from simulate-gate.mjs.
 *
 * @param {string} root
 * @returns {boolean}
 */
function hasActiveWorkflow(root) {
  try {
    const branch = currentBranch(root);
    const list = listWorkflows(root);
    const active = list.find(
      (w) =>
        w.currentPhase &&
        w.currentPhase !== 'done' &&
        w.branch &&
        branch &&
        w.branch === branch
    );
    if (!active) return false;
    const phaseIndex = PHASES.indexOf(active.currentPhase);
    const shipIndex = PHASES.indexOf('ship');
    return phaseIndex >= 0 && phaseIndex < shipIndex;
  } catch {
    // Defensive: if workflows cannot be read, assume an active workflow exists
    // to avoid false "workflow-missing" positives.
    return true;
  }
}

/**
 * Returns true when the project-map appears reasonably fresh.
 *
 * Heuristic: checks whether a project-map output directory or marker exists.
 * When the check cannot run, defaults to true (no false warns).
 *
 * @param {string} root
 * @returns {boolean}
 */
function isProjectMapFresh(root) {
  try {
    const paths = pathsFor(root);
    // Look for a project-map directory or any .md file produced by /project-map.
    const projMapDir = resolve(paths.memory, 'project-map');
    if (existsSync(projMapDir)) {
      const entries = readdirSync(projMapDir);
      return entries.length > 0;
    }
    return false;
  } catch {
    return true; // fail-open: unknown → treat as fresh
  }
}

/** Formats a human-readable advisory warning from evaluateAction output. */
function buildAdvisoryText(result, toolName) {
  const lines = [
    `[execution-gate] Advisory: ${toolName} intercepted (no blocking in advisory mode).`,
    `Reason codes: ${result.reasonCodes.join(', ')}`,
  ];
  if (result.detail.missing.length > 0) {
    lines.push(`Missing capabilities: ${result.detail.missing.join(', ')}`);
  }
  if (result.remediation.length > 0) {
    lines.push('Remediation:');
    for (const step of result.remediation) lines.push(`  - ${step}`);
  }
  return lines.join('\n') + '\n';
}

/** Formats a deny-mode block reason. */
function buildBlockText(result, toolName) {
  const lines = [
    `Execution gate denied: ${toolName}`,
    `Reason codes: ${result.reasonCodes.join(', ')}`,
  ];
  if (result.detail.missing.length > 0) {
    lines.push(`Missing capabilities: ${result.detail.missing.join(', ')}`);
  }
  if (result.remediation.length > 0) {
    lines.push('Required remediation:');
    for (const step of result.remediation) lines.push(`  - ${step}`);
  }
  return lines.join('\n');
}

/**
 * Best-effort telemetry append for gate block/degrade events (OP-0005 / ADR-0125 Wave 5).
 * Never throws — telemetry failure must never affect the gate decision (rule 2).
 */
function appendGateTelemetry(root, record) {
  try {
    const telemetryPath = join(pathsFor(root).memory, 'routing-decisions.jsonl');
    appendFileSync(telemetryPath, JSON.stringify(record) + '\n', 'utf8');
  } catch { /* telemetry is advisory — never block real work */ }
}

/**
 * Returns true when the tool call is a broad exploration (CDK-035 counter).
 * Mirrors `isBroadSearch` in evaluate-action.mjs — local so gate counts before evaluateAction.
 */
function isBroadExploration(toolName, input) {
  if (!toolName) return false;
  const moment = toolMoment(toolName, input ?? {});
  if (moment !== 'beforeExploration') return false;
  // Read/Grep/Glob are always broad; Bash only when toolMoment maps it to exploration.
  return true;
}

/**
 * Reads broadSearchCount from the session ledger, increments it, and persists.
 * Resets to 0 when the project-map is fresh (budget renewed). Returns the new count.
 */
async function incrementBroadSearchCount(sessionId, projectMapFresh) {
  try {
    const ledger = await readLedger(sessionId);
    if (typeof ledger.broadSearchCount !== 'number') ledger.broadSearchCount = 0;
    // Reset counter when the project-map was freshly produced this session.
    if (projectMapFresh && ledger.broadSearchCount > 0) ledger.broadSearchCount = 0;
    ledger.broadSearchCount += 1;
    await writeLedger(sessionId, ledger);
    return ledger.broadSearchCount;
  } catch {
    return 1; // fail-open: assume first search
  }
}

async function main() {
  // Inert below Level 5.
  if (getLevel(ROOT) < 5) return;

  const raw = await readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed stdin → silent, fail-open
  }

  const { toolName, filePaths } = normalizeToolPayload(payload);
  if (!toolName) return;
  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const ledger = await readLedger(sessionId);
  const advisoryTexts = [];

  // ADR-0103: economy advisory (warn-only, fail-open) — runs for any gated tool
  // call, independent of the capability contract. NEVER blocks (immutable rule 2).
  if (toolMoment(toolName, payload?.tool_input ?? {}) !== null) {
    const ecoText = await buildEconomyAdvisory({
      config: await loadConfig(ROOT),
      payload, toolName, root: ROOT,
      sessionId,
      readLedger,
      now: Date.now(),
    });
    if (ecoText) advisoryTexts.push(ecoText);
  }

  // No taskId → no contract → gate is silent for unregistered tasks.
  const taskId = extractTaskId(payload) ?? ledger.activeTask;
  if (!taskId) {
    if (advisoryTexts.length) emitAdvisory(advisoryTexts.join('\n'), HOST, 'PreToolUse');
    return;
  }

  const contract = loadContract(ROOT, taskId);
  if (!contract) {
    if (advisoryTexts.length) emitAdvisory(advisoryTexts.join('\n'), HOST, 'PreToolUse');
    return;
  }

  const config = await loadConfig(ROOT);
  const mode = resolveEnforcementMode(config);
  const mapFresh = isProjectMapFresh(ROOT);

  // CDK-035: persist + read the real broad-search counter.
  const input = payload?.tool_input ?? {};
  let broadSearchCount = 0;
  if (isBroadExploration(toolName, input)) {
    broadSearchCount = await incrementBroadSearchCount(sessionId, mapFresh);
  }

  const projectState = {
    scope: {
      branch: currentBranch(ROOT) ?? 'unknown',
      taskId,
      paths: filePaths,
    },
    root: ROOT,
    requiresHumanApproval: false,
    activeWorkflow: hasActiveWorkflow(ROOT),
    projectMapFresh: mapFresh,
    broadSearchCount,
    exploreBudget: 2,
  };

  const result = evaluateAction({ tool: toolName, input, contract, projectState, mode });

  // Silence when nothing to say.
  if (result.reasonCodes.length === 0) {
    if (advisoryTexts.length) emitAdvisory(advisoryTexts.join('\n'), HOST, 'PreToolUse');
    return;
  }

  // OP-0005 / ADR-0125 Wave 5: mandatory-with-graceful-fallback enforcement.
  // resolveGateAction evaluates all five conditions (mode, contract, decision,
  // ceremony capability, signals.work confidence) and returns block or warn.
  // Any error in resolveGateAction degrades to warn via the outer try/catch (rule 2).
  const signalsWork = contract?.signals?.work ?? null;
  const gateCtx = {
    mode,
    contract,
    decision: result.decision,
    missedCapabilities: result.detail?.missing ?? [],
    signalsWork,
    registryLoadFailed: false,
    taskRegistered: !!taskId,
  };
  const gateVerdict = resolveGateAction(gateCtx);

  if (gateVerdict.action === 'block') {
    // All five conditions met — emit a hard block decision.
    appendGateTelemetry(ROOT, {
      ts: Date.now(), event: 'gate:block', tool: toolName, taskId,
      reasonCode: gateVerdict.reasonCode, reason: gateVerdict.reason,
      missing: result.detail?.missing ?? [],
    });
    emitBlockDecision([...advisoryTexts, buildBlockText(result, toolName)].filter(Boolean).join('\n'), HOST);
    return;
  }

  // warn / degrade path — advisory guarantee: exit 0, never block.
  appendGateTelemetry(ROOT, {
    ts: Date.now(), event: 'gate:degrade', tool: toolName, taskId,
    reasonCode: gateVerdict.reasonCode, reason: gateVerdict.reason,
    missing: result.detail?.missing ?? [],
  });
  advisoryTexts.push(buildAdvisoryText(result, toolName));
  emitAdvisory(advisoryTexts.join('\n'), HOST, 'PreToolUse');
}

main().catch(() => process.exit(0));
