/**
 * NEW per-section zod schemas for the OPTIONAL strict config validator (CDK-013).
 *
 * Cohesion note: a single, cohesive catalogue of the section shapes added by
 * CDK-013 (quality gates, autoformat, bridges, advisor, pipeline, QA, tokens,
 * security mode, predictions review, L3, small toggles) plus the forward slot.
 * Split out of `schema.mjs` only to keep that file under the 280-line budget;
 * the pre-existing sections (ledger, l5, deliberations, autonomy, projectMap,
 * swarm, deps) stay in schema.mjs where their ADR-traced definitions live. The
 * two files are read together; keep this one declarations-only.
 *
 * Every section is `.passthrough()`: strict on the keys we MODEL (a typo or a
 * wrong type is refused with an actionable message), tolerant of the keys we do
 * NOT (forward-extension: an unknown key is RETAINED, never silently dropped).
 * This is the CDK-013 contract: tighten the known surface without turning
 * extensibility into rigidity. The hot path NEVER imports this; zod is optional.
 */
import { z } from 'zod';
import { MAX_LEVEL, MIN_LEVEL } from './levels.mjs';

/** A repo-relative, forward-slashed path (no leading slash, no backslashes). */
export const PathString = z
  .string()
  .min(1, 'path must not be empty')
  .refine((p) => !p.startsWith('/') && !p.includes('\\'), {
    message: 'use forward-slashed, repo-relative paths (no leading /, no backslashes)',
  });

/** A ContextDevKit level (1..MAX_LEVEL), single-sourced from levels.mjs. */
const LevelBound = z
  .number({ error: 'must be a number' })
  .int('must be a whole number')
  .min(MIN_LEVEL, 'must be >= ' + MIN_LEVEL)
  .max(MAX_LEVEL, 'unsupported level - must be <= ' + MAX_LEVEL + ' (see levels.mjs)');

// -- Quality gates / autoformat / bridges (ADR-0061/0062/0068) ---------------

// ADR-0062 - multi-language pre-push gate. strictLevel is the level at which a
// failing gate BLOCKS (warn-only below it); modelled so a config that lowers it
// is type-checked here and the security-fallback helper can warn.
export const QualityGateSchema = z
  .object({
    enabled: z.boolean().default(true),
    minLevel: LevelBound.default(3),
    strictLevel: LevelBound.default(4),
    disabled: z.array(z.string()).default([]),
  })
  .passthrough()
  .default({});

// ADR-0061 - PostToolUse format/lint. Advisory; never blocks.
export const AutoFormatSchema = z
  .object({
    enabled: z.boolean().default(true),
    minLevel: LevelBound.default(4),
    excludePaths: z.array(PathString).default([]),
  })
  .passthrough()
  .default({});

const BRIDGE_TOOLS = ['cursor', 'copilot', 'gemini', 'windsurf', 'aider', 'continue'];

// ADR-0068 - context-only bridges. enabled opts in per supported tool; an
// unsupported tool id is an actionable refusal, not a silent no-op.
export const BridgesSchema = z
  .object({
    enabled: z
      .array(
        z.enum(BRIDGE_TOOLS, {
          error: () => 'unsupported bridge - one of: ' + BRIDGE_TOOLS.join(', '),
        }),
      )
      .default([]),
  })
  .passthrough()
  .default({});

// -- Advisor (ADR-0028) ------------------------------------------------------

// A lane is { owner } (agent/command) or null to mute it. An empty owner is a
// malformed lane.
const AdvisorLane = z
  .object({ owner: z.string().min(1, 'lane owner must be a non-empty agent/command name') })
  .passthrough()
  .nullable();

export const AdvisorSchema = z
  .object({
    active: z.boolean().default(true),
    nudgeOnStop: z.boolean().default(true),
    lanes: z.record(z.string(), AdvisorLane).default({}),
  })
  .passthrough()
  .default({});

// -- Pipeline / QA (ADR-0015 / squads) ---------------------------------------

export const PipelineSchema = z
  .object({
    framework: z.string().min(1).default('wsjf'),
    wsjfBands: z.record(z.string(), z.number()).default({}),
    severityPriority: z.record(z.string(), z.string()).default({}),
    slaDays: z.record(z.string(), z.number().int().positive()).default({}),
    bugTypes: z.array(z.string()).default([]),
    workingStaleAfterMinutes: z.number().int().positive().default(90),
    commitBoard: z.boolean().default(true),
  })
  .passthrough()
  .default({});

export const QaSchema = z
  .object({
    criticalPaths: z.array(PathString).default([]),
    coverageTarget: z
      .object({
        lines: z.number().int().min(0).max(100).default(80),
        branches: z.number().int().min(0).max(100).default(70),
      })
      .passthrough()
      .default({}),
  })
  .passthrough()
  .default({});

// -- Tokens / security mode / predictions review (cadence sections) ----------

export const TokensSchema = z
  .object({
    budgetPerSession: z.number().int().min(0).default(0),
    warnAtPct: z.number().int().min(1).max(100).default(80),
  })
  .passthrough()
  .default({});

export const SecurityModeSchema = z
  .object({
    active: z.boolean().default(true),
    everyNSessions: z.number().int().positive().default(10),
  })
  .passthrough()
  .default({});

export const PredictionsReviewSchema = z
  .object({
    active: z.boolean().default(true),
    everyNSessions: z.number().int().positive().default(10),
  })
  .passthrough()
  .default({});

// -- Automatic model routing (ADR-0094) --------------------------------------

