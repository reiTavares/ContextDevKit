/**
 * decision-triple.mjs — pure triple-derivation helpers for the B2 decision-need
 * classifier (BIZ-0001 / WF-0037 Wave B2, ADR-0102).
 *
 * Implements §1 of B2-design-decision-table.md:
 *   §1.1 primaryContext derivation
 *   §1.2 decisionKind derivation (K1..K9)
 *   §1.3 decisionScope derivation (S1..S6)
 *
 * Extracted here so `decision-need-classifier.mjs` stays inside the 280-line
 * limit (cohesion note: these are all pure §1 derivations, one consumer).
 * Zero runtime dependencies. No I/O. Pure functions; deterministic.
 *
 * @module decision-triple
 */

// ─── §1.1 primaryContext ─────────────────────────────────────────────────────

/**
 * Resolves `primaryContext` from upstream signals (§1.1, first-match).
 *
 * @param {object} work - signals.work from intake.
 * @param {object|null} businessMatch - A2 business matcher result or null.
 * @returns {{ primaryContext: object, provisional: boolean, reason: string }}
 */
export function derivePrimaryContext(work, businessMatch) {
  if (businessMatch?.status === 'confirmed' || businessMatch?.confirmed) {
    const id = businessMatch.confirmed ?? businessMatch.suggested;
    return {
      primaryContext: { type: 'business', id },
      provisional: false,
      reason: `primaryContext: confirmed business context (${id})`,
    };
  }
  if (businessMatch?.status === 'suggested') {
    const id = businessMatch.suggested;
    return {
      primaryContext: { type: 'business', id },
      provisional: true,
      reason: `primaryContext: suggested business context (${id}) — PROVISIONAL`,
    };
  }
  if (work?.nature === 'operation' && businessMatch?.operationId) {
    return {
      primaryContext: { type: 'operation', id: businessMatch.operationId },
      provisional: false,
      reason: 'primaryContext: resolved operation context',
    };
  }
  if (work?.nature === 'business') {
    return {
      primaryContext: { type: 'business', id: null },
      provisional: true,
      reason: 'primaryContext: business nature, no id resolved — PROVISIONAL',
    };
  }
  return {
    primaryContext: { type: 'platform', id: 'platform' },
    provisional: false,
    reason: 'primaryContext: platform (cross-cutting, no owner)',
  };
}

// ─── §1.2 decisionKind (K1..K9) ──────────────────────────────────────────────

/**
 * Resolves `decisionKind` from upstream signals (§1.2, K1..K9).
 * First-match wins; K9 fallback = 'ARCHITECTURE' (constitution §8 — never routine).
 *
 * @param {object} work - signals.work from intake.
 * @param {{ tier: string, domain: string }} tier - resolved tier + domain.
 * @param {object|null} businessMatch - A2 business matcher result.
 * @param {string} objectiveLower - lowercased objective text.
 * @param {object} policy - loaded decision-intelligence policy.
 * @returns {{ kind: string, reason: string }}
 */
