/**
 * defaults-economy.mjs — Economy Runtime config defaults (ADR-0103 activation
 * go-live), extracted from defaults.mjs to keep that file within the 308-line
 * constitution budget (mirrors defaults-eacp.mjs).
 *
 * Every wired module ships ON, advisory + fail-open. This is the additive
 * distribution source: `migrateConfigSections(cfg, DEFAULT_CONFIG)` copies this
 * `economy` block into an existing install on `--update` — only when a key is
 * absent, so user toggles always win and an explicit `enabled:false` is never
 * re-enabled.
 *
 * Three surfaces mirror ECONOMY_MODULE_KEYS (tools/scripts/economy/
 * economy-defaults.mjs — the single key source): this distribution seed, the
 * strict-validator shape (runtime/config/schema-sections.mjs → EconomySchema),
 * and the runtime flag layer (economy-governance-core.mjs → FLAG_DEFAULTS).
 *
 * Auto-activation (autoActivate + tools.*): the activation module reads these
 * flags at session-start. Absent keys are treated as ON (fail-open), so these
 * are explicit defaults that make the behaviour visible and reversible.
 * Setting `economy.enabled = false` (master switch) disables everything,
 * including auto-activation, regardless of the values below.
 *
 * Zero runtime dependencies — pure data.
 */
export const ECONOMY_CONFIG_DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'advisory',
  outputContract:  { enabled: true },
  findings:        { enabled: true },
  agentContract:   { enabled: true },
  compaction:      { enabled: true },
  contextProfiles: { enabled: true },
  bootDelta:       { enabled: true },
  resumePack:      { enabled: true },
  leanLoop:        { enabled: true },
  loopBreaker:     { enabled: true },
  patchEconomy:    { enabled: true },
  measurement:     { enabled: true },
  /**
   * sessionAutonomyReceipt — generate a per-session Session Autonomy Receipt at
   * finalization (advisory, fail-open). Public default 'conservative' estimation;
   * receipts are stored beside the session ledger and signed only when a key is
   * configured (else hash-only). Subscription mode never invents financial savings.
   */
  sessionAutonomyReceipt: Object.freeze({
    enabled: true,
    generateOnSessionFinalize: true,
    showTerminalSummary: true,
    signReceipts: true,
    estimationMode: 'conservative',
    minimumConfidenceToDisplay: 'low',
    storeMarkdown: true,
    storeJson: true,
    tokenAccounting: Object.freeze({ enabled: true, preserveRawUsageReference: true, strictReconciliation: false }),
    financialAccounting: Object.freeze({ enabled: true, allowEstimatedCost: true, allowUserSuppliedPricing: true, preserveHistoricalPricingSnapshot: true }),
  }),
  /**
   * autoActivate — emit the economy guidance block at session start by default.
   * Set to false to suppress the activation message without touching other flags.
   * Ignored when economy.enabled === false.
   */
  autoActivate: true,
  /**
   * tools — per-lever on/off switches for the 5 economy tool capabilities.
   * Each key maps to an independently disableable economy lever.
   * All default ON; set any to false to suppress that lever's guidance.
   * Ignored when economy.enabled === false.
   */
  tools: Object.freeze({
    /** find — economy-aware file-search guidance (avoid re-reading, cache hits). */
    find:            true,
    /** runCompact — trigger a compaction run when context budget is tight. */
    runCompact:      true,
    /** workPacket — decompose large tasks into bounded work packets. */
    workPacket:      true,
    /** subagentProfile — select the cheapest capable subagent for the task. */
    subagentProfile: true,
    /** loopBreaker — detect and break token-burning retry loops. */
    loopBreaker:     true,
  }),
});
