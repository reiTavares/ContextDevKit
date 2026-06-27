/**
 * schema-arch-debt.mjs — OPTIONAL zod schema for the Architecture &
 * Technical-Debt Governance Gate config block (WF-0057 W5.2, ADR-0122).
 *
 * Split out of `schema-sections.mjs` to keep that file within the constitution
 * line budget (mirrors `schema-economy.mjs`). Read together with `schema.mjs`,
 * which composes this into the root `ConfigSchema`. The hot path NEVER imports
 * this — zod is an optional dependency behind a dynamic import in `/context-config`.
 *
 * The gate is the SOLE config authority. `mode` is the global gear (ACTIVE by
 * contract); `lineSignals.blocking` MUST be a boolean and DEFAULTS false — line
 * count is now an ADVISORY investigation signal, never a CI blocker (constitution
 * §1 amended). Modelled so a config that flips `blocking` to a non-boolean, or
 * sets an unknown `mode`, is refused with an actionable message before persisting.
 * `.passthrough()` on every object keeps forward knobs round-tripping.
 */
import { z } from 'zod';

const GATE_MODES = ['active', 'shadow', 'canary'];
const FLOOR_AUTHORITIES = ['BLOCKING', 'REVIEW_REQUIRED', 'ADVISORY', 'OBSERVE_ONLY', 'DISABLED'];

const FloorAuthority = z.enum(FLOOR_AUTHORITIES, {
  error: () => 'floor authority must be one of: ' + FLOOR_AUTHORITIES.join(', '),
});

const ArchDebtLineSignalsSchema = z
  .object({
    enabled: z.boolean().default(true),
    blocking: z.boolean().default(false), // hard invariant — line count never blocks
    yellow: z.number().int().positive().default(240),
    elevated: z.number().int().positive().default(308),
  })
  .passthrough()
  .default({});

// F2 (boundary) authorities: layers (name → path prefixes) + forbidden import
// directions (fromLayer → toLayer). Optional adapters/invertPairs refine the rule.
const LayerRulesSchema = z
  .object({
    layers: z.record(z.string(), z.array(z.string())),
    forbidden: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
  })
  .passthrough();

// F3 (state-authority): one declared write-authority per state key.
const WriteAuthoritySchema = z.object({ state: z.string().min(1), module: z.string().min(1) }).passthrough();

// §25 pre-existing conformance evidence to grandfather (empty = nothing grandfathered).
const ConformanceBaselineSchema = z
  .object({
    cycles: z.array(z.array(z.string())).default([]),
    forbiddenEdges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()).default([]),
    stateAuthorities: z.array(WriteAuthoritySchema).default([]),
  })
  .passthrough();

export const ArchitectureDebtGateSchema = z
  .object({
    enabled: z.boolean().default(true),
    mode: z
      .enum(GATE_MODES, { error: () => 'architectureDebtGate.mode must be one of: ' + GATE_MODES.join(', ') })
      .default('active'),
    baseline: z
      .object({
        strategy: z.string().min(1).default('ratchet'),
        blockUnchangedLegacyDebt: z.boolean().default(false),
      })
      .passthrough()
      .default({}),
    ruleModes: z.record(z.string(), z.string()).default({}),
    lineSignals: ArchDebtLineSignalsSchema,
    floors: z
      .object({
        security: FloorAuthority.default('BLOCKING'),
        reliability: FloorAuthority.default('BLOCKING'),
        testability: FloorAuthority.default('BLOCKING'),
      })
      .passthrough()
      .default({}),
    intentionalDebt: z
      .object({
        requireOwner: z.boolean().default(true),
        requireBusinessJustification: z.boolean().default(true),
        requireRepaymentTrigger: z.boolean().default(true),
        requireAcceptanceAuthority: z.boolean().default(true),
      })
      .passthrough()
      .default({}),
    scope: z
      .object({
        changedFilesOnly: z.boolean().default(true),
        affectedModules: z.boolean().default(true),
      })
      .passthrough()
      .default({}),
    unknownEvidence: z.string().min(1).default('REVIEW_REQUIRED'),

    // Conformance authorities (F1/F2/F3) — all OPTIONAL. Wiring any of them flips
    // the conformance floors from SKIPPED to EVALUATE (resolve-arch-debt-config).
    // Absent ⇒ the floors stay dormant (an install opts in deliberately).
    layerRules: LayerRulesSchema.optional(),
    ownership: z.record(z.string(), z.string()).optional(),
    writeAuthorities: z.array(WriteAuthoritySchema).optional(),
    conformanceBaseline: ConformanceBaselineSchema.optional(),
  })
  .passthrough()
  .default({});
