#!/usr/bin/env node
/**
 * domain-conformance.mjs — PostToolUse hook: the Domain Engineering conformance
 * reconciler (ADR-0128 §19; WF-0067). After each write, reconciles the real path
 * (and any changed contracts) against the governing Implementation Packet's
 * declared touch-set via the PURE `reconcileWrite`, then records the deviation and
 * — in guarded/strict — arms a next-write block for a high-risk drift.
 *
 * WIRED (WF-0068): registered as a PostToolUse hook at L≥4 in settings-compose +
 * the Codex/Antigravity composers. It stays inert unless `domainEngineering.enabled`
 * (default false). PostToolUse cannot retroactively block the write that already
 * happened — the low/medium verdicts RECORD a deviation (advisory) and a high
 * verdict WARNS + records intent to block the NEXT write (the actual next-write
 * block is the PreToolUse `domain-code-gate.mjs`, now wired alongside it).
 *
 * Fail-open (immutable rule 2): every error exits 0 silently. Inert below Level 4.
 *
 * @module hooks/domain-conformance
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLevel, loadConfig } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';
import { emitAdvisory, hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';
import { readLedger, toRepoRelative } from './ledger.mjs';
import { resolveConfig } from '../domain-engineering/config.mjs';
import { resolveDomainMode } from '../domain-engineering/code-gate.mjs';
import { reconcileWrite } from '../domain-engineering/conformance.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/** Reads stdin to exhaustion with a short timeout guard. */
async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/** Best-effort read of the governing Implementation Packet for the active task. */
function readPacket(root, taskId) {
  if (!taskId) return null;
  try {
    const file = join(pathsFor(root).pipeline, 'state', String(taskId), 'implementation-packet.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

async function main() {
  if (getLevel(ROOT) < 4) return; // Inert below Level 4.

  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return;
  }

  const config = await loadConfig(ROOT);
  const deConfig = resolveConfig(config?.domainEngineering);
  if (deConfig.enabled !== true) return; // default-OFF: inert.

  const mode = resolveDomainMode(getLevel(ROOT), deConfig);
  if (mode === 'shadow') return; // record-only: emits nothing visible.

  const { filePaths } = normalizeToolPayload(payload);
  const targetPath = Array.isArray(filePaths) && filePaths.length > 0 ? toRepoRelative(filePaths[0]) : null;
  if (!targetPath) return;

  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const ledger = await readLedger(sessionId);
  const packet = readPacket(ROOT, ledger?.activeTask ?? null);
  if (!packet) return; // no packet to reconcile against → silent (never a false positive).

  const reconciliation = reconcileWrite({ path: targetPath, packet, contractsChanged: [] });
  if (reconciliation.drift.length === 0) return; // within touch-set → silent.

  // advisory always; guarded/strict surface the higher-risk drift with intent to
  // block the NEXT write. PostToolUse never blocks the write that already landed.
  emitAdvisory(buildText(reconciliation, targetPath), HOST, 'PostToolUse');
}

/** Formats the deviation advisory. */
function buildText(reconciliation, targetPath) {
  const lines = [
    `[domain-conformance] ${targetPath}: ${reconciliation.action} (risk=${reconciliation.riskBand}).`,
    `Drift: ${reconciliation.drift.join(', ')}`,
  ];
  if (reconciliation.action === 'require-packet-update') {
    lines.push('Update the Implementation Packet touch-set to cover this path, or revert the out-of-scope write.');
  } else if (reconciliation.action === 'block-next-write') {
    lines.push('High-risk drift — the next code write will be gated until the packet/contract is re-evaluated.');
  }
  return lines.join('\n') + '\n';
}

main().catch(() => process.exit(0));
