#!/usr/bin/env node
/**
 * swarm-state — run-manifest I/O for the swarm coordinator (ADR-0051 §2).
 *
 * One manifest per run at `.claude/.swarm/<runId>.json`:
 *   { runId, startedAt, grade, configSnapshot, workstreams: [{ id, taskId,
 *     branch, worktree, touchSet, status, heartbeatTs, deliberationId,
 *     model, tokens, history: [{ ts, status, note? }] }] }
 *
 * `model` is the cost-tier alias the coordinator actually dispatched on
 * (ADR-0052 Phase 2 — resolved via `model-policy.mjs`); null until dispatched.
 * The report aggregates it into a per-model breakdown so a fan-out's true tier
 * mix (and cost) is auditable, not assumed.
 *
 * Contracts: atomic writes (tmp + rename via safe-io); per-workstream `history`
 * is APPEND-ONLY (mirrors the ADR-0043 events idiom); unknown statuses throw
 * (refuse-by-default); corrupt manifests read as null, never throw.
 *
 * Library + thin CLI:
 *   node swarm-state.mjs show <runId> | list | evict <runId> | report <runId>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

export const WS_STATUSES = Object.freeze([
  'planned', 'dispatched', 'working', 'qa', 'parked-testing', 'parked-budget', 'failed', 'evicted',
]);
/** Statuses still consuming a worktree — eligible for stale eviction. */
const ACTIVE_WS_STATUSES = new Set(['dispatched', 'working', 'qa']);

const swarmDir = (root) => resolve(root, '.claude', '.swarm');
export const manifestPath = (root, runId) => join(swarmDir(root), `${String(runId).replace(/[^a-z0-9-]/gi, '-')}.json`);

