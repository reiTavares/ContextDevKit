/**
 * Task-Compiler: task-intent scorer + ambiguity gate (WF0022 / ADR-0087..0090).
 *
 * Single responsibility: turn a raw task request into a narrowing decision.
 * The DEFAULT is ESCALATE; narrowing is the evidence-gated exception — only
 * granted when all of: confidence ≥ threshold, no band ambiguity, no floor
 * path, and closure holds. Skipped inputs → escalate (skipped ≠ passed).
 *
 * Design invariants:
 *   - DETERMINISTIC: no Date.now() / Math.random(). Pure function; no I/O.
 *   - ZERO HOT-PATH DEPS: node:* + relative imports only.
 *   - ESCALATE-BY-DEFAULT: ADR-0087; narrowing is opt-in evidence-gated.
 *   - FROZEN OUTPUT: all returned decision objects are Object.freeze()'d.
 *
 * // consumes: complexity-rubric
 *
 * [task-compiler] [token-economy] [WF0022]
 */
import { classify } from '../complexity-rubric.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for all intent decisions produced by this module. */
export const TC_INTENT_SCHEMA_VERSION = 'cdk-tc-intent/1';

// ---------------------------------------------------------------------------
// Floor-path patterns (security / contract / high-risk — non-narrowable)
// ---------------------------------------------------------------------------

/**
 * Substrings that mark a file path as non-narrowable. Any change touching
 * a floor path MUST escalate regardless of confidence or tier.
 * @type {Readonly<string[]>}
 */
export const FLOOR_PATH_PATTERNS = Object.freeze([
  'auth', 'security', 'crypto', 'secret', 'token', 'permission',
  'contract', 'compliance', 'migration', 'schema', 'lgpd', 'gdpr',
  'pii', 'payment', 'billing', '.env', 'credentials', 'certificate',
  'ssl', 'tls',
]);

// ---------------------------------------------------------------------------
// Floor-path guard
// ---------------------------------------------------------------------------

/**
 * Returns true when the given path matches any floor-path pattern (case-insensitive).
 * Floor paths are non-narrowable: any change touching them MUST escalate.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isFloorPath(filePath) {
  if (typeof filePath !== 'string') return false;
  const lower = filePath.toLowerCase();
  return FLOOR_PATH_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coverage string based on how many file paths were supplied.
 * @param {string[] | undefined} files
 * @returns {'none' | 'partial' | 'full'}
 */
function coverageFromFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return 'none';
  return files.length === 1 ? 'partial' : 'full';
}

/**
 * Confidence score [0,1] from available signals (additive; capped).
 *
 *   +0.30  non-empty title
 *   +0.25  ≥1 file path
 *   +0.20  ≥2 file paths (scope is bounded)
 *   +0.15  extra signals present
 *   +0.10  tier differs from rubric default (signal hit)
 *   -0.20  any floor path detected
 *   -0.10  no files (open-ended scope)
 *
 * @param {{ title: string, files?: string[], signals?: object }} input
 * @param {string} tier
 * @param {string} defaultTier
 * @returns {number}
 */
function computeConfidence(input, tier, defaultTier) {
  let score = 0;
  const fileCount = Array.isArray(input.files) ? input.files.length : 0;
  if (String(input.title).trim().length > 0) score += 0.30;
  if (fileCount >= 1) score += 0.25;
  if (fileCount >= 2) score += 0.20;
  if (input.signals && typeof input.signals === 'object' && Object.keys(input.signals).length > 0) score += 0.15;
  if (tier !== defaultTier) score += 0.10;
  if (fileCount >= 1 && input.files.some((fp) => isFloorPath(fp))) score -= 0.20;
  if (fileCount === 0) score -= 0.10;
  return Math.max(0, Math.min(1, score));
}

/**
 * Ambiguity score [0,1] — higher means more uncertain.
 *
 *   +0.30  no files (open-ended scope)
 *   +0.20  confidence below threshold
 *   +0.20  tier matched the rubric default (no strong signal hit)
 *   +0.15  floor path present
 *   +0.15  no extra signals provided
 *
 * @param {{ files?: string[], signals?: object }} input
 * @param {number} confidence
 * @param {string} tier
 * @param {string} defaultTier
 * @param {boolean} hasFloor
 * @param {number} threshold
 * @returns {number}
 */
