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
});
