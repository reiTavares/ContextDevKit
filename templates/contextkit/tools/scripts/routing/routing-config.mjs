/**
 * Effective routing-config resolver (ADR-0094 §1, §6, §10).
 *
 * Resolves the routing posture with clear precedence —
 *   session override > project config (`contextkit/config.json`) > built-in defaults
 * — and decides whether routing is ACTIVE for the current session/level. Pure and
 * zero-dependency: the built-in defaults are imported from the same source of truth
 * the hooks use (`runtime/config/defaults.mjs`), so the posture can never drift.
 *
 * "Active" here means *loaded, recorded, surfaced and measuring* — not that the
 * kit forces dispatch (it cannot; ADR-0094 §Decision). In `shadow` mode active is
 * still true: the layer recommends + measures without changing the executor.
 */

import { DEFAULT_CONFIG } from '../../../runtime/config/defaults.mjs';

/** The canonical default routing posture (single-sourced from defaults.mjs). */
export const DEFAULT_ROUTING = Object.freeze({ ...DEFAULT_CONFIG.routing });

/** Valid deployment modes (ADR-0094 §1). */
export const ROUTING_MODES = Object.freeze(['shadow', 'canary', 'active']);

/**
 * Merge a single override layer over a base (shallow — routing is a flat object).
 * @param {object} base
 * @param {object} override
 * @returns {object}
 */
function mergeLayer(base, override) {
  if (!override || typeof override !== 'object') return base;
  const next = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val !== undefined) next[key] = val;
  }
  return next;
}

/**
 * Resolve the effective routing config + activation verdict.
 *
 * @param {object} [opts]
 * @param {object} [opts.project] - the project's `routing` config block (from config.json).
 * @param {object} [opts.session] - explicit per-session override (highest precedence).
 * @param {number} [opts.level] - the resolved ContextDevKit level (gates by `minLevel`).
 * @returns {{ config: object, active: boolean, mode: string, reason: string }}
 */
export function resolveRoutingConfig({ project, session, level } = {}) {
  // Precedence: defaults < project < session.
  let config = mergeLayer(DEFAULT_ROUTING, project && typeof project === 'object' ? project : {});
  config = mergeLayer(config, session && typeof session === 'object' ? session : {});

  // Normalize an out-of-range mode back to the safe default rather than trusting it.
  if (!ROUTING_MODES.includes(config.mode)) config = { ...config, mode: 'shadow' };

  const lvl = Number.isFinite(level) ? level : Number(DEFAULT_CONFIG.level);
  let active = true;
  let reason = `routing ${config.mode} active`;
  if (!config.enabled) {
    active = false;
    reason = 'routing disabled (routing.enabled=false)';
  } else if (lvl < Number(config.minLevel || 0)) {
    active = false;
    reason = `routing inert below level ${config.minLevel} (current ${lvl})`;
  }

  return Object.freeze({ config: Object.freeze({ ...config }), active, mode: config.mode, reason });
}

/**
 * A short, single-line surface for the boot banner (ADR-0094 §6). Returns null
 * when routing is not active, so the banner stays silent.
 *
 * @param {{ active: boolean, config: object, mode: string }} resolved
 * @returns {string|null}
 */
export function routingBannerLine(resolved) {
  if (!resolved || !resolved.active) return null;
  const c = resolved.config || {};
  const posture = `${c.mechanicalExecutor || 'haiku'} ops · ${c.implementationExecutor || 'sonnet'} exec · ${c.reasoningExecutor || 'opus'} decides`;
  return `🔀 Auto-routing: ${resolved.mode} — ${posture}`;
}
