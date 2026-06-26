/**
 * redact.mjs — hardened multi-pattern secret redactor for the economy log path.
 *
 * One concern: take arbitrary text (command output, compacted run logs) and
 * replace each recognized secret class with a TYPED mask, so persisted logs
 * stay diagnostic without leaking the credential.
 *
 * Wave W7 wires this into run-compact (which today carries only a single weak
 * api_key|token|secret|password regex). This module ships standalone + tested
 * so the wiring is a one-line swap.
 *
 * Zero runtime dependencies — pure node regex, no npm secret-scan packages.
 * Never throws: non-string input returns empty string (fail-closed).
 *
 * Ordering matters: specific patterns run BEFORE the generic key=value
 * fallback, so a JWT/AWS/GitHub token gets its precise mask instead of the
 * blunt REDACTED. Each rule consumes its own match, so once a span is masked
 * the generic pass cannot re-match the placeholder text.
 */

/**
 * Redaction rules in priority order (specific to generic).
 * Each rule: re (global RegExp) + mask (may reference $1).
 * @type {{ re: RegExp, mask: string }[]}
 */
const RULES = [
  // PEM private key blocks (multiline, any key type). Early so the base64
  // body is never re-scanned by later token patterns.
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    mask: "[REDACTED:pem]",
  },

  // JWT — three base64url segments separated by dots, leading eyJ.
  {
    re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    mask: "[REDACTED:jwt]",
  },

  // Authorization: Bearer <token> header, then bare Bearer <token>.
  { re: /Authorization:\s*Bearer\s+\S+/gi, mask: "Authorization: [REDACTED:bearer]" },
  { re: /\bBearer\s+[A-Za-z0-9._-]+/g, mask: "[REDACTED:bearer]" },

  // AWS access key id, then the long-lived secret-access-key assignment.
  { re: /(?:AKIA|ASIA)[0-9A-Z]{16}/g, mask: "[REDACTED:aws]" },
  { re: /aws_secret_access_key\s*[=:]\s*\S+/gi, mask: "aws_secret_access_key=[REDACTED:aws]" },

  // GitHub personal/OAuth/server/refresh tokens.
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, mask: "[REDACTED:gh]" },

  // Slack tokens (bot / user / app / refresh / config).
  { re: /xox[baprs]-[A-Za-z0-9-]+/g, mask: "[REDACTED:slack]" },

  // Stripe live/test secret keys.
  { re: /sk_(?:live|test)_[A-Za-z0-9]+/g, mask: "[REDACTED:stripe]" },

  // Google API key.
  { re: /AIza[0-9A-Za-z_-]{35}/g, mask: "[REDACTED:gapi]" },

  // URL embedded credentials: scheme://user:pass@host -> mask the user:pass@.
  { re: /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, mask: "$1[REDACTED:url-cred]@" },

  // URL / query-string secrets: ?token= &sig= etc. Keep the key name.
  {
    re: /([?&](?:token|sig|signature|key|password|secret)=)[^&\s]+/gi,
    mask: "$1[REDACTED]",
  },

  // Generic key=value / key:value fallback (the original weak case, retained).
  // Runs LAST so any classed secret above already won its precise mask.
  {
    re: /((?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+/gi,
    mask: "$1[REDACTED]",
  },
];

/**
 * Replace every recognized secret class in text with a typed mask.
 *
 * Specific classes (JWT, PEM, AWS, GitHub, Slack, Stripe, Google, bearer,
 * url-cred, url-secret) are masked before the generic key=value fallback so
 * the log keeps the secret TYPE while losing its value.
 *
 * @param {string} text - Arbitrary text that may embed credentials.
 * @returns {string} The masked text; empty string when text is not a string
 *   (fail-closed — never leak, never throw).
 */
export function redactSecrets(text) {
  if (typeof text !== "string") return "";
  let out = text;
  for (const { re, mask } of RULES) {
    // Each rule regex is global; replace consumes every occurrence.
    out = out.replace(re, mask);
  }
  return out;
}

/**
 * Advisory self-check: one fixture per secret class. For each class it asserts
 * the typed mask appears AND the raw secret no longer does; plus a clean string
 * passes through untouched and non-string input yields empty string.
 *
 * Shape mirrors the other economy cards — (root) => { name, pass, detail }[].
 * Pure (ignores root); advisory + fail-open.
 *
 * @returns {{ name: string, pass: boolean, detail: string }[]}
 */
export function econCheckRedact() {
  const results = [];
  const push = (name, pass, detail) => results.push({ name, pass, detail });

  /** @type {{ cls: string, raw: string, mask: string }[]} */
  const cases = [
    { cls: "jwt", raw: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabc_DEF-123", mask: "[REDACTED:jwt]" },
    { cls: "bearer-header", raw: "Authorization: Bearer abc123XYZ.token_value-99", mask: "[REDACTED:bearer]" },
    { cls: "bearer-bare", raw: "sent Bearer abc123XYZ.token_value-99 upstream", mask: "[REDACTED:bearer]" },
    { cls: "aws-akid", raw: "AKIAIOSFODNN7EXAMPLE", mask: "[REDACTED:aws]" },
    { cls: "aws-secret", raw: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", mask: "[REDACTED:aws]" },
    { cls: "pem", raw: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3\nxfNT2KZ8sdeadbeef\n-----END RSA PRIVATE KEY-----", mask: "[REDACTED:pem]" },
    { cls: "url-cred", raw: "postgres://admin:s3cr3tPass@db.internal:5432/app", mask: "[REDACTED:url-cred]@" },
    { cls: "url-secret", raw: "GET /download?file=x&token=abc123secretVALUE&ok=1", mask: "token=[REDACTED]" },
    { cls: "gh", raw: "ghp_1234567890abcdefABCDEF1234567890wXyZ", mask: "[REDACTED:gh]" },
    { cls: "slack", raw: "xoxb-2401234567-2401234567-AbCdEfGhIjKlMnOpQrStUvWx", mask: "[REDACTED:slack]" },
    { cls: "stripe", raw: "sk_live_4eC39HqLyjWDarjtT1zdp7dcAbCdEf", mask: "[REDACTED:stripe]" },
    { cls: "gapi", raw: "AIzaSyA1234567890abcdefghijklmnopqrstuvw", mask: "[REDACTED:gapi]" },
    { cls: "generic", raw: "API_KEY: pk_abc123_super_secret_value", mask: "[REDACTED]" },
  ];

  for (const { cls, raw, mask } of cases) {
    let redacted;
    try {
      redacted = redactSecrets(raw);
    } catch (err) {
      push("redact:" + cls, false, "threw: " + (err && err.message ? err.message : err));
      continue;
    }
    const rawLeak = leakFragment(cls);
    const maskPresent = redacted.includes(mask);
    const rawGone = rawLeak.length === 0 || !redacted.includes(rawLeak);
    push("redact:" + cls, maskPresent && rawGone, "mask=" + maskPresent + " rawGone=" + rawGone);
  }

  // Clean string passes through unchanged.
  const clean = "normal log line: tests passed in 1.2s, 0 failures, build ok";
  push("redact:clean-passthrough", redactSecrets(clean) === clean, "unchanged");

  // Non-string input fails closed to empty string.
  push(
    "redact:nonstring-fail-closed",
    redactSecrets(null) === "" && redactSecrets(undefined) === "" && redactSecrets(42) === "",
    "null/undefined/number -> empty",
  );

  return results;
}

/**
 * Returns the high-entropy fragment a leak would expose for a given class,
 * so the test can assert it is absent from the redacted output.
 *
 * @param {string} cls - Secret class label.
 * @returns {string} The value fragment that must NOT survive redaction
 *   (empty string when the whole token is the secret and already covered).
 */
function leakFragment(cls) {
  switch (cls) {
    case "aws-secret":  return "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    case "url-cred":    return "s3cr3tPass";
    case "url-secret":  return "abc123secretVALUE";
    case "generic":     return "pk_abc123_super_secret_value";
    case "pem":         return "MIIEpAIBAAKCAQEA0Z3VS5JJcds3";
    case "bearer-header":
    case "bearer-bare": return "abc123XYZ.token_value-99";
    default:            return "";
  }
}
