/**
 * dispatch-plan.mjs — Explicit dispatch plan + reconciliation for WF0038/ADR-0112
 * (A8-T2, shadow-first).
 *
 * Produces a FROZEN, deterministic plan object from an intent envelope BEFORE any
 * real dispatch happens (shadow or active). A companion reconciliation function
 * compares the plan's expected agents against what was actually dispatched.
 *
 * Design notes:
 * - Pure functions only — no I/O, no side effects, no runtime deps beyond node:crypto.
 * - The plan is consistent with request-telemetry.mjs conventions:
 *   `plannedAgents` here covers ALL roles in step order (lead, council, scouts,
 *   reviewers, synthesizer) so the caller can compare a full dispatch manifest.
 *   Telemetry's `agentsPlanned` intentionally uses a narrower dedup (lead+council+
 *   reviewers only) for quality-selection tallies — that is a read-side concern and
 *   does not change how the plan is built here.
 * - Shadow semantics: when `willDispatch` is false an empty `actualDispatchedAgents`
 *   in reconcileDispatch() is the EXPECTED outcome (record-only contract). Callers
 *   should pass [] in shadow mode; reconcile will return matched=true.
 *
 * @module dispatch-plan
 */

/** Ordered dispatch role sequence — defines step.seq numbering. */
const ROLE_ORDER = /** @type {const} */ (['lead', 'council', 'scouts', 'reviewers', 'synthesizer']);

/**
 * Extracts agent name(s) for a given role from the envelope agents block.
 * lead + synthesizer are scalar (string|null); the rest are arrays.
 *
 * @param {object} agentsBlock envelope.agents
 * @param {string} role one of ROLE_ORDER
 * @returns {string[]} zero or more unique, non-empty agent names
 */
