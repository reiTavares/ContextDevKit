/**
 * request-telemetry.mjs — Orchestration telemetry + effectiveness (WF0038, ADR-0107 §23/§24).
 *
 * Append-only JSONL stream of per-request orchestration facts (mirrors the
 * economy-savings.mjs pattern): classification, debate decision, planned vs
 * dispatched agents, injected playbook sections, overhead. Feeds token-report,
 * the Session Autonomy Receipt and WF0018 calibration. A read side derives the
 * §24 agent + playbook effectiveness tallies — quality/selection facts, NOT a
 * token-economy ranking (§24: quality is primary).
 *
 * Append + read are defensive: a malformed line is skipped, never crashes; a
 * failed write is swallowed (telemetry must never break a request, rule 2).
 * Zero runtime dependencies. The JSONL lives under the gitignored pipeline dir.
 *
 * @module request-telemetry
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Telemetry schema tag — bump on a breaking record shape change. */
export const ORCH_TELEMETRY_SCHEMA = 'cdk-orchestration-telemetry/1';

/**
 * Absolute path to the orchestration telemetry JSONL (gitignored pipeline dir).
 * @param {string} root project root
 * @returns {string}
 */
export function telemetryPathFor(root) {
  return join(pathsFor(root).pipeline, 'telemetry', 'orchestration.jsonl');
}

/**
 * Derives a compact telemetry record from an intent envelope.
 *
 * @param {object} envelope intent envelope
 * @param {string[]} [dispatched] actually-dispatched agent labels
 * @returns {object}
 */
export function envelopeToRecord(envelope, dispatched = []) {
  const e = envelope && typeof envelope === 'object' ? envelope : {};
  const cls = e.classification ?? {};
  const agents = e.agents ?? {};
  const eventRefs = Array.isArray(e.economy?.eventIds)
    ? e.economy.eventIds
    : Array.isArray(e.economyEvents)
      ? e.economyEvents.map((event) => typeof event === 'string' ? event : event?.eventId)
      : [];
  return {
    schema: ORCH_TELEMETRY_SCHEMA,
    requestId: e.requestId ?? null,
    decisionId: e.routing?.decisionId ?? e.routing?.summary?.decisionId ?? null,
    economyEventIds: [...new Set(eventRefs.filter((id) => typeof id === 'string' && id.length > 0))],
    sessionId: e.sessionId ?? null,
    receivedAt: e.receivedAt ?? null,
    primaryType: e.context?.primaryType ?? null,
    intent: cls.intent ?? null,
    complexity: cls.complexity ?? null,
    risk: cls.risk ?? null,
    materialityScore: cls.materialityScore ?? null,
    debateRequired: Boolean(e.deliberation?.required),
    // A planned agent counts once regardless of how many roles it fills (lead +
    // council voice + reviewer) — dedupe so selection tallies are not inflated.
    agentsPlanned: [...new Set([agents.lead, ...(agents.council ?? []), ...(agents.reviewers ?? [])].filter(Boolean))],
    agentsDispatched: Array.isArray(dispatched) ? dispatched : [],
    playbooksApplied: (e.playbooks ?? []).map((p) => p.id),
    playbookSections: (e.playbooks ?? []).reduce((n, p) => n + (p.sections?.length ?? 0), 0),
    routingMode: e.routing?.mode ?? null,
    effectiveGrade: e.autonomy?.effectiveGrade ?? null,
  };
}

/**
 * Appends an orchestration telemetry record for an envelope. Never throws.
 *
 * @param {string} root project root
 * @param {object} envelope intent envelope
 * @param {string[]} [dispatched] dispatched agent labels
 * @returns {boolean} true on success
 */
export function recordOrchestration(root, envelope, dispatched = []) {
  try {
    const file = telemetryPathFor(root);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(envelopeToRecord(envelope, dispatched)) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads all telemetry records (skips malformed lines). Returns [] when absent.
 *
 * @param {string} root project root
 * @returns {object[]}
 */
export function readOrchestrationTelemetry(root) {
  try {
    const file = telemetryPathFor(root);
    if (!existsSync(file)) return [];
    const records = [];
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { records.push(JSON.parse(t)); } catch { /* skip bad line */ }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Derives §24 agent + playbook effectiveness tallies from telemetry records.
 * Per agent: selectionCount (planned), dispatchCount (actually dispatched).
 * Per playbook: selectionCount. Quality/selection facts — NOT a token ranking.
 *
 * @param {object[]} records telemetry records
 * @returns {{ agents: Record<string,{selectionCount:number,dispatchCount:number}>,
 *   playbooks: Record<string,{selectionCount:number}>, totals: object }}
 */
export function orchestrationEffectiveness(records) {
  const agents = {};
  const playbooks = {};
  let debatesRequired = 0;
  const list = Array.isArray(records) ? records : [];
  for (const r of list) {
    for (const a of (r.agentsPlanned ?? [])) {
      agents[a] ??= { selectionCount: 0, dispatchCount: 0 };
      agents[a].selectionCount += 1;
    }
    for (const a of (r.agentsDispatched ?? [])) {
      agents[a] ??= { selectionCount: 0, dispatchCount: 0 };
      agents[a].dispatchCount += 1;
    }
    for (const p of (r.playbooksApplied ?? [])) {
      playbooks[p] ??= { selectionCount: 0 };
      playbooks[p].selectionCount += 1;
    }
    if (r.debateRequired) debatesRequired += 1;
  }
  return { agents, playbooks, totals: { requests: list.length, debatesRequired } };
}
