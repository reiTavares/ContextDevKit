/**
 * economy-session-activation.mjs — Session-start economy guidance injection.
 *
 * WHY this exists: every new session should automatically receive concise
 * guidance on which deterministic economy tools to use, without the agent
 * having to discover them from scratch. By returning a frozen boot section,
 * the SessionStart hook can prepend it to the boot banner cheaply (pure read).
 *
 * Design invariants:
 *   - Pure — no side effects beyond reading the cfg argument.
 *   - Deterministic — no Date.now/Math.random/new Date calls.
 *   - Zero runtime dependencies — node:* and relative imports only.
 *   - File ≤ 308 lines (constitution §1 +10% tolerance).
 *   - Returns null when economy is explicitly disabled in config.
 *
 * Config path: `cfg.economy.enabled` and `cfg.economy.autoActivate`.
 * Both default to true; set either to `false` to suppress the section.
 *
 * Cohesion note: activation guidance only. Session-start hook owns wiring;
 * EACP modules own measurement, routing, and governance.
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Schema version string for the economy activation section.
 * Bump the minor part on backwards-compatible additions; major part on breaks.
 *
 * @type {string}
 */
export const ECONOMY_ACTIVATION_SCHEMA_VERSION = 'cdk-economy-activation/1';

// ---------------------------------------------------------------------------
// Guidance lines (constant — defined once, reused by every call)
// ---------------------------------------------------------------------------

/**
 * The fixed guidance lines injected into every boot when economy is active.
 *
 * Lines are intentionally concise (≤8 total) to stay within the boot-section
 * budget and avoid overwhelming the agent with tooling prose.
 *
 * @type {readonly string[]}
 */
const GUIDANCE_LINES = Object.freeze([
  'Locate code with project-map --find before broad search; only exact hits may feed the Task Compiler canary.',
  'For exact Project Map hits, run task-compiler.mjs --symbol <symbol> --objective "<objective>"; otherwise report skipped.',
  'When a prior checkpoint/run id exists, render resume-pack.mjs before re-reading old context.',
  'Before subagent dispatch, run subagent-profile.mjs and pass only the bounded packet/profile.',
  'Run tests/builds via run-compact so only new failures enter context, not full logs.',
  'In ship/swarm, use lean-loop-cli.mjs controller hints and merge structured worker results.',
  'When host quota data is visible, write quota-snapshot.mjs --write; missing data is skipped, not pass.',
]);

// ---------------------------------------------------------------------------
// isEconomyActive
// ---------------------------------------------------------------------------

/**
 * Determine whether economy mode is active for the given config.
 *
 * Economy is active (true) unless EITHER:
 *   - `cfg.economy.enabled` is explicitly `false`, OR
 *   - `cfg.economy.autoActivate` is explicitly `false`.
 *
 * Missing or non-object `cfg.economy` → both flags default to true.
 *
 * @param {object} cfg - resolved ContextDevKit config object (may have `cfg.economy`)
 * @returns {boolean}
 */
export function isEconomyActive(cfg) {
  const econ = cfg?.economy;
  if (!econ || typeof econ !== 'object') return true;
  if (econ.enabled === false) return false;
  if (econ.autoActivate === false) return false;
  return true;
}

// ---------------------------------------------------------------------------
// economyActivationSection
// ---------------------------------------------------------------------------

/**
 * Build the frozen boot section for economy guidance.
 *
 * Returns a frozen section object when economy mode is active, or null when
 * disabled via config. The returned object follows the same shape as other
 * boot sections consumed by boot-banner.mjs.
 *
 * @param {object} cfg - resolved ContextDevKit config object (may have `cfg.economy`)
 * @returns {{ kind: string, title: string, lines: readonly string[] } | null}
 */
export function economyActivationSection(cfg) {
  if (!isEconomyActive(cfg)) return null;

  return Object.freeze({
    kind:  'economy',
    title: '💸 Economy mode active',
    lines: GUIDANCE_LINES,
  });
}
