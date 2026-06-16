/**
 * run-compact-core.mjs — pure delta / fingerprint functions for ECON-04.
 *
 * Cohesion note: split from run-compact.mjs because these fns are pure
 * (no I/O, no spawning) and the combined file would exceed the 308-line budget.
 * The single concern is "normalize + hash + diff two run snapshots".
 *
 * Zero runtime dependencies — node:* only.
 * Advisory / fail-open: bad input yields empty/false results, never throws to caller.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

/** ANSI escape sequences (CSI + OSC + standalone ESC). */
const RE_ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\].*?(?:\x07|\x1B\\))/g;

/**
 * ISO-8601 timestamps and common clock patterns.
 * Matches: 2026-06-16T12:34:56.789Z, 2026-06-16 12:34:56, HH:MM:SS(.mmm)
 */
const RE_TIMESTAMPS = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?|\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;

/**
 * Absolute path prefixes (Unix + Windows).
 * Strips leading /home/… or C:\… or D:\… so output is path-agnostic.
 */
const RE_ABS_PATH = /(?:[A-Za-z]:[/\\]|\/(?:home|Users|var|tmp|opt|usr|root)\/)[^\s"'`)]+/g;

/** CRLF → LF normalizer. */
const RE_CRLF = /\r\n/g;

/** Secret-pattern redaction (best-effort). Applied at WRITE time, not in fingerprint. */
const RE_SECRET = /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)\S+/gi;

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes raw command output for stable hashing:
 *   1. CRLF → LF
 *   2. Strip ANSI escapes
 *   3. Redact ISO/clock timestamps
 *   4. Redact absolute cwd paths
 *   5. Collapse trailing whitespace per line
 *   6. Strip leading/trailing blank lines
 *
 * Does NOT redact secrets — that is handled at write time to preserve
 * diagnostic value in the console view.
 *
 * @param {string} rawOutput
 * @returns {string}
 */
