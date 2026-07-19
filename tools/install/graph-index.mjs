/**
 * Graph index-on-update (WF-0074/BIZ-0004, ADR-0134 rollout).
 *
 * Companion to `maybeGenerateBaseline`: regenerates the committed symbol-graph
 * projection (`contextkit/memory/project-map/graph/graph.json`) during
 * `npx contextdevkit --update` / install, so the graph stays wired to every
 * update — but ONLY when the capability is explicitly enabled
 * (`projectMap.graph.enabled === true`). Default-off means a normal update is a
 * silent no-op (safe; ADR-0134). Fail-open throughout: never throws, so a graph
 * failure never breaks an install.
 *
 * Guard order (cheapest / safest first), mirroring the baseline generator:
 *   1. capability disabled (default) -> disabled (silent no-op).
 *   2. greenfield (no source files) -> greenfield.
 *   3. self-update risk -> deferred_self_update.
 *   4. active sessions -> deferred_active_sessions.
 *   5. graph builder not installed -> skip.
 *   6. run the builder (--apply) -> generated | failed (fail-open).
 *
 * Zero runtime deps beyond `node:*` and the sibling baseline helpers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

/** Default runner: invoke the installed graph builder with `--apply` at cwd=target. */
function defaultRunGraph(builderPath, cwd) {
  execFileSync(process.execPath, [builderPath, '--apply'], { cwd, stdio: 'ignore' });
}

/**
 * Conditionally (re)generates the committed graph projection for a target.
 * Called during `--update`/install after the engine writes its assets and after
 * `maybeGenerateBaseline`. Returns `{ status, note }`; never throws.
 *
 * @param {string} target absolute path to the target project
 * @param {object} [opts]
 * @param {Function} [opts.runGraph] injectable runner fn(builderPath, cwd)
 * @param {Function} [opts.isEnabled] injectable enable-check fn(target)
 * @param {Function} [opts.hasSource] injectable source-presence fn(target)
 * @param {boolean}  [opts.selfHost] self-update risk -> defer
 * @param {Array|number} [opts.activeSessions] active sessions -> defer
 * @returns {Promise<{status:string, note:string}>}
 */
export async function maybeGenerateGraph(target, opts = {}) {
  const isEnabled = opts.isEnabled ?? graphEnabled;
  const runGraph = opts.runGraph ?? defaultRunGraph;

  // Guard 1: capability disabled (the default) -> silent no-op.
  if (!isEnabled(target)) {
    return { status: 'disabled', note: 'graph index: projectMap.graph.enabled not set — skipped (default off)' };
  }
  // Guard 2: greenfield -> nothing to graph.
  if (typeof opts.hasSource === 'function' && !opts.hasSource(target)) {
    return { status: 'greenfield', note: 'graph index: no source files (greenfield) — skipped' };
  }
  // Guard 3: self-update risk.
  if (opts.selfHost === true) {
    return { status: 'deferred_self_update', note: 'graph index: deferred (self-update risk)' };
  }
  // Guard 4: active sessions.
  const sessions = opts.activeSessions;
  const active = Array.isArray(sessions) ? sessions.length > 0 : (typeof sessions === 'number' ? sessions > 0 : false);
  if (active) {
    return { status: 'deferred_active_sessions', note: 'graph index: deferred (active sessions)' };
  }
  // Guard 5: builder not installed (injectable check, mirrors the other guards).
  const builderExists = opts.builderExists ?? existsSync;
  const builderPath = join(target, 'contextkit', 'tools', 'scripts', 'project-map-graph.mjs');
  if (!builderExists(builderPath)) {
    return { status: 'failed', note: 'graph index: builder not found — skipped' };
  }
  // Guard 6: run the builder, fail-open.
  try {
    runGraph(builderPath, target);
    return { status: 'generated', note: '✓ graph projection regenerated (index-on-update)' };
  } catch (err) {
    return { status: 'failed', note: `graph index: builder failed (${err?.message ?? err}) — skipped` };
  }
}
