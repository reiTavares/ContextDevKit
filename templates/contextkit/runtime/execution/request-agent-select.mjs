/**
 * request-agent-select.mjs — Deterministic specialist selection (WF0038, ADR-0107 §9/§10/§11).
 *
 * Loads the Agent Capability Registry and scores every installed specialist
 * against the request classification + context, returning the lead, supporting
 * specialists, reviewers, the deliberation council and a DISTINCT synthesizer —
 * each with explainable reason codes (§10: scoring must be deterministic and
 * explainable; §11: minimum composition for material decisions; the synthesizer
 * is never one of the debating voices).
 *
 * Pure given (classification, ctx, registry). Zero runtime dependencies. Fail-open:
 * a missing/invalid registry yields an empty selection with a reason code, never
 * throws — the orchestrator degrades to direct execution.
 *
 * @module request-agent-select
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Score weights (§10). Tuned so capability+context dominate, cost trims ties. */
const W = Object.freeze({
  intent: 5, contextOwnership: 4, pathOwnership: 3, riskMatch: 3,
  playbookMatch: 2, capabilityHit: 2, antiTrigger: -100, duplicate: -2, coordCost: -1,
});

/**
 * Loads the agent capability registry from policy/. Returns {agents:[]} on any
 * error (fail-open).
 *
 * @param {string} root project root
 * @returns {{ agents: object[] }}
 */
export function loadAgentRegistry(root) {
  try {
    const p = join(pathsFor(root).policy, 'agent-capability-registry.json');
    if (!existsSync(p)) return { agents: [] };
    const parsed = JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));
    return parsed && Array.isArray(parsed.agents) ? parsed : { agents: [] };
  } catch {
    return { agents: [] };
  }
}

/** True when any registry pathPattern stem is a substring of any affected path. */
function pathOwns(patterns, paths) {
  if (!Array.isArray(patterns) || !Array.isArray(paths) || !paths.length) return false;
  return patterns.some((pat) => {
    const stem = String(pat).replace(/\*+/g, '').replace(/\/+$/, '');
    return stem && paths.some((f) => String(f).includes(stem));
  });
}

/** Maps a classification intent to the registry review-intent vocabulary. */
function intentMatches(agent, cls) {
  const intents = Array.isArray(agent.intents) ? agent.intents : [];
  if (intents.includes(cls.intent)) return true;
  if (cls.needsDebate && intents.includes('material-decision')) return true;
  if ((cls.risk === 'high' || cls.risk === 'critical') && intents.includes('implementation-review')) return true;
  return false;
}

/**
 * Scores one agent against the classification + context. Returns the numeric
 * score plus the reason codes that produced it. Anti-trigger context forces a
 * disqualifying score so the agent is never selected for trivial/mechanical work.
 *
 * @param {object} agent registry entry
 * @param {object} cls classification
 * @param {object} ctx { paths, primaryType }
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreAgent(agent, cls, ctx) {
  const reasons = [];
  let score = 0;
  const anti = Array.isArray(agent.antiTriggers) ? agent.antiTriggers : [];
  const isAnti = (cls.complexity === 'trivial' && anti.includes('copy-edit'))
    || (cls.primaryType === 'documentation' && anti.includes('formatting-only'));
  if (isAnti) { return { score: W.antiTrigger, reasons: [`${agent.agent}: anti-trigger (trivial/${cls.primaryType})`] }; }

  if (intentMatches(agent, cls)) { score += W.intent; reasons.push(`+intent(${cls.intent})`); }
  if (Array.isArray(agent.riskTriggers) && agent.riskTriggers.includes(cls.risk)) { score += W.riskMatch; reasons.push(`+risk(${cls.risk})`); }
  if (pathOwns(agent.pathPatterns, ctx?.paths)) { score += W.pathOwnership; reasons.push('+path-ownership'); }
  if (ownsContext(agent, cls.primaryType)) { score += W.contextOwnership; reasons.push(`+context(${cls.primaryType})`); }
  if (Array.isArray(agent.capabilities) && agent.capabilities.length) { score += W.capabilityHit; reasons.push('+capabilities'); }
  return { score, reasons: score > 0 ? [`${agent.agent}: ${reasons.join(' ')}`] : [] };
}

/** Context → squad ownership heuristic. */
function ownsContext(agent, primaryType) {
  const squad = String(agent.squad ?? '');
  if (primaryType === 'business') return squad.includes('product') || squad.includes('growth');
  if (primaryType === 'decision') return agent.agent === 'architect' || squad.includes('security');
  if (primaryType === 'incident') return squad.includes('ops') || squad.includes('security');
  if (primaryType === 'documentation') return agent.agent === 'context-keeper';
  return false;
}

