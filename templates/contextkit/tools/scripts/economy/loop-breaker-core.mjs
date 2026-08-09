/**
 * loop-breaker-core.mjs — Pure loop-detection logic for the Economy Runtime
 * advisory loop-breaker (WF0020, CDK-262 ECON-09).
 *
 * WHY split from loop-breaker.mjs: detectLoop + its fingerprinting helpers are
 * the heaviest concern (crypto import, 3 detection passes, fingerprint build).
 * Keeping them here lets loop-breaker.mjs stay within the 308-line constitution
 * ceiling while housing the CI check and the projectState signal wrapper.
 *
 * Exports consumed by loop-breaker.mjs:
 *   detectLoop, LOOP_KINDS, MIN_REPEAT_THRESHOLD
 *
 * Advisory + fail-open: every export returns a safe default on bad/short input —
 * see each function's JSDoc. NEVER throws to the caller.
 *
 * Pure + deterministic: no I/O, no Date.now(), no side effects.
 * Zero runtime dependencies — node:crypto only.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Minimum consecutive repeats required to trigger a detection. */
export const MIN_REPEAT_THRESHOLD = 3;

/** Valid loop-kind discriminants (null means no loop). */
export const LOOP_KINDS = Object.freeze([
  'repeat-error',
  'repeat-diff',
  'no-progress',
]);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns a short SHA-256 hex digest of an arbitrary string.
 * Used for stable fingerprinting across detection passes.
 *
 * @param {string} text
 * @returns {string} 16-char hex prefix of SHA-256
 */
function shortHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Extracts the cmd+error identity key from a single history entry.
 * Returns null when either field is missing/empty so we don't
 * fabricate a false match on sparse data.
 *
 * @param {object} entry
 * @returns {string|null}
 */
function cmdErrorKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const cmd   = typeof entry.cmd   === 'string' && entry.cmd.trim()   ? entry.cmd.trim()   : null;
  const error = typeof entry.error === 'string' && entry.error.trim() ? entry.error.trim() : null;
  if (cmd === null || error === null) return null;
  return `${cmd}\x00${error}`;
}

/**
 * Extracts the diffHash from a single history entry.
 * Returns null when the field is missing, empty, or non-string.
 *
 * @param {object} entry
 * @returns {string|null}
 */
function diffHashKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return typeof entry.diffHash === 'string' && entry.diffHash.trim()
    ? entry.diffHash.trim()
    : null;
}

/**
 * Counts the longest consecutive run at the TAIL of an array that shares the
 * same non-null key (as returned by `keyFn`).
 *
 * Returns `{ count, value }` where `value` is the key text and `count` is
 * the run length.  When the tail key is null or there are fewer than 1
 * entries, returns `{ count: 0, value: null }`.
 *
 * @param {object[]} entries
 * @param {(entry: object) => string|null} keyFn
 * @returns {{ count: number, value: string|null }}
 */
function trailingRun(entries, keyFn) {
  if (!Array.isArray(entries) || entries.length === 0) return { count: 0, value: null };

  const lastKey = keyFn(entries[entries.length - 1]);
  if (lastKey === null) return { count: 0, value: null };

  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (keyFn(entries[i]) === lastKey) {
      count++;
    } else {
      break;
    }
  }
  return { count, value: lastKey };
}

// ---------------------------------------------------------------------------
// Stable-state fingerprinting for no-progress detection
// ---------------------------------------------------------------------------

/**
 * Builds a stable-state fingerprint from a single history entry by hashing
 * the combination of cmd, error, and diffHash (all optional but at least one
 * must be present).  Returns null when all three fields are missing/empty.
 *
 * Rationale: no-progress means consecutive states that look identical even if
 * cmd varies slightly (e.g. timestamp in args).  Hashing the combination
 * captures that while remaining portable and deterministic.
 *
 * @param {object} entry
 * @returns {string|null}
 */
