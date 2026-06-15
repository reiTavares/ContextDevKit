/**
 * evaluate-subagent-scope.mjs — Pure subagent scope evaluator (CDK-041, ADR-0072).
 *
 * Compares a subagent's OBSERVED touched paths against the scope it DECLARED at
 * spawn time (an allowed touch-set) plus a FORBIDDEN list (high-risk paths it must
 * never write). It returns the canonical { decision, reasonCodes, remediation,
 * detail } shape used by the subagent-gate hook — exactly mirroring
 * evaluate-completion.mjs / evaluate-action.mjs so the hook layer stays uniform.
 *
 * Observability honesty (the anti-false-positive rule, ADR-0072 §8):
 *   Subagent writes are only BEST-EFFORT observable. When the subagent declared
 *   NO touch-set, we cannot know what was in scope, so an out-of-scope write is
 *   UNOBSERVABLE — we degrade to silence (allow) rather than fabricate a warning.
 *   The FORBIDDEN list, by contrast, is an absolute denylist: a touched path that
 *   matches it is always flagged, regardless of whether a touch-set was declared.
 *   Unknown / unobservable → allow (skipped), NEVER warn. A false negative here is
 *   acceptable (advisory layer); a false positive that nags on every spawn is not.
 *
 * Advisory mode rule:
 *   Advisory NEVER denies — the result is `warn` when reasonCodes are present.
 *   Guarded and strict modes produce `deny` on reasonCodes (wired but inert in v1).
 *
 * PURE FUNCTION — zero I/O, no Date.now() in the signature path. All inputs arrive
 * via parameters so tests are fully deterministic.
 *
 * Zero runtime deps — this module imports nothing.
 */

/** Reason code: a subagent wrote outside its declared touch-set. */
export const REASON_OUT_OF_SCOPE = 'subagent-out-of-scope-write';
/** Reason code: a subagent wrote to a forbidden (high-risk / contract-marked) path. */
export const REASON_FORBIDDEN_WRITE = 'subagent-forbidden-write';

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

/**
 * Normalizes a path to a comparable token: trims, converts backslashes to forward
 * slashes, and strips a leading `./`. Non-strings normalize to an empty string so
 * a malformed entry can never throw or accidentally match.
 *
 * @param {unknown} path
 * @returns {string}
 */
