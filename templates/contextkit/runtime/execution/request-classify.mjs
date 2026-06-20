/**
 * request-classify.mjs — Request → governed context classification (WF0038, ADR-0107).
 *
 * The base classifier for the RequestOrchestrator boundary. It COMPOSES the
 * deterministic signals that `task-intake.mjs` already produces (tier, domain,
 * needsAdr, work, decisionNeed) into the canonical §6 request taxonomy plus the
 * §5 classification block — it does NOT re-derive them and does NOT classify by
 * keyword alone (immutable: deterministic rules first, explainable reason codes
 * always; model refinement is an optional downstream seam, never on the hot path).
 *
 * Pure given (signals, ctx). Zero runtime dependencies — only sibling pure
 * modules. Fail-open: any malformed input degrades to a conservative
 * `implementation` / medium-risk verdict with a reason code, never throws.
 *
 * Consumers: request-orchestrator.mjs (W1), request-envelope.mjs (W1).
 *
 * @module request-classify
 */

/** Canonical primary contexts (§6). Order is the first-match precedence. */
export const REQUEST_CONTEXTS = Object.freeze([
  'business', 'decision', 'operation', 'workflow', 'implementation',
  'incident', 'research', 'maintenance', 'documentation', 'conversation',
]);

/** Token tables — supplementary signals, never the sole basis for a verdict. */
const INCIDENT_TOKENS = ['outage', 'production failure', 'prod failure', 'broken in prod', 'regression', 'incident', 'down ', 'failing in production', 'hotfix'];
const RESEARCH_TOKENS = ['investigate', 'research', 'explore options', 'compare ', 'evaluate options', 'spike', 'feasibility', 'which approach', 'should we use'];
const DOC_TOKENS = ['document', 'readme', 'changelog', 'docs', 'comment', 'write up', 'explain in the docs'];
const CONVERSATION_TOKENS = ['what is', 'what are', 'how does', 'why does', 'can you explain', 'tell me', '?'];

/**
 * Maps the intake complexity tier to the §5 complexity vocabulary.
 * @param {string} tier intake tier (trivial|feature|architectural)
 * @returns {string}
 */
function complexityFromTier(tier) {
  if (tier === 'architectural') return 'architectural';
  if (tier === 'feature') return 'feature';
  return 'trivial';
}

/**
 * Derives a risk band from regulated domain, tier and affected paths.
 * Regulated domain or architectural tier ⇒ high; high-risk paths bump a notch.
 *
 * @param {object} signals intake signals
 * @returns {{ risk: string, reasons: string[] }}
 */
function deriveRisk(signals) {
  const reasons = [];
  const domain = signals?.domain ?? 'general';
  const tier = signals?.tier ?? 'trivial';
  let risk = 'low';
  if (tier === 'feature') risk = 'medium';
  if (tier === 'architectural') { risk = 'high'; reasons.push('risk=high (architectural tier)'); }
  if (domain && domain !== 'general') {
    risk = risk === 'high' ? 'critical' : 'high';
    reasons.push(`risk≥high (regulated domain '${domain}')`);
  }
  if (risk === 'low') reasons.push('risk=low (trivial tier, no regulated domain)');
  return { risk, reasons };
}

/**
 * Derives reversibility + blast radius from tier, ADR-need and paths.
 *
 * @param {object} signals intake signals
 * @returns {{ reversibility: string, blastRadius: string }}
 */
function deriveBlast(signals) {
  const tier = signals?.tier ?? 'trivial';
  const needsAdr = Boolean(signals?.needsAdr);
  const paths = Array.isArray(signals?.paths) ? signals.paths : [];
  const reversibility = needsAdr || tier === 'architectural' ? 'low' : tier === 'feature' ? 'medium' : 'high';
  let blastRadius = 'local';
  if (paths.length > 3) blastRadius = 'module';
  if (needsAdr || tier === 'architectural') blastRadius = 'cross-cutting';
  return { reversibility, blastRadius };
}

/**
 * Resolves the materiality score from the B2 decisionNeed signal (BIZ-0001),
 * falling back to a tier-derived estimate when decisionNeed is absent.
 *
 * @param {object} signals intake signals
 * @returns {{ materialityScore: number, needVerdict: string|null }}
 */
