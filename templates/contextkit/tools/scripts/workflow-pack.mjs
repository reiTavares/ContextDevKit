/**
 * Workflow spec-pack helpers (ADR-0057). New workflows live in
 * `contextkit/memory/workflows/<slug>/`, while the old single-file breadcrumb
 * remains readable for compatibility.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';

export const PHASES = ['intake', 'prd', 'spec', 'adr', 'roadmap', 'pipeline', 'ship', 'testing', 'conclusion'];
const LEGACY_PHASES = ['roadmap', 'adr', 'tickets', 'ship'];
const VALID_KINDS = new Set(['feature', 'architecture', 'bug', 'chore', 'spike']);
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

function workflowsDir(root) { return resolve(pathsFor(root).memory, 'workflows'); }
function packDir(root, slug) { return resolve(workflowsDir(root), slug); }
function indexFile(root, slug) { return resolve(packDir(root, slug), 'index.md'); }
function legacyFile(root, slug) { return resolve(workflowsDir(root), `${slug}.md`); }
function stamp() { return new Date().toISOString(); }
function day() { return new Date().toISOString().slice(0, 10); }

function phaseMap(phases) {
  return Object.fromEntries(phases.map((phase) => [phase, { status: 'pending', ref: '' }]));
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
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

function readPack(root, slug) {
  if (!existsSync(indexFile(root, slug))) return null;
  const workflow = parseWorkflowText(readFileSync(indexFile(root, slug), 'utf-8'), PHASES, 'pack');
  return workflow ? { ...workflow, path: indexFile(root, slug) } : null;
}

function readLegacy(root, slug) {
  if (!existsSync(legacyFile(root, slug))) return null;
  const workflow = parseWorkflowText(readFileSync(legacyFile(root, slug), 'utf-8'), LEGACY_PHASES, 'legacy');
  return workflow ? { ...workflow, path: legacyFile(root, slug) } : null;
}

export function readWorkflow(root, slug) {
  return readPack(root, slug) || readLegacy(root, slug);
}

export function listWorkflows(root) {
  mkdirSync(workflowsDir(root), { recursive: true });
  const entries = readdirSync(workflowsDir(root), { withFileTypes: true });
  const packs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== '_TEMPLATE')
    .map((entry) => readPack(root, entry.name))
    .filter(Boolean);
  const legacy = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '.gitkeep')
    .map((entry) => readLegacy(root, entry.name.replace(/\.md$/, '')))
    .filter(Boolean);
  return [...packs, ...legacy].sort((a, b) => String(b.started).localeCompare(String(a.started)));
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

function git(root, args) {
  const out = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  return out.status === 0 ? (out.stdout || '').trim() : '';
}
function touchedFiles(root) {
  const diffNames = git(root, ['diff', '--name-only'])
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  const statusNames = git(root, ['status', '--short'])
    .split('\n')
    .map((line) => line.replace(/^\s*[ MADRCU?!]{1,2}\s+/, '').trim())
    .filter(Boolean)
    .map((name) => name.replace(/^"|"$/g, ''));
  return [...new Set([...diffNames, ...statusNames])];
}
export function writeReport(root, slug, taskId = '') {
  const workflow = readWorkflow(root, slug);
  if (!workflow || workflow.format !== 'pack') throw new Error(`workflow pack "${slug}" not found`);
  const reportPath = resolve(packDir(root, slug), 'reports', `${day()}.md`);
  mkdirSync(resolve(reportPath, '..'), { recursive: true });
  const names = touchedFiles(root);
  const lines = [
    `# Daily Report - ${slug} - ${day()}`,
    '',
    `- **Workflow**: ${slug}`,
    `- **Task**: ${taskId || 'not specified'}`,
    `- **Branch**: ${git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown'}`,
    `- **Commit**: ${git(root, ['rev-parse', '--short', 'HEAD']) || 'unknown'}`,
    '',
    '## Diff summary',
    '',
    '```text',
    git(root, ['diff', '--stat']) || 'No working tree diff.',
    '```',
    '',
    '## Numstat',
    '',
    '```text',
    git(root, ['diff', '--numstat']) || 'No working tree diff.',
    '```',
    '',
    '## Files touched',
    '',
    names.length ? names.map((name) => `- ${name}`).join('\n') : '- None',
    '',
    '## Verification',
    '',
    '- [ ] Record the suite command and exit code.',
    '',
    '## Notes',
    '',
    '- Full patches stay in git; this report records the factual summary only.',
    '',
  ];
  writeFileAtomicSync(reportPath, lines.join('\n'));
  return reportPath;
}