const ROUTING_MODES = ['shadow', 'canary', 'active'];
const EXECUTOR_TIERS = ['haiku', 'sonnet', 'opus'];

// ADR-0094 - standard-session routing posture. `mode` is the deployment gear
// (shadow=measure-only default); executor aliases are tier names, never versioned
// model ids (ADR-0052). Modelled so `/context-config` refuses an invalid mode or a
// raw model id before persisting; `.passthrough()` keeps forward knobs.
export const RoutingSchema = z
  .object({
    enabled: z.boolean().default(true),
    mode: z
      .enum(ROUTING_MODES, { error: () => 'routing.mode must be one of: ' + ROUTING_MODES.join(', ') })
      .default('shadow'),
    applyToStandardSessions: z.boolean().default(true),
    canaryPct: z.number().int().min(0).max(100).default(10),
    mechanicalExecutor: z.enum(EXECUTOR_TIERS).default('haiku'),
    implementationExecutor: z.enum(EXECUTOR_TIERS).default('sonnet'),
    reasoningExecutor: z.enum(EXECUTOR_TIERS).default('opus'),
    allowOpusCoding: z.boolean().default(true),
    allowAutomaticFable: z.boolean().default(false),
    escalationEnabled: z.boolean().default(true),
    compactHandoffs: z.boolean().default(true),
    useProjectMapFirst: z.boolean().default(true),
    routeToolOperationsToHaiku: z.boolean().default(true),
    routeSessionLoggingToHaiku: z.boolean().default(true),
    runnerFirstMaxCommands: z.number().int().min(1).max(10).default(3),
    handoffMaxTokens: z.number().int().min(0).default(2000),
    minLevel: LevelBound.default(4),
  })
  .passthrough()
  .default({});

// -- Small boolean-toggle sections + L3 --------------------------------------

/** { active: boolean } toggle reused by practices/behaviors. */
const ActiveToggle = z.object({ active: z.boolean() }).passthrough().partial().default({});

export const PracticesSchema = ActiveToggle;
export const BehaviorsSchema = ActiveToggle;
export const SetupSchema = z.object({ completed: z.boolean() }).passthrough().partial().default({});
export const BootSchema = z.object({ valueLine: z.boolean() }).passthrough().partial().default({});
export const L3Schema = z.object({ mainBranch: z.string().min(1) }).passthrough().partial().default({});

// -- EACP (Economic & Autonomy Control Plane) — WF0018 / ADR-0077..0081 -------
// All fields are optional and advisory-safe. No REQUIRED field is introduced —
// an existing config without an `eacp` key validates cleanly and gets the
// defaults from defaults-eacp.mjs. Passthrough on every sub-object so forward
// flags (phases, future package keys) round-trip without error.

const EacpBudgetMode = z.enum(['observe', 'warn', 'ask', 'downgrade', 'split', 'block'], {
  error: () => 'eacp.budgetGuards.mode must be one of: observe, warn, ask, downgrade, split, block',
});

const EacpCostEngineSchema = z
  .object({
    enabled: z.boolean().default(true),
    grossCacheValueSeparate: z.boolean().default(true),
  })
  .passthrough()
  .default({});

const EacpMeasurementSchema = z
  .object({
    enabled: z.boolean().default(true),
    costEngine: EacpCostEngineSchema,
  })
  .passthrough()
  .default({});

const EacpAdvisoryToggle = z.object({ enabled: z.boolean().default(true) }).passthrough().default({});

const EacpAdvisorySchema = z
  .object({
    enabled: z.boolean().default(true),
    sessionPressure: EacpAdvisoryToggle,
    mapEffectiveness: EacpAdvisoryToggle,
    quotaSnapshots: EacpAdvisoryToggle,
    autonomyMultiplier: EacpAdvisoryToggle,
  })
  .passthrough()
  .default({});

const EacpBudgetGuardsSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: EacpBudgetMode.default('observe'),
  })
  .passthrough()
  .default({});

const EacpPrivacySchema = z
  .object({
    metadataOnly: z.boolean().default(true),
    optOut: z.boolean().default(false),
    retentionDays: z.number().int().positive().default(90),
  })
  .passthrough()
  .default({});

/**
 * Full EACP config section (WF0018). Advisory-first; all sub-sections optional.
 * `enabled: false` restores legacy token-report behavior (no data loss — events
 * are append-only). No strict defaults before dogfood (#246 AC).
 */
export const EacpSchema = z
  .object({
    enabled: z.boolean().default(true),
    rolloutPhase: z.number().int().min(0).max(5).default(0),
    measurement: EacpMeasurementSchema,
    advisory: EacpAdvisorySchema,
    budgetGuards: EacpBudgetGuardsSchema,
    routingEconomics: z.object({ enabled: z.boolean().default(false) }).passthrough().default({}),
    benchmark: z
      .object({ pilotEnabled: z.boolean().default(false), fullBenchmarkEnabled: z.boolean().default(false) })
      .passthrough()
      .default({}),
    fleet: z.object({ enabled: z.boolean().default(false) }).passthrough().default({}),
    privacy: EacpPrivacySchema,
  })
  .passthrough()
  .default({});

/**
 * Forward slot for future enforcement (CDK-013). Sections we have NOT modelled
 * yet validate through this: an object whose unknown keys are RETAINED. It
 * exists so a new section can be wired with a one-line entry in schema.mjs
 * (a clean seam for the next consumer) instead of relying solely on the
 * top-level passthrough().
 */
export const ForwardSection = z.object({}).passthrough().default({});