function computeAmbiguity(input, confidence, tier, defaultTier, hasFloor, threshold) {
  let score = 0;
  const fileCount = Array.isArray(input.files) ? input.files.length : 0;
  if (fileCount === 0) score += 0.30;
  if (confidence < threshold) score += 0.20;
  if (tier === defaultTier) score += 0.20;
  if (hasFloor) score += 0.15;
  const hasSignals = input.signals && typeof input.signals === 'object' && Object.keys(input.signals).length > 0;
  if (!hasSignals) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

/**
 * Band condition: true when the title is so minimal that the tier could
 * plausibly sit in an adjacent tier (conservative proxy — short title +
 * default tier = ambiguous band). `bandMargin` is accepted for API
 * symmetry but the proxy already encodes margin=1.
 *
 * @param {{ title: string }} input
 * @param {string} tier
 * @param {string} defaultTier
 * @returns {boolean}
 */
function detectBand(input, tier, defaultTier) {
  return tier === defaultTier && String(input.title || '').trim().length < 8;
}

// ---------------------------------------------------------------------------
// Core scorer
// ---------------------------------------------------------------------------

/**
 * Scores a task request and returns a frozen narrowing decision.
 *
 * The default is ESCALATE. Returns `result:'narrow'` ONLY when ALL hold:
 *   - confidence ≥ opts.confidenceThreshold (default 0.7)
 *   - no band (title too short → ambiguous tier)
 *   - no floor path in the file list
 *   - closure (1–5 non-floor files)
 *   - no 'skipped' sentinel in input
 *
 * @param {{
 *   title:    string,
 *   files?:   string[],
 *   signals?: Record<string, unknown>
 * }} input
 * @param {{
 *   confidenceThreshold?: number,
 *   bandMargin?:          number,
 *   rubric?:              object
 * }} [opts={}]
 * @returns {Readonly<{
 *   schemaVersion: string,
 *   result: 'narrow' | 'escalate',
 *   confidence: number,
 *   coverage: 'none' | 'partial' | 'full',
 *   closure: boolean,
 *   ambiguity: number,
 *   escalate: boolean,
 *   reasons: readonly string[],
 *   tier: string
 * }>}
 * @throws {TypeError} when input is missing or title is not a string
 */
export function scoreIntent(input, opts = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('scoreIntent: input must be a non-null object');
  }
  if (typeof input.title !== 'string') {
    throw new TypeError('scoreIntent: input.title must be a string');
  }

  const confidenceThreshold = typeof opts.confidenceThreshold === 'number' ? opts.confidenceThreshold : 0.7;
  // bandMargin accepted for API symmetry; proxy already encodes margin=1.
  void (typeof opts.bandMargin === 'number' ? opts.bandMargin : 1);

  // Detect skipped sentinels — skipped ≠ narrowed (constitution §8).
  const hasSkippedSignal = (
    input.title === 'skipped' ||
    (Array.isArray(input.files) && input.files.includes('skipped')) ||
    (input.signals != null && typeof input.signals === 'object' &&
      Object.values(input.signals).some((v) => v === 'skipped'))
  );

  const classification = classify(input.title, opts.rubric);
  const tier           = classification.tier;
  const defaultTier    = 'feature'; // complexity-rubric built-in default

  const fileCount  = Array.isArray(input.files) ? input.files.length : 0;
  const floorFiles = Array.isArray(input.files) ? input.files.filter(isFloorPath) : [];
  const hasFloor   = floorFiles.length > 0;

  const confidence = computeConfidence(input, tier, defaultTier);
  const ambiguity  = computeAmbiguity(input, confidence, tier, defaultTier, hasFloor, confidenceThreshold);
  const band       = detectBand(input, tier, defaultTier);
  const coverage   = coverageFromFiles(input.files);
  // Closure: bounded, non-empty, non-floor file set.
  const closure    = fileCount >= 1 && fileCount <= 5 && !hasFloor;

  const reasons = [];
  if (hasSkippedSignal)                reasons.push('skipped signal detected — cannot narrow');
  if (confidence < confidenceThreshold) reasons.push(`confidence ${confidence.toFixed(2)} < threshold ${confidenceThreshold}`);
  if (band)                            reasons.push(`band detected — tier "${tier}" is ambiguous at this signal level`);
  if (hasFloor)                        reasons.push(`floor path(s): ${floorFiles.join(', ')} — non-narrowable`);
  if (!closure && !hasFloor)           reasons.push('closure not established — file scope is open-ended or too broad');

  const escalate = reasons.length > 0;

  return Object.freeze({
    schemaVersion: TC_INTENT_SCHEMA_VERSION,
    result:        escalate ? 'escalate' : 'narrow',
    confidence,
    coverage,
    closure,
    ambiguity,
    escalate,
    reasons:       Object.freeze([...reasons]),
    tier,
  });
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

/**
 * Renders an intent decision as a terse human-readable string.
 * @param {Readonly<object>} decision
 * @returns {string}
 */
export function presentIntent(decision) {
  if (!decision || typeof decision !== 'object') return 'intent-decision: invalid';
  const verdict = decision.result === 'narrow' ? 'NARROW ✓' : 'ESCALATE ⚠';
  const lines = [
    `intent-decision [${decision.schemaVersion ?? 'unknown'}]`,
    `  verdict    : ${verdict}`,
    `  tier       : ${decision.tier ?? 'unknown'}`,
    `  confidence : ${typeof decision.confidence === 'number' ? decision.confidence.toFixed(2) : '?'}`,
    `  ambiguity  : ${typeof decision.ambiguity === 'number' ? decision.ambiguity.toFixed(2) : '?'}`,
    `  coverage   : ${decision.coverage ?? 'unknown'}`,
    `  closure    : ${decision.closure}`,
  ];
  if (Array.isArray(decision.reasons) && decision.reasons.length > 0) {
    lines.push('  reasons    :');
    for (const r of decision.reasons) lines.push(`    - ${r}`);
  }
  return lines.join('\n');
}