function normalizePath(path) {
  if (typeof path !== 'string') return '';
  return path.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Returns true when `target` is covered by a single `pattern`. Three forms, in
 * ascending breadth — all interpreted as repo-relative, forward-slashed tokens:
 *   - exact:            `src/a.mjs`           matches only `src/a.mjs`
 *   - directory prefix: `src/`                matches anything under `src/`
 *   - glob suffix:      `src/**` or `src/*`   matches anything under `src/`
 * A bare directory name with no trailing slash (`src`) is treated as a directory
 * prefix too, since that is the common developer shorthand for "this folder".
 *
 * @param {string} target normalized touched path
 * @param {string} pattern normalized scope/forbidden entry
 * @returns {boolean}
 */
function matchesPattern(target, pattern) {
  if (!target || !pattern) return false;
  if (pattern === target) return true;

  // Glob suffix: strip a trailing /** or /* (or bare ** / *) to a directory prefix.
  let prefix = pattern.replace(/\/\*\*?$/, '/').replace(/\*\*?$/, '');
  if (prefix !== pattern) {
    if (prefix === '') return true; // bare '**' / '*' → match everything
    return target === prefix.replace(/\/$/, '') || target.startsWith(ensureTrailingSlash(prefix));
  }

  // Directory prefix: explicit trailing slash, OR a bare token with no extension
  // (a folder shorthand). A token that looks like a file (has a dot in the last
  // segment) is treated as an exact path only.
  if (pattern.endsWith('/')) return target.startsWith(pattern);
  if (!lastSegmentLooksLikeFile(pattern)) return target.startsWith(ensureTrailingSlash(pattern));
  return false;
}

/** Appends a single trailing slash if absent. @param {string} value @returns {string} */
function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

/**
 * Heuristic: the last path segment "looks like a file" when it contains a dot that
 * is not the first character (so `.gitignore` is NOT a file by this test, but
 * `a.mjs` is). Used only to decide whether a bare pattern is a folder or a file.
 *
 * @param {string} pattern
 * @returns {boolean}
 */
function lastSegmentLooksLikeFile(pattern) {
  const segment = pattern.split('/').pop() ?? '';
  const dot = segment.indexOf('.');
  return dot > 0;
}

/**
 * Returns true when `target` is covered by ANY pattern in `patterns`.
 *
 * @param {string} target normalized touched path
 * @param {string[]} patterns normalized pattern list
 * @returns {boolean}
 */
function coveredByAny(target, patterns) {
  for (const pattern of patterns) {
    if (matchesPattern(target, pattern)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Decision derivation
// ---------------------------------------------------------------------------

/**
 * Translates (mode, reasonCodes) into the final allow/warn/deny decision.
 * Advisory invariant: NEVER deny. Guarded + strict: deny when reason codes present.
 *
 * @param {'advisory'|'guarded'|'strict'} mode
 * @param {string[]} reasonCodes
 * @returns {'allow'|'warn'|'deny'}
 */
function deriveDecision(mode, reasonCodes) {
  if (reasonCodes.length === 0) return 'allow';
  switch (mode) {
    case 'guarded':
    case 'strict':
      return 'deny';
    case 'advisory':
    default:
      return 'warn';
  }
}

// ---------------------------------------------------------------------------
// Main pure decision function
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a subagent's observed writes stayed within the scope it
 * declared at spawn, and never touched a forbidden path.
 *
 * Decision rules (advisory v1):
 *   - No touched paths → allow silently (nothing observed → nothing to judge).
 *   - Forbidden hit → flag (denylist is absolute, even with no declared scope).
 *   - Out-of-scope write → flag ONLY when a non-empty touch-set was declared
 *     (empty declared = scope unknown = unobservable → never an out-of-scope warn).
 *   - mode maps reasonCodes to warn (advisory) or deny (guarded/strict).
 *
 * @param {{
 *   declared?: string[],
 *   touched?: string[],
 *   forbidden?: string[],
 *   mode?: 'advisory'|'guarded'|'strict'
 * }} params
 * @returns {{
 *   decision: 'allow'|'warn'|'deny',
 *   reasonCodes: string[],
 *   remediation: string[],
 *   detail: { outOfScope: string[], forbiddenHits: string[] }
 * }}
 */
export function evaluateSubagentScope({ declared, touched, forbidden, mode = 'advisory' } = {}) {
  const declaredList = toNormalizedList(declared);
  const forbiddenList = toNormalizedList(forbidden);
  const touchedList = toNormalizedList(touched);

  const empty = {
    decision: 'allow',
    reasonCodes: [],
    remediation: [],
    detail: { outOfScope: [], forbiddenHits: [] },
  };

  // Nothing observed → nothing to judge. Graceful degradation, not a false positive.
  if (touchedList.length === 0) return empty;

  const forbiddenHits = [];
  const outOfScope = [];
  const scopeDeclared = declaredList.length > 0;

  for (const path of touchedList) {
    // Forbidden is an absolute denylist — checked regardless of declared scope.
    if (coveredByAny(path, forbiddenList)) {
      forbiddenHits.push(path);
      continue; // a forbidden hit subsumes the out-of-scope signal for this path
    }
    // Out-of-scope only judged when a scope was actually declared (else unobservable).
    if (scopeDeclared && !coveredByAny(path, declaredList)) {
      outOfScope.push(path);
    }
  }

  const reasonCodes = [];
  const remediation = [];
  if (forbiddenHits.length > 0) {
    reasonCodes.push(REASON_FORBIDDEN_WRITE);
    remediation.push(
      `Subagent wrote to forbidden path(s): ${forbiddenHits.join(', ')}. ` +
        'Run /simulate-impact for these high-risk paths or route the change through the owning agent.'
    );
  }
  if (outOfScope.length > 0) {
    reasonCodes.push(REASON_OUT_OF_SCOPE);
    remediation.push(
      `Subagent wrote outside its declared touch-set: ${outOfScope.join(', ')}. ` +
        'Re-spawn with an accurate touch-set, or confirm the wider scope is intended.'
    );
  }

  return {
    decision: deriveDecision(mode, reasonCodes),
    reasonCodes,
    remediation,
    detail: { outOfScope, forbiddenHits },
  };
}

/**
 * Coerces an unknown value into a deduplicated list of normalized, non-empty path
 * tokens. Non-arrays and malformed entries degrade to an empty list (never throws).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function toNormalizedList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    const normalized = normalizePath(entry);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}
