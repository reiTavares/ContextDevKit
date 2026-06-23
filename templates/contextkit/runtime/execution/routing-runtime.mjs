/**
 * Routing runtime orchestrator — wires the ADR-0094 routing engine into the real
 * UserPromptSubmit flow (HIGH hotfix 3.0.1). It COMPOSES the canonical modules,
 * never forks them: `routing-config` (posture) → `task-classifier` (verdict) →
 * `routing-decision` (route) → `routing-telemetry` (append-only ledger).
 *
 * Honest by construction (ADR-0094 §Decision; spec §6.3/§6.8): the kit is a
 * governance layer, not a model scheduler. No current host (claude/codex/agy) can
 * switch the session model from a hook, so the normal hook record keeps
 * `applied:false` and `actualTier:null`. A separate executor may later provide a
 * valid correlated acknowledgement; only that reconciliation can set applied.
 * This makes `shadow` actually observe real prompts (its whole purpose) without
 * ever claiming a model switch or a saving that did not happen.
 *
 * Pure except for the optional telemetry append; never throws (the hook is
 * fail-open). Idempotent: a stable `decisionId` means a retried event is logged
 * once. Two sessions with the same prompt get distinct ids (sessionId is in the id).
 */
import { resolveRoutingConfig } from '../../tools/scripts/routing/routing-config.mjs';
import { classifyTask, signalsFromTitle } from '../../tools/scripts/routing/task-classifier.mjs';
import { decideRoute } from '../../tools/scripts/routing/routing-decision.mjs';
import { decisionRecord, appendDecision, readDecisions } from '../../tools/scripts/routing/routing-telemetry.mjs';
import {
  ECONOMY_EVENT_SCHEMA, createEconomyEvent, reconcileDecisionExecution,
} from './economy-lifecycle.mjs';

/** Decision-record schema (spec §6.5). */
export const ROUTING_DECISION_SCHEMA = 'routing-decision/1';

/**
 * Deterministic FNV-1a 32-bit hex. Used for the prompt fingerprint and the
 * decision id so NOTHING of the prompt itself is ever persisted (spec §6.5).
 * @param {string} str
 * @returns {string} 8-hex-char digest
 */
export function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable identity for one routing event: (session, prompt, policy). Two key facts
 * drive this (spec §6.6): the hook mints a FRESH taskId on every submit, so taskId
 * cannot be part of the identity or no two submits would ever dedup; and the same
 * prompt re-submitted in the same session under the same policy IS the same event,
 * so it must collapse to one decision. A different session → different id (the
 * session id is in the hash), so two sessions with the same prompt stay distinct.
 * @param {{sessionId:string, fingerprint:string, policyVersion:string}} parts
 * @returns {string}
 */
export function decisionIdFor({ sessionId, fingerprint, policyVersion }) {
  return 'route_' + fnv1aHex([sessionId, fingerprint, policyVersion].join('|'));
}

/** Deterministic short version tag for the effective policy (so a policy change re-decides). */
function policyVersionFor(config) {
  const stable = {
    mode: config.mode, canaryPct: config.canaryPct,
    mech: config.mechanicalExecutor, impl: config.implementationExecutor, reason: config.reasoningExecutor,
    runnerMax: config.runnerFirstMaxCommands, escalation: config.escalationEnabled,
  };
  return 'routing/' + fnv1aHex(JSON.stringify(stable));
}

/**
 * Whether the host can switch the current session's model from a hook. No host
 * supports this today (ADR-0094 §Decision) — this is the documented seam for a
 * future executor (subagent / separate command) that does.
 * @param {string} _host
 * @returns {boolean}
 */
export function hostCanSwitchModel(_host) {
  return false;
}

/**
 * Maps mode + the policy decision to honest direction fields. Execution truth is
 * reconciled separately from a correlated acknowledgement.
 * @param {string} mode
 * @param {object} decision route from decideRoute
 * @param {string} host
 * @returns {{ reason: string, selectedTier: string|null, directed:boolean }}
 */
