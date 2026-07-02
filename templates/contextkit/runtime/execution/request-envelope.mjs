/**
 * request-envelope.mjs — The canonical Request Intent Envelope (WF0038, ADR-0107 §5).
 *
 * Builds + persists the versioned envelope that records, for one request, the
 * classification, the resolved autonomy, the routing decision, the planned agents
 * and playbooks, and a dispatch-plan id. It is stored INSIDE the existing
 * session/execution state architecture (co-located with execution-contract.json),
 * never as an arbitrary per-request markdown file (ADR-0107 §5).
 *
 * Zero runtime dependencies — `node:*` + the canonical platform primitives only.
 * Defensive I/O: persistence never throws (rule 2). buildEnvelope is pure except
 * for the injected `receivedAt` (callers may pass one for reproducible tests).
 *
 * @module request-envelope
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';
import { pathsFor } from '../config/paths.mjs';
import { buildImplementationBlock } from '../domain-engineering/envelope-block.mjs';

/** Envelope schema version — bump on any breaking shape change (§5). */
export const ENVELOPE_SCHEMA_VERSION = '1.0.0';

/**
 * Returns the absolute path for a request's intent-envelope.json. Co-located
 * with the task's state.json + execution-contract.json so one task owns one
 * orchestration record.
 *
 * @param {string} root project root
 * @param {string} id task / request id
 * @returns {string}
 */
export function envelopePathFor(root, id) {
  return join(pathsFor(root).pipeline, 'state', String(id), 'intent-envelope.json');
}

/**
 * Computes the sha256 hash of the request text (prefixed `sha256:`). Never stores
 * the raw text — only its hash + a bounded summary (privacy: metadata, not payload).
 *
 * @param {string} text request text
 * @returns {string}
 */
export function hashRequestText(text) {
  const digest = createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
  return `sha256:${digest}`;
}

/**
 * Derives a short bounded summary from the request text (first line, ≤120 chars).
 *
 * @param {string} text request text
 * @returns {string}
 */
