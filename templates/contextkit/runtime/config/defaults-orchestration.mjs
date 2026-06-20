/**
 * defaults-orchestration.mjs — Automatic Request Orchestration defaults (WF0038, ADR-0107 §25).
 *
 * Split out of defaults.mjs (like defaults-routing.mjs / defaults-ledger.mjs) to
 * keep that file under the line budget. All keys are ADDITIVE and gated so the
 * feature is shadow-safe: with `executeDispatchPlan` reading the routing mode, a
 * fresh install changes NO behavior until the routing default is flipped (which
 * is itself gated behind ADR-0107's human acceptance).
 *
 * Reuses existing sources of truth — `routing`, `advisor`, `deliberations` stay
 * canonical; orchestration never duplicates them (ADR-0107 §25).
 *
 * @module defaults-orchestration
 */

/**
 * Default orchestration policy. `enabled` turns the request-level boundary on;
 * `classifyEveryRequest` makes the orchestrator run for ordinary prompts;
 * `executeDispatchPlan` is the real-dispatch switch (honored only in active
 * routing, gated by the over-orchestration guard).
 */
export const ORCHESTRATION_DEFAULTS = Object.freeze({
  enabled: true,
  classifyEveryRequest: true,
  persistIntentEnvelope: true,
  executeDispatchPlan: true,
  allowNaturalLanguageOverrides: true,
  minLevel: 7,
  specialists: Object.freeze({
    autoSelect: true,
    autoDispatch: true,
    requireReasonCodes: true,
    maxParallelAgents: 6,
  }),
  playbooks: Object.freeze({
    autoSelect: true,
    injectRelevantSections: true,
    maxContextTokens: 3000,
  }),
  overOrchestrationGuard: Object.freeze({
    enabled: true,
    runnerFirstMaxCommands: 3,
  }),
});