/** Reads a run manifest — null when missing or corrupt (never throws). */
export function readRun(root, runId) {
  const file = manifestPath(root, runId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch {
    process.stderr.write(`[swarm-state] corrupt manifest: ${file}\n`);
    return null;
  }
}

function writeRun(root, run) {
  mkdirSync(swarmDir(root), { recursive: true });
  writeFileAtomicSync(manifestPath(root, run.runId), JSON.stringify(run, null, 2));
  return run;
}

/**
 * Creates a new run manifest from a plan. Every workstream starts `planned`.
 * Throws if the run already exists (a runId is single-use) or the plan is empty.
 *
 * @param {string} root
 * @param {{ runId: string, grade: number, configSnapshot?: object,
 *           workstreams: Array<{ id: string, taskId: string, branch: string, worktree: string, touchSet: string[] }> }} plan
 */
export function createRun(root, plan) {
  if (!plan?.runId) throw new Error('swarm-state: plan.runId is required');
  if (!Array.isArray(plan.workstreams) || plan.workstreams.length === 0) throw new Error('swarm-state: plan has no workstreams');
  if (readRun(root, plan.runId)) throw new Error(`swarm-state: run "${plan.runId}" already exists — runIds are single-use`);
  const now = Date.now();
  const run = {
    runId: String(plan.runId),
    startedAt: now,
    grade: Number(plan.grade) || 2,
    configSnapshot: plan.configSnapshot ?? {},
    workstreams: plan.workstreams.map((ws) => ({
      id: String(ws.id),
      taskId: String(ws.taskId),
      branch: String(ws.branch),
      worktree: String(ws.worktree),
      touchSet: Array.isArray(ws.touchSet) ? ws.touchSet.map(String) : [],
      status: 'planned',
      heartbeatTs: now,
      deliberationId: null,
      model: ws.model ? String(ws.model) : null,
      tokens: 0,
      history: [{ ts: now, status: 'planned' }],
    })),
  };
  return writeRun(root, run);
}

/**
 * Patches one workstream. `status` must be a known value; the change is also
 * appended to `history` (append-only — past entries are never rewritten).
 * Any patch renews the workstream heartbeat.
 *
 * @param {string} root
 * @param {string} runId
 * @param {string} wsId
 * @param {{ status?: string, tokens?: number, model?: string, deliberationId?: string, note?: string }} patch
 */
export function updateWorkstream(root, runId, wsId, patch = {}) {
  const run = readRun(root, runId);
  if (!run) throw new Error(`swarm-state: run "${runId}" not found`);
  const workstream = run.workstreams.find((ws) => ws.id === String(wsId));
  if (!workstream) throw new Error(`swarm-state: workstream "${wsId}" not in run "${runId}"`);
  if (patch.status != null) {
    if (!WS_STATUSES.includes(patch.status)) throw new Error(`swarm-state: invalid status "${patch.status}" — one of ${WS_STATUSES.join(', ')}`);
    workstream.status = patch.status;
    const entry = { ts: Date.now(), status: patch.status };
    if (patch.note) entry.note = String(patch.note).slice(0, 300);
    workstream.history = [...(workstream.history ?? []), entry];
  }
  if (typeof patch.tokens === 'number' && patch.tokens >= 0) workstream.tokens = patch.tokens;
  if (patch.model != null) workstream.model = String(patch.model);
  if (patch.deliberationId != null) workstream.deliberationId = String(patch.deliberationId);
  workstream.heartbeatTs = Date.now();
  return writeRun(root, run);
}

/**
 * Marks active workstreams silent for > staleMinutes as `evicted` (the
 * worktree is PRESERVED for forensics — only `/swarm clean` removes it).
 * Returns the evicted workstream ids.
 */
export function evictStale(root, runId, staleMinutes = 30) {
  const run = readRun(root, runId);
  if (!run) return [];
  const cutoff = Date.now() - staleMinutes * 60 * 1000;
  const evicted = [];
  for (const workstream of run.workstreams) {
    if (!ACTIVE_WS_STATUSES.has(workstream.status) || workstream.heartbeatTs >= cutoff) continue;
    workstream.status = 'evicted';
    workstream.history = [...(workstream.history ?? []), { ts: Date.now(), status: 'evicted', note: `stale > ${staleMinutes}min` }];
    evicted.push(workstream.id);
  }
  if (evicted.length > 0) writeRun(root, run);
  return evicted;
}

/** Lists every run manifest under `.claude/.swarm/`, newest first. */
export function listRuns(root) {
  const dir = swarmDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readRun(root, file.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

/** Total subagent tokens recorded across a run's workstreams. */
export const runTokens = (run) => (run?.workstreams ?? []).reduce((sum, ws) => sum + (ws.tokens || 0), 0);

/**
 * Per-model fan-out breakdown (ADR-0052 Phase 2 byModel attribution): how many
 * workstreams ran on each cost tier and how many subagent tokens each burned.
 * Answers "were all N agents on opus?" with data, not assumption. A workstream
 * dispatched before the model was recorded buckets under `unknown`.
 *
 * @returns {Array<{ model: string, count: number, tokens: number }>}
 */
export function byModel(run) {
  const buckets = new Map();
  for (const ws of run?.workstreams ?? []) {
    const key = ws.model || 'unknown';
    const cur = buckets.get(key) || { model: key, count: 0, tokens: 0 };
    cur.count += 1;
    cur.tokens += ws.tokens || 0;
    buckets.set(key, cur);
  }
  return [...buckets.values()].sort((a, b) => b.tokens - a.tokens || b.count - a.count);
}

/** Human run report — the /swarm review input. */
export function renderReport(run) {
  if (!run) return 'swarm-state: no such run';
  const lines = [`🐝 Swarm run ${run.runId} — grade ${run.grade}, ${run.workstreams.length} workstream(s), ${runTokens(run)} subagent tokens`];
  for (const ws of run.workstreams) {
    lines.push(`  [${ws.status}] ${ws.id} → task ${ws.taskId} on ${ws.branch} (${ws.model || 'model:?'}, ${ws.tokens || 0} tok)${ws.deliberationId ? ` quorum:${ws.deliberationId}` : ''}`);
  }
  const tiers = byModel(run);
  if (tiers.length > 0) {
    lines.push(`  models: ${tiers.map((t) => `${t.model} ×${t.count} (${t.tokens} tok)`).join(' · ')}`);
  }
  const parked = run.workstreams.filter((ws) => ws.status === 'parked-testing');
  if (parked.length > 0) lines.push(`  → ${parked.length} workstream(s) parked at testing — human review/merge pending (/swarm review).`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- thin CLI
const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('swarm-state.mjs');
if (isMain) {
  const [verb, runId] = process.argv.slice(2);
  const root = process.cwd();
  if (verb === 'show') console.log(JSON.stringify(readRun(root, runId), null, 2));
  else if (verb === 'report') console.log(renderReport(readRun(root, runId)));
  else if (verb === 'list') for (const run of listRuns(root)) console.log(renderReport(run));
  else if (verb === 'evict') console.log(JSON.stringify(evictStale(root, runId)));
  else {
    console.error('Usage: swarm-state.mjs <show|report|list|evict> [runId]');
    process.exit(1);
  }
}
