/**
 * Workflow spec-pack helpers (ADR-0057). New workflows live in
 * `contextkit/memory/workflows/<slug>/`, while the old single-file breadcrumb
 * remains readable for compatibility.
 *
 * Cohesion Note: Content completeness checks and validation gates are kept
 * cohesive inside this module to avoid fragmented parsing logic across files
 * and to keep workflow advancing atomic and safe.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { checkPhaseGaps } from './workflow-gate.mjs';
import { resolveFolderName } from './workflow-number.mjs';
import { parseFrontmatter } from './workflow-frontmatter.mjs';
import { resolveWorkflow } from './registry/workflow.mjs';
import { nextWorkflowNumber, workflowRoots } from './registry/ids.mjs';
import { seedFileContents } from './workflow-pack-seeds.mjs';

export { checkWorkflowDocument } from './workflow-doc-check.mjs';

export const PHASES = ['intake', 'prd', 'spec', 'adr', 'roadmap', 'pipeline', 'ship', 'testing', 'conclusion'];
const LEGACY_PHASES = ['roadmap', 'adr', 'tickets', 'ship'];
const VALID_KINDS = new Set(['feature', 'architecture', 'bug', 'chore', 'spike']);
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

function workflowsDir(root) { return resolve(pathsFor(root).memory, 'workflows'); }

/**
 * Absolute pack dir for an id-or-slug, resolved across EVERY root (BIZ-0001 /
 * WF-0036 A4): top-level `workflows/` plus each owned `business|operations/<id>/
 * workflows/`. Without this an owner-nested workflow (ownership rule 3) is
 * invisible to `readWorkflow`/`status`/`advance`. Order: (1) a direct central
 * match — also the not-yet-created path `createWorkflow` probes, so create stays
 * central; (2) else the cross-root `resolveWorkflow` row's memory-relative
 * `.path`, rebased absolute; (3) else the central path (unknown slug → "missing").
 * @param {string} root project root.
 * @param {string} slug workflow id or slug.
 * @returns {string} absolute pack directory (may not exist yet).
 */
export function packDir(root, slug) {
  const central = resolve(workflowsDir(root), resolveFolderName(workflowsDir(root), slug));
  if (existsSync(central)) return central;
  const hit = resolveWorkflow(slug, root);
  if (hit && hit.path) return resolve(pathsFor(root).memory, hit.path);
  return central;
}
function indexFile(root, slug) { return resolve(packDir(root, slug), 'index.md'); }
function legacyFile(root, slug) { return resolve(workflowsDir(root), `${slug}.md`); }
function stamp() { return new Date().toISOString(); }
function day() { return new Date().toISOString().slice(0, 10); }

/**
 * Current git branch (ADR-0071), zero-dep. Handles worktrees where `.git` is a
 * file pointing at the real gitdir. Returns null when undeterminable (detached
 * HEAD, no repo): a null-branch workflow never scopes the guard to a branch.
 */
export function currentBranch(root) {
  let gitDir = resolve(root, '.git');
  try {
    const meta = readFileSync(gitDir, 'utf-8'); // throws if .git is a directory (normal repo)
    const m = meta.match(/^gitdir:\s*(.+)$/m);
    if (m) gitDir = resolve(root, m[1].trim());
  } catch { /* normal repo: .git is a directory */ }
  try {
    const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf-8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return ref ? ref[1] : null;
  } catch {
    return null;
  }
}

