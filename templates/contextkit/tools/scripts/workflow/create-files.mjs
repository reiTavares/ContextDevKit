/**
 * File-template strings for the wave-workflow creator (WF0035, ADR-0101 §5).
 *
 * Split out of `create.mjs` so that module stays inside the line budget while
 * keeping the human-file seed text in one cohesive place. Every template is a
 * pure function of its inputs (no I/O, no clock) — `create.mjs` owns the writes.
 *
 * The `index.md` frontmatter intentionally mirrors the legacy spec-pack shape
 * (slug / number / started / branch / currentPhase + the nine journey phase
 * keys) so the legacy `readWorkflow` / `status` parser still reads a wave pack.
 *
 * Zero runtime dependencies — pure string builders, `node:*` not even needed.
 */

/** The nine immutable journey phases (ADR-0057), mirrored from workflow-pack. */
export const JOURNEY_PHASES = Object.freeze([
  'intake', 'prd', 'spec', 'adr', 'roadmap', 'pipeline', 'ship', 'testing', 'conclusion',
]);

/**
 * Render the `index.md` for a wave-created pack. The frontmatter is
 * legacy-parser compatible: the nine phase keys default to `pending`, with
 * `intake` as the starting `currentPhase`.
 * @param {{ slug: string, number: string, profile: string, pattern: (string|null),
 *   branch: string, started: string }} meta pack identity (started is injected)
 * @returns {string} full index.md content
 */
export function renderWaveIndex(meta) {
  const lines = [
    '---',
    `slug: ${meta.slug}`,
    'kind: feature',
    `number: ${meta.number}`,
    `started: ${meta.started}`,
    `branch: ${meta.branch}`,
    `profile: ${meta.profile}`,
    `pattern: ${meta.pattern ?? ''}`,
    'currentPhase: intake',
  ];
  for (const phase of JOURNEY_PHASES) lines.push(`${phase}: pending`);
  lines.push(
    '---', '',
    `# Workflow - ${meta.slug}`, '',
    '## Purpose', '',
    `Wave-based workflow (profile: ${meta.profile}${meta.pattern ? `, pattern: ${meta.pattern}` : ''}). ` +
      'Execution topology lives in `workflow-plan.json`; status lives in `workflow-state.json`.',
    '',
    '## History', '',
    '- Created; next phase: intake.', '',
  );
  return lines.join('\n');
}

/** Seed text for prd.md. */
export function renderPrd(slug) {
  return `# PRD/PDR - ${slug}\n\n## Problem\n\n## Goals\n\n## Users / Jobs\n\n## Non-goals\n\n## Success metrics\n\n## Open questions\n`;
}

/** Seed text for spec.md. */
export function renderSpec(slug) {
  return `# SPEC - ${slug}\n\n## Executive summary\n\n## Current architecture read\n\n## Proposed design\n\n## Interfaces / contracts\n\n## Data flow\n\n## Impact analysis\n\n## Test plan\n\n## Development sequence\n`;
}

/** Seed text for decisions.md. */
export function renderDecisions(slug) {
  return `# Decisions - ${slug}\n\nLink ADRs here. Do not duplicate ADR contents.\n\n| ADR | Status | Why it matters |\n| --- | --- | --- |\n`;
}

/** Seed text for tasks.md (a human projection; populated on execution). */
export function renderTasks(slug) {
  return `# Tasks - ${slug}\n\nGenerated projection of \`workflow-plan.json\` + \`workflow-state.json\`. Do not hand-edit the task board.\n\n| Wave | Task | Mode | Status |\n| --- | --- | --- | --- |\n`;
}

/** Seed text for memory.md. */
export function renderMemory(slug) {
  return `# Workflow Memory - ${slug}\n\nKeep only durable handoffs and learnings not already in git, ADRs, the PRD/PDR,\nSPEC, or the plan/state contracts.\n\n## Current state\n\n## Decisions / handoffs\n\n## Open risks\n`;
}

/**
 * Generic one-line-purpose stub for any catalog artifact (used for add-on files
 * and profile-required docs that have no bespoke seed above). The purpose header
 * comes from the catalog so the file explains itself on creation.
 * @param {{ filename: string, purpose: string }} artifact catalog entry fields
 * @returns {string} stub content
 */
export function renderStub(artifact) {
  const title = artifact.filename.replace(/\.md$/, '');
  return `# ${title}\n\n> ${artifact.purpose}\n`;
}