function resolveMateriality(signals) {
  const dn = signals?.decisionNeed;
  if (dn && typeof dn.materialityScore === 'number') {
    return { materialityScore: clamp01(dn.materialityScore), needVerdict: dn.needVerdict ?? null };
  }
  const tier = signals?.tier ?? 'trivial';
  const fallback = tier === 'architectural' ? 0.7 : tier === 'feature' ? 0.4 : 0.1;
  return { materialityScore: fallback, needVerdict: null };
}

/** Clamps a number into [0,1]; non-numbers ⇒ 0. */
function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Estimates an ambiguity score from request length and option language. High
 * ambiguity is the seam where the orchestrator may request model refinement.
 *
 * @param {string} text request text
 * @returns {number} 0..1
 */
function ambiguityFromText(text) {
  const t = String(text ?? '').trim();
  if (!t) return 1;
  const words = t.split(/\s+/).length;
  let score = words < 4 ? 0.6 : words < 10 ? 0.3 : 0.1;
  if (/\bor\b|either|vs\.?|versus|alternativ/i.test(t)) score = Math.min(1, score + 0.3);
  return Number(score.toFixed(2));
}

/**
 * Picks the primary governed context using intake signals first, token tables
 * only as a tie-break. Returns the context plus the reason code that decided it.
 *
 * @param {object} signals intake signals
 * @param {object} ctx { businessId, operationId, workflowId, taskId, requestText }
 * @returns {{ primaryType: string, secondaryTypes: string[], reasons: string[] }}
 */
function pickContext(signals, ctx) {
  const reasons = [];
  const secondary = new Set();
  const text = String(ctx?.requestText ?? '').toLowerCase();
  const work = signals?.work ?? {};
  const triple = signals?.decisionNeed?.triple ?? {};
  const ctxType = triple?.primaryContext?.type ?? null;
  const tier = signals?.tier ?? 'trivial';
  const needsAdr = Boolean(signals?.needsAdr);
  const material = (signals?.decisionNeed?.materialityScore ?? 0) >= 0.6
    || signals?.decisionNeed?.needVerdict === 'NEEDS_DECISION';

  // 1. Business — confirmed/suggested business context wins (§19).
  if (ctxType === 'business' || work?.nature === 'business' || ctx?.businessId) {
    reasons.push(`primary=business (decisionNeed context='${ctxType}', work.nature='${work?.nature}')`);
    if (material) secondary.add('decision');
    return finalize('business', secondary, reasons);
  }
  // 2. Incident — operational emergency / production failure.
  if ((work?.kind === 'operationalResponse') || INCIDENT_TOKENS.some((k) => text.includes(k))) {
    reasons.push('primary=incident (operationalResponse / production-failure tokens)');
    secondary.add('operation');
    return finalize('incident', secondary, reasons);
  }
  // 3. Operation — operation nature with an owner.
  if (ctxType === 'operation' || work?.nature === 'operation' || ctx?.operationId) {
    reasons.push(`primary=operation (context='${ctxType}', work.nature='${work?.nature}')`);
    return finalize('operation', secondary, reasons);
  }
  // 4. Decision — architectural / material decision with options.
  if ((needsAdr || tier === 'architectural') && material) {
    reasons.push('primary=decision (needsAdr/architectural + material)');
    secondary.add('implementation');
    return finalize('decision', secondary, reasons);
  }
  // 5. Workflow — an active workflow task is referenced.
  if (ctx?.workflowId || ctx?.taskId) {
    reasons.push(`primary=workflow (active workflow=${ctx?.workflowId ?? '?'} task=${ctx?.taskId ?? '?'})`);
    secondary.add('implementation');
    return finalize('workflow', secondary, reasons);
  }
  // 6. Maintenance.
  if (work?.kind === 'maintenance') {
    reasons.push('primary=maintenance (work.kind=maintenance)');
    return finalize('maintenance', secondary, reasons);
  }
  // 7. Research / documentation / conversation — token-assisted, lowest precedence.
  if (RESEARCH_TOKENS.some((k) => text.includes(k))) {
    reasons.push('primary=research (research-intent tokens)');
    return finalize('research', secondary, reasons);
  }
  if (DOC_TOKENS.some((k) => text.includes(k)) && tier === 'trivial') {
    reasons.push('primary=documentation (doc tokens, trivial tier)');
    return finalize('documentation', secondary, reasons);
  }
  if (tier === 'trivial' && CONVERSATION_TOKENS.some((k) => text.includes(k)) && text.split(/\s+/).length < 12) {
    reasons.push('primary=conversation (question/short, trivial tier)');
    return finalize('conversation', secondary, reasons);
  }
  // 8. Default — implementation.
  reasons.push(`primary=implementation (default; tier='${tier}')`);
  return finalize('implementation', secondary, reasons);
}