function resolveOutcome(mode, decision, host) {
  if (mode === 'shadow') return { reason: 'shadow_mode', selectedTier: null, directed: false };
  const policyWouldApply = decision.policyWouldApply === true;
  if (policyWouldApply) {
    // Policy selected a route, but the host cannot enact it from a hook.
    if (!hostCanSwitchModel(host)) {
      return { reason: 'host_does_not_support_in_session_model_switch', selectedTier: decision.executor, directed: false };
    }
    return { reason: `${mode}_directed`, selectedTier: decision.executor, directed: true };
  }
  return {
    reason: mode === 'canary' ? 'canary_not_sampled_or_ineligible' : 'active_no_net_benefit',
    selectedTier: null,
    directed: false,
  };
}

/**
 * Builds the classifier input by COMPOSING the canonical title heuristic with
 * intake's authoritative `tier`/`domain` (spec §6.2 — intake → classifyTask). The
 * title heuristic gives granular mechanical detection (test/search/build → Haiku);
 * intake's tier overrides it for architectural work, and any high-stakes surface
 * (auth/security/migration/sensitive/public-contract) is never treated as
 * mechanical — so a critical task can never fall to the operate tier. Regulated
 * domains raise the risk surface deterministically.
 *
 * @param {string} promptText trimmed prompt
 * @param {object} [intakeSignals] signals from task-intake ({ tier, domain, ... })
 * @returns {object} signals for classifyTask
 */
export function classifierSignals(promptText, intakeSignals = {}) {
  const base = signalsFromTitle(promptText);
  const tier = intakeSignals?.tier;
  const domain = intakeSignals?.domain;
  if (tier === 'architectural') base.architectural = true;
  const highStakes = base.touchesAuth || base.touchesSecurity || base.sensitiveData || base.migration || base.publicContract;
  if (tier === 'architectural' || highStakes) base.kind = 'implement'; // never mechanical
  if (domain === 'lgpd' || domain === 'healthcare') base.sensitiveData = true;
  if (domain === 'fintech') base.touchesSecurity = true;
  return base;
}

/** True when routing is explicitly switched off (master switch or `disabled` mode). */
function isDisabled(projectRouting, session) {
  const enabled = session?.enabled ?? projectRouting?.enabled;
  if (enabled === false) return true;
  return (session?.mode ?? projectRouting?.mode) === 'disabled';
}

/**
 * Classify + decide + record a real prompt. The single entry point the hook calls.
 *
 * @param {object} input
 * @param {string} input.promptText raw (trimmed) prompt — fingerprinted, never stored
 * @param {object} [input.intakeSignals] signals from task-intake (authoritative tier/domain)
 * @param {string} input.sessionId resolved session id
 * @param {string} input.taskId resolved task id
 * @param {string} [input.host] host key (default 'claude')
 * @param {number} [input.level] resolved ContextDevKit level
 * @param {object} [input.projectRouting] config.json `routing` block
 * @param {object} [input.session] per-session routing override
 * @param {object} [input.commandFacts] explicit { commandCount, expectedOutput, needsInterpretation, batch }
 * @param {object|null} [input.executionAck] correlated `cdk-economy-ack/1`
 * @param {string|null} [input.logFile] telemetry jsonl path (null → no append)
 * @param {string|null} [input.at] ISO timestamp (caller-supplied; null-safe)
 * @returns {object} `{ active, mode?, reason, decisionId?, recommendedTier?, applied, record?, summary?, logged?, duplicate? }`
 */
