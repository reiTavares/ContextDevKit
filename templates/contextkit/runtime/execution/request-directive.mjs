/**
 * request-directive.mjs — Machine-readable orchestration directive + planned-vs-actual (WF0038, ADR-0107 §4/§13/§21).
 *
 * On a host that cannot dispatch sub-agents programmatically (Claude Code via a
 * hook), the orchestration plan is surfaced as a MANDATORY machine-readable
 * directive the main agent must honor before substantive work — never a mere
 * printed suggestion (§4). This module renders that directive from the envelope
 * and provides the planned-vs-actual comparison the completion gate uses (§13/§21).
 *
 * Actual dispatch is read from the existing subagent spawn-record substrate
 * (<pipeline>/state/<taskId>/subagents/*.json `label`) — no new recorder needed.
 *
 * Pure render + defensive read. Zero runtime dependencies. Fail-open.
 *
 * @module request-directive
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonSafe } from '../hooks/safe-io.mjs';
import { pathsFor } from '../config/paths.mjs';

/**
 * Renders the orchestration directive for an envelope. Returns '' (silent) when
 * there is nothing to orchestrate (trivial-direct: no debate, no specialists) so
 * the over-orchestration guard keeps trivial prompts noise-free (§15).
 *
 * @param {object} envelope intent envelope (request-envelope §5)
 * @returns {string}
 */
export function renderDirective(envelope) {
  try {
    const e = envelope && typeof envelope === 'object' ? envelope : {};
    const cls = e.classification ?? {};
    const agents = e.agents ?? {};
    const delib = e.deliberation ?? {};
    const hasSpecialists = Boolean(agents.lead) || (agents.council ?? []).length > 0;
    if (!delib.required && !hasSpecialists) return '';

    const ctx = [e.context?.primaryType, ...(e.context?.secondaryTypes ?? [])].filter(Boolean).join(' + ');
    const lines = [`‹CONTEXTKIT-ORCHESTRATION requestId=${e.requestId ?? '?'}›`];
    lines.push(`context: ${ctx} | intent: ${cls.intent} | materiality: ${num(cls.materialityScore)} | risk: ${cls.risk}`);
    lines.push(`autonomy: configured ${e.autonomy?.configuredGrade ?? '?'} → effective ${e.autonomy?.effectiveGrade ?? '?'} (${e.autonomy?.source ?? '?'}) | mode: ${e.autonomy?.mode ?? '?'}`);

    if (delib.required) {
      lines.push('DELIBERATION REQUIRED — convene the specialist council before substantive work:');
      lines.push(`  council: ${(agents.council ?? []).join(', ') || '(none resolved)'}`);
      lines.push(`  synthesizer (distinct from voices): ${agents.synthesizer ?? '(none)'}`);
    }
    if (agents.lead) {
      const reviewers = (agents.reviewers ?? []).join(', ');
      lines.push(`specialists: lead=${agents.lead}${reviewers ? ` reviewers=[${reviewers}]` : ''}`);
    }
    const pbs = (e.playbooks ?? []).map((p) => `${p.id}[${(p.sections ?? []).join(', ')}]`).join('; ');
    if (pbs) lines.push(`playbooks (sections injected): ${pbs}`);
    lines.push(`routing: ${e.routing?.mode ?? 'shadow'} | directExecutionAllowed: ${e.routing?.directExecutionAllowed !== false}`);
    lines.push(delib.required
      ? 'ACTION: run the council (real specialist agents), then synthesize. Do NOT mark complete without the deliberation. ADR write stays human-gated.'
      : 'ACTION: dispatch the lead specialist (+ reviewer if high-risk) before substantive work, or justify direct execution.');
    lines.push('‹/CONTEXTKIT-ORCHESTRATION›');
    return lines.join('\n') + '\n';
  } catch {
    return '';
  }
}

/** Formats a 0..1 number to 2 decimals; non-numbers → '?'. */
function num(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '?';
}

/**
 * Reads the set of actually-dispatched agent labels from the subagent spawn-record
 * substrate for a task. Returns [] on any error.
 *
 * @param {string} root project root
 * @param {string} taskId task id
 * @returns {string[]}
 */
export function readDispatchedAgents(root, taskId) {
  try {
    const dir = join(pathsFor(root).pipeline, 'state', String(taskId), 'subagents');
    const labels = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const rec = readJsonSafe(join(dir, name), null);
      if (rec && typeof rec.label === 'string') labels.push(rec.label);
    }
    return labels;
  } catch {
    return [];
  }
}

/**
 * Compares the planned orchestration (from the envelope) against the agents
 * actually dispatched (§13/§21). A required debate needs a quorum (≥2) of the
 * planned council to have been dispatched; required specialists (lead +
 * reviewers) must each appear. Returns the deviation set + reasons.
 *
 * @param {object} envelope intent envelope
 * @param {string[]} dispatched actually-dispatched agent labels
 * @returns {{ ok: boolean, requiredDebateMissing: boolean, missingSpecialists: string[], reasons: string[] }}
 */
export function comparePlannedActual(envelope, dispatched) {
  const reasons = [];
  try {
    const e = envelope && typeof envelope === 'object' ? envelope : {};
    const agents = e.agents ?? {};
    const delib = e.deliberation ?? {};
    const got = new Set((Array.isArray(dispatched) ? dispatched : []).map((d) => String(d).toLowerCase()));
    const was = (name) => got.has(String(name).toLowerCase());

    let requiredDebateMissing = false;
    if (delib.required) {
      const council = agents.council ?? [];
      const quorum = council.filter(was).length;
      if (quorum < 2) {
        requiredDebateMissing = true;
        reasons.push(`required deliberation not executed: only ${quorum}/${council.length} council voices dispatched`);
      }
    }
    const planned = [agents.lead, ...(agents.reviewers ?? [])].filter(Boolean);
    const missingSpecialists = planned.filter((a) => !was(a));
    if (missingSpecialists.length) reasons.push(`required specialists not dispatched: ${missingSpecialists.join(', ')}`);

    const ok = !requiredDebateMissing && missingSpecialists.length === 0;
    return { ok, requiredDebateMissing, missingSpecialists, reasons };
  } catch {
    return { ok: true, requiredDebateMissing: false, missingSpecialists: [], reasons: ['fail-open: comparison degraded'] };
  }
}
