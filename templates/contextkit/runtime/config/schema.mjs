/**
 * OPTIONAL strict config schema (zod) for `/context-config`.
 *
 * The hot path (hooks) NEVER imports this; it uses the zero-dependency loader in
 * `load.mjs`. This module is loaded ONLY by `/context-config` when the user
 * wants strict validation before persisting an edit, and it degrades gracefully
 * when `zod` is not installed (the slash command catches the import error and
 * falls back to structural checks).
 *
 * Structure (CDK-013): this file is the COMPOSITION ROOT + validators. The
 * pre-existing, ADR-traced sections (l5, deliberations,
 * projectMap, swarm, deps) are defined here; every section ADDED by CDK-013
 * (quality gates, autoformat, bridges, advisor, pipeline, qa, tokens, security
 * mode, predictions review, l3, toggles, forward slot) lives in the sibling
 * `schema-sections.mjs` to keep this file under the 280-line budget.
 *
 * Extensibility contract: each modelled section is `.passthrough()` and the root
 * is `.passthrough()`, so unknown keys (top-level or nested) are RETAINED, never
 * silently dropped. Validation tightens the KNOWN surface (missing/malformed/
 * unsupported are actionable refusals) while leaving a clean forward-extension
 * seam (`ForwardSection`). See ADR-0010.
 *
 * Install `zod` in the target project to enable strict validation:
 *   npm i -D zod   (or pnpm/yarn/bun equivalent)
 */
import { z } from 'zod';
import { MAX_LEVEL, MIN_LEVEL } from './levels.mjs';
import { EconomySchema } from './schema-economy.mjs';
import { ArchitectureDebtGateSchema } from './schema-arch-debt.mjs';
import {
  DEFAULT_GOVERNANCE_CONFIG,
  GATE_IDS,
  GUARDED_GATE_IDS,
} from '../governance/gate-registry.mjs';
import {
  AdvisorSchema,
  AutoFormatSchema,
  BehaviorsSchema,
  BootSchema,
  BridgesSchema,
  EacpSchema,
  ForwardSection,
  L3Schema,
  PracticesSchema,
  PathString,
  PredictionsReviewSchema,
  QaSchema,
  QualityGateSchema,
  RoutingSchema,
  SecurityModeSchema,
  SetupSchema,
  TokensSchema,
} from './schema-sections.mjs';

const Profile = z.object({
  cadenceDays: z.number().int().positive(),
  scope: z.string().min(1),
});

const L5Schema = z
  .object({
    highRiskPaths: z.array(PathString).default([]),
    distill: z
      .object({
        observeWindow: z.number().int().positive().default(10),
        proposeAfterSessions: z.number().int().positive().default(30),
        archiveRunsOlderThanDays: z.number().int().positive().default(7),
      })
      .passthrough()
      .default({}),
    techDebtSweep: z
      .object({ default: z.string().min(1), profiles: z.record(z.string(), Profile) })
      .passthrough()
      .default({ default: 'full', profiles: { full: { cadenceDays: 14, scope: 'all' } } }),
  })
  .passthrough()
  .default({});

// ADR-0035 - Deliberations toggle. Modelled (not just passed through) so
// `/context-config` validates the voice count and level gate before persisting.
const DeliberationsSchema = z
  .object({
    active: z.boolean().default(true),
    voices: z.number().int().min(2).max(5).default(3),
    minLevel: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).default(5),
    nudgeOnHighRisk: z.boolean().default(true),
  })
  .passthrough()
  .default({});

const RiskAcknowledgementSchema = z
  .object({
    requiredFor: z.array(z.enum(['destructive-production', 'force-push', 'secret-rotation']))
      .default(['destructive-production', 'force-push', 'secret-rotation']),
    message: z.string().min(1).default('Confirm this high-risk action through the real host/platform safety boundary.'),
    extraSecretPaths: z.array(z.string().min(1)).default([]),
  })
  .passthrough()
  .default({});

const GovernanceModeSchema = z.enum(['off', 'shadow', 'canary', 'guarded']);
const GovernanceGatesSchema = z
  .object(Object.fromEntries(GATE_IDS.map((gateId) => [gateId, GovernanceModeSchema.optional()])))
  .passthrough()
  .default({});

const GovernanceSchema = z
  .object({
    defaultMode: GovernanceModeSchema.default('canary'),
    failurePolicy: z.literal('continue').default('continue'),
    humanAuthority: z.literal('owner-wins').default('owner-wins'),
    gates: GovernanceGatesSchema,
  })
  .passthrough()
  .superRefine((governance, context) => {
    if (governance.defaultMode === 'guarded') {
      context.addIssue({
        code: 'custom',
        path: ['defaultMode'],
        message: 'governance.defaultMode cannot guard gates outside the explicit allowlist',
      });
    }
    for (const [gateId, mode] of Object.entries(governance.gates)) {
      if (mode === 'guarded' && !GUARDED_GATE_IDS.includes(gateId)) {
        context.addIssue({
          code: 'custom',
          path: ['gates', gateId],
          message: `${gateId} cannot use guarded outside the blocking allowlist`,
        });
      }
    }
  })
  .default(DEFAULT_GOVERNANCE_CONFIG);

