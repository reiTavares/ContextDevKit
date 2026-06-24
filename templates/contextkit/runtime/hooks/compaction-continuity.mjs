#!/usr/bin/env node
/**
 * compaction-continuity.mjs — PreCompact + SessionStart compaction-resume hook
 * (CDK-042, ADR-0072).
 *
 * Handles TWO moments under one file, branching on `payload.hook_event_name`:
 *
 *   PreCompact
 *     If an active task with a contract on disk exists, persists a durable
 *     continuity record to the pipeline state substrate at
 *     `<pipeline>/state/<taskId>/compaction.json`. Metadata only; no prompt
 *     or source bytes. One short advisory line emitted; NEVER blocks.
 *
 *   SessionStart (compact/resume source)
 *     If a continuity record + active contract exist, re-surfaces a short
 *     advisory summary so the post-compaction agent regains the governance
 *     thread. Satisfied obligations are suppressed (computed from receipts);
 *     only still-outstanding ones are surfaced. Silent when no active task
 *     or no continuity record on disk.
 *
 * Key invariants (must never change without a new ADR):
 *   - Inert below Level 5: exits 0 immediately.
 *   - Silent when no active task OR no contract: exits 0.
 *   - NEVER blocks (always exits 0 — immutable rule 2).
 *   - Metadata only: no file content or prompt text stored (ADR-0072 §9).
 *   - Fail-open: any unhandled error exits 0 silently.
 *   - UNREGISTERED (advisory-only): not wired into settings-compose yet;
 *     activation is gated on the PKG-04 settings-compose pass.
 *
 * Zero runtime deps — node:* + sibling runtime modules only.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getLevel } from '../config/load.mjs';
import { loadContract } from '../execution/execution-contract.mjs';
import { readReceipts } from '../execution/receipt-store.mjs';
import { writeFileAtomicSync, readJsonSafe } from './safe-io.mjs';
import { readLedger } from './ledger.mjs';
import { emitAdvisory, hookHost, resolveHookSessionId } from './host-adapter.mjs';
import { pathsFor } from '../config/paths.mjs';
import { summarizeObligations } from '../execution/compaction-continuity-core.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

// ---------------------------------------------------------------------------
// stdin helper (shared pattern from completion-gate.mjs)
// ---------------------------------------------------------------------------

/**
 * Reads all of stdin into a string. Resolves on 'end' or after 500 ms.
 * @returns {Promise<string>}
 */
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
// Continuity record path
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path of a task's compaction continuity record.
 * Stored in the pipeline state substrate alongside execution-contract.json.
 *
 * @param {string} root project root
 * @param {string} taskId task identifier
 * @returns {string}
 */
function continuityPathFor(root, taskId) {
  return join(pathsFor(root).pipeline, 'state', String(taskId), 'compaction.json');
}

// ---------------------------------------------------------------------------
// PreCompact handler
// ---------------------------------------------------------------------------

/**
 * Handles the PreCompact event.
 *
 * Reads the active task from the session ledger; if a contract exists on disk,
 * writes a continuity record (metadata only) to the pipeline state substrate
 * and emits a single advisory line.
 *
 * @param {string} sessionId resolved session id
 * @returns {Promise<void>}
 */
async function handlePreCompact(sessionId) {
  const ledger = await readLedger(sessionId);
  const taskId = ledger.activeTask;
  if (typeof taskId !== 'string' || taskId.length === 0) return;

  const contract = loadContract(ROOT, taskId);
  if (!contract) return;

  const record = {
    taskId,
    savedAt: Date.now(),
    obligations: {
      requiredBeforeWrite: Array.isArray(contract.requiredBeforeWrite)
        ? [...contract.requiredBeforeWrite]
        : [],
      requiredBeforeCompletion: Array.isArray(contract.requiredBeforeCompletion)
        ? [...contract.requiredBeforeCompletion]
        : [],
    },
    summary: buildRecordSummary(contract),
  };

  const stateDir = join(pathsFor(ROOT).pipeline, 'state', String(taskId));
  mkdirSync(stateDir, { recursive: true });
  writeFileAtomicSync(continuityPathFor(ROOT, taskId), JSON.stringify(record, null, 2));

  emitAdvisory(
    `[compaction-continuity] Context compacting — task ${taskId} continuity record saved.\n`,
    HOST,
    'PreCompact',
  );
}

// ---------------------------------------------------------------------------
// SessionStart (compact/resume) handler
// ---------------------------------------------------------------------------

/**
 * Handles a SessionStart whose source signals a post-compaction resume.
 *
 * Looks for an active task in the ledger with both a continuity record AND a
 * contract. Computes outstanding (unsatisfied) obligations and re-surfaces a
 * short advisory so the resumed agent regains the governance thread.
 *
 * @param {string} sessionId resolved session id
 * @param {object} payload raw hook payload
 * @returns {Promise<void>}
 */
async function handleSessionStart(sessionId, payload) {
  // Detect compact/resume source. Claude Code may set payload.source to
  // 'compact' or 'resume' on post-compaction starts. Fall back to checking
  // payload.hook_event_name only (session-start.mjs pattern) if absent.
  const source = typeof payload.source === 'string' ? payload.source : null;
  const isCompactSource = source === 'compact' || source === 'resume';
  if (!isCompactSource) return; // ordinary SessionStart — not a resume

  const ledger = await readLedger(sessionId);
  const taskId = ledger.activeTask;
  if (typeof taskId !== 'string' || taskId.length === 0) return;

  const record = readJsonSafe(continuityPathFor(ROOT, taskId), null);
  if (!record) return; // no compaction record on disk

  const contract = loadContract(ROOT, taskId);
  if (!contract) return; // contract gone — nothing useful to surface

  const receipts = readReceipts(ROOT, taskId);
  const scope = {
    branch: contract.branch ?? 'unknown',
    taskId,
    paths: contract.signals?.paths ?? [],
  };

  const outstanding = summarizeObligations({ contract, receipts, scope, now: Date.now() });

  if (outstanding.length === 0) return; // all obligations satisfied — silent

  const lines = [
    `[compaction-continuity] Session resumed after compaction. Active task: ${taskId}`,
    `  Still required before write: ${
      outstanding.filter((o) => o.moment === 'beforeWrite').map((o) => o.capability).join(', ') || 'none'
    }`,
    `  Still required before completion: ${
      outstanding.filter((o) => o.moment === 'beforeCompletion').map((o) => o.capability).join(', ') || 'none'
    }`,
    `  Context snapshot: "${record.summary}"`,
  ];
  emitAdvisory(lines.join('\n') + '\n', HOST, 'SessionStart');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a one-line human summary for the continuity record.
 * Keeps it short (metadata-only; no file content — ADR-0072 §9).
 *
 * @param {object} contract execution contract
 * @returns {string}
 */
function buildRecordSummary(contract) {
  const writeCount = (contract.requiredBeforeWrite ?? []).length;
  const completionCount = (contract.requiredBeforeCompletion ?? []).length;
  const tier = contract.signals?.tier ?? 'unknown';
  return `${tier} task; ${writeCount} write gates, ${completionCount} completion gates pending`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (getLevel(ROOT) < 5) return; // inert below Level 5

  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw.replace(/^﻿/, '')) : {};
  } catch {
    return; // malformed stdin — fail-open
  }

  const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';
  const sessionId = resolveHookSessionId(payload, HOST);

  if (event === 'PreCompact') {
    await handlePreCompact(sessionId);
    return;
  }

  if (event === 'SessionStart') {
    await handleSessionStart(sessionId, payload);
    return;
  }

  // Unknown event — silent (fail-open).
}

main().catch(() => process.exit(0));
