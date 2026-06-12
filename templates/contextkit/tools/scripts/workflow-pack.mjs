/**
 * Workflow spec-pack helpers (ADR-0057). New workflows live in
 * `contextkit/memory/workflows/<slug>/`, while the old single-file breadcrumb
 * remains readable for compatibility.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

export const PHASES = ['intake', 'prd', 'spec', 'adr', 'roadmap', 'pipeline', 'ship', 'testing', 'conclusion'];
const LEGACY_PHASES = ['roadmap', 'adr', 'tickets', 'ship'];
const VALID_KINDS = new Set(['feature', 'architecture', 'bug', 'chore', 'spike']);
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

function workflowsDir(root) { return resolve(pathsFor(root).memory, 'workflows'); }
export function packDir(root, slug) { return resolve(workflowsDir(root), slug); }
function indexFile(root, slug) { return resolve(packDir(root, slug), 'index.md'); }
function legacyFile(root, slug) { return resolve(workflowsDir(root), `${slug}.md`); }
function stamp() { return new Date().toISOString(); }
function day() { return new Date().toISOString().slice(0, 10); }

function phaseMap(phases) {
  return Object.fromEntries(phases.map((phase) => [phase, { status: 'pending', ref: '' }]));
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter, body: match[2] ?? '' };
}

function parseWorkflowText(text, phases = PHASES, format = 'pack') {
  const parsed = parseFrontmatter(text);
  if (!parsed) return null;
  const workflowPhases = {};
  for (const phase of phases) {
    workflowPhases[phase] = {
      status: parsed.frontmatter[phase] || 'pending',
      ref: parsed.frontmatter[`${phase}-ref`] || '',
    };
  }
  return {
    format,
    slug: parsed.frontmatter.slug,
    kind: parsed.frontmatter.kind || '',
    started: parsed.frontmatter.started || '',
    currentPhase: parsed.frontmatter.currentPhase || '',
    phases: workflowPhases,
    body: parsed.body,
  };
}

function renderIndex(workflow) {
  const lines = [
    '---',
    `slug: ${workflow.slug}`,
    `kind: ${workflow.kind}`,
    `started: ${workflow.started}`,
    `currentPhase: ${workflow.currentPhase}`,
  ];
  for (const phase of PHASES) {
    const state = workflow.phases[phase] || { status: 'pending', ref: '' };
    lines.push(`${phase}: ${state.status}`);
    if (state.ref) lines.push(`${phase}-ref: ${state.ref}`);
  }
  lines.push('---', '', `# Workflow - ${workflow.slug}`, '');
  lines.push('## Purpose', '', 'Track the PRD/PDR, SPEC, ADR, roadmap, pipeline, and completion evidence for this workflow.', '');
  lines.push('## History', '');
  const history = workflow.body.match(/## History\n([\s\S]*)$/)?.[1]?.trim();
  lines.push(history || '- Created; next phase: intake.');
  lines.push('');
  return lines.join('\n');
}

function write(root, slug, relativePath, text) {
  const fullPath = resolve(packDir(root, slug), relativePath);
  mkdirSync(resolve(fullPath, '..'), { recursive: true });
  writeFileAtomicSync(fullPath, text);
}

function seedFiles(root, slug, kind) {
  write(root, slug, 'prd.md', `# PRD/PDR - ${slug}

## Problem

## Goals

## Users / Jobs

## Non-goals

## Success metrics

## Open questions
`);
  write(root, slug, 'spec.md', `# SPEC - ${slug}

## Executive summary

## Current architecture read

## Proposed design

## Interfaces / contracts

## Data flow

## Impact analysis

## Test plan

## Development sequence
`);
  write(root, slug, 'decisions.md', `# Decisions - ${slug}

Link ADRs here. Do not duplicate ADR contents.

| ADR | Status | Why it matters |
| --- | --- | --- |
`);
  write(root, slug, 'tasks.md', `# Tasks - ${slug}

Link DevPipeline cards here. Do not duplicate task bodies.

| Task | Lane | Purpose |
| --- | --- | --- |
`);
  write(root, slug, 'memory.md', `# Workflow Memory - ${slug}

Keep only durable handoffs and learnings that are not already in git, ADRs,
the PRD/PDR, SPEC, or DevPipeline cards.

## Current state

## Decisions / handoffs

## Open risks
`);
  write(root, slug, 'reports/.gitkeep', '');
  const workflow = { slug, kind, started: stamp(), currentPhase: 'intake', phases: phaseMap(PHASES), body: '' };
  writeFileAtomicSync(indexFile(root, slug), renderIndex(workflow));
}

export function createWorkflow(root, slug, kind = 'feature') {
  if (!SLUG_RE.test(slug || '')) throw new Error(`slug must match ${SLUG_RE} (got "${slug || ''}")`);
  if (!VALID_KINDS.has(kind)) throw new Error(`kind must be one of: ${[...VALID_KINDS].join(', ')}`);
  mkdirSync(workflowsDir(root), { recursive: true });
  if (existsSync(packDir(root, slug)) || existsSync(legacyFile(root, slug))) throw new Error(`workflow "${slug}" already exists`);
  mkdirSync(packDir(root, slug), { recursive: true });
  seedFiles(root, slug, kind);
  return readWorkflow(root, slug);
}

/** Marker for an existing-but-unparseable artifact (malformed ≠ missing). */
function malformed(path) { return { malformed: true, path }; }
function isMalformed(entry) { return Boolean(entry && entry.malformed); }

