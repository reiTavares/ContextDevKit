/**
 * Canonical Operation package TEMPLATES (BIZ-0001 / WF-0036, A1-T2).
 *
 * Builds the three artifacts of an Operation work context — `operation.json`
 * (machine contract), `reason.md` (the WHY), and `tasks.md` (the task projection
 * host with a managed block). The `operation.json` builder produces an object
 * that conforms to the A1-T1 `validateOperation` contract; the markdown builders
 * carry NO invented domain content (constitution §9) — only the structural
 * scaffold and a single managed-block seam the renderer fills.
 *
 * Zero runtime dependencies — `node:*` not even needed here (pure builders).
 * Reuses the shared enums via callers; this module stays data-shape only.
 */
import { OPERATION_SCHEMA_VERSION } from '../../runtime/work/schema-operation.mjs';

/** Managed-block id the task renderer projects DevPipeline cards into. */
export const OPERATION_TASKS_BLOCK = 'operation-tasks';

/**
 * Builds a canonical, schema-valid `operation.json` object. Optional vocabularies
 * (urgency/severity) default to conservative values; linkage defaults to the
 * unlinked/unproven state (refusal-by-default, constitution §8) — only a later
 * `link`/classify step stamps a confirmed Business.
 *
 * @param {object} input - operation inputs.
 * @param {string} input.id - canonical `OP-####` id (allocated by the caller).
 * @param {string} input.title - human title.
 * @param {string} input.slug - lower-kebab slug.
 * @param {string} input.kind - operation kind (free vocabulary at A1).
 * @param {string} input.executionMode - one of the EXECUTION_MODES.
 * @param {object} input.valueIntents - `{ primary, secondary }` value intents.
 * @param {string} [input.urgency] - urgency label (default "normal").
 * @param {string} [input.severity] - severity label (default "low").
 * @returns {object} a parsed-operation-shaped object (validate before writing).
 */
export function buildOperationJson(input) {
  const { id, title, slug, kind, executionMode, valueIntents } = input;
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    uid: null,
    id,
    title,
    slug,
    kind,
    executionMode,
    urgency: input.urgency || 'normal',
    severity: input.severity || 'low',
    valueIntents: {
      primary: valueIntents.primary,
      secondary: Array.isArray(valueIntents.secondary) ? valueIntents.secondary : [],
    },
    business: { suggested: null, confirmed: null, score: 0, status: 'unlinked' },
    decisions: { coverage: 'none', primary: null, governing: [], created: [], candidatesEvaluated: 0 },
    relations: [],
  };
}

/**
 * Builds the `reason.md` body — the WHY scaffold for an Operation. Carries the
 * structural prompts a human/agent fills; no invented justification.
 *
 * @param {object} operation - a built operation object.
 * @param {string} createdAt - ISO date (injected; builder stays timeless).
 * @returns {string} markdown content (trailing newline).
 */
export function buildReasonMd(operation, createdAt) {
  const intents = [operation.valueIntents.primary, ...operation.valueIntents.secondary].join(', ');
  return [
    `# ${operation.id} — ${operation.title}`,
    '',
    `- **Kind:** ${operation.kind}`,
    `- **Execution mode:** ${operation.executionMode}`,
    `- **Value intents:** ${intents}`,
    `- **Created:** ${createdAt}`,
    '',
    '## Why this Operation exists',
    '',
    '_State the concrete trigger and the value this Operation protects or creates._',
    '',
    '## Business linkage',
    '',
    '_Unlinked at creation. Run classification / `work link` to bind a Business._',
    '',
    '## Decision coverage',
    '',
    '_No governing decision yet. Material choices must be ADR-gated (constitution §9)._',
    '',
  ].join('\n');
}

/**
 * Builds the initial `tasks.md` host — a human-authored shell with ONE empty
 * managed block the renderer owns. Human notes live OUTSIDE the markers and are
 * preserved verbatim across re-renders (idempotent projection).
 *
 * @param {object} operation - a built operation object.
 * @param {{ start: string, end: string }} markers - managed-block markers.
 * @returns {string} markdown content (trailing newline).
 */
export function buildTasksMd(operation, markers) {
  return [
    `# ${operation.id} — Tasks`,
    '',
    '> The table below is generated from DevPipeline cards. Do not edit between',
    '> the markers — human notes belong outside the block and are preserved.',
    '',
    markers.start,
    '_No cards linked to this Operation yet._',
    markers.end,
    '',
    '## Notes',
    '',
    '_Free-form human notes — never overwritten by the renderer._',
    '',
  ].join('\n');
}
