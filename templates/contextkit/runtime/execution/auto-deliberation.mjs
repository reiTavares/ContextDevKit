/**
 * auto-deliberation.mjs — shadow-only deliberation recommendation engine
 * (WF0038 Wave A7-T2, ADR-0112).
 *
 * Decides whether an incoming request is material enough to warrant convening
 * an L7 deliberation council, and recommends the council composition.
 * SHADOW-ONLY: this module NEVER dispatches, approves an ADR, or mutates state.
 * It emits a frozen recommendation; the caller decides what to do with it.
 *
 * Deterministic: no Date.now(), no Math.random(). Same input → identical output.
 * Zero runtime dependencies (node:* only on the hot path; none used here).
 *
 * Integration seams:
 *   - materialityScore (materiality-score.mjs) — computes the numeric score.
 *   - resolveAutonomy (config/resolve-autonomy.mjs) — grade-resolution contract.
 *   - deliberation-nudge.mjs — composed WITH (same gate conditions), never forked.
 *
 * @module auto-deliberation
 */

// ─── Structural trigger catalogue ────────────────────────────────────────────

/**
 * §24-style structural triggers — categories whose presence forces convening
 * regardless of the numeric materiality score. Each entry carries a
 * `reasonCode` (surfaced in the return value) and a `matchFn` predicate over
 * the normalised `decisionSignal` string.
 *
 * @type {ReadonlyArray<{ reasonCode: string, matchFn: (sig: string) => boolean }>}
 */
const STRUCTURAL_TRIGGERS = Object.freeze([
  {
    reasonCode: 'auth-security',
    matchFn: (sig) => /\b(auth|oauth|jwt|token|secret|credential|permission|role|rbac|privilege|encryption|tls|https|ssl|cert|key.rotation|security)\b/.test(sig),
  },
  {
    reasonCode: 'public-contract-change',
    matchFn: (sig) => /\b(public.api|breaking.change|semver.major|interface.change|contract.change|remove.endpoint|rename.endpoint|deprecate.api)\b/.test(sig),
  },
  {
    reasonCode: 'new-dependency',
    matchFn: (sig) => /\b(new.dep(endency)?|add.package|install.library|adopt.library|add.dependency|vendor)\b/.test(sig),
  },
  {
    reasonCode: 'migration',
    matchFn: (sig) => /\b(migrat(e|ion)|schema.change|data.model|drop.column|rename.column|rewrite|replace|one.way|irreversible)\b/.test(sig),
  },
  {
    reasonCode: 'irreversible-action',
    matchFn: (sig) => /\b(delete.data|drop.table|purge|wipe|destroy|irreversible|one.way|cannot.undo)\b/.test(sig),
  },
]);

// ─── Voice pool ──────────────────────────────────────────────────────────────

/**
 * Ordered candidate pool for council composition.
 * Sourced from the ADR-0070 advisor-lane design; kept small and descriptive so
 * the synthesizer can be unambiguously distinct from every voice.
 *
 * @type {ReadonlyArray<string>}
 */
const VOICE_POOL = Object.freeze([
  'architect',
  'security',
  'product-owner',
  'code-reviewer',
  'qa-orchestrator',
  'devops',
]);

/** The fixed synthesizer role — distinct from all VOICE_POOL entries (verified at test time). */
const SYNTHESIZER = 'context-keeper';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalises an arbitrary value to a lowercase string for pattern matching.
 * Returns an empty string on null/undefined/non-string input.
 *
 * @param {unknown} value
 * @returns {string}
 */
function toLower(value) {
  if (typeof value === 'string') return value.toLowerCase();
  return '';
}

/**
 * Detects which structural triggers fire for `signalText`.
 *
 * @param {string} signalText - normalised (lowercased) decision signal.
 * @returns {string[]} fired reasonCodes.
 */
function detectStructuralTriggers(signalText) {
  if (!signalText) return [];
  const fired = [];
  for (const trigger of STRUCTURAL_TRIGGERS) {
    if (trigger.matchFn(signalText)) fired.push(trigger.reasonCode);
  }
  return fired;
}

/**
 * Builds the recommended council: picks `voiceCount` voices from VOICE_POOL
 * in order, then appends SYNTHESIZER. The synthesizer is always distinct from
 * the voices because SYNTHESIZER is not in VOICE_POOL.
 *
 * @param {number} voiceCount - number of voices to select (clamped 2..6).
 * @returns {{ voices: string[], synthesizer: string }}
 */
