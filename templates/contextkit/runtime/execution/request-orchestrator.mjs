/**
 * request-orchestrator.mjs — The RequestOrchestrator brain (WF0038, ADR-0107 §2).
 *
 * Given the intake signals for one request, it runs the orchestration pipeline and
 * returns a Request Intent Envelope: classify → resolve autonomy (READ-ONLY) →
 * deliberation decision → [agent + playbook selection: W2 seam] → routing decision
 * → dispatch plan → envelope. It NEVER mutates autonomy state and NEVER weakens a
 * safety gate (ADR-0107 §2: additive toward governance, advisory toward permission).
 *
 * Pure given (signals, params). Zero runtime dependencies. Fail-open: any error
 * yields a minimal conservative envelope, never throws into the host adapter.
 *
 * W1 scope (shadow only): produces the envelope + classification + deliberation +
 * routing RECOMMENDATION. Agent/playbook selection and real dispatch are W2/W3 —
 * their seams return empty with an explicit `pending` reason code.
 *
 * @module request-orchestrator
 */
import { classifyRequest } from './request-classify.mjs';
import { buildEnvelope } from './request-envelope.mjs';
import { selectAgents } from './request-agent-select.mjs';
import { selectPlaybooks, compilePlaybookContext } from './playbook-compile.mjs';
import { resolveAutonomy } from '../config/resolve-autonomy.mjs';
import { resolveActiveContext } from './active-context-resolver.mjs';
import { recommendDeliberation } from './auto-deliberation.mjs';
import { applyOverOrchestrationGuard } from './agent-orchestration-guard.mjs';
import { buildDispatchPlan } from './dispatch-plan.mjs';

/** Anti-trigger contexts that must never convene a council (ADR-0107 §7.2). */
const DEBATE_ANTI_CONTEXTS = Object.freeze(['maintenance', 'documentation', 'conversation']);