function agentNamesForRole(agentsBlock, role) {
  const raw = agentsBlock[role];
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((n) => typeof n === 'string' && n.length > 0);
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

/**
 * Determines whether the gate condition for real dispatch is satisfied.
 * Returns an array of blocking reason strings (empty when all conditions pass).
 *
 * Gate (ADR-0107 §execute, §autoDispatch, ADR-0112 §shadow-first):
 *   1. envelope routing.mode must be 'active'
 *   2. config.orchestration.executeDispatchPlan must be true (or truthy)
 *   3. config.orchestration.specialists.autoDispatch must not be false
 *
 * @param {string} mode envelope routing.mode
 * @param {object} orchestrationConfig config.orchestration block
 * @returns {string[]} list of blocking gate labels
 */
function evaluateGate(mode, orchestrationConfig) {
  const cfg = orchestrationConfig && typeof orchestrationConfig === 'object'
    ? orchestrationConfig
    : {};
  const specialists = cfg.specialists && typeof cfg.specialists === 'object'
    ? cfg.specialists
    : {};

  const blocked = [];
  if (mode !== 'active') blocked.push('mode=shadow');
  if (cfg.executeDispatchPlan !== true) blocked.push('executeDispatchPlan=off');
  if (specialists.autoDispatch === false) blocked.push('autoDispatch=off');
  return blocked;
}

/**
 * Builds a deterministic, FROZEN dispatch plan from an intent envelope.
 *
 * Steps are ordered: lead → council → scouts → reviewers → synthesizer.
 * Each agent within a role group receives an incrementing `seq` starting at 1.
 * Null/empty slots are skipped — no phantom steps.
 *
 * `willDispatch` is true ONLY when ALL three gate conditions pass (mode=active,
 * executeDispatchPlan===true, autoDispatch!==false). Otherwise false and `gatedBy`
 * names every failing condition.
 *
 * @param {object} envelope intent envelope from buildEnvelope()
 * @param {object} config   runtime config (must have config.orchestration)
 * @param {object} [opts]   reserved for future extensions
 * @returns {Readonly<{
 *   planId: string,
 *   mode: string,
 *   willDispatch: boolean,
 *   gatedBy: string[],
 *   steps: Array<{ seq: number, role: string, agent: string }>,
 *   plannedAgents: string[],
 *   reasonCodes: string[],
 * }>}
 */
export function buildDispatchPlan(envelope, config, opts = {}) {
  const env = envelope && typeof envelope === 'object' ? envelope : {};
  const cfg = config && typeof config === 'object' ? config : {};
  const requestId = String(env.requestId ?? 'req-unknown');
  const dispatchPlanId = (env.dispatchPlanId && String(env.dispatchPlanId).length > 0)
    ? String(env.dispatchPlanId)
    : `dispatch-${requestId}`;
  const routing = env.routing && typeof env.routing === 'object' ? env.routing : {};
  const mode = typeof routing.mode === 'string' ? routing.mode : 'shadow';
  const agentsBlock = env.agents && typeof env.agents === 'object' ? env.agents : {};
  const routingReasonCodes = Array.isArray(routing.reasonCodes) ? routing.reasonCodes : [];

  const gatedBy = evaluateGate(mode, cfg.orchestration);
  const willDispatch = gatedBy.length === 0;

  // Build ordered steps, incrementing seq across all roles in sequence.
  const steps = [];
  let seq = 1;
  for (const role of ROLE_ORDER) {
    for (const agent of agentNamesForRole(agentsBlock, role)) {
      steps.push(Object.freeze({ seq, role, agent }));
      seq += 1;
    }
  }

  // plannedAgents: unique agent names in the same step order (first occurrence wins).
  const seenAgents = new Set();
  const plannedAgents = [];
  for (const step of steps) {
    if (!seenAgents.has(step.agent)) {
      seenAgents.add(step.agent);
      plannedAgents.push(step.agent);
    }
  }

  return Object.freeze({
    planId: dispatchPlanId,
    mode,
    willDispatch,
    gatedBy: Object.freeze([...gatedBy]),
    steps: Object.freeze(steps),
    plannedAgents: Object.freeze(plannedAgents),
    reasonCodes: Object.freeze([...routingReasonCodes]),
  });
}

/**
 * Reconciles the dispatch plan against the agents that were actually dispatched.
 *
 * Shadow semantics: when `plan.willDispatch` is false, the expected `dispatched`
 * list is [] (record-only — nothing runs). Callers must pass [] in that case;
 * if they do, `matched` will be true (empty missing + empty extra = clean shadow).
 *
 * `missing` = planned agents absent from dispatched (a planning gap or skipped step).
 * `extra`   = dispatched agents absent from the plan (an unplanned dispatch).
 * `matched` = both sets are empty (plan and reality agree).
 *
 * Deterministic: result depends only on inputs; no mutation of either argument.
 *
 * @param {object}   plan                  result of buildDispatchPlan()
 * @param {string[]} actualDispatchedAgents agents that were actually dispatched
 * @returns {Readonly<{
 *   planned: string[],
 *   dispatched: string[],
 *   missing: string[],
 *   extra: string[],
 *   matched: boolean,
 * }>}
 */
export function reconcileDispatch(plan, actualDispatchedAgents) {
  const plannedList = Array.isArray(plan?.plannedAgents) ? [...plan.plannedAgents] : [];
  const dispatchedRaw = Array.isArray(actualDispatchedAgents) ? actualDispatchedAgents : [];
  const dispatchedList = dispatchedRaw.filter((n) => typeof n === 'string' && n.length > 0);

  const plannedSet = new Set(plannedList);
  const dispatchedSet = new Set(dispatchedList);

  const missing = plannedList.filter((a) => !dispatchedSet.has(a));
  const extra = dispatchedList.filter((a) => !plannedSet.has(a));
  const matched = missing.length === 0 && extra.length === 0;

  return Object.freeze({
    planned: Object.freeze(plannedList),
    dispatched: Object.freeze(dispatchedList),
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    matched,
  });
}
