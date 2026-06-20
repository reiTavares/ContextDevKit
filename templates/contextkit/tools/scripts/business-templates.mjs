/**
 * Canonical Business package template BUILDERS (BIZ-0001 / WF-0036 A3-T1).
 *
 * Public API for constructing Business work-context artifacts:
 *   - `buildBusinessPrompt(kind)` — returns the canonical skeleton Markdown for
 *     one of the three Business documents (business-case / growth /
 *     investment-decision).
 *   - `buildBusinessJson(input)` — returns a schema-valid seed `business.json`
 *     object (refusal-by-default posture: status 'draft', unknowns as 'unknown').
 *   - `BUSINESS_PROMPT_KINDS` — frozen list of valid `kind` values.
 *   - `BUSINESS_SUMMARY_BLOCK` — managed-block id that `business-render.mjs` fills.
 *
 * Template strings live in `business-template-strings.mjs` (a peer module) so
 * this file stays within the 280-line budget (split justified by the distinct
 * cohesion: authoring content vs. builder API).
 *
 * Design principles (mirroring `work-templates.mjs`):
 *   - NO invented domain content (constitution §9): skeletons + placeholders only.
 *   - Pure functions — no I/O, no side effects on import.
 *   - Zero runtime dependencies (`node:*` not needed here).
 */
import {
  BUSINESS_CASE_TEMPLATE,
  GROWTH_TEMPLATE,
  INVESTMENT_DECISION_TEMPLATE,
} from './business-template-strings.mjs';

/** Managed-block id the renderer writes the machine summary into. */
export const BUSINESS_SUMMARY_BLOCK = 'business-summary';

/** Valid kind values for `buildBusinessPrompt`. */
export const BUSINESS_PROMPT_KINDS = Object.freeze([
  'business-case',
  'growth',
  'investment-decision',
]);

/**
 * Returns the canonical skeleton template string for the requested Business
 * document kind.  The template contains structural scaffolding and `[FILL: …]`
 * placeholders — NO invented domain content (constitution §9).
 *
 * @param {'business-case'|'growth'|'investment-decision'} kind - document kind.
 * @returns {string} the skeleton Markdown content (ready to write to disk).
 * @throws {Error} when `kind` is not one of the supported values.
 */
export function buildBusinessPrompt(kind) {
  switch (kind) {
    case 'business-case':
      return BUSINESS_CASE_TEMPLATE;
    case 'growth':
      return GROWTH_TEMPLATE;
    case 'investment-decision':
      return INVESTMENT_DECISION_TEMPLATE;
    default:
      throw new Error(
        `buildBusinessPrompt: unknown kind "${kind}". ` +
          `Valid values: ${BUSINESS_PROMPT_KINDS.join(', ')}`,
      );
  }
}

/**
 * Builds a canonical, schema-valid `business.json` seed object.  Defaults to
 * the refusal-by-default posture (constitution §8): status is 'draft', all
 * nullable/optional fields are null, numeric/unknown fields use 'unknown'.
 *
 * The caller MUST supply at minimum `id`, `title`, `slug`, `kind`,
 * `strategicFacet`, and `valueIntents`.
 *
 * @param {object} input - business seed inputs.
 * @param {string} input.id - canonical `BIZ-####` id.
 * @param {string} input.title - human title.
 * @param {string} input.slug - lower-kebab slug.
 * @param {string} input.kind - business kind (TRANSFORMATION | INITIATIVE | …).
 * @param {string} input.strategicFacet - strategic facet label.
 * @param {{ primary: string, secondary?: string[] }} input.valueIntents - value intents.
 * @param {string} [input.status] - lifecycle status (default 'draft').
 * @returns {object} a parsed-business-shaped object (validate before writing).
 */
export function buildBusinessJson(input) {
  const { id, title, slug, kind, strategicFacet, valueIntents } = input;
  return {
    schemaVersion: 1,
    uid: null,
    id,
    title,
    slug,
    status: input.status || 'draft',
    kind,
    strategicFacet,
    valueIntents: {
      primary: valueIntents.primary,
      secondary: Array.isArray(valueIntents.secondary) ? valueIntents.secondary : [],
    },
    growth: {
      primaryLever: null,
      secondaryLevers: [],
      northStar: { metric: null, baseline: 'unknown', target: 'to-be-defined' },
    },
    investment: {
      recommendation: null,
      p50: 'unknown',
      p80: 'unknown',
      forecastSource: null,
    },
    approval: {
      actor: null,
      revision: 0,
      decisionHash: null,
      approvedAt: null,
      decision: null,
    },
    decisions: {
      status: 'uncovered',
      primary: null,
      governing: [],
    },
    workflows: {
      authorized: [],
    },
    relations: [],
    lifecycle: [
      'draft', 'proposed', 'needs-revision', 'approved',
      'active', 'paused', 'validated', 'partially-validated',
      'invalidated', 'closed', 'rejected',
    ],
  };
}
