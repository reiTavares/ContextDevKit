/**
 * loop-breaker.mjs — Advisory loop-breaker signal for Economy Runtime
 * (WF0020, CDK-262 ECON-09).
 *
 * Public surface:
 *   detectLoop(history, opts)         — pure loop detection (re-exported)
 *   loopBreakerSignal(history, mode)  — projectState-compatible signal wrapper
 *   econCheckLoopBreaker(root)        — CI self-check suite → {name,pass,detail}[]
 *
 * `mode` semantics (mirrors the gate in evaluate-action.mjs):
 *   'advisory'  — escalate is ALWAYS false; signal is informational only
 *   'guarded'   — escalate is ALWAYS false; same advisory contract
 *   'strict'    — escalate may become true ONLY on the 4th provably-no-progress
 *                 repeat (reversible, human-bypassable, fingerprint-scoped,
 *                 self-clearing condition). All other kinds → escalate:false.
 *
 * UNREGISTERED (Phase 1): this lib is NOT wired into any hook or gate.
 * Wiring is a deferred activation gated on WF0019 CDK-032 consumer sign-off.
 * NEVER throws; NEVER blocks edits or the human override.
 *
 * Split rationale: pure detection logic (detectLoop + helpers + crypto) lives
 * in loop-breaker-core.mjs to keep both files within the 308-line constitution
 * ceiling (§1 +10% tolerance).
 *
 * Zero runtime dependencies — node:* only.
 */

export { detectLoop, MIN_REPEAT_THRESHOLD, LOOP_KINDS } from './loop-breaker-core.mjs';

import { detectLoop, MIN_REPEAT_THRESHOLD } from './loop-breaker-core.mjs';

// ---------------------------------------------------------------------------
// Escalation threshold for no-progress in strict mode
// ---------------------------------------------------------------------------

/**
 * Number of consecutive no-progress states required before escalate:true in
 * strict mode.  One above MIN_REPEAT_THRESHOLD so the first detection is
 * advisory, and only the 4th provably-identical state escalates.
 *
 * Conditions for escalate:true (ALL must hold simultaneously):
 *   1. mode === 'strict'
 *   2. kind === 'no-progress'
 *   3. count >= STRICT_ESCALATE_THRESHOLD
 *   — always reversible (human can override), fingerprint-scoped, self-clearing
 *     (any state change resets the run count to 0)
 */
const STRICT_ESCALATE_THRESHOLD = MIN_REPEAT_THRESHOLD + 1; // 4

// ---------------------------------------------------------------------------
// loopBreakerSignal
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LoopBreakerPayload
 * @property {boolean}         detected   - Mirror of detectLoop().loopDetected
 * @property {'repeat-error'|'repeat-diff'|'no-progress'|null} kind
 * @property {number}          count      - Run length (0 when not detected)
 * @property {string}          suggestion - Human-readable advisory hint
 * @property {boolean}         escalate   - True ONLY in strict+no-progress+4th repeat
 */

/**
 * Wraps detectLoop() into a projectState-compatible signal object.
 *
 * The returned shape can be merged into projectState by the deferred gate
 * activation as: `{ ...projectState, loopBreaker: signal.loopBreaker }`.
 *
 * Fail-open: any bad input (history missing/short, unknown mode) →
 * `{ loopBreaker: { detected:false, kind:null, count:0, suggestion:'No loop detected.', escalate:false } }`.
 * NEVER throws.
 *
 * @param {Array<{cmd?: string, error?: string, diffHash?: string, ts?: number}>} history
 * @param {'advisory'|'guarded'|'strict'} [mode='advisory']
 * @returns {{ loopBreaker: LoopBreakerPayload }}
 */
