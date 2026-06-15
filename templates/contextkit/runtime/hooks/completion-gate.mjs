#!/usr/bin/env node
/**
 * completion-gate.mjs - Stop hook: completion evidence gate (CDK-040, ADR-0072).
 *
 * Fires once per session when Claude declares a task done (the Stop event).
 * Checks whether all required completion capabilities have valid receipts on
 * disk before the session ends. Advisory-first design: in advisory mode (the
 * v1 default) this hook NEVER blocks - it emits a stdout nudge.
 *
 * Key invariants:
 *   Inert below Level 5: exits 0 immediately.
 *   Silent for unregistered tasks (no activeTask in ledger): exits 0.
 *   Silent when no contract exists on disk: exits 0.
 *   Debounce: fires at most ONCE per session (completionWarnedAt stamp guards re-entry).
 *   Fail-open: any unhandled error exits 0 silently (immutable rule 2).
 *   Anti-loop: stop_hook_active === true -> exits 0 immediately.
 *
 * Advisory mode: emits advisory text to stdout, never blocks.
 * Guarded / strict: emits block decision when result.decision === 'deny'.
 *
 * Zero runtime deps - node:* + sibling runtime modules only.
 */
import { getLevel, loadConfig } from '../config/load.mjs';
import { loadContract } from '../execution/execution-contract.mjs';
import { resolveEnforcementMode } from '../execution/enforcement-modes.mjs';
import { evaluateCompletion } from '../execution/evaluate-completion.mjs';
import { readLedger, writeLedger } from './ledger.mjs';
import { emitBlockDecision, hookHost, resolveHookSessionId } from './host-adapter.mjs';
import { currentBranch } from '../../tools/scripts/workflow-pack.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

// ---------------------------------------------------------------------------
// stdin helper
// ---------------------------------------------------------------------------

async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/**
 * Formats a human-readable advisory nudge from evaluateCompletion output.
 *
 * @param {{ reasonCodes: string[], remediation: string[], detail: object }} result
 * @param {string} taskId
 * @returns {string}
 */
function buildAdvisoryText(result, taskId) {
  const shortId = taskId.length > 16 ? taskId.slice(0, 16) + '...' : taskId;
  const lines = [
    '[completion-gate] Advisory: task ' + shortId + ' declared done without complete evidence (no blocking in advisory mode).',
    'Reason codes: ' + result.reasonCodes.join(', '),
  ];
  if (result.detail.missing.length > 0) {
    lines.push('Missing completion evidence: ' + result.detail.missing.join(', '));
  }
  if (result.detail.bypassed.length > 0) {
    lines.push('Bypassed (waived, not proved): ' + result.detail.bypassed.join(', '));
  }
  if (result.remediation.length > 0) {
    lines.push('Remediation:');
    for (const step of result.remediation) lines.push('  - ' + step);
  }
  return lines.join('\n') + '\n';
}

/**
 * Formats a deny-mode block reason for the completion gate.
 *
 * @param {{ reasonCodes: string[], remediation: string[], detail: object }} result
 * @param {string} taskId
 * @returns {string}
 */
function buildCompletionBlockText(result, taskId) {
  const lines = [
    'Completion gate denied: task ' + taskId + ' lacks required completion evidence.',
    'Reason codes: ' + result.reasonCodes.join(', '),
  ];
  if (result.detail.missing.length > 0) {
    lines.push('Missing: ' + result.detail.missing.join(', '));
  }
  if (result.remediation.length > 0) {
    lines.push('Required remediation:');
    for (const step of result.remediation) lines.push('  - ' + step);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Inert below Level 5.
  if (getLevel(ROOT) < 5) return;

  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw.replace(/^﻿/, '')) : {};
  } catch {
    return; // malformed stdin - fail-open
  }

  // Anti-loop guard (Stop hooks can re-trigger each other).
  if (payload.stop_hook_active === true) return;

  const sessionId = resolveHookSessionId(payload, HOST);
  const ledger = await readLedger(sessionId);

  // Only gate tasks that have been registered by the contract hook.
  const taskId = ledger.activeTask;
  if (typeof taskId !== 'string' || taskId.length === 0) return;

  const contract = loadContract(ROOT, taskId);
  if (!contract) return; // no contract on disk - silent

  // Debounce: warn at most once per session to avoid Stop-loop noise.
  if (typeof ledger.completionWarnedAt === 'number') return;

  const branch = currentBranch(ROOT) ?? 'unknown';
  const scope = {
    branch,
    taskId,
    paths: contract.signals?.paths ?? [],
  };

  const config = await loadConfig(ROOT);
  const mode = resolveEnforcementMode(config);

  const result = evaluateCompletion({ contract, scope, mode, root: ROOT });

  // Silence rule: nothing to say - return immediately.
  if (result.reasonCodes.length === 0) return;

  // Mark BEFORE emitting to avoid re-entry if Claude stops again.
  ledger.completionWarnedAt = Date.now();
  await writeLedger(sessionId, ledger);

  if (mode === 'advisory' || result.decision !== 'deny') {
    process.stdout.write(buildAdvisoryText(result, taskId));
    return;
  }

  // Guarded / strict + deny -> block.
  emitBlockDecision(buildCompletionBlockText(result, taskId), HOST);
}

main().catch(() => process.exit(0));
