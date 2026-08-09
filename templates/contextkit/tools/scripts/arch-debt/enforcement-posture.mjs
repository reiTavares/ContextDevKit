/**
 * enforcement-posture.mjs — turns the TWELVE DIMENSIONS into real, configurable
 * law (OP-0012 hotfix, ADR-0122 §12 + ADR-0125's guarded-by-default contract).
 *
 * WHY THIS EXISTS. Enforcement used to be hardcoded in the fitness catalogue and
 * the floor emitters, so `architectureDebtGate.floors.*` was decorative: setting
 * `floors.security = 'ADVISORY'` changed nothing, and there was no way to arm or
 * disarm a dimension as a whole. This module is the ONE place a dimension's
 * authority is resolved, keyed by DIMENSION (the twelve principles) rather than
 * by the volatile per-finding `ruleId` (floor ids like
 * `F7.security-regression.<code>` are generated, so a ruleId-keyed map could
 * never target them).
 *
 * THE POSTURE LADDER (`architectureDebtGate.enforcement`):
 *   - `guarded`  — DEFAULT. Each dimension keeps its declared authority, so a
 *                  deterministic VIOLATION on a changed line BLOCKS for real.
 *   - `advisory` — global opt-out: every dimension is demoted to observation.
 *                  Nothing blocks; findings still surface on the board.
 *   - `strict`   — additionally promotes REVIEW_REQUIRED dimensions to BLOCKING.
 *
 * TWO INVARIANTS THIS MODULE MAY NEVER BREAK:
 *   1. LINE COUNT NEVER BLOCKS, in any posture, under any config (ADR-0122 /
 *      ADR-0143, constitution §1). `NEVER_BLOCKING_RULES` is checked before any
 *      promotion and the demotion path leaves it untouched.
 *   2. BLOCKING requires DETERMINISTIC-TIER evidence (`makeFinding`'s fork-2
 *      invariant). Because this module rewrites `enforcement` on already-built
 *      findings it bypasses that constructor check, so it re-asserts it here:
 *      a SEMANTIC/HEURISTIC finding is NEVER promoted to BLOCKING, only to
 *      REVIEW_REQUIRED. A model opinion can raise concern, never block.
 *
 * A DEMOTION IS ALWAYS ALLOWED; A PROMOTION IS ALWAYS CHECKED. That asymmetry is
 * the constitution's §8 default-to-refuse applied to enforcement itself.
 *
 * PURE — no I/O, no clock. Zero runtime deps, ESM, relative imports only.
 */

import { Enforcement, DETERMINISTIC_TIER } from './finding-enums.mjs';

/** Valid postures; anything else resolves to `guarded` (never silently disarmed). */
export const POSTURES = Object.freeze(['advisory', 'guarded', 'strict']);

/**
 * Rules that may NEVER reach a blocking authority regardless of posture or
 * config. File size is investigation telemetry, not a verdict (ADR-0143).
 */
export const NEVER_BLOCKING_RULES = Object.freeze(new Set([
  'arch-debt.line-count',
]));

/** Authorities that count as "observation only" (cannot fail CI). */
const OBSERVATIONAL = Object.freeze(new Set([
  Enforcement.ADVISORY, Enforcement.OBSERVE_ONLY, Enforcement.DISABLED,
]));

/**
 * Can this finding legitimately carry a BLOCKING authority? Mirrors
 * `makeFinding`'s fork-2 invariant so a rewrite here can never produce a finding
 * the constructor would have refused.
 *
 * @param {Object} finding  a built finding.
 * @returns {boolean} true iff promotion to BLOCKING is permitted.
 */
export function mayBlock(finding) {
  if (!finding || NEVER_BLOCKING_RULES.has(finding.ruleId)) return false;
  const evidenceClass = finding.evidence && finding.evidence.class;
  return DETERMINISTIC_TIER.has(evidenceClass);
}

/**
 * Resolve the authority for ONE finding under a posture + per-dimension override.
 *
 * Order of authority: an explicit per-dimension config value wins over the
 * posture, and the two invariants above win over both.
 *
 * @param {Object} finding  a built finding (reads `.enforcement`, `.dimension`,
 *   `.ruleId`, `.evidence.class`).
 * @param {string} posture  one of POSTURES.
 * @param {Object<string,string>} authorities  dimension → Enforcement override.
 * @returns {string} the effective Enforcement value.
 */
export function resolveAuthority(finding, posture, authorities = {}) {
  const declared = finding.enforcement;
  const override = authorities[finding.dimension];
  const wanted = typeof override === 'string' && Object.values(Enforcement).includes(override)
    ? override
    : postureAuthority(declared, posture);

  // Invariant 1 + 2: a promotion into BLOCKING must earn it.
  if (wanted === Enforcement.BLOCKING && !mayBlock(finding)) {
    return OBSERVATIONAL.has(declared) ? declared : Enforcement.REVIEW_REQUIRED;
  }
  return wanted;
}

/**
 * The posture's default transform of a DECLARED authority (no per-dimension
 * override in play).
 *
 * @param {string} declared  the finding's own enforcement.
 * @param {string} posture   one of POSTURES.
 * @returns {string} the posture-adjusted enforcement.
 */
function postureAuthority(declared, posture) {
  if (posture === 'advisory') {
    // Global opt-out — nothing enforces. OBSERVE_ONLY/DISABLED stay as they are
    // so a deliberately-off rule is not accidentally "upgraded" into advisory noise.
    return OBSERVATIONAL.has(declared) ? declared : Enforcement.ADVISORY;
  }
  if (posture === 'strict' && declared === Enforcement.REVIEW_REQUIRED) {
    return Enforcement.BLOCKING; // gated by mayBlock() in resolveAuthority
  }
  return declared; // `guarded`: the declared authority IS the law
}

/**
 * Apply the posture + per-dimension authorities across a finding set, returning
 * NEW finding objects (never mutating the inputs, so the board/store keep the
 * analyzer's original claim while the verdict path sees the governed authority).
 *
 * @param {Object[]} findings  the built findings.
 * @param {Object} [options]
 * @param {string} [options.posture]  one of POSTURES (default `guarded`).
 * @param {Object<string,string>} [options.authorities]  dimension → Enforcement.
 * @returns {Object[]} findings with governed `enforcement`.
 */
export function applyEnforcementPosture(findings, options = {}) {
  const list = Array.isArray(findings) ? findings.filter(Boolean) : [];
  const posture = POSTURES.includes(options.posture) ? options.posture : 'guarded';
  const authorities = options.authorities && typeof options.authorities === 'object'
    ? options.authorities
    : {};

  return list.map((finding) => {
    const enforcement = resolveAuthority(finding, posture, authorities);
    return enforcement === finding.enforcement ? finding : { ...finding, enforcement };
  });
}