/**
 * Reads a spec-pack index. Returns null only when the index is genuinely
 * absent; an existing-but-unparseable index yields a `malformed` marker so
 * corruption is never masked as absence (constitution §8).
 */
function readPack(root, slug) {
  const path = indexFile(root, slug);
  if (!existsSync(path)) return null;
  const workflow = parseWorkflowText(readFileSync(path, 'utf-8'), PHASES, 'pack');
  return workflow ? { ...workflow, path } : malformed(path);
}

/** Reads a legacy breadcrumb. Same malformed-vs-missing contract as readPack. */
function readLegacy(root, slug) {
  const path = legacyFile(root, slug);
  if (!existsSync(path)) return null;
  const workflow = parseWorkflowText(readFileSync(path, 'utf-8'), LEGACY_PHASES, 'legacy');
  return workflow ? { ...workflow, path } : malformed(path);
}

export function readWorkflow(root, slug) {
  const pack = readPack(root, slug);
  if (isMalformed(pack)) throw new Error(`workflow "${slug}" is malformed (unparseable frontmatter): ${pack.path}`);
  if (pack) return pack;
  const legacy = readLegacy(root, slug);
  if (isMalformed(legacy)) throw new Error(`workflow "${slug}" is malformed (unparseable frontmatter): ${legacy.path}`);
  return legacy;
}

/**
 * Lists every workflow. Malformed entries are KEPT as `{ malformed, path }`
 * markers (never silently dropped) so `status` can print a `skipped (malformed)`
 * line; well-formed entries sort by start date, newest first.
 */
export function listWorkflows(root) {
  mkdirSync(workflowsDir(root), { recursive: true });
  const entries = readdirSync(workflowsDir(root), { withFileTypes: true });
  const packs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== '_TEMPLATE')
    .map((entry) => readPack(root, entry.name))
    .filter((entry) => entry !== null);
  const legacy = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '.gitkeep')
    .map((entry) => readLegacy(root, entry.name.replace(/\.md$/, '')))
    .filter((entry) => entry !== null);
  const all = [...packs, ...legacy];
  const valid = all.filter((entry) => !isMalformed(entry));
  const broken = all.filter(isMalformed);
  valid.sort((a, b) => String(b.started).localeCompare(String(a.started)));
  return [...valid, ...broken];
}

export function advanceWorkflow(root, slug, ref = '') {
  const workflow = readWorkflow(root, slug);
  if (!workflow) throw new Error(`workflow "${slug}" not found`);
  if (workflow.format === 'legacy') return advanceLegacy(root, workflow, ref);
  const index = PHASES.indexOf(workflow.currentPhase);
  if (index < 0) throw new Error(`workflow "${slug}" has unknown currentPhase: ${workflow.currentPhase}`);
  workflow.phases[workflow.currentPhase].status = 'done';
  if (ref) workflow.phases[workflow.currentPhase].ref = ref;
  const nextPhase = PHASES[index + 1];
  const note = `${day()} - ${workflow.currentPhase} done${ref ? ` (ref: ${ref})` : ''}`;
  workflow.currentPhase = nextPhase || 'done';
  workflow.body = `${workflow.body.trim()}\n- ${note}${nextPhase ? `; next phase: ${nextPhase}` : '; workflow complete'}`.trim();
  writeFileAtomicSync(indexFile(root, slug), renderIndex(workflow));
  return readWorkflow(root, slug);
}

function advanceLegacy(root, workflow, ref) {
  const index = LEGACY_PHASES.indexOf(workflow.currentPhase);
  if (index < 0) throw new Error(`workflow "${workflow.slug}" has unknown currentPhase: ${workflow.currentPhase}`);
  workflow.phases[workflow.currentPhase].status = 'done';
  if (ref) workflow.phases[workflow.currentPhase].ref = ref;
  workflow.currentPhase = LEGACY_PHASES[index + 1] || 'done';
  const lines = ['---', `slug: ${workflow.slug}`, `started: ${workflow.started}`, `currentPhase: ${workflow.currentPhase}`];
  for (const phase of LEGACY_PHASES) {
    lines.push(`${phase}: ${workflow.phases[phase].status}`);
    if (workflow.phases[phase].ref) lines.push(`${phase}-ref: ${workflow.phases[phase].ref}`);
  }
  lines.push('---', '', workflow.body.trim(), `- ${day()} - advanced legacy workflow`);
  writeFileAtomicSync(legacyFile(root, workflow.slug), `${lines.join('\n')}\n`);
  return readWorkflow(root, workflow.slug);
}
