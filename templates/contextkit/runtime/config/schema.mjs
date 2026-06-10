/**
 * OPTIONAL strict config schema (zod) for `/context-config`.
 *
 * The hot path (hooks) NEVER imports this — it uses the zero-dependency
 * loader in `load.mjs`. This module is loaded ONLY by `/context-config` when the
 * user wants strict validation before persisting an edit, and it degrades
 * gracefully when `zod` is not installed (the slash command catches the import
 * error and falls back to structural checks).
 *
 * Install `zod` in the target project to enable strict validation:
 *   npm i -D zod   (or pnpm/yarn/bun equivalent)
 */
import { z } from 'zod';
import { MAX_LEVEL, MIN_LEVEL } from './levels.mjs';

const PathString = z
  .string()
  .min(1, 'path must not be empty')
  .refine((p) => !p.startsWith('/') && !p.includes('\\'), {
    message: 'use forward-slashed, repo-relative paths (no leading /, no backslashes)',
  });

const Profile = z.object({
  cadenceDays: z.number().int().positive(),
  scope: z.string().min(1),
});

const LedgerSchema = z
  .object({
    important: z.array(PathString).min(1),
    irrelevant: z.array(PathString),
    registration: z.array(PathString),
  })
  .partial()
  .default({});

const L5Schema = z
  .object({
    highRiskPaths: z.array(PathString).default([]),
    distill: z
      .object({
        observeWindow: z.number().int().positive().default(10),
        proposeAfterSessions: z.number().int().positive().default(30),
        archiveLedgersOlderThanDays: z.number().int().positive().default(7),
      })
      .default({}),
    techDebtSweep: z
      .object({ default: z.string().min(1), profiles: z.record(z.string(), Profile) })
      .default({ default: 'full', profiles: { full: { cadenceDays: 14, scope: 'all' } } }),
  })
  .default({});

// ADR-0035 — Deliberations toggle. Modelled (not just passed through) so
// `/context-config` validates the voice count and level gate before persisting.
const DeliberationsSchema = z
  .object({
    active: z.boolean().default(true),
    voices: z.number().int().min(2).max(5).default(3),
    minLevel: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).default(5),
    nudgeOnHighRisk: z.boolean().default(true),
  })
  .default({});

const AutonomySchema = z
  .object({
    grade: z.number().int().min(1).max(4).default(2),
    extraSecretPaths: z.array(z.string()).default([]),
  })
  .default({});

const DepsSchema = z
  .object({
    requireLockfile: z.boolean().default(true),
    licenses: z
      .object({ allow: z.array(z.string()).default([]), deny: z.array(z.string()).default([]) })
      .default({}),
    maxAgeDays: z.number().int().positive().nullable().default(null),
  })
  .default({});

// `.passthrough()` keeps every section the defaults define (qa, pipeline,
// securityMode, tokens, predictionsReview, l3, setup, practices, …) instead of
// silently dropping the ones not modelled here — the alternative to re-declaring
// the whole config tree in zod. The level bound is single-sourced from
// levels.mjs so it can never drift from getLevel again. See ADR-0010.
export const ConfigSchema = z
  .object({
    level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).default(2),
    ledger: LedgerSchema,
    l5: L5Schema,
    deps: DepsSchema,
    deliberations: DeliberationsSchema,
    autonomy: AutonomySchema,
  })
  .passthrough()
  .default({});

export function validateConfig(raw) {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, error: parsed.error };
}

export function formatZodError(error) {
  return error.issues
    .map((i) => `  - ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('\n');
}
