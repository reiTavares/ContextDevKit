/**
 * Spec-pack seed CONTENT (ADR-0057). The five human-authored breadcrumb files a
 * fresh workflow pack is born with — prd/spec/decisions/tasks/memory. Split out
 * of `workflow-pack.mjs` so that module stays within the line budget and keeps a
 * single responsibility (pack lifecycle + cross-root resolution); this module
 * owns only the seed templates. Pure: takes a slug, returns `{ filename, content }`
 * rows. Zero runtime dependencies (no I/O here — the caller writes the files).
 */

/**
 * Build the seed breadcrumb files for a new workflow pack.
 * @param {string} slug workflow slug (interpolated into each title).
 * @returns {Array<{ filename: string, content: string }>} the five seed docs.
 */
export function seedFileContents(slug) {
  return [
    { filename: 'prd.md', content: `# PRD/PDR - ${slug}

## Problem

## Goals

## Users / Jobs

## Non-goals

## Success metrics

## Open questions
` },
    { filename: 'spec.md', content: `# SPEC - ${slug}

## Executive summary

## Current architecture read

## Proposed design

## Interfaces / contracts

## Data flow

## Impact analysis

## Test plan

## Development sequence
` },
    { filename: 'decisions.md', content: `# Decisions - ${slug}

Link ADRs here. Do not duplicate ADR contents.

| ADR | Status | Why it matters |
| --- | --- | --- |
` },
    { filename: 'tasks.md', content: `# Tasks - ${slug}

Link DevPipeline cards here. Do not duplicate task bodies.

| Task | Lane | Purpose |
| --- | --- | --- |
` },
    { filename: 'memory.md', content: `# Workflow Memory - ${slug}

Keep only durable handoffs and learnings that are not already in git, ADRs,
the PRD/PDR, SPEC, or DevPipeline cards.

## Current state

## Decisions / handoffs

## Open risks
` },
  ];
}
