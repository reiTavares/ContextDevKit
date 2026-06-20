/**
 * tc-accept-core.mjs — Pure per-criterion evaluators and escalation detector
 * for the Task-Compiler acceptance gate (WF0022 / ADR-0090 §C).
 *
 * WHY split from tc-accept.mjs: the five per-kind evaluator functions plus the
 * escalation detector push the parent file past the 308-line constitution ceiling
 * (§1 +10% tolerance). All functions here are purely functional (no I/O, no
 * side-effects) and form a single cohesion unit: criterion-level signal decoding.
 *
 * Zero runtime dependencies — node:* only.
 * [task-compiler] [token-economy] [WF0022]
 */

// ---------------------------------------------------------------------------
// Escalation trigger keys
// ---------------------------------------------------------------------------

/** Signal names that trigger escalation when present in the observed map. */
export const ESCALATION_TRIGGER_KEYS = [
  'subjectiveAcceptance',
  'thinCriticalPathCoverage',
  'securityOrPiiFindings',
  'highRiskPath',
];

// ---------------------------------------------------------------------------
// Per-kind evaluators
// ---------------------------------------------------------------------------

/**
 * Evaluates a `file_exists` criterion.
 * Passes when observed?.exists === true; skips if observation is absent.
 *
 * @param {object} criterion - The criterion object.
 * @param {object} observed  - Injected observation map (keyed by criterion label).
 * @param {string} label     - Resolved criterion label.
 * @returns {{ status: 'pass'|'fail'|'skipped', detail: string }}
 */
export function evalFileExists(criterion, observed, label) {
  const observedExists =
    observed?.[label]?.exists ?? criterion?.observedExists;
  if (observedExists === undefined || observedExists === null) {
    return { status: 'skipped', detail: 'file existence not observed (no injection)' };
  }
  return observedExists
    ? { status: 'pass', detail: 'file exists' }
    : { status: 'fail', detail: 'file not found' };
}

/**
 * Evaluates an `exitCode` criterion.
 * Passes when the observed exit code matches the expected value (default 0).
 *
 * @param {object} criterion
 * @param {object} observed
 * @param {string} label
 * @returns {{ status: 'pass'|'fail'|'skipped', detail: string }}
 */
export function evalExitCode(criterion, observed, label) {
  const expected = criterion?.expected ?? 0;
  const actual   =
    observed?.[label]?.exitCode ?? criterion?.observedExitCode;
  if (actual === undefined || actual === null) {
    return { status: 'skipped', detail: 'exit code not observed (no injection)' };
  }
  return actual === expected
    ? { status: 'pass', detail: `exit code ${actual} matches expected ${expected}` }
    : { status: 'fail', detail: `exit code ${actual} ≠ expected ${expected}` };
}

/**
 * Evaluates a `command` criterion.
 * Passes when the injected result object's exitCode equals the expected value.
 *
 * @param {object} criterion
 * @param {object} observed
 * @param {string} label
 * @returns {{ status: 'pass'|'fail'|'skipped', detail: string }}
 */
export function evalCommand(criterion, observed, label) {
  const result = observed?.[label];
  if (!result || typeof result !== 'object') {
    return { status: 'skipped', detail: 'command result not observed (no injection)' };
  }
  const exitCode = result.exitCode ?? result.exit ?? null;
  if (exitCode === null) {
    return { status: 'skipped', detail: 'command exit code missing in observation' };
  }
  const expected = criterion?.expected ?? 0;
  return exitCode === expected
    ? { status: 'pass', detail: `command exited ${exitCode}` }
    : { status: 'fail', detail: `command exited ${exitCode} ≠ expected ${expected}` };
}

/**
 * Evaluates a `grep_absent` criterion.
 * Passes when the pattern was NOT matched (matched === false).
 *
 * @param {object} criterion
 * @param {object} observed
 * @param {string} label
 * @returns {{ status: 'pass'|'fail'|'skipped', detail: string }}
 */
export function evalGrepAbsent(criterion, observed, label) {
  const matched =
    observed?.[label]?.matched ?? criterion?.observedMatched;
  if (matched === undefined || matched === null) {
    return { status: 'skipped', detail: 'grep_absent not observed (no injection)' };
  }
  return !matched
    ? { status: 'pass', detail: 'pattern absent as required' }
    : { status: 'fail', detail: 'forbidden pattern found in output' };
}

/**
 * Evaluates a `coverage` criterion.
 * Passes when the observed percentage meets or exceeds the configured threshold.
 *
 * @param {object} criterion
 * @param {object} observed
 * @param {string} label
 * @returns {{ status: 'pass'|'fail'|'skipped', detail: string }}
 */
export function evalCoverage(criterion, observed, label) {
  const threshold =
    typeof criterion?.threshold === 'number' ? criterion.threshold : 0;
  const actualPct = observed?.[label]?.pct ?? criterion?.observedPct;
  if (actualPct === undefined || actualPct === null) {
    return { status: 'skipped', detail: 'coverage not observed (no injection)' };
  }
  return actualPct >= threshold
    ? { status: 'pass', detail: `coverage ${actualPct}% ≥ threshold ${threshold}%` }
    : { status: 'fail', detail: `coverage ${actualPct}% < threshold ${threshold}%` };
}

// ---------------------------------------------------------------------------
// Escalation detector
// ---------------------------------------------------------------------------

/**
 * Detects escalation triggers present in the observed signals map.
 * Returns the list of triggered keys so the gate can surface them.
 *
 * @param {object} observed - Injected observation map.
 * @returns {{ triggered: boolean, triggers: string[] }}
 */
export function detectEscalation(observed) {
  const triggers = ESCALATION_TRIGGER_KEYS.filter(
    (key) => observed && observed[key] === true
  );
  return { triggered: triggers.length > 0, triggers };
}
