/**
 * schema-economy.mjs — Economy Runtime config section (ADR-0103 activation
 * go-live) for the OPTIONAL strict validator (CDK-013).
 *
 * Split out of schema-sections.mjs to keep that file within the 308-line
 * constitution budget (the same reason schema-sections was split from
 * schema.mjs). The hot path NEVER imports this; zod is optional and loaded only
 * by `/context-config` for strict validation.
 *
 * The module keys mirror ECONOMY_MODULE_KEYS (tools/scripts/economy/
 * economy-defaults.mjs) — the canonical single source — and `.passthrough()`
 * keeps forward knobs (e.g. an `output` contract override resolved by
 * output-contract.mjs).
 */
import { z } from 'zod';

/** A single Economy Runtime module toggle. Defaults ON at go-live (ADR-0103). */
const EconModuleToggle = z.object({ enabled: z.boolean().default(true) }).passthrough().default({});

/** Session Autonomy Receipt config (spec §29). Advisory; conservative default. */
const SessionAutonomyReceiptSchema = z
  .object({
    enabled: z.boolean().default(true),
    generateOnSessionFinalize: z.boolean().default(true),
    showTerminalSummary: z.boolean().default(true),
    signReceipts: z.boolean().default(true),
    estimationMode: z.enum(['conservative', 'balanced', 'experimental']).default('conservative'),
    minimumConfidenceToDisplay: z.enum(['insufficient', 'low', 'medium', 'high']).default('low'),
    storeMarkdown: z.boolean().default(true),
    storeJson: z.boolean().default(true),
    tokenAccounting: z.object({}).passthrough().default({}),
    financialAccounting: z.object({}).passthrough().default({}),
  })
  .passthrough()
  .default({});

/**
 * Full Economy Runtime config section. Every wired module ships ON, advisory +
 * fail-open; users disable any one via `economy.<module>.enabled = false`.
 * `mode` is advisory by default; raising it to 'blocking' opts the loop-breaker
 * / patch-economy gate signals into the CDK-032 deny path (still reversible +
 * human-bypassable). `enabled:false` gates the whole stack.
 */
export const EconomySchema = z
  .object({
    enabled: z.boolean().default(true),
    mode: z
      .enum(['advisory', 'blocking'], { error: () => "economy.mode must be 'advisory' or 'blocking'" })
      .default('advisory'),
    outputContract:  EconModuleToggle,
    findings:        EconModuleToggle,
    agentContract:   EconModuleToggle,
    compaction:      EconModuleToggle,
    contextProfiles: EconModuleToggle,
    bootDelta:       EconModuleToggle,
    resumePack:      EconModuleToggle,
    leanLoop:        EconModuleToggle,
    loopBreaker:     EconModuleToggle,
    patchEconomy:    EconModuleToggle,
    measurement:     EconModuleToggle,
    sessionAutonomyReceipt: SessionAutonomyReceiptSchema,
  })
  .passthrough()
  .default({});
