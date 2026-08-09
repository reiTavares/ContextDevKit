/**
 * signals.mjs — the REUSE BOUNDARY for domain-engineering classification
 * (ADR-0128 plan §4, CC0-T1). It does NOT re-derive what ContextDevKit already
 * computes. It COMPOSES the existing intake signals (tier, domain, needsAdr,
 * paths, work) and the existing request classification (risk, blastRadius,
 * materialityScore, reversibility, primaryType) into the flat signal object the
 * CMIS and DAS scorers read.
 *
 * The ONLY net-new extraction here is deterministic token-presence over the
 * request text, which the base classifier does not compute (it answers "which
 * governed context?", not "will this create/change code?" or "how much domain
 * engineering?"). Each net-new field is marked in the JSDoc.
 *
 * Pure + deterministic + zero runtime dependencies.
 *
 * @module domain-engineering/signals
 */

/**
 * Builds the normalized signal object consumed by both scorers. Pure.
 *
 * Reused (never re-derived): tier, domain, needsAdr, paths (intake); risk,
 * blastRadius, materialityScore, reversibility, primaryType (classification).
 * Net-new: lowercased `text` for token matching, `writeAttempt`/`tool` carried
 * for the CMIS Class-A hard trigger (set by PreToolUse in WF-0067).
 *
 * @param {object} params
 * @param {string} [params.requestText] raw request text.
 * @param {object} [params.intakeSignals] result of task-intake.intake().
 * @param {object} [params.classification] result of classifyRequest().
 * @param {boolean} [params.writeAttempt] true when a real write tool fired (WF-0067).
 * @param {string|null} [params.tool] the write tool name, when writeAttempt.
 * @returns {object} normalized signals.
 */
export function buildSignals(params) {
  const p = params && typeof params === 'object' ? params : {};
  const intake = p.intakeSignals && typeof p.intakeSignals === 'object' ? p.intakeSignals : {};
  const cls = p.classification && typeof p.classification === 'object' ? p.classification : {};
  const paths = Array.isArray(intake.paths) ? intake.paths.filter((x) => typeof x === 'string') : [];

  return {
    // net-new: lowercased text for deterministic token matching.
    text: String(p.requestText ?? '').toLowerCase(),
    // reused from intake.
    tier: intake.tier ?? 'trivial',
    domain: intake.domain ?? 'general',
    needsAdr: Boolean(intake.needsAdr ?? cls.needsAdr),
    paths,
    // reused from the base classification (§5 block).
    risk: cls.risk ?? 'medium',
    blastRadius: cls.blastRadius ?? 'local',
    reversibility: cls.reversibility ?? 'medium',
    materialityScore: numberOr(cls.materialityScore, 0),
    primaryType: cls.primaryType ?? 'implementation',
    complexity: cls.complexity ?? 'feature',
    // net-new: authoritative write-attempt hard-trigger inputs (carried, not inferred).
    writeAttempt: Boolean(p.writeAttempt),
    tool: p.tool ?? null,
  };
}

/**
 * Returns true iff `text` contains at least one token (substring match — same
 * rule as the base classifier and the materiality scorer).
 *
 * @param {string} text lowercased text.
 * @param {readonly string[]} tokens token list.
 * @returns {boolean}
 */
export function hasAnyToken(text, tokens) {
  if (!Array.isArray(tokens) || typeof text !== 'string') return false;
  return tokens.some((token) => typeof token === 'string' && token.length > 0 && text.includes(token));
}

/** Coerces to a finite number, else the fallback. */
function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
