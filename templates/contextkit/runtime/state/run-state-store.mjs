/**
 * Atomic state store for transient pipeline runs.
 *
 * Task and workflow status never live here: their authorities are respectively
 * `pipeline/tasks.json` and `workflow-state.json`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from '../hooks/safe-io.mjs';

const RUN_STATUSES = new Set(['running', 'blocked-on-checkpoint', 'done', 'failed']);

/** @param {string} id @returns {string} */
function safeRunId(id) {
  const value = String(id ?? '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new TypeError(`invalid pipeline run id: ${value}`);
  }
  return value;
}

/** @param {string} memoryRoot @param {string} id @returns {string} */
function statePath(memoryRoot, id) {
  return resolve(memoryRoot, 'runs', safeRunId(id), 'state.json');
}

/**
 * Reads one pipeline run. Missing or corrupt state is explicit as `null`.
 * @param {string} memoryRoot
 * @param {string} id
 * @returns {object|null}
 */
export function readRunState(memoryRoot, id) {
  const file = statePath(memoryRoot, id);
  if (!existsSync(file)) return null;
  try {
    const state = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return state?.kind === 'pipeline-run' ? state : null;
  } catch {
    return null;
  }
}

/**
 * Atomically creates or patches one pipeline run.
 * @param {string} memoryRoot
 * @param {string} id
 * @param {object} patch
 * @returns {object}
 */
export function writeRunState(memoryRoot, id, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('run-state patch must be an object');
  }
  const current = readRunState(memoryRoot, id);
  const status = patch.status ?? current?.status ?? 'running';
  if (!RUN_STATUSES.has(status)) throw new TypeError(`invalid pipeline run status: ${status}`);
  const now = Date.now();
  const next = {
    kind: 'pipeline-run',
    id: safeRunId(id),
    status,
    step: null,
    startedAt: current?.startedAt ?? now,
    lastHeartbeat: now,
    endedAt: null,
    cycles: {},
    events: [],
    ...current,
    ...patch,
    kind: 'pipeline-run',
    id: safeRunId(id),
    status,
    lastHeartbeat: now,
    events: Array.isArray(current?.events) ? current.events : [],
  };
  const file = statePath(memoryRoot, id);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileAtomicSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Appends a run transition without rewriting earlier events.
 * @param {string} memoryRoot
 * @param {string} id
 * @param {{from?:string,to:string,actor?:string,note?:string,ts?:number}} event
 * @returns {object}
 */
export function appendRunEvent(memoryRoot, id, event) {
  const current = readRunState(memoryRoot, id);
  if (!current) throw new Error(`pipeline run not found: ${id}`);
  if (!RUN_STATUSES.has(event?.to)) throw new TypeError(`invalid pipeline run event target: ${event?.to}`);
  const entry = {
    ts: event.ts ?? Date.now(),
    actor: event.actor ?? 'runtime',
    from: event.from ?? current.status,
    to: event.to,
    inverse: event.from ?? current.status,
    ...(event.note ? { note: String(event.note) } : {}),
  };
  const next = writeRunState(memoryRoot, id, { status: event.to });
  next.events = [...current.events, entry];
  writeFileAtomicSync(statePath(memoryRoot, id), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Lists pipeline runs newest-first.
 * @param {string} memoryRoot
 * @returns {object[]}
 */
export function listRunStates(memoryRoot) {
  const runsRoot = resolve(memoryRoot, 'runs');
  let entries = [];
  try { entries = readdirSync(runsRoot, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readRunState(memoryRoot, entry.name))
    .filter(Boolean)
    .sort((left, right) => (right.lastHeartbeat ?? 0) - (left.lastHeartbeat ?? 0));
}
