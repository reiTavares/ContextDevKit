#!/usr/bin/env node
/**
 * Optional swarm result reports.
 *
 * Reports are written only when a controller explicitly creates a run. They are
 * host-neutral diagnostics, not task state, dispatch authority, or a required
 * receipt. Canonical task transitions remain in the selected tasks.json store.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

export const WS_STATUSES = Object.freeze(['planned', 'running', 'completed', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['running']);

/** @param {string} root @returns {string} */
const swarmReportDirectory = (root) => join(pathsFor(root).memory, 'reports', 'swarm');

/** @param {string} root @param {string} runId @returns {string} */
export const manifestPath = (root, runId) => join(
  swarmReportDirectory(root),
  `${String(runId).replace(/[^a-z0-9-]/gi, '-')}.json`,
);

/** @param {string} root @param {string} runId @returns {object|null} */
export function readRun(root, runId) {
  const file = manifestPath(root, runId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    process.stderr.write(`[swarm-state] corrupt optional report: ${file}\n`);
    return null;
  }
}

/** @param {string} root @param {object} report @returns {object} */
function writeRun(root, report) {
  mkdirSync(swarmReportDirectory(root), { recursive: true });
  writeFileAtomicSync(manifestPath(root, report.runId), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/**
 * Creates an optional report from an accepted plan.
 *
 * @param {string} root
 * @param {{runId:string,workstreams:object[]}} plan
 * @param {{now?:number}} options
 * @returns {object}
 */
export function createRun(root, plan, options = {}) {
  if (!plan?.runId) throw new Error('swarm-state: plan.runId is required');
  if (!Array.isArray(plan.workstreams) || plan.workstreams.length === 0) {
    throw new Error('swarm-state: plan has no workstreams');
  }
  if (readRun(root, plan.runId)) throw new Error(`swarm-state: report "${plan.runId}" already exists`);
  const now = options.now ?? Date.now();
  return writeRun(root, {
    schemaVersion: 1,
    runId: String(plan.runId),
    createdAt: now,
    updatedAt: now,
    workstreams: plan.workstreams.map((workstream) => ({
      id: String(workstream.id),
      taskId: String(workstream.taskId),
      branch: String(workstream.branch ?? ''),
      worktree: String(workstream.worktree ?? ''),
      touchSet: Array.isArray(workstream.touchSet) ? workstream.touchSet.map(String) : [],
      status: 'planned',
      updatedAt: now,
      note: null,
      model: null,
      effort: null,
      tokens: null,
    })),
  });
}

/**
 * Updates one optional workstream report. Model/token data is observational and
 * may remain null; no caller may use it as an admission condition.
 *
 * @param {string} root
 * @param {string} runId
 * @param {string} workstreamId
 * @param {{status?:string,tokens?:number,model?:string,effort?:string,note?:string,now?:number}} patch
 * @returns {object}
 */
export function updateWorkstream(root, runId, workstreamId, patch = {}) {
  const report = readRun(root, runId);
  if (!report) throw new Error(`swarm-state: report "${runId}" not found`);
  const workstream = report.workstreams.find((entry) => entry.id === String(workstreamId));
  if (!workstream) throw new Error(`swarm-state: workstream "${workstreamId}" not found`);
  if (patch.status != null && !WS_STATUSES.includes(patch.status)) {
    throw new Error(`swarm-state: invalid status "${patch.status}"`);
  }
  if (patch.status != null) workstream.status = patch.status;
  if (patch.tokens != null) {
    if (!Number.isFinite(patch.tokens) || patch.tokens < 0) throw new TypeError('swarm-state: tokens must be non-negative');
    workstream.tokens = patch.tokens;
  }
  if (patch.model != null) workstream.model = String(patch.model);
  if (patch.effort != null) workstream.effort = String(patch.effort);
  if (patch.note != null) workstream.note = String(patch.note).slice(0, 300);
  const now = patch.now ?? Date.now();
  workstream.updatedAt = now;
  report.updatedAt = now;
  return writeRun(root, report);
}

/**
 * Marks stale running reports failed without touching their branches/worktrees.
 *
 * @param {string} root
 * @param {string} runId
 * @param {number} staleMinutes
 * @param {{now?:number}} options
 * @returns {string[]}
 */
export function evictStale(root, runId, staleMinutes = 30, options = {}) {
  const report = readRun(root, runId);
  if (!report) return [];
  const now = options.now ?? Date.now();
  const cutoff = now - staleMinutes * 60 * 1000;
  const stale = [];
  for (const workstream of report.workstreams) {
    if (!ACTIVE_STATUSES.has(workstream.status) || workstream.updatedAt >= cutoff) continue;
    workstream.status = 'failed';
    workstream.note = `stale for more than ${staleMinutes} minutes`;
    workstream.updatedAt = now;
    stale.push(workstream.id);
  }
  if (stale.length > 0) {
    report.updatedAt = now;
    writeRun(root, report);
  }
  return stale;
}

/** @param {string} root @returns {object[]} */
export function listRuns(root) {
  const directory = swarmReportDirectory(root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readRun(root, file.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
}

/** @param {object|null} report @returns {number} */
export const runTokens = (report) => (report?.workstreams ?? []).reduce(
  (total, workstream) => total + (Number.isFinite(workstream.tokens) ? workstream.tokens : 0),
  0,
);

/** @param {object|null} report @returns {object[]} */
export function byModel(report) {
  const buckets = new Map();
  for (const workstream of report?.workstreams ?? []) {
    const key = workstream.model ?? 'unreported';
    const bucket = buckets.get(key) ?? { model: key, count: 0, tokens: 0 };
    bucket.count += 1;
    bucket.tokens += Number.isFinite(workstream.tokens) ? workstream.tokens : 0;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}

/** @param {object|null} report @returns {object[]} */
export function byDispatch(report) {
  const buckets = new Map();
  for (const workstream of report?.workstreams ?? []) {
    const model = workstream.model ?? 'unreported';
    const effort = workstream.effort ?? 'unreported';
    const key = `${model}|${effort}`;
    const bucket = buckets.get(key) ?? { model, effort, count: 0, tokens: 0 };
    bucket.count += 1;
    bucket.tokens += Number.isFinite(workstream.tokens) ? workstream.tokens : 0;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}

/** @param {object|null} report @returns {string} */
export function renderReport(report) {
  if (!report) return 'swarm-state: no such optional report';
  const lines = [`Swarm report ${report.runId}: ${report.workstreams.length} workstream(s)`];
  for (const workstream of report.workstreams) {
    lines.push(`  [${workstream.status}] ${workstream.id} -> ${workstream.taskId}${workstream.note ? ` (${workstream.note})` : ''}`);
  }
  const models = byModel(report);
  if (models.length > 0) lines.push(`  observed models: ${models.map((entry) => `${entry.model} x${entry.count}`).join(', ')}`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('swarm-state.mjs')) {
  const [verb, runId] = process.argv.slice(2);
  const root = process.cwd();
  if (verb === 'show') console.log(JSON.stringify(readRun(root, runId), null, 2));
  else if (verb === 'report') console.log(renderReport(readRun(root, runId)));
  else if (verb === 'list') for (const report of listRuns(root)) console.log(renderReport(report));
  else if (verb === 'evict') console.log(JSON.stringify(evictStale(root, runId)));
  else {
    console.error('Usage: swarm-state.mjs <show|report|list|evict> [runId]');
    process.exit(1);
  }
}