function phaseMap(phases) {
  return Object.fromEntries(phases.map((phase) => [phase, { status: 'pending', ref: '' }]));
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
    number: parsed.frontmatter.number || '',
    // ADR-0116 round-trip (card #357): owner must survive read→advance→render, else
    // an advanced workflow loses its BIZ/OP owner and the done-sweep can't file it
    // under its context. Empty string keeps renderIndex's `owner ?` guard honest.
    owner: parsed.frontmatter.owner || '',
    started: parsed.frontmatter.started || '',
    branch: parsed.frontmatter.branch || '',
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
    `number: ${workflow.number || ''}`,
    ...(workflow.owner ? [`owner: ${workflow.owner}`] : []),
    `started: ${workflow.started}`,
    `branch: ${workflow.branch || ''}`,
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

function seedFiles(root, slug, kind, number = '', owner = null) {
  for (const seed of seedFileContents(slug)) write(root, slug, seed.filename, seed.content);
  write(root, slug, 'reports/.gitkeep', '');
  const workflow = { slug, kind, number, owner: owner || '', started: stamp(), branch: currentBranch(root) || '', currentPhase: 'intake', phases: phaseMap(PHASES), body: '' };
  writeFileAtomicSync(indexFile(root, slug), renderIndex(workflow));
}

export function createWorkflow(root, slug, kind = 'feature', owner = null) {
  if (!SLUG_RE.test(slug || '')) throw new Error(`slug must match ${SLUG_RE} (got "${slug || ''}")`);
  if (!VALID_KINDS.has(kind)) throw new Error(`kind must be one of: ${[...VALID_KINDS].join(', ')}`);
  // ADR-0116: feature/architecture work must declare an owner work-context (Operation/Business).
  if ((kind === 'feature' || kind === 'architecture') && !/^(BIZ|OP)-\d{4}$/.test(owner || '')) {
    throw new Error(`workflow "${slug}" (${kind}) needs an owner — pass --operation OP-#### or --business BIZ-#### (create it first). [ADR-0116]`);
  }
  const dir = workflowsDir(root);
  mkdirSync(dir, { recursive: true });
  if (existsSync(packDir(root, slug)) || existsSync(legacyFile(root, slug))) throw new Error(`workflow "${slug}" already exists`);
  // UNIVERSAL numbering (BIZ-0001 / WF-0036 A4, ADR-0119): global max+1 across every
  // root (legacy + business + operations + done/), NEVER a per-directory count.
  const number = nextWorkflowNumber(root);
  mkdirSync(resolve(dir, `${number}-${slug}`), { recursive: true });
  seedFiles(root, slug, kind, number, owner);
  return readWorkflow(root, slug);
}

/** Marker for an existing-but-unparseable artifact (malformed ≠ missing). */
function malformed(path) { return { malformed: true, path }; }
function isMalformed(entry) { return Boolean(entry && entry.malformed); }

/**
 * Reads a spec-pack from an ABSOLUTE `index.md` path. null when genuinely absent;
 * an existing-but-unparseable index yields a `malformed` marker (constitution §8).
 * Path-based so it serves both the slug resolver and the cross-root walk.
 */
function readPackAt(path) {
  if (!existsSync(path)) return null;
  const workflow = parseWorkflowText(readFileSync(path, 'utf-8'), PHASES, 'pack');
  return workflow ? { ...workflow, path } : malformed(path);
}

/** Reads a spec-pack index for an id-or-slug (resolved across all roots). */
function readPack(root, slug) {
  return readPackAt(indexFile(root, slug));
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
  // Pack dirs from every ACTIVE workflow root (top-level + owned contexts),
  // reusing `workflowRoots` so nested owned workflows are not blind spots
  // (BIZ-0001 / WF-0036 A4). Read by absolute index path (no slug round-trip).
  // `done/` archives are excluded to keep the prior active-only listing.
  const packs = workflowRoots(root)
    .filter((dir) => !dir.endsWith('/done') && existsSync(dir))
    .flatMap((dir) => readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '_TEMPLATE')
      .map((entry) => readPackAt(resolve(dir, entry.name, 'index.md'))))
    .filter((entry) => entry !== null);
  // Legacy `.md` breadcrumbs only ever live in the central top-level root.
  const legacy = readdirSync(workflowsDir(root), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '.gitkeep')
    .map((entry) => readLegacy(root, entry.name.replace(/\.md$/, '')))
    .filter((entry) => entry !== null);
  const all = [...packs, ...legacy];
  const valid = all.filter((entry) => !isMalformed(entry));
  const broken = all.filter(isMalformed);
  valid.sort((a, b) => String(b.started).localeCompare(String(a.started)));
  return [...valid, ...broken];
}

/**
 * Reports the journey-gate gaps for a workflow's CURRENT phase (ADR-0071).
 * @returns {{ currentPhase: string, missing: string[] }}
 */
export function checkWorkflow(root, slug) {
  const workflow = readWorkflow(root, slug);
  if (!workflow) throw new Error(`workflow "${slug}" not found`);
  if (workflow.format === 'legacy') return { currentPhase: workflow.currentPhase, missing: [] };
  return { currentPhase: workflow.currentPhase, missing: checkPhaseGaps(packDir(root, slug), workflow.currentPhase, workflow) };
}

export function advanceWorkflow(root, slug, ref = '', options = {}) {
  const workflow = readWorkflow(root, slug);
  if (!workflow) throw new Error(`workflow "${slug}" not found`);
  if (workflow.format === 'legacy') return advanceLegacy(root, workflow, ref);
  if (!options.force) {
    const phaseState = workflow.phases[workflow.currentPhase] || {};
    const candidate = ref
      ? { ...workflow, phases: { ...workflow.phases, [workflow.currentPhase]: { ...phaseState, ref } } }
      : workflow;
    const gaps = checkPhaseGaps(packDir(root, slug), workflow.currentPhase, candidate);
    if (gaps.length) {
      throw new Error(`workflow "${slug}" cannot leave "${workflow.currentPhase}" - missing:\n  - ${gaps.join('\n  - ')}\nComplete these, or pass --force to override.`);
    }
  }
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