function stateFingerprint(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const cmd      = typeof entry.cmd      === 'string' ? entry.cmd.trim()      : '';
  const error    = typeof entry.error    === 'string' ? entry.error.trim()    : '';
  const diffHash = typeof entry.diffHash === 'string' ? entry.diffHash.trim() : '';

  if (!cmd && !error && !diffHash) return null;
  return shortHash(`${cmd}\x01${error}\x01${diffHash}`);
}

// ---------------------------------------------------------------------------
// detectLoop — main export
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LoopDetectionResult
 * @property {boolean}         loopDetected - True when a loop pattern was found
 * @property {'repeat-error'|'repeat-diff'|'no-progress'|null} kind - Loop variant
 * @property {number}          count        - Length of the detected run (0 when none)
 * @property {string|null}     fingerprint  - Stable hex fingerprint of the repeated unit
 * @property {string}          suggestion   - Human-readable advisory suggestion
 */

/**
 * Detects three loop patterns in an ordered action-history array:
 *
 *   (a) repeat-error:   same cmd+error ≥ MIN_REPEAT_THRESHOLD consecutive times.
 *   (b) repeat-diff:    same diffHash  ≥ MIN_REPEAT_THRESHOLD consecutive times.
 *   (c) no-progress:    same combined state-fingerprint ≥ MIN_REPEAT_THRESHOLD times.
 *
 * Priority: repeat-error is checked first; if that doesn't fire, repeat-diff;
 * then no-progress.  This ordering matches severity (error-loops are the most
 * actionable signal).
 *
 * Fail-open guarantees:
 *   - history is null / undefined / non-array → no-signal result
 *   - history has fewer than MIN_REPEAT_THRESHOLD entries → no-signal result
 *   - any entry that is missing the relevant field is treated as a non-match
 *     (so sparse data shrinks the run count, never inflates it)
 *
 * Pure + deterministic: no I/O, no Date.now().
 *
 * @param {Array<{cmd?: string, error?: string, diffHash?: string, ts?: number}>} history
 * @param {object} [opts] - Reserved for future threshold overrides; currently unused
 * @returns {LoopDetectionResult}
 */
export function detectLoop(history, opts = {}) {
  void opts; // reserved — no opts in Phase 1

  /** @type {LoopDetectionResult} */
  const noSignal = {
    loopDetected: false,
    kind:         null,
    count:        0,
    fingerprint:  null,
    suggestion:   'No loop detected.',
  };

  // Fail-open: bad/short history
  if (!Array.isArray(history) || history.length < MIN_REPEAT_THRESHOLD) return noSignal;

  // --- Pass (a): repeat-error ---
  const cmdErrRun = trailingRun(history, cmdErrorKey);
  if (cmdErrRun.count >= MIN_REPEAT_THRESHOLD) {
    return {
      loopDetected: true,
      kind:         'repeat-error',
      count:        cmdErrRun.count,
      fingerprint:  shortHash(cmdErrRun.value),
      suggestion:
        `The same command+error has repeated ${cmdErrRun.count}× consecutively. ` +
        'Consider trying a different approach, checking dependencies, or pausing ' +
        'for a human review before retrying.',
    };
  }

  // --- Pass (b): repeat-diff ---
  const diffRun = trailingRun(history, diffHashKey);
  if (diffRun.count >= MIN_REPEAT_THRESHOLD) {
    return {
      loopDetected: true,
      kind:         'repeat-diff',
      count:        diffRun.count,
      fingerprint:  shortHash(diffRun.value),
      suggestion:
        `The same code diff has been applied ${diffRun.count}× without apparent progress. ` +
        'Verify that the change is being persisted and that tests or linters are not ' +
        'silently reverting it.',
    };
  }

  // --- Pass (c): no-progress ---
  const stateRun = trailingRun(history, stateFingerprint);
  if (stateRun.count >= MIN_REPEAT_THRESHOLD) {
    return {
      loopDetected: true,
      kind:         'no-progress',
      count:        stateRun.count,
      fingerprint:  shortHash(stateRun.value),
      suggestion:
        `${stateRun.count} consecutive actions produced identical state. ` +
        'The session may be stuck. Consider running /project-map to refresh ' +
        'context or requesting a human review.',
    };
  }

  return noSignal;
}