export function deriveDecisionKind(work, tier, businessMatch, objectiveLower, policy) {
  const regulated = (policy.regulatedDomains ?? []).includes(tier?.domain ?? '');
  const emergencyTokens = Object.values(policy.emergencyEnvelope ?? {}).flat();
  const hasEmergency = emergencyTokens.some((t) => objectiveLower.includes(t));
  const hasLifecycle = (policy.lifecycleTokens ?? []).some((t) => objectiveLower.includes(t));

  // K1: business + architectural + new/confirmed business context
  if (work?.nature === 'business' && tier?.tier === 'architectural'
      && (businessMatch?.status === 'confirmed' || businessMatch?.isNewContext)) {
    return { kind: 'BUSINESS_AUTHORIZATION', reason: 'K1: business nature + architectural tier + new/confirmed business context' };
  }
  // K2: bounded emergency envelope (§6)
  if (work?.nature === 'operation' && work?.kind === 'operationalResponse' && hasEmergency) {
    return { kind: 'EMERGENCY_GOVERNANCE', reason: 'K2: operation + operationalResponse kind + emergency envelope token' };
  }
  // K3: COMPLY intent or regulated domain
  if (work?.valueIntents?.primary === 'COMPLY' || regulated) {
    return { kind: 'COMPLIANCE', reason: `K3: COMPLY intent or regulated domain (${tier?.domain})` };
  }
  // K4: lifecycle act
  if (hasLifecycle) {
    return { kind: 'LIFECYCLE', reason: 'K4: lifecycle token present (supersede/deprecate/transfer/replace adr)' };
  }
  // K5: maintenance kind
  if (work?.kind === 'maintenance') {
    return { kind: 'ROUTINE_OPERATION_GOVERNANCE', reason: 'K5: maintenance kind → routine governance path' };
  }
  // K6: architectural tier or architectural-signal tokens
  const archTokens = ['migrate', 'new dependency', 'schema', 'breaking', 'protocol', 'data model', 'auth', 'rewrite'];
  if (tier?.tier === 'architectural' || archTokens.some((t) => objectiveLower.includes(t))) {
    return { kind: 'ARCHITECTURE', reason: 'K6: architectural tier or architectural signal token' };
  }
  // K7: QUALITY lever or policy/governance tokens
  const policyTokens = ['policy', 'governance', 'threshold', 'naming', 'convention'];
  if (work?.growthLever === 'QUALITY' || policyTokens.some((t) => objectiveLower.includes(t))) {
    return { kind: 'POLICY', reason: 'K7: QUALITY growth lever or policy/governance token' };
  }
  // K8: operation nature catch-all (new operation authorization)
  if (work?.nature === 'operation') {
    return { kind: 'OPERATION_AUTHORIZATION', reason: 'K8: operation nature, no prior match → new operation authorization' };
  }
  // K9: fallback — material kind, never routine
  return { kind: 'ARCHITECTURE', reason: 'K9: fallback — default to material kind (ARCHITECTURE)' };
}

// ─── §1.3 decisionScope (S1..S6) ─────────────────────────────────────────────

/**
 * Resolves `decisionScope` from upstream signals (§1.3, S1..S6). First-match.
 * S6 fallback = 'workflow' (narrowest reach — least over-claiming).
 *
 * @param {object} work - signals.work.
 * @param {{ tier: string, domain: string }} tier - resolved tier.
 * @param {string} decisionKind - derived kind.
 * @param {object} primaryContext - derived primary context.
 * @param {string} objectiveLower - lowercased objective text.
 * @param {object} policy - loaded decision-intelligence policy.
 * @returns {{ scope: string, reason: string }}
 */
export function deriveDecisionScope(work, tier, decisionKind, primaryContext, objectiveLower, policy) {
  const platformTokens = policy.platformTokens ?? ['platform', 'across modules', 'kit-wide'];
  const hitsPlatform = platformTokens.some((t) => objectiveLower.includes(t));
  // S1
  if (work?.executionMode === 'workflow' && decisionKind === 'BUSINESS_AUTHORIZATION' && hitsPlatform) {
    return { scope: 'platform', reason: 'S1: workflow executionMode + BUSINESS_AUTHORIZATION + platform token' };
  }
  // S2
  if (primaryContext?.type === 'platform') {
    return { scope: 'platform', reason: 'S2: primaryContext.type is platform' };
  }
  // S3
  if (decisionKind === 'BUSINESS_AUTHORIZATION' || work?.nature === 'business') {
    return { scope: 'business', reason: 'S3: BUSINESS_AUTHORIZATION kind or business nature' };
  }
  // S4
  if (decisionKind === 'OPERATION_AUTHORIZATION' || primaryContext?.type === 'operation') {
    return { scope: 'operation', reason: 'S4: OPERATION_AUTHORIZATION kind or operation context' };
  }
  // S5
  if (work?.executionMode === 'direct' && (tier?.tier === 'trivial' || tier?.tier === 'feature')) {
    return { scope: 'workflow', reason: 'S5: direct executionMode + trivial/feature tier' };
  }
  // S6 fallback
  return { scope: 'workflow', reason: 'S6: fallback — narrowest scope (workflow)' };
}