function buildCouncil(voiceCount) {
  const count = Math.max(2, Math.min(6, voiceCount));
  return {
    voices: VOICE_POOL.slice(0, count),
    synthesizer: SYNTHESIZER,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Recommends whether to convene an L7 deliberation council for a request.
 *
 * SHADOW-ONLY — this function never dispatches or modifies state. It returns a
 * frozen recommendation object that the caller may act on (or ignore).
 *
 * Fires (`shouldConvene: true`) when ALL of the following hold:
 *   1. `grade >= 3` (autonomy grade — auto or debate mode).
 *   2. `deliberationsActive === true` (master switch from config).
 *   3. A MATERIAL trigger: `materiality >= threshold` OR at least one
 *      structural trigger (auth/security, public-contract, new dependency,
 *      migration, irreversible action).
 *
 * ADR acceptance stays manual — this only recommends; no ADR is ever approved
 * here (ADR-0112).
 *
 * @param {{
 *   request?:           string,
 *   decisionSignal?:    string,
 *   grade?:             number,
 *   deliberationsActive?: boolean,
 *   materiality?:       number
 * }} input - caller-supplied signals. `materiality` may be pre-computed or
 *   derived here from `decisionSignal` via simple structural-trigger heuristic
 *   (the full materialityScore import is available to callers who want it).
 *
 * @param {{
 *   threshold?:         number,
 *   voiceCount?:        number
 * }} [opts]
 *   - `threshold`: override the default 0.6. Value is recorded in the result.
 *   - `voiceCount`: override the default 3 voice count for the council.
 *
 * @returns {Readonly<{
 *   shouldConvene:      boolean,
 *   materiality:        number,
 *   threshold:          number,
 *   reasonCodes:        string[],
 *   recommendedCouncil: { voices: string[], synthesizer: string } | null
 * }>}
 */
export function recommendDeliberation(input, opts = {}) {
  // Validate: fail-open on bad input — never throws (constitution §8 / hook rule 2).
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return buildResult(false, 0, resolveThreshold(opts), [], null);
  }

  const threshold = resolveThreshold(opts);
  const voiceCount = typeof opts.voiceCount === 'number' && opts.voiceCount >= 2
    ? Math.min(opts.voiceCount, 6)
    : 3;

  // Gate 1: grade >= 3 (autonomy consent axis — auto/debate range).
  const grade = typeof input.grade === 'number' ? input.grade : 0;
  if (grade < 3) {
    return buildResult(false, resolveInputMateriality(input), threshold, ['grade-below-3'], null);
  }

  // Gate 2: deliberations master switch must be explicitly true.
  if (input.deliberationsActive !== true) {
    return buildResult(false, resolveInputMateriality(input), threshold, ['deliberations-inactive'], null);
  }

  // Combine request + decisionSignal into a single matchable string.
  const signalText = [toLower(input.request), toLower(input.decisionSignal)].filter(Boolean).join(' ');

  // Gate 3a: structural trigger (fires independently of numeric threshold).
  const structuralCodes = detectStructuralTriggers(signalText);

  // Gate 3b: numeric materiality.
  const materiality = resolveInputMateriality(input);
  const meetsThreshold = materiality >= threshold;

  const reasonCodes = [...structuralCodes];
  if (meetsThreshold) reasonCodes.push('materiality-threshold');

  const shouldConvene = structuralCodes.length > 0 || meetsThreshold;

  if (!shouldConvene) {
    return buildResult(false, materiality, threshold, reasonCodes, null);
  }

  return buildResult(true, materiality, threshold, reasonCodes, buildCouncil(voiceCount));
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Resolves the materiality threshold from opts, defaulting to 0.6.
 *
 * @param {object} opts
 * @returns {number}
 */
function resolveThreshold(opts) {
  const raw = opts?.threshold;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0.6;
}

/**
 * Reads `input.materiality` if it is a finite number in [0, 1], otherwise 0.
 * Callers that want the full signal-weighted score should call materialityScore
 * from materiality-score.mjs and pass the result as `input.materiality`.
 *
 * @param {object} input
 * @returns {number}
 */
function resolveInputMateriality(input) {
  const m = input?.materiality;
  return typeof m === 'number' && Number.isFinite(m) && m >= 0 ? m : 0;
}

/**
 * Builds and freezes the return value so callers cannot mutate it.
 *
 * @param {boolean} shouldConvene
 * @param {number}  materiality
 * @param {number}  threshold
 * @param {string[]} reasonCodes
 * @param {{ voices: string[], synthesizer: string } | null} recommendedCouncil
 * @returns {Readonly<object>}
 */
function buildResult(shouldConvene, materiality, threshold, reasonCodes, recommendedCouncil) {
  return Object.freeze({
    shouldConvene,
    materiality,
    threshold,
    reasonCodes: Object.freeze([...reasonCodes]),
    recommendedCouncil: recommendedCouncil
      ? Object.freeze({
          voices: Object.freeze([...recommendedCouncil.voices]),
          synthesizer: recommendedCouncil.synthesizer,
        })
      : null,
  });
}
