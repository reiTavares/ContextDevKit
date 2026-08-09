/**
 * Graph index-on-update + rollout telemetry (WF-0074/BIZ-0004, ADR-0134 rollout).
 *
 * Companion to `maybeGenerateBaseline`: regenerates the committed symbol-graph
 * projection during `npx contextdevkit --update` / install. The graph ships
 * ENABLED by default (`projectMap.graph.enabled: true` in the install template),
 * so every new client gets it — but with a SAFE rollout: a small telemetry
 * counter tracks consecutive builder failures, and after `MAX_FAILURES` the index
 * AUTO-DISABLES itself (fail-open, never breaks an install). A later successful
 * build resets the counter. This is what makes default-on responsible: a project
 * where the graph builder repeatedly fails silently stops retrying instead of
 * failing every update.
 *
 * Guard order (cheapest / safest first):
 *   1. capability disabled (explicit opt-out) -> disabled (silent no-op).
 *   2. rollout auto-disabled (>= MAX_FAILURES consecutive) -> auto_disabled.
 *   3. greenfield (no source files) -> greenfield.
 *   4. self-update risk -> deferred_self_update.
 *   5. active sessions -> deferred_active_sessions.
 *   6. builder not installed -> failed (counts as a failure).
 *   7. run the builder (--apply) -> generated (resets counter) | failed (increments).
 *
 * Zero runtime deps beyond `node:*`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Consecutive builder failures after which the index auto-disables (fail-open). */
export const MAX_FAILURES = 3;

/** Reads `projectMap.graph.enabled` from the target's committed config, refusal-by-default. */
function graphEnabled(target) {
  const cfgPath = join(target, 'contextkit', 'config.json');
  if (!existsSync(cfgPath)) return false;
  try {
    const raw = readFileSync(cfgPath, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const cfg = JSON.parse(text);
    return Boolean(cfg && cfg.projectMap && cfg.projectMap.graph && cfg.projectMap.graph.enabled === true);
  } catch {
    return false;
  }
}

/** Path of the gitignored rollout-telemetry counter for a target. */
function rolloutPath(target) {
  return join(target, 'contextkit', 'memory', 'project-map', 'graph', '.rollout.json');
}

/** Reads the rollout counter defensively; absent/unreadable -> a fresh zero state. */
export function readRollout(target, readFn = readFileSync, existsFn = existsSync) {
  const p = rolloutPath(target);
  if (!existsFn(p)) return { consecutiveFailures: 0, lastReason: null };
  try {
    const raw = readFn(p, 'utf-8');
    const text = typeof raw === 'string' && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const s = JSON.parse(text);
    return { consecutiveFailures: Number(s.consecutiveFailures) || 0, lastReason: s.lastReason ?? null };
  } catch {
    return { consecutiveFailures: 0, lastReason: null };
  }
}

/** Writes the rollout counter atomically (tmp + rename); best-effort, never throws. */
function writeRollout(target, state, writeFn = writeFileSync) {
  try {
    const dir = join(target, 'contextkit', 'memory', 'project-map', 'graph');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const p = rolloutPath(target);
    const tmp = `${p}.tmp-${process.pid}`;
    writeFn(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    renameSync(tmp, p);
  } catch {
    /* telemetry is best-effort; a write failure must never break the install */
  }
}

/** Default runner: invoke the installed graph builder with `--apply` at cwd=target. */
function defaultRunGraph(builderPath, cwd) {
  execFileSync(process.execPath, [builderPath, '--apply'], { cwd, stdio: 'ignore' });
}

/**
 * Conditionally (re)generates the committed graph projection for a target, with
 * rollout telemetry + auto-disable backoff. Returns `{ status, note }`; never throws.
 *
 * @param {string} target absolute path to the target project
 * @param {object} [opts]
 * @param {Function} [opts.runGraph] injectable runner fn(builderPath, cwd)
 * @param {Function} [opts.isEnabled] injectable enable-check fn(target)
 * @param {Function} [opts.hasSource] injectable source-presence fn(target)
 * @param {Function} [opts.builderExists] injectable builder-presence fn(path)
 * @param {object}   [opts.rollout] injected {read, write} for tests
 * @param {boolean}  [opts.selfHost] self-update risk -> defer
 * @param {Array|number} [opts.activeSessions] active sessions -> defer
 * @returns {Promise<{status:string, note:string}>}
 */
export async function maybeGenerateGraph(target, opts = {}) {
  const isEnabled = opts.isEnabled ?? graphEnabled;
  const runGraph = opts.runGraph ?? defaultRunGraph;
  const rollout = opts.rollout ?? { read: (t) => readRollout(t), write: (t, s) => writeRollout(t, s) };

  // Guard 1: capability disabled (explicit opt-out) -> silent no-op.
  if (!isEnabled(target)) {
    return { status: 'disabled', note: 'graph index: projectMap.graph.enabled is false — skipped (explicit opt-out)' };
  }
  // Guard 2: rollout backoff — auto-disabled after too many consecutive failures.
  const state = rollout.read(target);
  if (state.consecutiveFailures >= MAX_FAILURES) {
    return { status: 'auto_disabled', note: `graph index: auto-disabled after ${state.consecutiveFailures} consecutive failures (${state.lastReason || 'unknown'}) — fix the builder + delete .rollout.json to re-enable` };
  }
  // Guard 3: greenfield -> nothing to graph.
  if (typeof opts.hasSource === 'function' && !opts.hasSource(target)) {
    return { status: 'greenfield', note: 'graph index: no source files (greenfield) — skipped' };
  }
  // Guard 4: self-update risk.
  if (opts.selfHost === true) {
    return { status: 'deferred_self_update', note: 'graph index: deferred (self-update risk)' };
  }
  // Guard 5: active sessions.
  const sessions = opts.activeSessions;
  const active = Array.isArray(sessions) ? sessions.length > 0 : (typeof sessions === 'number' ? sessions > 0 : false);
  if (active) {
    return { status: 'deferred_active_sessions', note: 'graph index: deferred (active sessions)' };
  }
  // Guard 6: builder not installed -> a failure (counts toward backoff).
  const builderExists = opts.builderExists ?? existsSync;
  const builderPath = join(target, 'contextkit', 'tools', 'scripts', 'project-map-graph.mjs');
  if (!builderExists(builderPath)) {
    rollout.write(target, { consecutiveFailures: state.consecutiveFailures + 1, lastReason: 'builder not found' });
    return { status: 'failed', note: 'graph index: builder not found — skipped' };
  }
  // Guard 7: run the builder, fail-open, and record the outcome.
  try {
    runGraph(builderPath, target);
    rollout.write(target, { consecutiveFailures: 0, lastReason: null });
    return { status: 'generated', note: '✓ graph projection regenerated (index-on-update)' };
  } catch (err) {
    const reason = err?.message ?? String(err);
    rollout.write(target, { consecutiveFailures: state.consecutiveFailures + 1, lastReason: reason });
    return { status: 'failed', note: `graph index: builder failed (${reason}) — skipped [${state.consecutiveFailures + 1}/${MAX_FAILURES} before auto-disable]` };
  }
}
