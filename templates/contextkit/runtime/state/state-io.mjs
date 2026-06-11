/**
 * Canonical state.json substrate ([ADR-0015](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md) Part C).
 *
 * One schema, two kinds of in-flight items:
 *   - `kind: 'task'`          — a DevPipeline task currently in `working/`
 *   - `kind: 'pipeline-run'`  — a single execution of a squad's `pipeline.yaml`
 *
 * Storage (ADR-0053): one file per item under
 * `contextkit/pipeline/state/<id>/state.json` — the runtime substrate lives in its
 * OWN `state/` subdir, isolated from the board stage dirs (backlog/working/testing/
 * conclusion) and gitignored in installs (it is in-flight state, not the shared
 * board). The pipeline directory is single-sourced via `paths.mjs`. Reads fall back
 * to the pre-ADR-0053 flat path (`pipeline/<id>/state.json`) so an un-migrated
 * project keeps working; `migrateStateLayout` tidies the filesystem. Defensive
 * everywhere — corrupt or missing JSON returns `null`, not throws.
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
 *     cycles: Record<string, number>,                         // pipeline-run only
 *     events: Array<{ ts, from, to, actor, inverse, note? }>  // ADR-0043: append-only
 *   }
 *
 * The `events` log is APPEND-ONLY (ADR-0043): `appendEvent` is the only writer;
 * `writeState` can never rewrite or drop past events. `inverse` records the
 * stage to restore — every transition is reversible by construction, and the
 * telemetry the grade-4 eligibility bar reads (ADR-0045) derives ONLY from
 * these events ("if it isn't an event, it didn't happen").
 *
 * Zero-dep, pure ESM over `node:*`. The hot path may import this — it never
 * pulls in the optional `yaml` dep.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeFileAtomicSync } from '../hooks/safe-io.mjs';

const VALID_KINDS = new Set(['task', 'pipeline-run']);
const VALID_STATUSES = new Set(['backlog', 'working', 'testing', 'done', 'running', 'blocked-on-checkpoint', 'failed']);
const VALID_ACTORS = new Set(['human', 'auto', 'qa', 'evict']);
/** The state substrate's own subdir (ADR-0053) — kept apart from the board stages. */
const STATE_SUBDIR = 'state';
/** Board stage dirs that live beside `state/` and must never be read as task ids. */
const STAGE_DIRS = new Set(['backlog', 'working', 'testing', 'conclusion', STATE_SUBDIR]);
let warnedOnce = false;

/** Canonical path (ADR-0053): `pipeDir/state/<id>/state.json`. */
function fileFor(pipeDir, id) {
  return resolve(pipeDir, STATE_SUBDIR, String(id), 'state.json');
}

/** Pre-ADR-0053 flat path (`pipeDir/<id>/state.json`) — read-only back-compat. */
function legacyFileFor(pipeDir, id) {
  return resolve(pipeDir, String(id), 'state.json');
}

/** readdir withFileTypes, never throws. */
function safeEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
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
  // New layout first, then the pre-ADR-0053 flat path (un-migrated projects).
  let file = fileFor(pipeDir, id);
  if (!existsSync(file)) file = legacyFileFor(pipeDir, id);
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
  // ADR-0043: events are append-only — a patch can never rewrite or drop them.
  merged.events = Array.isArray(previous.events) ? previous.events : [];
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
 * Appends ONE transition event (ADR-0043) — the only writer of `events`.
 * `inverse` is recorded automatically as the from-stage, making every
 * transition reversible by construction. Throws on an unknown actor
 * (refuse-by-default — telemetry from forged actors would be worse than none).
 *
 * @param {string} pipeDir
 * @param {string} id
 * @param {{ from: string, to: string, actor: 'human'|'auto'|'qa'|'evict', note?: string }} event
 * @returns {object} the updated record
 */
export function appendEvent(pipeDir, id, { from, to, actor, note }) {
  if (!VALID_ACTORS.has(actor)) throw new Error(`appendEvent: invalid actor "${actor}" — one of ${[...VALID_ACTORS].join(', ')}`);
  const previous = readState(pipeDir, id) || {};
  const events = Array.isArray(previous.events) ? previous.events : [];
  const entry = { ts: Date.now(), from: String(from ?? ''), to: String(to ?? ''), actor, inverse: String(from ?? '') };
  if (note) entry.note = String(note).slice(0, 300);
  const merged = { ...previous, id: String(id), events: [...events, entry] };
  if (typeof merged.startedAt !== 'number') merged.startedAt = Date.now();
  merged.lastHeartbeat = Date.now();
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
  // Ids from the new `state/` subdir, plus any un-migrated legacy dirs at the
  // pipeline root (stage dirs are skipped — they are never task state, ADR-0053).
  const ids = new Set();
  for (const ent of safeEntries(resolve(pipeDir, STATE_SUBDIR))) if (ent.isDirectory()) ids.add(ent.name);
  for (const ent of safeEntries(pipeDir)) if (ent.isDirectory() && !STAGE_DIRS.has(ent.name)) ids.add(ent.name);
  const states = [];
  for (const id of ids) {
    const state = readState(pipeDir, id);
    if (!state) continue;
    if (opts.kind && state.kind !== opts.kind) continue;
    if (opts.sinceMs && (state.startedAt || 0) < opts.sinceMs) continue;
    states.push(state);
  }
  states.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return states;
}

/**
 * Migrates any pre-ADR-0053 flat state dirs (`pipeDir/<id>/state.json`) into the
 * `state/` subdir. Idempotent and best-effort — a project that already migrated,
 * or has no legacy dirs, is a no-op. Called by the installer's update path and on
 * pipeline sync so every environment self-heals. Returns the count moved.
 *
 * @param {string} pipeDir
 * @returns {number}
 */
export function migrateStateLayout(pipeDir) {
  let moved = 0;
  for (const ent of safeEntries(pipeDir)) {
    if (!ent.isDirectory() || STAGE_DIRS.has(ent.name)) continue;
    const legacy = legacyFileFor(pipeDir, ent.name);
    if (!existsSync(legacy)) continue;
    const dest = fileFor(pipeDir, ent.name);
    if (existsSync(dest)) continue; // already migrated — never clobber the new file
    try {
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(legacy, dest);
      try { rmdirSync(resolve(pipeDir, ent.name)); } catch { /* dir not empty — leave it */ }
      moved += 1;
    } catch { /* best-effort — a failed move just stays legacy (still readable) */ }
  }
  return moved;
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
    // Remove whichever location holds it (new layout, or an un-migrated legacy file).
    const file = existsSync(fileFor(pipeDir, state.id)) ? fileFor(pipeDir, state.id) : legacyFileFor(pipeDir, state.id);
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
    events: Array.isArray(safe.events) ? safe.events : [],
  };
}