function summarize(text) {
  const firstLine = String(text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const trimmed = firstLine.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

/**
 * Assembles a Request Intent Envelope from the orchestration inputs. Pure: the
 * caller supplies classification, autonomy, routing, agents, playbooks and ids.
 * Missing optional blocks default to empty/safe shapes so the envelope is always
 * schema-complete (W1 ships with agents/playbooks empty — W2 fills them).
 *
 * @param {object} params
 * @param {string} params.requestId
 * @param {string|null} params.sessionId
 * @param {string} params.requestText
 * @param {object} params.classification result of classifyRequest()
 * @param {object} params.context { businessId, operationId, workflowId, taskId }
 * @param {object} params.autonomy { configuredGrade, effectiveGrade, source, mode }
 * @param {object} params.routing { mode, directExecutionAllowed, reasonCodes }
 * @param {object} [params.agents] { lead, council, scouts, reviewers }
 * @param {object[]} [params.playbooks] [{ id, sections }]
 * @param {string[]} [params.explicitOverrides] natural-language overrides (§8)
 * @param {string} [params.dispatchPlanId]
 * @param {string} [params.receivedAt] ISO timestamp (injectable for tests)
 * @param {string} [params.root] project root — builds the §15 implementation block
 * @param {object} [params.intakeSignals] intake signals for the implementation block
 * @param {object} [params.implementation] pre-built implementation block (overrides inline build)
 * @returns {object} intent envelope (§5) including the shadow §15 implementation block (ADR-0128)
 */
export function buildEnvelope(params) {
  const p = params && typeof params === 'object' ? params : {};
  const cls = p.classification && typeof p.classification === 'object' ? p.classification : {};
  const ctx = p.context && typeof p.context === 'object' ? p.context : {};
  const autonomy = p.autonomy && typeof p.autonomy === 'object' ? p.autonomy : {};
  const routing = p.routing && typeof p.routing === 'object' ? p.routing : {};
  const agents = p.agents && typeof p.agents === 'object' ? p.agents : {};

  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    requestId: String(p.requestId ?? 'req-unknown'),
    sessionId: p.sessionId ?? null,
    receivedAt: p.receivedAt ?? new Date().toISOString(),
    request: {
      textHash: hashRequestText(p.requestText),
      summary: summarize(p.requestText),
      explicitOverrides: Array.isArray(p.explicitOverrides) ? p.explicitOverrides : [],
    },
    context: {
      primaryType: cls.primaryType ?? 'implementation',
      secondaryTypes: Array.isArray(cls.secondaryTypes) ? cls.secondaryTypes : [],
      businessId: ctx.businessId ?? null,
      operationId: ctx.operationId ?? null,
      workflowId: ctx.workflowId ?? null,
      taskId: ctx.taskId ?? null,
    },
    classification: {
      intent: cls.intent ?? 'implementation',
      complexity: cls.complexity ?? 'feature',
      risk: cls.risk ?? 'medium',
      materialityScore: typeof cls.materialityScore === 'number' ? cls.materialityScore : 0,
      ambiguityScore: typeof cls.ambiguityScore === 'number' ? cls.ambiguityScore : 0,
      reversibility: cls.reversibility ?? 'medium',
      blastRadius: cls.blastRadius ?? 'local',
      needsAdr: Boolean(cls.needsAdr),
      needsDebate: Boolean(cls.needsDebate),
    },
    autonomy: {
      configuredGrade: autonomy.configuredGrade ?? null,
      effectiveGrade: autonomy.effectiveGrade ?? null,
      source: autonomy.source ?? 'unknown',
      mode: autonomy.mode ?? 'manual',
    },
    routing: {
      mode: routing.mode ?? 'shadow',
      directExecutionAllowed: routing.directExecutionAllowed !== false,
      reasonCodes: Array.isArray(routing.reasonCodes) ? routing.reasonCodes : [],
    },
    agents: {
      lead: agents.lead ?? null,
      council: Array.isArray(agents.council) ? agents.council : [],
      scouts: Array.isArray(agents.scouts) ? agents.scouts : [],
      reviewers: Array.isArray(agents.reviewers) ? agents.reviewers : [],
      synthesizer: agents.synthesizer ?? null,
    },
    playbooks: Array.isArray(p.playbooks) ? p.playbooks : [],
    dispatchPlanId: p.dispatchPlanId ?? null,
    // §15 shadow implementation block (ADR-0128). Additive: zero blocking power.
    implementation: resolveImplementationBlock(p, cls),
  };
}

/**
 * Resolves the §15 implementation block: a caller-supplied block wins; otherwise
 * it is built inline from the request + intake signals (defensive — a missing
 * root/policy degrades to a recorded receipt, never throws). Shadow-only.
 *
 * @param {object} p buildEnvelope params.
 * @param {object} cls the classification block.
 * @returns {object} the §15 implementation block.
 */
function resolveImplementationBlock(p, cls) {
  if (p.implementation && typeof p.implementation === 'object') return p.implementation;
  try {
    return buildImplementationBlock({
      root: p.root,
      requestText: p.requestText,
      intakeSignals: p.intakeSignals,
      classification: cls,
    });
  } catch {
    return { schemaVersion: '1.0.0', shadow: true, profile: 'no-code', degraded: true, reasonCodes: ['ENVELOPE_DEGRADED'] };
  }
}

/**
 * Atomically persists an intent envelope co-located with the task state. Creates
 * the parent state dir if missing. Never throws — returns false on any I/O error.
 *
 * @param {string} root project root
 * @param {string} id task / request id
 * @param {object} envelope envelope from buildEnvelope()
 * @returns {boolean} true on success
 */
export function saveEnvelope(root, id, envelope) {
  try {
    const stateDir = join(pathsFor(root).pipeline, 'state', String(id));
    mkdirSync(stateDir, { recursive: true });
    writeFileAtomicSync(envelopePathFor(root, id), JSON.stringify(envelope, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a persisted intent envelope, or null when absent/unparseable (rule 2).
 *
 * @param {string} root project root
 * @param {string} id task / request id
 * @returns {object|null}
 */
export function loadEnvelope(root, id) {
  return readJsonSafe(envelopePathFor(root, id), null);
}
