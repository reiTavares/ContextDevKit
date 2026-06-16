/**
 * lean-loop.mjs — Lean orchestrator-only loop lib for Economy Runtime
 * (ECON-08, WF0020 Wave 2, ADR-0082).
 *
 * WHY this exists: the Economy Runtime spec (§A) mandates that inside the
 * /ship and /swarm controller paths, delegating tasks to an ephemeral worker
 * in an isolated git worktree is the DEFAULT strategy. The host main loop
 * (the Claude Code session itself) is NOT controllable; only the swarm
 * controller that spawns workers is in scope. This lib gives those controllers
 * a stable API to check whether delegation is appropriate and to validate the
 * Worker Output Envelope the delegated worker must return.
 *
 * Phase-1 scope (UNREGISTERED): this is a standalone library. Controllers
 * consume it when activated in Phase 2. No command-file edits, no hook wiring,
 * no runtime registration are performed here.
 *
 * Design constraints:
 *   - Advisory + fail-open: shouldDelegate always returns a result, never throws.
 *   - validateWorkerReturn flags non-conforming envelopes; it never throws.
 *   - Zero runtime dependencies — node:* only.
 *   - Controller-scoped: lean-loop is NOT a global default. leanLoopSeam()
 *     marks the Phase-2 seam for enabling it globally (deliberately deferred).
 */

import {
  WORKER_ENVELOPE_VERSION,
  emptyEnvelope,
  validateEnvelope,
} from './output-contract.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Controllers in whose scope lean-loop delegation is the default strategy.
 * Outside these controllers (e.g. the global main loop), delegation is not
 * enforced — lean-loop is controller-scoped only.
 *
 * @type {ReadonlySet<string>}
 */
const LEAN_LOOP_CONTROLLERS = Object.freeze(new Set(['ship', 'swarm']));

// ---------------------------------------------------------------------------
// shouldDelegate
// ---------------------------------------------------------------------------

/**
 * Determines whether a task should be delegated to an ephemeral worker.
 *
 * Delegation is the default WHEN:
 *   1. context.controller is one of the lean-loop controllers (ship, swarm).
 *   2. The task has a bounded touchSet (a non-empty array of file paths that
 *      the worker is expected to modify — i.e., the blast radius is known).
 *
 * Delegation is refused (delegate:false) in all other cases, including when
 * the controller is global/unrecognised — lean-loop is controller-scoped.
 *
 * Fail-open: unexpected context shapes (null, primitives) are treated as
 * non-controller contexts; they receive delegate:false with a descriptive reason.
 *
 * @param {{ controller?: string, touchSet?: unknown[] } | null | undefined} context
 * @returns {{ delegate: boolean, reason: string }}
 */
export function shouldDelegate(context) {
  const safeCtx = (context && typeof context === 'object' && !Array.isArray(context))
    ? context
    : {};

  const controller = typeof safeCtx.controller === 'string'
    ? safeCtx.controller
    : null;

  if (!controller) {
    return {
      delegate: false,
      reason: 'no controller in context — lean-loop is controller-scoped only',
    };
  }

  if (!LEAN_LOOP_CONTROLLERS.has(controller)) {
    return {
      delegate: false,
      reason: `controller '${controller}' is not in the lean-loop scope ` +
              `(${[...LEAN_LOOP_CONTROLLERS].join(', ')}); ` +
              'lean-loop is controller-scoped, not global',
    };
  }

  const touchSet = safeCtx.touchSet;
  const hasBoundedTouchSet = Array.isArray(touchSet) && touchSet.length > 0;

  if (!hasBoundedTouchSet) {
    return {
      delegate: false,
      reason: `controller '${controller}' is in scope but task has no bounded ` +
              'touchSet — cannot determine blast radius; delegation deferred',
    };
  }

  return {
    delegate: true,
    reason: `controller '${controller}' is in lean-loop scope and task has a ` +
            `bounded touchSet (${touchSet.length} path(s)); delegate to ephemeral worker`,
  };
}

