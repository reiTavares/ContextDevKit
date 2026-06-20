/**
 * economy-dispatch.mjs — Dispatch-plan helper for Economy Runtime (WF0020, CDK-265).
 *
 * Produces a frozen advisory dispatch plan that guides an agent session toward
 * economy-aware defaults: bounded subagent context (via context-profiles.mjs),
 * run-compact wrapping for test/build commands, and an optional loop-breaker
 * signal for repeated-failure detection.
 *
 * Public surface:
 *   DISPATCH_PLAN_SCHEMA_VERSION   — schema identifier string
 *   buildDispatchPlan(opts, cfg)   — returns a frozen advisory plan object
 *   presentDispatchPlan(plan)      — returns a terse multi-line advisory string
 *
 * Fail-open contract (constitution §8 + immutable rule 2):
 *   - Never throws; if any import fails the plan degrades to a minimal frozen object.
 *   - cfg.economy.enabled === false → immediately returns {schemaVersion, disabled:true}.
 *   - advisory:true on ALL outputs — this plan is NEVER a gate; it only nudges.
 *
 * UNREGISTERED (Phase 1): not wired into any hook or gate; wiring is deferred.
 *
 * Zero runtime dependencies — node:* only (relative imports within economy/).
 *
 * Cohesion note (constitution §1): one concern (dispatch planning). Dependencies
 * on context-profiles and loop-breaker are explicit imports; no side-effects.
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** @type {string} Schema identifier for dispatch plans produced by this module. */
export const DISPATCH_PLAN_SCHEMA_VERSION = 'cdk-dispatch-plan/1';

// ---------------------------------------------------------------------------
// Internal helpers — lazy-imported so a missing sibling never throws at load time
// ---------------------------------------------------------------------------

/**
 * Attempt to import profileFor from context-profiles.mjs.
 * Returns a no-op fallback if the import fails.
 *
 * @returns {Promise<(name: string) => number|null>}
 */
async function loadProfileFor() {
  try {
    const mod = await import('./context-profiles.mjs');
    if (typeof mod.profileFor === 'function') return mod.profileFor;
  } catch {
    // Defensive: sibling module absent or broken → degrade gracefully.
  }
  /** @param {string} _name */
  return (_name) => null;
}

/**
 * Attempt to import loopBreakerSignal from loop-breaker.mjs.
 * Returns a no-op fallback if the import fails.
 *
 * @returns {Promise<(history: unknown[], mode: string) => { loopBreaker: object }>}
 */
async function loadLoopBreakerSignal() {
  try {
    const mod = await import('./loop-breaker.mjs');
    if (typeof mod.loopBreakerSignal === 'function') return mod.loopBreakerSignal;
  } catch {
    // Defensive: sibling module absent or broken → degrade gracefully.
  }
  return (_history, _mode) => ({
    loopBreaker: { detected: false, kind: null, count: 0, suggestion: 'No loop detected.', escalate: false },
  });
}

// ---------------------------------------------------------------------------
// buildDispatchPlan
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DispatchPlan
 * @property {string}          schemaVersion
 * @property {string}          [contextProfile]
 * @property {number|null}     [profileBudget]
 * @property {boolean}         [useRunCompact]
 * @property {string}          [runCompactHint]
 * @property {{ loopBreaker: object }} [loopBreak]
 * @property {boolean}         [advisory]
 * @property {boolean}         [disabled]
 */

/**
 * Build a frozen advisory dispatch plan.
 *
 * When `cfg.economy.enabled` is explicitly `false`, returns immediately with a
 * minimal disabled marker so callers can short-circuit without further work.
 *
 * All other errors are swallowed (fail-open); a partial plan is always returned.
 *
 * @param {{ history?: unknown[] }} [opts={}]
 * @param {{ economy?: { enabled?: boolean } }} [cfg={}]
 * @returns {Promise<Readonly<DispatchPlan>>}
 */
export async function buildDispatchPlan(opts = {}, cfg = {}) {
  // Short-circuit: economy explicitly disabled.
  if (cfg.economy?.enabled === false) {
    return Object.freeze({ schemaVersion: DISPATCH_PLAN_SCHEMA_VERSION, disabled: true });
  }

  const history = Array.isArray(opts?.history) ? opts.history : [];

  // Load dependencies defensively — any failure degrades to built-in fallbacks.
  const [profileFor, loopBreakerSignal] = await Promise.all([
    loadProfileFor(),
    loadLoopBreakerSignal(),
  ]);

  let profileBudget = null;
  try {
    profileBudget = profileFor('subagent');
  } catch {
    // Fail-open: keep null.
  }

  let loopBreak;
  try {
    loopBreak = loopBreakerSignal(history, 'advisory');
  } catch {
    loopBreak = {
      loopBreaker: { detected: false, kind: null, count: 0, suggestion: 'No loop detected.', escalate: false },
    };
  }

  return Object.freeze({
    schemaVersion:  DISPATCH_PLAN_SCHEMA_VERSION,
    contextProfile: 'subagent',
    profileBudget,
    useRunCompact:  true,
    runCompactHint: 'wrap test/build commands in run-compact so only NEW failures enter context',
    loopBreak,
    advisory:       true,
  });
}

// ---------------------------------------------------------------------------
// presentDispatchPlan
// ---------------------------------------------------------------------------

/**
 * Render a dispatch plan as a terse, human-readable multi-line advisory string.
 *
 * Fail-open: if plan is falsy or disabled, returns a minimal one-liner.
 * Always mentions run-compact so the caller can display the key nudge.
 *
 * @param {DispatchPlan} plan
 * @returns {string}
 */
export function presentDispatchPlan(plan) {
  if (!plan || plan.disabled) {
    return 'Economy dispatch: disabled (economy.enabled=false). run-compact advisory skipped.';
  }

  const budgetLine = plan.profileBudget !== null && plan.profileBudget !== undefined
    ? `Context profile: ${plan.contextProfile} (budget ≤${plan.profileBudget} lines).`
    : `Context profile: ${plan.contextProfile ?? 'subagent'} (budget: unknown).`;

  const loopLine = plan.loopBreak?.loopBreaker?.detected
    ? `Loop signal: ${plan.loopBreak.loopBreaker.kind} × ${plan.loopBreak.loopBreaker.count} — ${plan.loopBreak.loopBreaker.suggestion}`
    : 'Loop signal: none detected.';

  return [
    `Economy dispatch advisory [${plan.schemaVersion}]`,
    budgetLine,
    'run-compact: wrap test/build commands in run-compact so only NEW failures enter context.',
    loopLine,
    '(advisory only — never blocks; no gate wired)',
  ].join('\n');
}
