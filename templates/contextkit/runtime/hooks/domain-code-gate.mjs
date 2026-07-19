#!/usr/bin/env node
/**
 * domain-code-gate.mjs — PreToolUse hook: the Domain Engineering code gate
 * (ADR-0128 §16, §5; WF-0067). Thin I/O glue over the PURE `evaluateCodeGate`
 * (runtime/domain-engineering/code-gate.mjs): it resolves the effective mode,
 * builds the §15 implementation block WITH the write-attempt trigger (the
 * authoritative CMIS=100), classifies the target path and checks the deterministic
 * requirements' presence — then maps the two-axis verdict onto the host block/warn
 * surface.
 *
 * WIRED (WF-0068): registered as a PreToolUse hook at L≥4 in settings-compose +
 * the Codex/Antigravity composers (the activation-rollout owner drives the
 * shadow→advisory→guarded→strict ladder via `enforcement.rolloutStage`). It stays
 * inert unless `domainEngineering.enabled` (default false): a disabled or shadow
 * mode records nothing and exits 0 — so it never fires on an existing install until
 * a project opts in.
 *
 * Fail-open (immutable rule 2): every error exits 0 silently — a broken gate
 * MUST NEVER block real work. Inert below Level 4.
 *
 * @module hooks/domain-code-gate
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getLevel, loadConfig } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';
import { emitAdvisory, emitBlockDecision, hookHost, normalizeToolPayload, resolveHookSessionId } from './host-adapter.mjs';
import { readLedger } from './ledger.mjs';
import { resolveConfig } from '../domain-engineering/config.mjs';
import { evaluateCodeGate, resolveDomainMode } from '../domain-engineering/code-gate.mjs';
import { buildImplementationBlock } from '../domain-engineering/envelope-block.mjs';
import { classifyPath } from '../domain-engineering/path-classify.mjs';
import { loadPolicyTable } from '../domain-engineering/policy-load.mjs';
import { readSpawnRecords, dispatchedAgents } from '../domain-engineering/spawn-record.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/** Tools that constitute a real code-write attempt (the §5 authoritative trigger). */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

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

/**
 * Best-effort presence check for the governing Implementation Packet. In the
 * default-OFF / shadow posture the result never blocks (evaluateCodeGate returns
 * ALLOW in shadow), so an absent packet degrades to `false` safely. WF-0068
 * refines the exact store path during activation.
 */
function packetPresentFor(root, taskId) {
  if (!taskId) return false;
  try {
    const dir = join(pathsFor(root).pipeline, 'state', String(taskId));
    return existsSync(join(dir, 'implementation-packet.json'));
  } catch {
    return false;
  }
}

/** Best-effort simulate-impact receipt presence (mirrors the L5 simulate-gate ledger record). */
function simulateImpactPresent(ledger, path) {
  try {
    const sims = Array.isArray(ledger?.simulations) ? ledger.simulations : [];
    return sims.some((s) => Array.isArray(s?.coveredPaths) && s.coveredPaths.some((p) => path && String(path).includes(p)));
  } catch {
    return false;
  }
}

/**
 * ADR-0142 (WF-0075) — the pre-write DISPATCH evidence. Reuses the existing spawn-record
 * substrate (no new evidence module): every agent named in `block.requiredAgents` must
 * have a real spawn record under <pipeline>/state/<taskId>/subagents/. Returns `true`
 * (satisfied) when there are no required agents, when the read degrades, or when every
 * required agent is dispatched — fail-open so an unreadable substrate never false-blocks.
 * @param {string} root project root.
 * @param {string|null} taskId governing task id.
 * @param {object} block the §15 implementation block.
 * @returns {boolean} true when the profile-required squad is dispatched (or the check is inert).
 */
export function requiredAgentsDispatchedFor(root, taskId, block) {
  try {
    const required = block && Array.isArray(block.requiredAgents) ? block.requiredAgents : [];
    if (required.length === 0 || !taskId) return true; // nothing to require → inert.
    const dispatched = new Set(dispatchedAgents(readSpawnRecords(root, taskId)));
    return required.every((agent) => dispatched.has(agent));
  } catch {
    return true; // fail-open: an unreadable substrate never false-blocks.
  }
}