// ---------------------------------------------------------------------------
// workerEnvelopeContract
// ---------------------------------------------------------------------------

/**
 * Returns the expected Worker Output Envelope shape that a delegated worker
 * MUST return. The orchestrator merges this envelope — it never re-parses
 * the raw worker prose.
 *
 * Composed from emptyEnvelope() + WORKER_ENVELOPE_VERSION (imported from
 * output-contract.mjs) so the contract is always in sync with the schema.
 *
 * @returns {{
 *   version: number,
 *   status: string,
 *   changed: [],
 *   verification: { command: string, exitCode: number },
 *   blockers: [],
 *   findings: [],
 *   artifact: string
 * }}
 */
export function workerEnvelopeContract() {
  const envelope = emptyEnvelope('ok');
  // Stamp the authoritative version so callers can inspect the contract schema.
  envelope.version = WORKER_ENVELOPE_VERSION;
  return envelope;
}

// ---------------------------------------------------------------------------
// validateWorkerReturn
// ---------------------------------------------------------------------------

/**
 * Validates an envelope returned by a delegated worker.
 *
 * Advisory: a non-conforming envelope is flagged in the return value — the
 * orchestrator decides what to do with the result (fail-open by convention).
 * This function never throws.
 *
 * @param {unknown} envelope - The object the delegated worker returned
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateWorkerReturn(envelope) {
  try {
    return validateEnvelope(envelope);
  } catch (unexpectedErr) {
    // validateEnvelope is designed not to throw, but guard defensively.
    return {
      valid: false,
      errors: [`validateWorkerReturn: unexpected error — ${unexpectedErr?.message ?? unexpectedErr}`],
    };
  }
}

// ---------------------------------------------------------------------------
// leanLoopSeam
// ---------------------------------------------------------------------------

/**
 * Returns the Phase-2 scope marker for the lean-loop global default.
 *
 * Phase 1 (now): delegation is ONLY the default inside controller-scoped
 * paths (ship, swarm). The global main loop is not controllable in Claude Code
 * and is explicitly excluded.
 *
 * Phase 2 (deferred): a future ADR may set phase2GlobalDefault:true and wire
 * this seam into the main loop's task dispatcher. Until that ADR exists, this
 * value MUST remain false — it is the one-line hook point, not the activation.
 *
 * @returns {{ scope: 'controller-only', phase2GlobalDefault: false }}
 */
export function leanLoopSeam() {
  return {
    scope: 'controller-only',
    phase2GlobalDefault: false,
  };
}

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Self-check suite for the lean-loop module.
 *
 * Pure and fail-open: every assertion is caught individually; a thrown error
 * becomes a failed check, not an unhandled rejection. Called by the wave
 * selfcheck runner with the repo root path.
 *
 * Assertions:
 *   1. shouldDelegate({controller:'swarm', touchSet:[...]}) → delegate:true
 *   2. shouldDelegate({controller:'global'}) → delegate:false (not in scope)
 *   3. shouldDelegate({}) → delegate:false (no controller)
 *   4. workerEnvelopeContract() PASSES validateEnvelope
 *   5. validateWorkerReturn rejects a malformed envelope
 *   6. leanLoopSeam().phase2GlobalDefault === false
 *
 * @param {string} _root - Repo root path (unused; present for runner signature parity)
 * @returns {{ name: string, pass: boolean, detail: string }[]}
 */