export function loopBreakerSignal(history, mode = 'advisory') {
  try {
    const detection = detectLoop(history);

    // escalate is true ONLY under the strict, no-progress, 4th-repeat condition.
    const escalate =
      mode === 'strict' &&
      detection.loopDetected &&
      detection.kind === 'no-progress' &&
      detection.count >= STRICT_ESCALATE_THRESHOLD;

    return {
      loopBreaker: {
        detected:   detection.loopDetected,
        kind:       detection.kind,
        count:      detection.count,
        suggestion: detection.suggestion,
        escalate,
      },
    };
  } catch {
    // Defensive: any unexpected error → fail-open no-signal
    return {
      loopBreaker: {
        detected:   false,
        kind:       null,
        count:      0,
        suggestion: 'No loop detected.',
        escalate:   false,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Self-check suite for loop-breaker.mjs + loop-breaker-core.mjs.
 * Pure and fail-open: each assertion is caught individually; a thrown error
 * becomes a failed check entry, not an unhandled rejection.
 * Called by the wave selfcheck runner with the repo root path.
 *
 * Checks:
 *   1.  3× identical cmd+error → loopDetected:true, kind:'repeat-error', count≥3
 *   2.  2× repeated diffHash below threshold → not yet detected (count < 3)
 *   3.  advisory mode → escalate:false even when repeat-error detected
 *   4.  guarded mode  → escalate:false even when repeat-error detected
 *   5.  strict + 4th no-progress → escalate:true
 *   6.  strict + 3rd no-progress (threshold not reached) → escalate:false
 *   7.  empty history → fail-open loopDetected:false, escalate:false
 *   8.  null history → fail-open loopDetected:false (no throw)
 *   9.  3× repeated diffHash → loopDetected:true, kind:'repeat-diff'
 *   10. no-progress at threshold → loopDetected:true, kind:'no-progress'
 *   11. fingerprint is non-null string when detected
 *   12. suggestion is non-empty string always
 *
 * @param {string} _root - Repo root (unused; present for runner signature)
 * @returns {{ name: string, pass: boolean, detail: string }[]}
 */
export function econCheckLoopBreaker(_root) {
  const checks = [];

  /** @param {string} name @param {()=>void} fn */
  function check(name, fn) {
    try {
      fn();
      checks.push({ name, pass: true, detail: 'ok' });
    } catch (err) {
      checks.push({ name, pass: false, detail: err?.message ?? String(err) });
    }
  }

  /** @param {boolean} cond @param {string} msg */
  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  // 1. repeat-error detection at threshold
  check('3× identical cmd+error → repeat-error detected, count≥3', () => {
    const entry = { cmd: 'npm test', error: 'ENOENT: no such file' };
    const history = [entry, entry, entry];
    const result = detectLoop(history);
    assert(result.loopDetected === true, `loopDetected must be true, got ${result.loopDetected}`);
    assert(result.kind === 'repeat-error', `kind must be 'repeat-error', got '${result.kind}'`);
    assert(result.count >= 3, `count must be ≥3, got ${result.count}`);
  });

  // 2. 2× repeated diffHash → below threshold, no detection
  check('2× repeated diffHash below threshold → not yet detected', () => {
    const history = [
      { diffHash: 'abc123' },
      { diffHash: 'abc123' },
    ];
    const result = detectLoop(history);
    // history.length < MIN_REPEAT_THRESHOLD (3) → fail-open
    assert(result.loopDetected === false, `should not detect with only 2 entries, got ${result.loopDetected}`);
    assert(result.count === 0, `count should be 0 below threshold, got ${result.count}`);
  });

  // 3. advisory mode → escalate:false even when loop detected
  check('advisory mode → escalate:false when repeat-error detected', () => {
    const entry   = { cmd: 'build', error: 'TypeScript error' };
    const history = [entry, entry, entry];
    const sig = loopBreakerSignal(history, 'advisory');
    assert(sig.loopBreaker.detected  === true,  'loop must be detected');
    assert(sig.loopBreaker.escalate  === false,  'escalate must be false in advisory mode');
  });

  // 4. guarded mode → escalate:false
  check('guarded mode → escalate:false even when loop detected', () => {
    const entry   = { cmd: 'lint', error: 'Unexpected token' };
    const history = [entry, entry, entry];
    const sig = loopBreakerSignal(history, 'guarded');
    assert(sig.loopBreaker.escalate === false, 'escalate must be false in guarded mode');
  });

  // 5. strict + 4th no-progress → escalate:true
  check('strict mode + 4th no-progress repeat → escalate:true', () => {
    // Use an entry with ONLY cmd (no error, no diffHash) so:
    //   - cmdErrorKey() → null  (error is absent) → repeat-error pass skips
    //   - diffHashKey() → null  (diffHash absent)  → repeat-diff pass skips
    //   - stateFingerprint() → hash of cmd alone   → no-progress fires at count=4
    const entry = { cmd: 'static-analysis-pass' };
    const history = [entry, entry, entry, entry];
    const sig = loopBreakerSignal(history, 'strict');
    assert(sig.loopBreaker.detected === true,
      `loop must be detected; kind=${sig.loopBreaker.kind} count=${sig.loopBreaker.count}`);
    assert(sig.loopBreaker.kind === 'no-progress',
      `kind must be 'no-progress' to reach escalate gate, got '${sig.loopBreaker.kind}'`);
    assert(sig.loopBreaker.escalate === true,
      `escalate must be true for strict no-progress at count≥4; count=${sig.loopBreaker.count}`);
  });

  // 6. strict + 3rd no-progress (exactly threshold) → escalate:false because repeat-error fires first
  // (when cmd+error both present, repeat-error takes priority; escalate stays false at count=3)
  check('strict + repeat-error at count=3 → escalate:false (not no-progress)', () => {
    const entry = { cmd: 'go build', error: 'undefined: Foo' };
    const history = [entry, entry, entry];
    const sig = loopBreakerSignal(history, 'strict');
    assert(sig.loopBreaker.kind === 'repeat-error', `expected repeat-error, got ${sig.loopBreaker.kind}`);
    assert(sig.loopBreaker.escalate === false,
      'repeat-error at count=3 in strict mode should not escalate (only no-progress 4th does)');
  });

  // 7. empty history → fail-open
  check('empty history → fail-open: loopDetected:false, escalate:false', () => {
    const sig = loopBreakerSignal([], 'strict');
    assert(sig.loopBreaker.detected  === false, 'empty history must yield detected:false');
    assert(sig.loopBreaker.escalate  === false, 'empty history must yield escalate:false');
    assert(sig.loopBreaker.kind      === null,  'empty history must yield kind:null');
  });

  // 8. null history → fail-open, no throw
  check('null history → fail-open: no throw, loopDetected:false', () => {
    const sig = loopBreakerSignal(null, 'advisory');
    assert(sig.loopBreaker.detected === false, 'null history must yield detected:false');
  });

  // 9. 3× repeated diffHash → repeat-diff detection
  check('3× repeated diffHash → kind:repeat-diff detected', () => {
    // Use entries with NO cmd/error so repeat-error pass yields null → falls through to diffHash
    const entry = { diffHash: 'beefcafe00112233' };
    const history = [entry, entry, entry];
    const result = detectLoop(history);
    assert(result.loopDetected === true,      `loopDetected must be true`);
    assert(result.kind === 'repeat-diff',     `kind must be 'repeat-diff', got '${result.kind}'`);
    assert(result.count >= 3,                 `count must be ≥3, got ${result.count}`);
  });

  // 10. no-progress at threshold
  check('3× identical combined state → kind:no-progress detected', () => {
    // Entries have cmd but NO error and NO diffHash so repeat-error + repeat-diff both null
    const entry = { cmd: 'analyze' };
    const history = [entry, entry, entry];
    const result = detectLoop(history);
    assert(result.loopDetected === true,       `loopDetected must be true`);
    assert(result.kind === 'no-progress',      `kind must be 'no-progress', got '${result.kind}'`);
  });

  // 11. fingerprint is non-null string when detected
  check('fingerprint is a non-null string when loop detected', () => {
    const entry = { cmd: 'test', error: 'fail' };
    const result = detectLoop([entry, entry, entry]);
    assert(result.fingerprint !== null,               'fingerprint must not be null when detected');
    assert(typeof result.fingerprint === 'string',    'fingerprint must be a string');
    assert(result.fingerprint.length > 0,             'fingerprint must be non-empty');
  });

  // 12. suggestion is non-empty string always (even on fail-open)
  check('suggestion is always a non-empty string', () => {
    const noLoop = detectLoop([]);
    assert(typeof noLoop.suggestion === 'string' && noLoop.suggestion.length > 0,
      'suggestion must be non-empty even when no loop detected');
    const loop   = detectLoop([{ cmd: 'x', error: 'e' }, { cmd: 'x', error: 'e' }, { cmd: 'x', error: 'e' }]);
    assert(typeof loop.suggestion === 'string' && loop.suggestion.length > 0,
      'suggestion must be non-empty when loop detected');
  });

  return checks;
}