/**
 * True when THIS PreToolUse fires inside a dispatched subagent's call (the Claude Code
 * `agent_id` hook field, present only in a subagent context). The anti-deadlock seam
 * (ADR-0142): a dispatched leaf-worker IS the fulfilment of the dispatch requirement,
 * never subject to it — only the main/orchestrator write is gated. Defensive `typeof`
 * so a malformed payload never throws.
 * @param {object} payload the raw hook payload.
 * @returns {boolean}
 */
export function isDispatchedSubagentCall(payload) {
  return typeof payload?.agent_id === 'string' && payload.agent_id.length > 0;
}

async function main() {
  if (getLevel(ROOT) < 4) return; // Inert below Level 4 (advisory floor).

  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return; // malformed stdin → fail-open
  }

  const config = await loadConfig(ROOT);
  const deConfig = resolveConfig(config?.domainEngineering);
  if (deConfig.enabled !== true) return; // default-OFF: inert.

  const { toolName, filePaths } = normalizeToolPayload(payload);
  if (!toolName) return;
  const writeAttempt = WRITE_TOOLS.has(toolName);
  const targetPath = Array.isArray(filePaths) && filePaths.length > 0 ? filePaths[0] : null;

  const mode = resolveDomainMode(getLevel(ROOT), deConfig);
  if (mode === 'shadow') return; // record-only posture emits nothing.

  // Classify the path (fail-open: a degraded rules table → unknown → ASK, never block).
  const pathRules = loadPolicyTable(ROOT, 'pathRules').table;
  const { pathClass, hardExcluded } = targetPath
    ? classifyPath(targetPath, pathRules)
    : { pathClass: 'unknown', hardExcluded: false };

  // Build the §15 block WITH the write trigger — the authoritative CMIS=100 rides in here.
  const block = buildImplementationBlock({ root: ROOT, writeAttempt, tool: toolName });

  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const ledger = await readLedger(sessionId);
  const taskId = ledger?.activeTask ?? null;

  // ADR-0142 subagent-exemption seam: a dispatched leaf-worker's write is the FULFILMENT
  // of the dispatch requirement, never subject to it (anti-deadlock) → treat as dispatched.
  const requiredAgentsDispatched = isDispatchedSubagentCall(payload)
    ? true
    : requiredAgentsDispatchedFor(ROOT, taskId, block);

  const verdict = evaluateCodeGate({
    block,
    pathClass,
    hardExcluded,
    mode,
    riskBand: riskBandFrom(block),
    writeAttempt,
    packetPresent: packetPresentFor(ROOT, taskId),
    simulateImpactPresent: simulateImpactPresent(ledger, targetPath),
    ownerPresent: !!taskId,
    degradedInput: !!(block && block.degraded),
    requiredAgentsDispatched,
  });

  if (verdict.enforcement === 'BLOCK') {
    emitBlockDecision(buildBlockText(verdict, toolName, targetPath), HOST);
    return;
  }
  if (verdict.enforcement === 'WARN' || verdict.enforcement === 'ASK') {
    emitAdvisory(buildAdvisoryText(verdict, toolName), HOST, 'PreToolUse');
  }
  // ALLOW / DEGRADED (fail-open receipt) → silent exit 0.
}

/** Coarse risk band from the block's profile (guarded blocks medium/high only). */
function riskBandFrom(block) {
  const profile = block && typeof block.profile === 'string' ? block.profile : 'no-code';
  if (profile === 'domain-driven' || profile === 'distributed-domain') return 'high';
  if (profile === 'modular') return 'medium';
  return 'low';
}

/** Formats the deny-mode block reason, always naming the corrective command (§16). */
function buildBlockText(verdict, toolName, targetPath) {
  const lines = [
    `🛑 Domain code gate — ${toolName}${targetPath ? ` on ${targetPath}` : ''}`,
    `Missing deterministic requirement(s): ${verdict.missing.join(', ')}`,
  ];
  if (verdict.corrective.length > 0) {
    lines.push('Required next step — pick ONE:');
    for (const step of verdict.corrective) lines.push(`  • ${step}`);
  }
  return lines.join('\n');
}

/** Formats an advisory nudge (WARN/ASK) — never blocks. */
function buildAdvisoryText(verdict, toolName) {
  const lines = [`[domain-code-gate] Advisory: ${toolName} — ${verdict.reasonCodes.join(', ')}.`];
  for (const step of verdict.corrective) lines.push(`  • ${step}`);
  return lines.join('\n') + '\n';
}

main().catch(() => process.exit(0));