// ADR-0134 / ADR-0155 - structural knowledge graph. `mode` is the activation
// ladder (resolveGraphActivation clamps a blocking mode without `humanFlip`);
// `autoIndex` drives the per-session refresh; `maxAgeMinutes` is the staleness
// threshold above which the graph-first gate rebuilds on demand.
const GraphSchema = z
  .object({
    enabled: z.boolean().default(true),
    mode: z.enum(['off', 'shadow', 'advisory', 'guarded', 'strict']).default('guarded'),
    humanFlip: z.boolean().default(true),
    autoIndex: z.boolean().default(true),
    maxAgeMinutes: z.number().int().positive().default(60),
  })
  .passthrough()
  .default({});

// ADR-0046 - project-map active-fitness toggles (auto-refresh + rule enforcement).
const ProjectMapSchema = z
  .object({
    autoRefresh: z.boolean().default(true),
    enforce: z.boolean().default(true),
    // CDK-050 — configurable scan scope. `roots` must be a non-empty string list
    // (defaults to the whole project); `excludes` adds bare-name excludes.
    roots: z.array(z.string().min(1)).min(1).default(['.']),
    excludes: z.array(z.string().min(1)).default([]),
    graph: GraphSchema,
  })
  .passthrough()
  .default({});

// ADR-0158 — only a real host scheduler limit may cap parallelism.
const SwarmSchema = z
  .object({
    hostTechnicalLimit: z.number().int().positive().nullable().default(null),
    tokenBudgetPerRun: z.number().int().min(0).default(0),
    staleMinutes: z.number().int().positive().default(30),
  })
  .passthrough()
  .default({});

const DepsSchema = z
  .object({
    requireLockfile: z.boolean().default(true),
    licenses: z
      .object({ allow: z.array(z.string()).default([]), deny: z.array(z.string()).default([]) })
      .passthrough()
      .default({}),
    maxAgeDays: z.number().int().positive().nullable().default(null),
  })
  .passthrough()
  .default({});

// Each modelled section is itself `.passthrough()` (above / in schema-sections),
// and the root `.passthrough()` keeps any unmodelled section verbatim - so no
// known key is loosely typed AND no unknown key is dropped (CDK-013). The level
// bound is single-sourced from levels.mjs so it can never drift. See ADR-0010.
export const ConfigSchema = z
  .object({
    level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).default(2),
    governance: GovernanceSchema,
    l3: L3Schema,
    l5: L5Schema,
    deps: DepsSchema,
    deliberations: DeliberationsSchema,
    riskAcknowledgement: RiskAcknowledgementSchema,
    projectMap: ProjectMapSchema,
    swarm: SwarmSchema,
    qa: QaSchema,
    advisor: AdvisorSchema,
    qualityGate: QualityGateSchema,
    autoFormat: AutoFormatSchema,
    bridges: BridgesSchema,
    tokens: TokensSchema,
    securityMode: SecurityModeSchema,
    predictionsReview: PredictionsReviewSchema,
    routing: RoutingSchema,
    practices: PracticesSchema,
    behaviors: BehaviorsSchema,
    setup: SetupSchema,
    boot: BootSchema,
    eacp: EacpSchema,
    economy: EconomySchema,
    architectureDebtGate: ArchitectureDebtGateSchema,
    forward: ForwardSection,
  })
  .passthrough()
  .default({});

/**
 * Validate a raw config object against the strict schema.
 *
 * @param {unknown} raw - parsed `contextkit/config.json` (or `{}`).
 * @returns {{ ok: true, config: object } | { ok: false, error: import('zod').ZodError }}
 *   `ok` carries the parsed config WITH unknown keys retained; `!ok` carries the
 *   actionable zod error (format with `formatZodError`).
 */
export function validateConfig(raw) {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, error: parsed.error };
}

/**
 * Render a zod error as an actionable, multi-line `  - path: message` list.
 *
 * @param {import('zod').ZodError} error - the error from `validateConfig`.
 * @returns {string} one issue per line, root-pathed issues labelled `(root)`.
 */
export function formatZodError(error) {
  return error.issues
    .map((i) => `  - ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('\n');
}

/**
 * Detect edits that SILENTLY weaken the project security posture, so a caller
 * can warn before persisting (constitution rule 8 / CDK-013 acceptance: a
 * fallback must not reduce security without an explicit warning). Advisory only
 * - it never refuses; the warnings are surfaced, the write still proceeds.
 *
 * @param {object} prev - the config before the edit.
 * @param {object} next - the config after the edit (post-validation).
 * @returns {string[]} human-readable warnings (empty when nothing weakened).
 */
export function securityWarnings(prev, next) {
  const warnings = [];
  const was = prev ?? {};
  const now = next ?? {};
  if (was?.securityMode?.active === true && now?.securityMode?.active === false) {
    warnings.push('securityMode.active turned OFF - proactive security scans (/deep-analysis) will no longer be nudged.');
  }
  if (was?.qualityGate?.enabled === true && now?.qualityGate?.enabled === false) {
    warnings.push('qualityGate.enabled turned OFF - pre-push multi-language checks will no longer run.');
  }
  const prevStrict = was?.qualityGate?.strictLevel;
  const nextStrict = now?.qualityGate?.strictLevel;
  if (typeof prevStrict === 'number' && typeof nextStrict === 'number' && nextStrict > prevStrict) {
    warnings.push(`qualityGate.strictLevel raised ${prevStrict} -> ${nextStrict} - failing gates now block at a higher level only (warn-only for more levels).`);
  }
  return warnings;
}
