/**
 * Architecture-debt gate — security floor (F7, §9.6) detection patterns
 * (WF-0057 Wave W2). Split from `floors.mjs` because the regex catalogue is a
 * genuinely distinct concern (the *what to look for*) from the floor evaluation
 * logic (the *how to decide*) — constitution §1 cohesive seam.
 *
 * SCOPE & HONESTY (constitution §8, behaviors §1): these are CONSERVATIVE,
 * pattern-based heuristics over the TEXT of changed lines. They are deliberately
 * tuned to fire on the common, unambiguous shapes of a critical security
 * regression and to STAY QUIET otherwise — a respected floor beats a noisy one.
 * The *evidence class* the security floor emits is DETERMINISTIC because the
 * match itself is a static, reproducible fact about the changed source; the
 * conservative pattern set is documented so a reviewer can audit the basis.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

/**
 * A security pattern: a stable code, a human reason, and a predicate over a
 * single added/changed source line. `kind: 'INTRODUCED'` patterns fire when the
 * dangerous shape APPEARS on a changed line; `kind: 'REMOVED'` patterns fire
 * when a protective shape DISAPPEARS (matched on a removed baseline line).
 * @typedef {Object} SecurityPattern
 * @property {string}  code     SCREAMING_SNAKE reason code (the queryable fact).
 * @property {'INTRODUCED'|'REMOVED'} kind  Where the regression shows up.
 * @property {(line:string)=>boolean} test  Conservative predicate over one line.
 * @property {string}  reason   One-line human explanation for the report.
 */

/** Injection sink: a string-built SQL/shell/HTML query from a variable. */
const isInjectionSink = (line) => (
  /\b(execute|query|exec(?:Sync)?|spawn(?:Sync)?|raw|rawQuery)\s*\(/i.test(line)
  && /[`'"][^`'"]*(?:\$\{|"\s*\+|'\s*\+|`\s*\+)/.test(line)
) || /\.(innerHTML|outerHTML)\s*=\s*[^;]*(?:\+|\$\{)/.test(line);

/** A fail-OPEN default — auth/allow defaulting to true/granted on the happy path. */
const isFailOpen = (line) => (
  /(authoriz\w*|authenticat\w*|allow\w*|permitt\w*|verif\w*|isAdmin|hasAccess|isAllowed|canAccess)/i.test(line)
  && /=\s*true\b/.test(line)
) || /\bdefault\s*:\s*(?:return\s+)?(?:true|allow|grant)/i.test(line)
  || /catch\s*\([^)]*\)\s*\{\s*(?:return\s+true|allow|next\(\))/i.test(line);

/** A hardcoded secret / token / key / password literal on a changed line. */
const isSecretExposure = (line) => (
  /\b(password|passwd|secret|api[_-]?key|apikey|token|private[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*['"`][^'"`]{6,}['"`]/i.test(line)
  && !/process\.env|getenv|\$\{|<[A-Z_]+>|your[_-]|example|placeholder|xxx+|\*{3,}/i.test(line)
);

/** PII written to a log/console/analytics sink on a changed line. */
const isPiiExposure = (line) => (
  /\b(console\.(log|info|warn|error)|logger?\.\w+|analytics\.\w+|track\()/i.test(line)
  && /\b(ssn|cpf|cnpj|creditCard|cardNumber|password|email|phone|dateOfBirth|fullName)\b/i.test(line)
);

/** A removed verification/authorization guard (protection deleted). */
const isRemovedAuthCheck = (line) => (
  /\b(if\s*\(\s*!?\s*(?:is)?(?:authoriz\w*|authenticat\w*|verif\w*|hasAccess|hasPermission|isAdmin|isOwner))/i.test(line)
  || /\b(requireAuth|ensureAuthenticated|checkPermission|assertAuthorized|verifySignature|csrf|sanitize|escapeHtml)\b/i.test(line)
);

/**
 * The conservative F7 catalogue (§9.6). Each entry is documented and audited;
 * adding one is a deliberate widening of the floor, never an accident.
 * @type {ReadonlyArray<SecurityPattern>}
 */
export const SECURITY_PATTERNS = Object.freeze([
  { code: 'INJECTION_SINK_INTRODUCED', kind: 'INTRODUCED', test: isInjectionSink,
    reason: 'string-built query/markup from a variable (injection sink)' },
  { code: 'FAIL_OPEN_DEFAULT_INTRODUCED', kind: 'INTRODUCED', test: isFailOpen,
    reason: 'authorization/verification defaults to allow (fail-open)' },
  { code: 'SECRET_EXPOSURE_INTRODUCED', kind: 'INTRODUCED', test: isSecretExposure,
    reason: 'hardcoded credential/secret/token literal' },
  { code: 'PII_EXPOSURE_INTRODUCED', kind: 'INTRODUCED', test: isPiiExposure,
    reason: 'PII written to a log/analytics sink' },
  { code: 'AUTH_CHECK_REMOVED', kind: 'REMOVED', test: isRemovedAuthCheck,
    reason: 'verification/authorization guard removed' },
]);

/**
 * Scan one changed-line set against the catalogue. Pure, deterministic.
 *
 * @param {string[]} addedLines    lines INTRODUCED by the change (added/modified).
 * @param {string[]} removedLines  lines REMOVED from the baseline by the change.
 * @returns {{code:string,reason:string,line:string}[]} every pattern hit (may be empty).
 */
export function scanSecurityPatterns(addedLines, removedLines) {
  const added = Array.isArray(addedLines) ? addedLines : [];
  const removed = Array.isArray(removedLines) ? removedLines : [];
  const hits = [];
  for (const pattern of SECURITY_PATTERNS) {
    const haystack = pattern.kind === 'REMOVED' ? removed : added;
    for (const line of haystack) {
      if (typeof line === 'string' && pattern.test(line)) {
        hits.push({ code: pattern.code, reason: pattern.reason, line: line.trim().slice(0, 200) });
      }
    }
  }
  return hits;
}