export function routePrompt(input = {}) {
  const {
    promptText, intakeSignals, sessionId, taskId, host = 'claude', level,
    projectRouting, session, commandFacts, logFile = null, at = null, executionAck = null,
  } = input;

  if (isDisabled(projectRouting, session)) return { active: false, mode: 'disabled', reason: 'routing_disabled', applied: false };
  const resolved = resolveRoutingConfig({ project: projectRouting, session, level });
  if (!resolved.active) return { active: false, mode: resolved.mode, reason: resolved.reason, applied: false };
  if (!promptText || typeof promptText !== 'string') return { active: false, mode: resolved.mode, reason: 'no_prompt', applied: false };

  const classification = classifyTask(classifierSignals(promptText, intakeSignals));
  const explicitCommandFacts = commandFacts && typeof commandFacts === 'object'
    ? {
        ...(Object.hasOwn(commandFacts, 'commandCount') ? { commandCount: commandFacts.commandCount } : {}),
        ...(Object.hasOwn(commandFacts, 'expectedOutput') ? { expectedOutput: commandFacts.expectedOutput } : {}),
        ...(Object.hasOwn(commandFacts, 'needsInterpretation') ? { needsInterpretation: commandFacts.needsInterpretation } : {}),
        ...(Object.hasOwn(commandFacts, 'batch') ? { batch: commandFacts.batch } : {}),
      }
    : {};
  const decision = decideRoute(
    classification,
    { taskId, host, currentTier: resolved.config.reasoningExecutor || 'opus', ...explicitCommandFacts },
    resolved.config,
  );

  const fingerprint = fnv1aHex(promptText);
  const policyVersion = policyVersionFor(resolved.config);
  const decisionId = decisionIdFor({ sessionId, fingerprint, policyVersion });
  const { reason: outcomeReason, selectedTier, directed } = resolveOutcome(resolved.mode, decision, host);
  const reconciled = reconcileDecisionExecution({
    ...decision,
    decisionId,
    selectedTier,
    directed,
    reason: outcomeReason,
  }, executionAck);
  const economyEvent = createEconomyEvent({
    ...reconciled,
    at,
    lever: 'routing',
    sessionId,
    taskId,
    decisionId,
    executor: decision.executor,
    executionAck,
  });
  const reason = executionAck && reconciled.ackValid === false
    ? 'execution_ack_invalid'
    : reconciled.failed
      ? 'execution_failed'
      : reconciled.applied
        ? 'execution_applied'
        : reconciled.attempted
          ? 'execution_attempted'
          : outcomeReason;

  const record = {
    ...decisionRecord(reconciled, { at, sessionId, taskId, decisionId, executionAck }),
    schemaVersion: ROUTING_DECISION_SCHEMA,
    lifecycleSchemaVersion: ECONOMY_EVENT_SCHEMA,
    decisionId,
    timestamp: at,
    promptFingerprint: fingerprint,
    mode: resolved.mode,
    classification: { complexity: classification.complexity, risk: classification.risk, confidence: classification.confidence },
    recommendedTier: decision.executor,
    selectedTier,
    actualTier: economyEvent.applied ? economyEvent.executionAck?.executor ?? null : null,
    evaluated: economyEvent.evaluated,
    eligible: economyEvent.eligible,
    recommended: economyEvent.recommended,
    directed: economyEvent.directed,
    attempted: economyEvent.attempted,
    applied: economyEvent.applied,
    skipped: economyEvent.skipped,
    failed: economyEvent.failed,
    status: economyEvent.status,
    policyWouldApply: economyEvent.policyWouldApply,
    reasonCodes: economyEvent.reasonCodes,
    executionAck: economyEvent.executionAck,
    economyEvent,
    reason,
    policyVersion,
    host,
  };

  let logged = false;
  let duplicate = false;
  if (logFile) {
    const existing = readDecisions(logFile);
    if (existing.some((entry) => entry && entry.decisionId === decisionId)) duplicate = true;
    else logged = appendDecision(logFile, record);
  }

  return {
    active: true,
    mode: resolved.mode,
    reason,
    decisionId,
    recommendedTier: decision.executor,
    policyWouldApply: economyEvent.policyWouldApply,
    status: economyEvent.status,
    applied: economyEvent.applied,
    record,
    logged,
    duplicate,
    summary: {
      mode: resolved.mode,
      recommendedTier: decision.executor,
      policyWouldApply: economyEvent.policyWouldApply,
      status: economyEvent.status,
      applied: economyEvent.applied,
      reason,
      decisionId,
    },
  };
}
