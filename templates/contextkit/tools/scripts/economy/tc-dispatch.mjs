/**
 * Task-Compiler: ephemeral dispatch — public surface (TC-16 / WF0022 / ADR-0083).
 *
 * Single responsibility: capability probe + dispatch plan builder. Heavy
 * execution paths (in-session runner, ephemeral spawn, typed errors) live in
 * tc-dispatch-core.mjs to stay within the 308-line constitution ceiling (§1).
 *
 * Behavior contract:
 *   1. HOST-CAPABILITY DETECTION FIRST. probeHostCapability() reads process.env
 *      and process.execPath ONLY — zero side effects, never spawns.
 *   2. DRY-RUN BY DEFAULT. planDispatch() returns a frozen DispatchPlan without
 *      spawning. Actual execution requires opts.execute === true.
 *   3. GRACEFUL DEGRADATION = explicit in-session fallback. When the host cannot
 *      dispatch ephemerally, mode='in-session' with an explicit reason is returned.
 *      NEVER silently pretend a dispatch happened (constitution §8).
 *   4. VALIDATORS THROW BEFORE ANY I/O. Input validation is delegated to
 *      validateUnit (tc-dispatch-core.mjs) and runs before any probe or spawn.
 *   5. ADR-0083 WORKER-ENVELOPE SHAPE on all executeDispatch results.
 *
 * Cohesion note: probe + plan builder form a single cohesion unit (dispatch
 * decision); the execution paths are a distinct I/O-heavy concern in -core.
 *
 * // consumes: tc-dispatch-core (execution), tc-recipe-runner (recipe substrate)
 * [task-compiler] [token-economy] [WF0022] [ADR-0083] [ADR-0089]
 */
import {
  DispatchValidationError,
  DispatchSpawnError,
  validateUnit,
  executeInSession,
  executeEphemeral,
} from './tc-dispatch-core.mjs';

export { DispatchValidationError, DispatchSpawnError };

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for dispatch plans produced by this module. */
export const TC_DISPATCH_SCHEMA_VERSION = 'cdk-tc-dispatch/1';

// ---------------------------------------------------------------------------
// Capability probe — PURE, SIDE-EFFECT-FREE
// ---------------------------------------------------------------------------

/**
 * Reads environment signals to decide whether this host can spawn a real
 * ephemeral Node.js subprocess.
 *
 * Probe contract (ADR-0083):
 *   - Reads process.env and process.execPath ONLY.
 *   - NEVER spawns, NEVER writes, NEVER reads from disk.
 *   - Returns a frozen CapabilityProbe with an explicit `capable` boolean.
 *
 * Capability conditions (all must hold):
 *   1. process.execPath is a non-empty string (Node binary locatable).
 *   2. TC_DISPATCH_DISABLE env is not set to a truthy string.
 *   3. CLAUDE_CODE_TOOL_CALL env is not set (re-entrant spawn is unsafe in
 *      hook execution contexts — would deadlock or produce duplicate effects).
 *
 * @returns {Readonly<{ capable: boolean, reason: string, execPath: string|null }>}
 */
export function probeHostCapability() {
  const execPath = (typeof process.execPath === 'string' && process.execPath)
    ? process.execPath
    : null;

  if (!execPath) {
    return Object.freeze({
      capable:  false,
      reason:   'process.execPath is empty — cannot locate Node binary for spawn',
      execPath: null,
    });
  }

  const disabled = process.env['TC_DISPATCH_DISABLE'];
  if (disabled && disabled !== '0' && disabled.toLowerCase() !== 'false') {
    return Object.freeze({
      capable:  false,
      reason:   'TC_DISPATCH_DISABLE env var is set — ephemeral dispatch suppressed',
      execPath,
    });
  }

  if (process.env['CLAUDE_CODE_TOOL_CALL']) {
    return Object.freeze({
      capable:  false,
      reason:   'CLAUDE_CODE_TOOL_CALL env detected — re-entrant spawn is unsafe',
      execPath,
    });
  }

  return Object.freeze({
    capable:  true,
    reason:   'host capability confirmed: Node binary available, no suppression flags',
    execPath,
  });
}

// ---------------------------------------------------------------------------
// planDispatch — DRY-RUN by default
// ---------------------------------------------------------------------------

/**
 * @typedef {'ephemeral' | 'in-session'} DispatchMode
 *
 * @typedef {{
 *   schemaVersion: string,
 *   mode:          DispatchMode,
 *   reason:        string,
 *   probe:         Readonly<{ capable: boolean, reason: string, execPath: string|null }>,
 *   dryRun:        boolean,
 *   unit:          object,
 *   execArgs:      string[] | null,
 *   advisory:      true
 * }} DispatchPlan
 */