/**
 * Selects the specialist composition for a request (§10/§11). Returns the lead,
 * supporting specialists, reviewers, the deliberation council and a distinct
 * synthesizer. Council size honors config.deliberations.council {min,max}.
 *
 * @param {object} classification result of classifyRequest()
 * @param {object} [ctx] { paths }
 * @param {object} [config] project config (council bounds)
 * @param {object} [registry] agent registry (defaults to loadAgentRegistry via ctx.root)
 * @returns {{ lead: string|null, supporting: string[], scouts: string[],
 *   reviewers: string[], council: string[], synthesizer: string|null, reasonCodes: string[] }}
 */
export function selectAgents(classification, ctx = {}, config = {}, registry = null) {
  const empty = { lead: null, supporting: [], scouts: [], reviewers: [], council: [], synthesizer: null, reasonCodes: [] };
  try {
    const cls = classification && typeof classification === 'object' ? classification : {};
    const reg = registry ?? loadAgentRegistry(ctx.root);
    const agents = Array.isArray(reg.agents) ? reg.agents : [];
    if (!agents.length) return { ...empty, reasonCodes: ['agent-registry empty — direct execution'] };

    const scored = agents
      .map((a) => ({ agent: a, ...scoreAgent(a, cls, ctx) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.agent.agent.localeCompare(b.agent.agent));

    const reasonCodes = scored.slice(0, 8).flatMap((s) => s.reasons);
    if (!scored.length) return { ...empty, reasonCodes: ['no specialist scored > 0 — direct execution'] };

    const lead = scored[0].agent.agent;
    const reviewers = scored
      .filter((s) => s.agent.preferredRole === 'reviewer' && s.agent.agent !== lead)
      .slice(0, 2).map((s) => s.agent.agent);
    // High-risk implementation always gets an independent reviewer (§12).
    if ((cls.risk === 'high' || cls.risk === 'critical') && !reviewers.includes('code-reviewer')) {
      if (agents.some((a) => a.agent === 'code-reviewer')) reviewers.push('code-reviewer');
    }
    const supporting = scored.slice(1).filter((s) => !reviewers.includes(s.agent.agent)).slice(0, 1).map((s) => s.agent.agent);

    let council = [];
    let synthesizer = null;
    if (cls.needsDebate) {
      const bounds = config?.deliberations?.council ?? {};
      const min = Number(bounds.min ?? 3);
      const max = Number(bounds.max ?? 6);
      council = composeCouncil(scored, cls, min, max);
      synthesizer = pickSynthesizer(agents, council, lead);
      reasonCodes.push(`council=[${council.join(', ')}] synthesizer=${synthesizer ?? 'none'} (§11 minimum composition)`);
    }
    return { lead, supporting, scouts: [], reviewers, council, synthesizer, reasonCodes };
  } catch {
    return { ...empty, reasonCodes: ['fail-open: agent selection degraded — direct execution'] };
  }
}

/**
 * Builds a specialist council for a material decision (§11). Guarantees the
 * minimum composition (product/business owner + architecture owner + one risk
 * owner) when those agents are installed, padded to `min`, capped at `max`.
 *
 * @param {object[]} scored scored agents (desc)
 * @param {object} cls classification
 * @param {number} min minimum council size
 * @param {number} max maximum council size
 * @returns {string[]}
 */
function composeCouncil(scored, cls, min, max) {
  const names = scored.map((s) => s.agent.agent);
  const council = [];
  const want = (n) => { if (names.includes(n) && !council.includes(n) && council.length < max) council.push(n); };
  if (cls.primaryType === 'business') { want('product-owner'); want('architect'); want('growth'); want('security'); }
  else { want('architect'); want('security'); }
  for (const n of names) { if (council.length >= Math.max(min, 3)) break; want(n); }
  return council.slice(0, max);
}

/**
 * Picks a synthesizer distinct from every council voice and the lead (§11/§18).
 * Prefers architect, then context-keeper, then the first installed non-voice.
 *
 * @param {object[]} agents registry agents
 * @param {string[]} council council voices
 * @param {string} lead lead agent
 * @returns {string|null}
 */
function pickSynthesizer(agents, council, lead) {
  const taken = new Set([...council, lead]);
  const prefer = ['architect', 'context-keeper', 'product-owner'];
  for (const p of prefer) if (!taken.has(p) && agents.some((a) => a.agent === p)) return p;
  const fallback = agents.map((a) => a.agent).find((n) => !taken.has(n));
  return fallback ?? null;
}
