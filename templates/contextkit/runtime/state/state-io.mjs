/**
 * Canonical state.json substrate ([ADR-0015](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md) Part C).
 *
 * One schema, two kinds of in-flight items:
 *   - `kind: 'task'`          — a DevPipeline task currently in `working/`
 *   - `kind: 'pipeline-run'`  — a single execution of a squad's `pipeline.yaml`
 *
 * Storage: one file per item under `contextkit/pipeline/<id>/state.json` (the
 * pipeline directory is single-sourced via `paths.mjs`). Defensive everywhere
 * — corrupt or missing JSON returns `null`, not throws.
 *
 * Schema (canonical):
 *   {
 *     kind: 'task' | 'pipeline-run',
 *     id: string,
 *     status: 'backlog'|'working'|'testing'|'done'|'running'|'blocked-on-checkpoint'|'failed',
 *     ownerSessionId: string|null,
 *     ownerUser: string|null,
 *     branch: string|null,
 *     step: { current: string, total: number } | null,        // pipeline-run only
 *     startedAt: number,
 *     lastHeartbeat: number,
 *     endedAt: number|null,
 *     cycles: Record<string, number>                          // pipeline-run only
 *   }
 *
 * Zero-dep, pure ESM over `node:*`. The hot path may import this — it never
 * pulls in the optional `yaml` dep.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeFileAtomicSync } from '../hooks/safe-io.mjs';

const VALID_KINDS = new Set(['task', 'pipeline-run']);
const VALID_STATUSES = new Set(['backlog', 'working', 'testing', 'done', 'running', 'blocked-on-checkpoint', 'failed']);
let warnedOnce = false;

/**
 * @param {string} pipeDir — repo-relative pipeline root (single-sourced from paths.mjs)
 * @param {string} id
 */
function fileFor(pipeDir, id) {
  return resolve(pipeDir, String(id), 'state.json');
}

/**
 * Reads a state file. Returns `null` when missing OR corrupt — never throws.
 * On the FIRST corruption per process, logs a single line so the maintainer
 * sees it; subsequent corruptions are silent.
 *
 * @param {string} pipeDir
 * @param {string} id
 * @returns {object | null}
 */
export function readState(pipeDir, id) {
  const file = fileFor(pipeDir, id);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf-8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch {
    if (!warnedOnce) {
      process.stderr.write(`[state-io] corrupt or unreadable: ${file}\n`);
      warnedOnce = true;
    }
    return null;
  }
}

/**
 * Writes/updates a state file with a partial payload — fields not present in
 * `patch` are preserved from the existing file. Validates `kind` + `status`;
 * malformed inputs throw (state.json is owned by the kit, garbage in is a bug).
 *
 * Atomic via `writeFileAtomicSync` (tmp + rename).
 *
 * @param {string} pipeDir
 * @param {string} id
 * @param {object} patch
 * @returns {object} the merged record
 */
export function writeState(pipeDir, id, patch) {
  if (!patch || typeof patch !== 'object') throw new Error('writeState: patch must be an object');
  const previous = readState(pipeDir, id) || {};
  const merged = { ...previous, ...patch, id: String(id) };
  if (merged.kind != null && !VALID_KINDS.has(merged.kind)) throw new Error(`writeState: invalid kind "${merged.kind}"`);
  if (merged.status != null && !VALID_STATUSES.has(merged.status)) throw new Error(`writeState: invalid status "${merged.status}"`);
  if (typeof merged.startedAt !== 'number') merged.startedAt = Date.now();
  merged.lastHeartbeat = typeof patch.lastHeartbeat === 'number' ? patch.lastHeartbeat : Date.now();
  const file = fileFor(pipeDir, id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomicSync(file, JSON.stringify(merged, null, 2));
  return merged;
}

/**
 * Lists every state file under `pipeDir/<id>/state.json`. Optional `{ kind }`
 * filter and `{ sinceMs }` cutoff (returns only states whose `startedAt` >=
 * the cutoff). Sorted by `startedAt` descending (newest first).
 *
 * @param {string} pipeDir
 * @param {{ kind?: 'task'|'pipeline-run', sinceMs?: number }} [opts]
 * @returns {object[]}
 */
export function listStates(pipeDir, opts = {}) {
  if (!existsSync(pipeDir)) return [];
  const states = [];
  let entries;
  try {
    entries = readdirSync(pipeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const state = readState(pipeDir, ent.name);
    if (!state) continue;
    if (opts.kind && state.kind !== opts.kind) continue;
    if (opts.sinceMs && (state.startedAt || 0) < opts.sinceMs) continue;
    states.push(state);
  }
  states.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return states;
}

/**
 * Removes state files whose `endedAt` is older than `olderThanDays` ago. Live
 * states (no `endedAt`) are never pruned. Returns the count removed.
 *
 * @param {string} pipeDir
 * @param {{ olderThanDays: number }} opts
 * @returns {number}
 */
export function prune(pipeDir, { olderThanDays }) {
  if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) return 0;
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const state of listStates(pipeDir)) {
    if (typeof state.endedAt !== 'number' || state.endedAt > cutoff) continue;
    const file = fileFor(pipeDir, state.id);
    try {
      if (existsSync(file)) { unlinkSync(file); removed += 1; }
    } catch { /* best-effort */ }
  }
  return removed;
}

/**
 * Coerces a parsed record into the canonical shape with safe defaults. Unknown
 * fields are dropped; missing required fields get sensible defaults so a
 * partially-written record still parses.
 *
 * @param {object} obj
 * @returns {object}
 */
function normalize(obj) {
  const safe = obj && typeof obj === 'object' ? obj : {};
  return {
    kind: VALID_KINDS.has(safe.kind) ? safe.kind : 'task',
    id: typeof safe.id === 'string' ? safe.id : String(safe.id ?? ''),
    status: VALID_STATUSES.has(safe.status) ? safe.status : 'backlog',
    ownerSessionId: typeof safe.ownerSessionId === 'string' ? safe.ownerSessionId : null,
    ownerUser: typeof safe.ownerUser === 'string' ? safe.ownerUser : null,
    branch: typeof safe.branch === 'string' ? safe.branch : null,
    step: safe.step && typeof safe.step === 'object' ? safe.step : null,
    startedAt: typeof safe.startedAt === 'number' ? safe.startedAt : 0,
    lastHeartbeat: typeof safe.lastHeartbeat === 'number' ? safe.lastHeartbeat : 0,
    endedAt: typeof safe.endedAt === 'number' ? safe.endedAt : null,
    cycles: safe.cycles && typeof safe.cycles === 'object' ? safe.cycles : {},
  };
}