/** Natural-language override patterns (§8). Each maps text → an override token. */
const OVERRIDE_PATTERNS = Object.freeze([
  { re: /\b(do not|don't|no)\s+debate\b/i, token: 'no-debate' },
  { re: /\bhandle this directly\b|\bdo it directly\b/i, token: 'direct' },
  { re: /\b(do not|don't)\s+delegate\b/i, token: 'no-delegate' },
  { re: /\brun the full council\b|\bfull debate\b/i, token: 'force-debate' },
  { re: /\buse only deterministic\b|\bdeterministic tools only\b/i, token: 'deterministic-only' },
]);

/**
 * Parses explicit natural-language overrides from the request text (§8). Overrides
 * may REDUCE orchestration when safety permits; they never bypass a floor.
 *
 * @param {string} text request text
 * @returns {string[]} override tokens
 */
export function parseOverrides(text) {
  const t = String(text ?? '');
  const tokens = [];
  for (const { re, token } of OVERRIDE_PATTERNS) if (re.test(t)) tokens.push(token);
  return tokens;
}

/**
 * Decides whether a council must convene automatically (ADR-0107 §7). Requires
 * effective grade ≥ 3, deliberations.active, a material trigger in classification,
 * and NOT an anti-trigger context. Explicit overrides are honored: `no-debate`
 * suppresses (when no floor forces it); `force-debate` requests it.
 *
 * @param {object} cls classification
 * @param {object} config project config
 * @param {number} effectiveGrade resolved grade
 * @param {string} deliberationMode resolved mode for the deliberation area
 * @param {string[]} overrides parsed overrides
 * @returns {{ required: boolean, reasons: string[] }}
 */
function decideDeliberation(cls, config, effectiveGrade, deliberationMode, overrides) {
  const reasons = [];
  const active = config?.deliberations?.active !== false;
  const materialTrigger = Boolean(cls.needsDebate) || cls.intent === 'material-decision';
  const antiContext = DEBATE_ANTI_CONTEXTS.includes(cls.primaryType);

  if (!active) { reasons.push('debate=skip (deliberations.active=false)'); return { required: false, reasons }; }
  if (antiContext) { reasons.push(`debate=skip (anti-trigger context '${cls.primaryType}')`); return { required: false, reasons }; }
  if (overrides.includes('no-debate')) { reasons.push('debate=skip (explicit no-debate override)'); return { required: false, reasons }; }
  if (overrides.includes('force-debate')) { reasons.push('debate=required (explicit force-debate override)'); return { required: true, reasons }; }
  if (effectiveGrade < 3) {
    reasons.push(`debate=propose-only (effective grade ${effectiveGrade} < 3 — consent required before dispatch)`);
    return { required: false, reasons };
  }
  if (materialTrigger && deliberationMode === 'debate') {
    reasons.push(`debate=required (material trigger + grade ${effectiveGrade} + resolver mode 'debate')`);
    return { required: true, reasons };
  }
  reasons.push(`debate=not-required (materialTrigger=${materialTrigger}, mode='${deliberationMode}')`);
  return { required: false, reasons };
}

/**
 * Resolves the governed routing recommendation per request class (ADR-0107 §14).
 * The GLOBAL default (`config.routing.mode`) is authoritative; this only computes
 * the recommended per-class behavior. In shadow it records, never dispatches.
 *
 * @param {object} cls classification
 * @param {object} config project config
 * @param {string[]} overrides parsed overrides
 * @returns {{ mode: string, directExecutionAllowed: boolean, reasonCodes: string[] }}
 */
function decideRouting(cls, config, overrides) {
  const globalMode = config?.routing?.mode ?? 'shadow';
  const reasonCodes = [`routing.global=${globalMode}`];
  // Trivial / mechanical → runner-first direct (over-orchestration guard, §15).
  const trivial = cls.complexity === 'trivial' && cls.risk === 'low'
    && !cls.needsDebate && cls.primaryType !== 'business' && cls.primaryType !== 'decision';
  if (trivial || overrides.includes('direct')) {
    reasonCodes.push('class=trivial-or-direct → runner-first direct execution');
    return { mode: globalMode, directExecutionAllowed: true, reasonCodes };
  }
  // Business / material decision / high-risk → active orchestration recommendation.
  const wantsActive = cls.primaryType === 'business' || cls.primaryType === 'decision'
    || cls.needsDebate || cls.risk === 'high' || cls.risk === 'critical';
  if (wantsActive) {
    reasonCodes.push(`class=${cls.primaryType}/${cls.risk} → active orchestration recommended`);
    return { mode: globalMode, directExecutionAllowed: globalMode !== 'active', reasonCodes };
  }
  reasonCodes.push('class=ordinary-implementation → active with over-orchestration guard');
  return { mode: globalMode, directExecutionAllowed: true, reasonCodes };
}

/**
 * Selects the deliberation resolver area for this request.
 * @param {object} cls classification
 * @returns {string} an AREAS member
 */
function deliberationArea(cls) {
  if (cls.primaryType === 'business' || cls.primaryType === 'decision' || cls.needsAdr) return 'decision-deliberation';
  return 'feature-deliberation';
}

/**
 * Runs the orchestration pipeline for one request and returns its Intent Envelope.
 *
 * @param {object} payload { requestId, requestText, sessionId, signals, context }
 * @param {object} env { root, level, config, sessionOverride, receivedAt }
 * @returns {object} intent envelope (request-envelope §5)
 */
export function orchestrate(payload, env = {}) {
  try {
    const p = payload && typeof payload === 'object' ? payload : {};
    const config = env.config && typeof env.config === 'object' ? env.config : {};
    const ctx = { ...(p.context ?? {}), requestText: p.requestText };
    const overrides = parseOverrides(p.requestText);

    const cls = classifyRequest(p.signals, ctx);

    // Autonomy — READ-ONLY consult of the resolver (ADR-0042/0107 §1).
    const area = deliberationArea(cls);
    const auton = resolveAutonomy(area, config, env.sessionOverride ?? null, {});
    const effectiveGrade = auton.grade ?? null;
    const autonomy = {
      configuredGrade: config?.autonomy?.grade ?? null,
      effectiveGrade, source: auton.source ?? 'unknown', mode: auton.mode ?? 'manual',
    };

    const delib = decideDeliberation(cls, config, effectiveGrade ?? 0, auton.mode, overrides);
    const routing = decideRouting(cls, config, overrides);

    // Agent + playbook selection (W2). Skipped for trivial-direct work (the
    // over-orchestration guard, §15) — recording a recommendation there is waste.
    const selectCtx = { root: env.root, paths: p.signals?.paths, phase: p.context?.phase };
    const trivialDirect = routing.directExecutionAllowed
      && cls.complexity === 'trivial' && !cls.needsDebate
      && cls.primaryType !== 'business' && cls.primaryType !== 'decision';
    let agents = { lead: null, council: [], scouts: [], reviewers: [], synthesizer: null };
    let playbooks = [];
    let guardMeta = null;
    if (trivialDirect) {
      routing.reasonCodes.push('agents/playbooks=skipped (trivial-direct, over-orchestration guard)');
    } else {
      // W2 selection, then the A8 per-tier over-orchestration guard caps it (ADR-0112).
      const guarded = applyOverOrchestrationGuard(selectAgents(cls, selectCtx, config), cls, config);
      agents = { lead: guarded.lead, council: guarded.council, scouts: guarded.scouts, reviewers: guarded.reviewers, synthesizer: guarded.synthesizer };
      guardMeta = guarded.guard;
      const pbSel = selectPlaybooks(cls, selectCtx);
      const maxTokens = config?.orchestration?.playbooks?.maxContextTokens ?? 3000;
      const compiled = compilePlaybookContext(pbSel.selected, { root: env.root, maxTokens });
      playbooks = compiled.playbooks.map((pb) => ({ id: pb.id, sections: pb.sections.map((s) => s.name) }));
      routing.reasonCodes.push(...guarded.reasonCodes.slice(0, 6), ...pbSel.reasonCodes.slice(0, 4));
      if (compiled.missingCoverage.length) routing.reasonCodes.push(`playbook-missing-coverage=${compiled.missingCoverage.length}`);
    }

    const dispatchPlanId = `dispatch-${p.requestId ?? 'req'}`;
    const envelope = buildEnvelope({
      requestId: p.requestId ?? 'req-unknown',
      sessionId: p.sessionId ?? null,
      requestText: p.requestText,
      classification: cls,
      context: p.context ?? {},
      autonomy,
      routing,
      agents,
      playbooks,
      explicitOverrides: overrides,
      dispatchPlanId,
      receivedAt: env.receivedAt,
    });
    // Fold deliberation reasons into the envelope routing reason codes (auditable).
    envelope.routing.reasonCodes.push(...delib.reasons);
    envelope.deliberation = { required: delib.required, reasons: delib.reasons };

    // A7-A8 shadow enrichment (ADR-0112) — governed context, auto-deliberation,
    // the over-orchestration guard verdict, and a (non-dispatching) dispatch plan.
    // Best-effort: enrichment never breaks the base envelope (rule 2).
    try {
      envelope.activeContext = resolveActiveContext(
        { request: { text: p.requestText }, branch: p.context?.branch, cwd: env.root },
        { root: env.root },
      );
      envelope.autoDeliberation = recommendDeliberation(
        { request: p.requestText, decisionSignal: p.requestText, grade: effectiveGrade ?? 0,
          deliberationsActive: config?.deliberations?.active === true,
          materiality: cls.materialityScore, complexity: cls.complexity },
        {},
      );
      if (guardMeta) envelope.guard = guardMeta;
      envelope.dispatchPlan = buildDispatchPlan(envelope, config);
    } catch { /* shadow enrichment is best-effort; base envelope already complete */ }
    return envelope;
  } catch {
    // Fail-open: a minimal, schema-complete, conservative envelope.
    return buildEnvelope({
      requestId: payload?.requestId ?? 'req-unknown',
      sessionId: payload?.sessionId ?? null,
      requestText: payload?.requestText,
      classification: {}, context: {}, autonomy: {}, routing: { reasonCodes: ['fail-open: orchestrator degraded'] },
    });
  }
}
