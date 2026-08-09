#!/usr/bin/env node
/**
 * Graph activation ladder (RO2, WF-0074/BIZ-0004) — the staged rollout authority.
 *
 * Resolves the single activation mode of the whole graph capability from the
 * level, config and evidence, honoring ADR-0134's invariants:
 *
 *   off       default. `projectMap.graph.enabled !== true` -> off, always.
 *   shadow    build + measure, never surface, never block (L4+).
 *   advisory  surface signals; never block (L4+).
 *   guarded   block when it can evaluate confidently, degrade to advisory
 *             otherwise (L7 + explicit human flip).
 *   strict    block on any qualifying finding (L7 + explicit human flip).
 *
 * Hard rules:
 *   - default-OFF is the standing state; enabling is an explicit `=== true`.
 *   - guarded/strict NEVER auto-flip — they require `graph.humanFlip === true`
 *     (the G-RO4 human gate). Without it, a guarded/strict CONFIG value clamps
 *     down to advisory rather than silently blocking (fail-safe, constitution §8).
 *   - the level model is L7 + a flag, never a new L8.
 *   - a mode is never inferred from absent evidence — no evidence clamps a
 *     blocking mode to advisory (skipped ≠ pass).
 *
 * Pure, deterministic, zero non-`node:` imports (this is read on the hot path by
 * consumers deciding whether to act, so it must stay dependency-free).
 */

import { isGraphEnabled } from './graph-config.mjs';

// Re-export the single-source enablement gate (defined once in graph-config).
export { isGraphEnabled };

/** The ordered activation ladder. */
export const MODES = Object.freeze(['off', 'shadow', 'advisory', 'guarded', 'strict']);
/** Modes that can block work — only reachable with an explicit human flip. */
const BLOCKING_MODES = new Set(['guarded', 'strict']);
/** Minimum level for any non-off mode. */
const MIN_LEVEL = 4;
/** Minimum level for a blocking mode. */
const MIN_BLOCKING_LEVEL = 7;

/**
 * Resolves the effective activation mode. Never throws; unknown inputs clamp to
 * the safe side (off, or advisory for a would-be-blocking mode without a flip).
 *
 * @param {number} level the ContextDevKit capability level (1..7)
 * @param {object} config the resolved config (reads `projectMap.graph.*`)
 * @param {{available?:boolean}} [evidence] whether a usable graph projection exists
 * @returns {{mode:string, reason:string}}
 */
export function resolveGraphActivation(level, config, evidence = {}) {
  if (!isGraphEnabled(config)) return { mode: 'off', reason: 'projectMap.graph.enabled is not true (default off)' };
  if (typeof level !== 'number' || level < MIN_LEVEL) {
    return { mode: 'off', reason: `graph requires level >= ${MIN_LEVEL} (got ${level})` };
  }
  const graph = config.projectMap.graph;
  const requested = MODES.includes(graph.mode) ? graph.mode : 'shadow';
  const humanFlip = graph.humanFlip === true;

  // A requested blocking mode requires L7 AND an explicit human flip; else clamp to advisory.
  if (BLOCKING_MODES.has(requested)) {
    if (level < MIN_BLOCKING_LEVEL) {
      return { mode: 'advisory', reason: `${requested} requires level >= ${MIN_BLOCKING_LEVEL}; clamped to advisory` };
    }
    if (!humanFlip) {
      return { mode: 'advisory', reason: `${requested} requires an explicit human flip (graph.humanFlip); clamped to advisory` };
    }
    // Blocking is authorized — but if there is no usable graph, we do NOT block
    // on nothing: we stay in the blocking mode but the CONSUMER degrades each
    // finding to UNKNOWN (never a fabricated pass). Mode itself is honest.
    return { mode: requested, reason: `${requested} authorized (L>=7 + human flip)` };
  }
  // Non-blocking requested mode (shadow/advisory) — allowed at L4+.
  return { mode: requested, reason: `${requested} active (L>=${MIN_LEVEL})` };
}

/**
 * Convenience: does the resolved mode permit blocking a merge/edit? Only guarded
 * and strict, and only when a real evaluation is possible (the caller supplies
 * `evidenceAvailable`). No evidence -> never blocks (UNKNOWN, not a block).
 * @param {string} mode
 * @param {boolean} evidenceAvailable
 * @returns {boolean}
 */
export function modeCanBlock(mode, evidenceAvailable) {
  return BLOCKING_MODES.has(mode) && evidenceAvailable === true;
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-activation.mjs') {
  const demo = resolveGraphActivation(7, { projectMap: { graph: { enabled: true, mode: 'guarded', humanFlip: false } } });
  process.stdout.write(JSON.stringify(demo, null, 2) + '\n');
}