/** Removes the primary from secondary and returns the shaped object. */
function finalize(primaryType, secondarySet, reasons) {
  secondarySet.delete(primaryType);
  return { primaryType, secondaryTypes: [...secondarySet], reasons };
}

/**
 * Classifies a request into the canonical context + §5 classification block.
 *
 * @param {object} signals intake signals (from task-intake.intake())
 * @param {object} [ctx] { businessId, operationId, workflowId, taskId, requestText }
 * @returns {{ primaryType: string, secondaryTypes: string[], intent: string,
 *   complexity: string, risk: string, materialityScore: number,
 *   ambiguityScore: number, reversibility: string, blastRadius: string,
 *   needsAdr: boolean, needsDebate: boolean, reasonCodes: string[] }}
 */
export function classifyRequest(signals, ctx = {}) {
  try {
    const safeSignals = signals && typeof signals === 'object' ? signals : {};
    const { primaryType, secondaryTypes, reasons: ctxReasons } = pickContext(safeSignals, ctx);
    const { risk, reasons: riskReasons } = deriveRisk(safeSignals);
    const { reversibility, blastRadius } = deriveBlast(safeSignals);
    const { materialityScore, needVerdict } = resolveMateriality(safeSignals);
    const complexity = complexityFromTier(safeSignals.tier);
    const ambiguityScore = ambiguityFromText(ctx?.requestText);
    const needsAdr = Boolean(safeSignals.needsAdr);

    const intent = deriveIntent(primaryType, needsAdr, materialityScore, needVerdict);
    const needsDebate = intent === 'material-decision'
      || (needsAdr && materialityScore >= 0.6)
      || (primaryType === 'decision' && materialityScore >= 0.6);

    const reasonCodes = [...ctxReasons, ...riskReasons,
      `intent=${intent}`, `materiality=${materialityScore.toFixed(2)}`,
      `complexity=${complexity}`, `needsDebate=${needsDebate}`];

    return {
      primaryType, secondaryTypes, intent, complexity, risk,
      materialityScore, ambiguityScore, reversibility, blastRadius,
      needsAdr, needsDebate, reasonCodes,
    };
  } catch {
    return {
      primaryType: 'implementation', secondaryTypes: [], intent: 'implementation',
      complexity: 'feature', risk: 'medium', materialityScore: 0, ambiguityScore: 1,
      reversibility: 'medium', blastRadius: 'local', needsAdr: false, needsDebate: false,
      reasonCodes: ['fail-open: classifier degraded to conservative implementation verdict'],
    };
  }
}

/**
 * Derives the intent label from context + materiality.
 * @returns {string}
 */
function deriveIntent(primaryType, needsAdr, materialityScore, needVerdict) {
  if (primaryType === 'business' && (materialityScore >= 0.6 || needVerdict === 'NEEDS_DECISION')) return 'material-decision';
  if (primaryType === 'decision') return needsAdr ? 'material-decision' : 'decision';
  if (primaryType === 'incident') return 'incident-response';
  if (primaryType === 'research') return 'research';
  if (primaryType === 'maintenance') return 'maintenance';
  if (primaryType === 'documentation') return 'documentation';
  if (primaryType === 'conversation') return 'conversation';
  if (primaryType === 'operation') return 'operation';
  if (primaryType === 'workflow') return 'workflow-task';
  return 'implementation';
}
