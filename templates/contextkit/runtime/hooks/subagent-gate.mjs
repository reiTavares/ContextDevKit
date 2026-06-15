#!/usr/bin/env node
/**
 * subagent-gate.mjs — Subagent governance gate (CDK-041, ADR-0072).
 *
 * Advisory-first, fail-open, inert-below-L5, silent-for-UNREGISTERED. Governs
 * spawned subagents in TWO moments. Claude Code has no `SubagentStart` event, so
 * the SPAWN moment rides a `PreToolUse` matcher on the `Task` tool (which launches
 * subagents); COMPLETION is the `SubagentStop` event.
 *
 *   1. SPAWN (PreToolUse on Task): derives the declared touch-set + label from
 *      tool_input, computes a deterministic spawnId (session + a persisted
 *      monotonic counter — NO Math.random/Date.now in the id), and records a spawn
 *      entry under the pipeline state substrate at
 *      <pipeline>/state/<taskId>/subagents/<spawnId>.json. NEVER blocks.
 *   2. COMPLETION (SubagentStop): loads the latest spawn record, gathers the
 *      subagent's best-effort observed touched paths from the ledger, and compares
 *      them (via the pure evaluate-subagent-scope.mjs) against declared + forbidden.
 *      WARNs on stdout on an out-of-scope / forbidden write.
 *
 * Anti-false-positive: unobservable writes → allow (skipped), NEVER a warn.
 * Advisory NEVER blocks; the deny path is wired for guarded/strict but inert in v1.
 * State lives in the pipeline state substrate (like receipt-store), NOT the ledger
 * — the ledger normalizer whitelists fields and would silently drop spawn records.
 * Zero runtime deps — node:* + sibling runtime modules only.
 */
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getLevel, loadConfig } from '../config/load.mjs';
import { loadContract } from '../execution/execution-contract.mjs';
import { resolveEnforcementMode } from '../execution/enforcement-modes.mjs';
import { evaluateSubagentScope } from '../execution/evaluate-subagent-scope.mjs';
import { readJsonSafe, writeFileAtomicSync } from './safe-io.mjs';
import { readLedger, writeLedger } from './ledger.mjs';
import { pathsFor } from '../config/paths.mjs';
import { emitBlockDecision, hookHost, resolveHookSessionId } from './host-adapter.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/** Reads hook stdin, resolving after `end` or a 500ms safety timeout. @returns {Promise<string>} */
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
// Spawn-record substrate (pipeline state, NOT the ledger)
// ---------------------------------------------------------------------------

/** Absolute dir holding a task's subagent spawn records. @param {string} root @param {string} taskId @returns {string} */
function subagentsDirFor(root, taskId) {
  return join(pathsFor(root).pipeline, 'state', String(taskId), 'subagents');
}

/**
 * Persists a spawn record atomically. spawnId is deterministic (session + counter)
 * so tests can predict the filename.
 * @param {string} root @param {string} taskId @param {string} spawnId @param {object} record
 */
function saveSpawnRecord(root, taskId, spawnId, record) {
  const dir = subagentsDirFor(root, taskId);
  mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(join(dir, `${spawnId}.json`), JSON.stringify(record, null, 2));
}

/**
 * Most recent spawn record for a task (highest createdAt, mtime tiebreak). Null when
 * none exist — never throws.
 * @param {string} root @param {string} taskId @returns {object|null}
 */