export function normalizeOutput(rawOutput) {
  if (typeof rawOutput !== 'string') return '';
  return rawOutput
    .replace(RE_CRLF, '\n')
    .replace(RE_ANSI, '')
    .replace(RE_TIMESTAMPS, '<ts>')
    .replace(RE_ABS_PATH, '<path>')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Redacts obvious secrets from a string.
 * Applied at file-write time only (not in the fingerprint path).
 *
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  return text.replace(RE_SECRET, '$1***');
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Produces a stable SHA-256 hex fingerprint of the logical output.
 * Two runs with the same logical output (modulo timestamps / paths / ANSI)
 * produce the same fingerprint.
 *
 * @param {string} rawOutput
 * @returns {string} 64-char hex digest
 */
export function fingerprintRun(rawOutput) {
  const normalized = normalizeOutput(rawOutput);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Failure identity extraction
// ---------------------------------------------------------------------------

/**
 * Regular expressions for common test-runner failure lines, in priority order.
 * Each pattern captures a group[1] that serves as the identity string.
 *
 * Formats matched:
 *   - TAP:    "not ok 12 - suite > test name"
 *   - Jest/Vitest: "FAIL src/foo.test.ts" or "● foo > bar"
 *   - pytest: "FAILED tests/test_foo.py::test_bar"
 *   - go test: "--- FAIL: TestFoo (0.00s)"
 */
const FAILURE_PATTERNS = [
  /^not ok \d+\s*[-–]?\s*(.+)/,                // TAP
  /^\s+●\s+(.+)/,                               // Jest / Vitest suite·test
  /^FAIL\s+(\S+\.(?:test|spec)\.\S+)/,          // Jest FAIL file line
  /^FAILED\s+(\S+::\S+)/,                       // pytest
  /^---\s+FAIL:\s+(\w+)/,                       // go test
];

/**
 * Best-effort extraction of failed test identities from raw output.
 * Returns a sorted array of unique identity strings.
 * If no recognized pattern matches, returns an empty array.
 *
 * @param {string} rawOutput
 * @returns {string[]}
 */
export function failureIdentity(rawOutput) {
  if (typeof rawOutput !== 'string') return [];
  const identities = new Set();
  const lines = rawOutput.replace(RE_CRLF, '\n').replace(RE_ANSI, '').split('\n');
  for (const line of lines) {
    for (const pattern of FAILURE_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        identities.add(match[1].trim());
        break;
      }
    }
  }
  return [...identities].sort();
}

// ---------------------------------------------------------------------------
// Delta comparison
// ---------------------------------------------------------------------------

/**
 * @typedef {{ fingerprint: string, failures: string[] }} RunSnapshot
 */

/**
 * Compares two run snapshots and reports what changed.
 *
 * - `changed`: true when fingerprints differ (even if no identifiable failures).
 * - `newFailures`: failure identities present in `cur` but not `prev`.
 * - `fixed`: failure identities present in `prev` but not `cur`.
 *
 * @param {RunSnapshot} prev
 * @param {RunSnapshot} cur
 * @returns {{ changed: boolean, newFailures: string[], fixed: string[] }}
 */
export function deltaRuns(prev, cur) {
  const safePrev = prev && typeof prev === 'object' ? prev : {};
  const safeCur  = cur  && typeof cur  === 'object' ? cur  : {};

  const prevFp = typeof safePrev.fingerprint === 'string' ? safePrev.fingerprint : '';
  const curFp  = typeof safeCur.fingerprint  === 'string' ? safeCur.fingerprint  : '';
  const changed = prevFp !== curFp;

  const prevSet = new Set(Array.isArray(safePrev.failures) ? safePrev.failures : []);
  const curSet  = new Set(Array.isArray(safeCur.failures)  ? safeCur.failures  : []);

  const newFailures = [...curSet].filter((f) => !prevSet.has(f)).sort();
  const fixed       = [...prevSet].filter((f) => !curSet.has(f)).sort();

  return { changed, newFailures, fixed };
}

// ---------------------------------------------------------------------------
// Test-runner tier-2 matcher
// ---------------------------------------------------------------------------

/**
 * @typedef {{ matched: boolean, passed: number, failed: number, skipped: number, note?: string }} MatchResult
 */

/**
 * Tier-2 matcher: attempts to parse test-runner summary lines from output.
 * If NO recognized pattern matches, returns `matched: false` and
 * `note: 'summary unavailable'` — NEVER fabricates "0 failures".
 *
 * Recognizes:
 *   - TAP:    "# tests N", "# pass N", "# fail N"
 *   - Jest:   "Tests: N passed, M failed, P skipped"
 *   - Vitest: "✓ N | × M | ↓ P" or "Test Files N passed | M failed"
 *   - pytest: "N passed, M failed, P skipped"
 *   - go test: "ok  pkg  0.000s" / "FAIL pkg  0.000s"
 *
 * @param {string} rawOutput
 * @returns {MatchResult}
 */
export function matchSummary(rawOutput) {
  if (typeof rawOutput !== 'string') return { matched: false, note: 'summary unavailable' };
  const text = rawOutput.replace(RE_CRLF, '\n').replace(RE_ANSI, '');

  // TAP protocol
  const tapTests = /^#\s+tests\s+(\d+)/m.exec(text);
  const tapPass  = /^#\s+pass\s+(\d+)/m.exec(text);
  const tapFail  = /^#\s+fail\s+(\d+)/m.exec(text);
  if (tapTests || tapPass || tapFail) {
    const passed  = tapPass  ? parseInt(tapPass[1],  10) : 0;
    const failed  = tapFail  ? parseInt(tapFail[1],  10) : 0;
    const total   = tapTests ? parseInt(tapTests[1], 10) : passed + failed;
    return { matched: true, passed, failed, skipped: Math.max(0, total - passed - failed) };
  }

  // Jest / Vitest prose summary: "Tests: N passed, M failed"
  const jestLine = /Tests?:\s*((?:\d+\s+\w+(?:,\s*)?)+)/m.exec(text);
  if (jestLine) {
    const passM = /(\d+)\s+passed/.exec(jestLine[1]);
    const failM = /(\d+)\s+failed/.exec(jestLine[1]);
    const skipM = /(\d+)\s+skipped/.exec(jestLine[1]);
    return {
      matched: true,
      passed:  passM ? parseInt(passM[1], 10) : 0,
      failed:  failM ? parseInt(failM[1], 10) : 0,
      skipped: skipM ? parseInt(skipM[1], 10) : 0,
    };
  }

  // pytest: "N passed, M failed, P skipped" or "N passed"
  const pytestLine = /(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+(?:skipped|warning))?/m.exec(text);
  if (pytestLine) {
    return {
      matched: true,
      passed:  parseInt(pytestLine[1], 10),
      failed:  pytestLine[2] ? parseInt(pytestLine[2], 10) : 0,
      skipped: pytestLine[3] ? parseInt(pytestLine[3], 10) : 0,
    };
  }

  // go test: count ok / FAIL lines
  const goOk   = (text.match(/^ok\s+\S+/mg)   || []).length;
  const goFail  = (text.match(/^FAIL\s+\S+/mg)  || []).length;
  if (goOk > 0 || goFail > 0) {
    return { matched: true, passed: goOk, failed: goFail, skipped: 0 };
  }

  return { matched: false, note: 'summary unavailable' };
}