export function econCheckLeanLoop(_root) {
  const checkResults = [];

  /** @param {string} name @param {()=>void} fn */
  function check(name, fn) {
    try {
      fn();
      checkResults.push({ name, pass: true, detail: 'ok' });
    } catch (err) {
      checkResults.push({ name, pass: false, detail: err?.message ?? String(err) });
    }
  }

  /** @param {boolean} condition @param {string} msg */
  function assert(condition, msg) {
    if (!condition) throw new Error(msg);
  }

  // Check 1: swarm controller with bounded touchSet → delegate:true.
  check('shouldDelegate swarm+touchSet → delegate:true', () => {
    const result = shouldDelegate({ controller: 'swarm', touchSet: ['src/foo.mjs'] });
    assert(result.delegate === true,
      `expected delegate:true for swarm+touchSet, got ${JSON.stringify(result)}`);
    assert(typeof result.reason === 'string' && result.reason.length > 0,
      'reason must be a non-empty string');
  });

  // Check 2: ship controller with bounded touchSet → delegate:true.
  check('shouldDelegate ship+touchSet → delegate:true', () => {
    const result = shouldDelegate({ controller: 'ship', touchSet: ['lib/bar.mjs', 'lib/baz.mjs'] });
    assert(result.delegate === true,
      `expected delegate:true for ship+touchSet, got ${JSON.stringify(result)}`);
  });

  // Check 3: controller='global' → delegate:false (not in lean-loop scope).
  check('shouldDelegate controller=global → delegate:false (controller-scoped)', () => {
    const result = shouldDelegate({ controller: 'global' });
    assert(result.delegate === false,
      `expected delegate:false for controller='global', got ${JSON.stringify(result)}`);
    assert(result.reason.includes('not in the lean-loop scope'),
      `reason must explain scope restriction, got: "${result.reason}"`);
  });

  // Check 4: no controller in context → delegate:false.
  check('shouldDelegate no controller → delegate:false', () => {
    const result = shouldDelegate({});
    assert(result.delegate === false,
      `expected delegate:false for empty context, got ${JSON.stringify(result)}`);
  });

  // Check 5: swarm controller but no touchSet → delegate:false (unbounded).
  check('shouldDelegate swarm+no-touchSet → delegate:false (unbounded)', () => {
    const result = shouldDelegate({ controller: 'swarm' });
    assert(result.delegate === false,
      `expected delegate:false when touchSet missing, got ${JSON.stringify(result)}`);
  });

  // Check 6: workerEnvelopeContract() returns a valid envelope.
  check('workerEnvelopeContract passes validateEnvelope', () => {
    const contract = workerEnvelopeContract();
    const { valid, errors } = validateEnvelope(contract);
    assert(valid,
      `workerEnvelopeContract failed validation: ${(errors ?? []).join('; ')}`);
    assert(contract.version === WORKER_ENVELOPE_VERSION,
      `contract.version must equal WORKER_ENVELOPE_VERSION (${WORKER_ENVELOPE_VERSION}), got ${contract.version}`);
  });

  // Check 7: validateWorkerReturn rejects a malformed envelope.
  check('validateWorkerReturn rejects malformed envelope', () => {
    const { valid, errors } = validateWorkerReturn({ status: 'bad-status', version: 'x' });
    assert(valid === false,
      'expected valid:false for malformed envelope');
    assert(Array.isArray(errors) && errors.length > 0,
      `expected non-empty errors array, got ${JSON.stringify(errors)}`);
  });

  // Check 8: validateWorkerReturn accepts a well-formed envelope.
  check('validateWorkerReturn accepts valid emptyEnvelope', () => {
    const { valid } = validateWorkerReturn(emptyEnvelope('ok'));
    assert(valid === true, 'expected valid:true for emptyEnvelope(ok)');
  });

  // Check 9: leanLoopSeam().phase2GlobalDefault is strictly false.
  check('leanLoopSeam phase2GlobalDefault===false', () => {
    const seam = leanLoopSeam();
    assert(seam.phase2GlobalDefault === false,
      `phase2GlobalDefault must be false, got ${JSON.stringify(seam.phase2GlobalDefault)}`);
    assert(seam.scope === 'controller-only',
      `scope must be 'controller-only', got '${seam.scope}'`);
  });

  return checkResults;
}