/**
 * Produces a frozen DispatchPlan for a work-unit.
 *
 * Dry-run (default: opts.execute !== true):
 *   Runs the capability probe, decides mode, and sets execArgs — but does NOT spawn.
 *
 * Live (opts.execute === true):
 *   Produces the plan then delegates to executeDispatch(plan).
 *   The result is an ADR-0083 WorkerDispatchEnvelope.
 *
 * @param {object} unit - Work-packet (ADR-0083) or Recipe (tc-recipe-runner).
 * @param {{
 *   execute?:  boolean,
 *   root?:     string,
 *   write?:    boolean,
 *   pipeDir?:  string,
 *   runId?:    string,
 *   ctx?:      Record<string, unknown>,
 * }} [opts={}]
 * @returns {Readonly<DispatchPlan>}
 * @throws {DispatchValidationError} on malformed unit (before any I/O).
 */
export function planDispatch(unit, opts = {}) {
  // Validate BEFORE any I/O or probe (constitution §8).
  validateUnit(unit);

  const probe  = probeHostCapability();
  const dryRun = opts?.execute !== true;
  const root   = (typeof opts?.root === 'string' && opts.root)
    ? opts.root : process.cwd();

  let mode;
  let reason;
  let execArgs = null;

  if (probe.capable) {
    mode     = 'ephemeral';
    reason   = 'host capable of ephemeral spawn: will detach Node subprocess';
    execArgs = [
      '--input-stdin',
      '--root', root,
      ...(opts?.write  === true ? ['--write']                       : []),
      ...(opts?.pipeDir         ? ['--pipe-dir', opts.pipeDir]      : []),
      ...(opts?.runId           ? ['--run-id',   opts.runId]        : []),
    ];
  } else {
    mode   = 'in-session';
    reason = `in-session fallback: ${probe.reason}`;
  }

  return Object.freeze({
    schemaVersion: TC_DISPATCH_SCHEMA_VERSION,
    mode,
    reason,
    probe,
    dryRun,
    unit,
    execArgs,
    advisory: true,
  });
}

// ---------------------------------------------------------------------------
// executeDispatch — actually runs the dispatch
// ---------------------------------------------------------------------------

/**
 * Executes a live DispatchPlan (produced by planDispatch with execute:true).
 * Throws if plan.dryRun is true — call planDispatch first with execute:true.
 *
 * @param {Readonly<DispatchPlan>} plan
 * @param {{ root?: string, write?: boolean, ctx?: Record<string, unknown> }} [opts={}]
 * @returns {Readonly<object>} ADR-0083 WorkerDispatchEnvelope
 * @throws {DispatchValidationError} if plan is malformed or dryRun is true.
 * @throws {DispatchSpawnError}      if an ephemeral spawn fails.
 */
export function executeDispatch(plan, opts = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new DispatchValidationError('executeDispatch: plan must be a non-null object');
  }
  if (plan.dryRun === true) {
    throw new DispatchValidationError(
      'executeDispatch: plan.dryRun is true — build a live plan with execute:true'
    );
  }
  if (plan.schemaVersion !== TC_DISPATCH_SCHEMA_VERSION) {
    throw new DispatchValidationError(
      `executeDispatch: plan.schemaVersion "${plan.schemaVersion}" does not match ${TC_DISPATCH_SCHEMA_VERSION}`
    );
  }

  const root  = (typeof opts?.root === 'string' && opts.root) ? opts.root : process.cwd();
  const write = opts?.write === true;
  const ctx   = (opts?.ctx && typeof opts.ctx === 'object') ? opts.ctx : {};

  if (plan.mode === 'in-session') {
    return executeInSession(plan.unit, { root, write, ctx });
  }
  return executeEphemeral(plan, { root, write });
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

/**
 * Renders a DispatchPlan as a human-readable multi-line string.
 *
 * @param {Readonly<DispatchPlan>} plan
 * @returns {string}
 */
export function presentDispatchPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return `tc-dispatch [${TC_DISPATCH_SCHEMA_VERSION}]: invalid plan object`;
  }
  const modeLabel = plan.mode === 'ephemeral' ? 'EPHEMERAL' : 'IN-SESSION';
  const dryLabel  = plan.dryRun ? 'DRY-RUN' : 'EXECUTE';
  const lines     = [
    `tc-dispatch [${plan.schemaVersion}]: ${modeLabel} / ${dryLabel}`,
    `  mode    : ${plan.mode}`,
    `  reason  : ${plan.reason}`,
    `  probe   : capable=${plan.probe?.capable} — ${plan.probe?.reason}`,
    `  advisory: ${plan.advisory}`,
  ];
  if (plan.execArgs) {
    lines.push(`  execArgs: ${plan.execArgs.join(' ')}`);
  }
  return lines.join('\n');
}