function loadLatestSpawnRecord(root, taskId) {
  const dir = subagentsDirFor(root, taskId);
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  let best = null;
  let bestKey = -1;
  for (const name of names) {
    const full = join(dir, name);
    const record = readJsonSafe(full, null);
    if (!record) continue;
    let mtime = 0;
    try { mtime = statSync(full).mtimeMs; } catch { /* best effort */ }
    const key = typeof record.createdAt === 'number' ? record.createdAt : mtime;
    if (key > bestKey) { bestKey = key; best = record; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Payload derivation
// ---------------------------------------------------------------------------

/** Active taskId from the ledger, or null when unregistered. @param {object} ledger @returns {string|null} */
function activeTaskFrom(ledger) {
  const taskId = ledger?.activeTask;
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
}

/**
 * Derives the subagent's DECLARED touch-set from a Task tool_input. Only an EXPLICIT
 * declaration (`touch_set` / `touchSet` / `paths`) is honoured — never free-text
 * prompts, which would fabricate false out-of-scope positives. None → [] (unobservable).
 * @param {Record<string, any>} input @returns {string[]}
 */
function deriveDeclaredTouchSet(input) {
  for (const key of ['touch_set', 'touchSet', 'paths']) {
    if (Array.isArray(input?.[key])) {
      return input[key].filter((p) => typeof p === 'string' && p.length > 0);
    }
  }
  return [];
}

/** Human label for the subagent. @param {Record<string, any>} input @returns {string} */
function deriveLabel(input) {
  if (typeof input?.subagent_type === 'string' && input.subagent_type) return input.subagent_type;
  if (typeof input?.description === 'string' && input.description) return input.description.slice(0, 60);
  return 'subagent';
}

/**
 * FORBIDDEN list: high-risk paths from config (`l5.highRiskPaths`) + the task
 * contract's signals.paths. Deduplicated.
 * @param {object} config @param {object|null} contract @returns {string[]}
 */
function buildForbiddenList(config, contract) {
  const highRisk = Array.isArray(config?.l5?.highRiskPaths) ? config.l5.highRiskPaths : [];
  const contractPaths = Array.isArray(contract?.signals?.paths) ? contract.signals.paths : [];
  return [...new Set([...highRisk, ...contractPaths].filter((p) => typeof p === 'string' && p.length > 0))];
}

/**
 * BEST-EFFORT observed touched paths: ledger `modifications` recorded at/after the
 * spawn createdAt — the only signal a Stop hook sees without a subagent transcript.
 * Empty → [] so the evaluator degrades to silence (no false positive).
 * @param {object} ledger @param {number} since spawn createdAt @returns {string[]}
 */
function observedTouchedPaths(ledger, since) {
  const mods = Array.isArray(ledger?.modifications) ? ledger.modifications : [];
  const out = [];
  for (const mod of mods) {
    if (typeof mod?.path !== 'string' || !mod.path) continue;
    const at = typeof mod.at === 'number' ? mod.at : 0;
    if (typeof since === 'number' && at > 0 && at < since) continue;
    out.push(mod.path);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Message builder (one body for advisory + deny; only the header differs)
// ---------------------------------------------------------------------------

/**
 * Formats the finding text. Advisory and deny share the body; `block` swaps the
 * lead line and the remediation header.
 * @param {object} result evaluateSubagentScope output
 * @param {string} label subagent label
 * @param {boolean} block true → deny-mode block reason, false → advisory note
 * @returns {string}
 */
function buildText(result, label, block) {
  const head = block
    ? `Subagent gate denied: subagent "${label}" wrote outside its governed scope.`
    : `[subagent-gate] Advisory: subagent "${label}" wrote outside its governed scope (no blocking in advisory mode).`;
  const lines = [head, `Reason codes: ${result.reasonCodes.join(', ')}`];
  if (result.detail.forbiddenHits.length > 0) lines.push(`Forbidden writes: ${result.detail.forbiddenHits.join(', ')}`);
  if (result.detail.outOfScope.length > 0) lines.push(`Out-of-scope writes: ${result.detail.outOfScope.join(', ')}`);
  if (result.remediation.length > 0) {
    lines.push(block ? 'Required remediation:' : 'Remediation:');
    for (const step of result.remediation) lines.push(`  - ${step}`);
  }
  return lines.join('\n') + (block ? '' : '\n');
}

// ---------------------------------------------------------------------------
// Moment handlers
// ---------------------------------------------------------------------------

/**
 * SPAWN moment (PreToolUse on Task): records a deterministic spawn entry. NEVER
 * blocks — recording scope is not a finding, so it stays silent.
 * @param {object} payload @param {string} taskId @param {object} config @param {object|null} contract
 */
async function handleSpawn(payload, taskId, config, contract) {
  const input = payload?.tool_input ?? {};
  const sessionId = resolveHookSessionId(payload, HOST, ROOT);

  // Deterministic spawnId: session + a persisted monotonic counter (NO time/random).
  const ledger = await readLedger(sessionId);
  const nextIndex = (typeof ledger.subagentSpawnCounter === 'number' ? ledger.subagentSpawnCounter : 0) + 1;
  ledger.subagentSpawnCounter = nextIndex;
  await writeLedger(sessionId, ledger);

  const safeSession = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  const spawnId = `${safeSession}-${nextIndex}`;
  saveSpawnRecord(ROOT, taskId, spawnId, {
    version: 1,
    spawnId,
    taskId,
    sessionId,
    label: deriveLabel(input),
    declared: deriveDeclaredTouchSet(input),
    forbidden: buildForbiddenList(config, contract),
    createdAt: Date.now(),
  });
}

/**
 * COMPLETION moment (SubagentStop): compares observed writes against the latest
 * spawn record's declared + forbidden lists. Warns (advisory) or blocks
 * (guarded/strict + deny). Silent when there is nothing to say.
 * @param {string} taskId @param {object} ledger @param {string} mode
 */
function handleCompletion(taskId, ledger, mode) {
  const record = loadLatestSpawnRecord(ROOT, taskId);
  if (!record) return; // no spawn observed → silent

  const result = evaluateSubagentScope({
    declared: record.declared,
    touched: observedTouchedPaths(ledger, record.createdAt),
    forbidden: record.forbidden,
    mode,
  });
  if (result.reasonCodes.length === 0) return; // silence rule

  const label = typeof record.label === 'string' ? record.label : 'subagent';
  if (mode === 'advisory' || result.decision !== 'deny') {
    process.stdout.write(buildText(result, label, false));
    return;
  }
  emitBlockDecision(buildText(result, label, true), HOST);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (getLevel(ROOT) < 5) return; // inert below L5

  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw.replace(/^﻿/, '')) : {};
  } catch {
    return; // malformed stdin → fail-open
  }

  // Identify the moment: SubagentStop carries hook_event_name; spawn is PreToolUse on Task.
  const eventName = typeof payload?.hook_event_name === 'string' ? payload.hook_event_name : '';
  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
  const isCompletion = eventName === 'SubagentStop';
  const isSpawn = toolName === 'Task';
  if (!isCompletion && !isSpawn) return; // not our moment → silent

  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const ledger = await readLedger(sessionId);

  const taskId = activeTaskFrom(ledger);
  if (!taskId) return; // UNREGISTERED → silent

  const config = await loadConfig(ROOT);
  const contract = loadContract(ROOT, taskId); // may be null; spawn still records forbidden defaults

  if (isSpawn) {
    await handleSpawn(payload, taskId, config, contract);
    return;
  }
  handleCompletion(taskId, ledger, resolveEnforcementMode(config));
}

main().catch(() => process.exit(0));
