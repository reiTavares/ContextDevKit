/**
 * Wave-workflow creator for the universal wave engine (WF0035, ADR-0101 §5).
 *
 * Creates a wave-based workflow pack from a PROFILE (+ optional PATTERN and
 * add-ons), or from a caller-provided PLAN (the `program` path). The pack mirrors
 * the legacy spec-pack layout so `workflow.mjs status <slug>` keeps working, but
 * adds the machine contract `workflow-plan.json` (topology). `workflow-state.json`
 * is intentionally NOT created here — state is born on first execution.
 *
 * Default-refuse: an existing target folder is never clobbered (throws). All
 * registry lookups throw on an unknown profile/pattern/add-on. The clock is
 * injected (`now`) — no `new Date()` / `Date.now()` deep in this module so two
 * runs with the same inputs are byte-identical (ADR-0101 §Contracts).
 *
 * Zero runtime dependencies — `node:*` + sibling workflow modules only (ADR-0001).
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from './io.mjs';
import { writePlan } from './plan.mjs';
import { resolveProfile, requiredFilesFor } from './profiles.mjs';
import { resolvePattern, waveSkeleton } from './patterns.mjs';
import { explainFile } from './files.mjs';
import { addonRequirements } from './addons.mjs';
import { nextWorkflowNumber } from '../registry/ids.mjs';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import {
  renderWaveIndex, renderPrd, renderSpec, renderDecisions,
  renderTasks, renderMemory, renderStub,
} from './create-files.mjs';

/** Slug shape (mirrors workflow-pack SLUG_RE) — validated at the boundary. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

/** Bespoke seed renderers keyed by catalog artifact id; others fall to a stub. */
const SEEDS = Object.freeze({
  prd: renderPrd,
  spec: renderSpec,
  decisions: renderDecisions,
  tasks: renderTasks,
  memory: renderMemory,
});

/** Resolve the absolute central (legacy, owner=null) workflows directory. */
function workflowsDir(root) {
  return resolve(pathsFor(root).memory, 'workflows');
}

/** Owner-id shape: `OP-####` (Operation) or `BIZ-####` (Business). */
const OWNER_RE = /^(OP|BIZ)-\d{4}$/;

/**
 * Resolves the absolute `workflows/` directory under an owner's EXISTING context
 * folder (BIZ-0001 ownership rule 3 — one physical canonical owner). The context
 * folder is named `<OWNER-ID>-<owner-slug>`; it is located by scanning the parent
 * (`operations/` for `OP-####`, `business/` for `BIZ-####`) for a dir whose name
 * starts with `<OWNER-ID>-` (or equals the bare id).
 *
 * Fail-fast: throws a descriptive error when the owner id is malformed or its
 * context folder does not exist — NEVER silently falls back to the central root,
 * which would re-create the exact protocol violation this gate exists to prevent.
 *
 * @param {string} root project root.
 * @param {string} owner owner id (`OP-####` or `BIZ-####`).
 * @returns {string} absolute path of `<ownerFolder>/workflows`.
 * @throws {Error} on a malformed owner id or a missing owner context folder.
 */
function ownerWorkflowsDir(root, owner) {
  if (!OWNER_RE.test(owner)) {
    throw new Error(`createWaveWorkflow: owner must match ${OWNER_RE} (got "${owner}")`);
  }
  const paths = pathsFor(root);
  const parent = owner.startsWith('OP-') ? paths.operations : paths.business;
  const folder = existsSync(parent)
    ? readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .find((name) => name === owner || name.startsWith(`${owner}-`))
    : undefined;
  if (!folder) {
    throw new Error(`createWaveWorkflow: owner "${owner}" has no context folder under ${parent} — create the ${owner.startsWith('OP-') ? 'operation' : 'business'} first (no silent fallback to central)`);
  }
  return resolve(parent, folder, 'workflows');
}

/**
 * Build the `gates[]` array a plan needs so every wave gate reference resolves.
 * Combines a pattern's `defaultGates` map with any gate id named by a wave.
 * @param {object} pattern resolved pattern (or null)
 * @param {Array<{id:string,gate?:(string|null)}>} waves the skeleton waves
 * @returns {Array<{id:string,waveId:(string|null),type:string,requirements:string[]}>}
 */
function buildGates(pattern, waves) {
  const defaults = (pattern && pattern.defaultGates) || {};
  const waveByGate = new Map();
  for (const wave of waves) {
    if (wave.gate) waveByGate.set(wave.gate, wave.id);
  }
  const ids = new Set([...Object.keys(defaults), ...waveByGate.keys()]);
  return [...ids].sort().map((id) => ({
    id,
    waveId: waveByGate.get(id) ?? null,
    type: defaults[id] ?? 'machine',
    requirements: [],
  }));
}

/**
 * Seed the pattern skeleton into a fresh `workflow-plan.json` plan object. Waves
 * carry id/title/dependsOn/gate and EMPTY tasks (tasks are authored later); gates
 * are derived so references resolve. Status lives in state, never here.
 * @param {{ number: string, slug: string, profile: string, pattern: (string|null),
 *   addons: string[], patternDef: (object|null), skeleton: object[] }} input
 * @returns {object} an un-normalized plan (writePlan normalizes + validates)
 */
function planFromSkeleton(input) {
  const waves = input.skeleton.map((wave) => ({
    id: wave.id,
    title: wave.title ?? '',
    description: '',
    type: 'implementation',
    priority: 'P2',
    dependsOn: Array.isArray(wave.dependsOn) ? wave.dependsOn : [],
    gate: wave.gate ?? null,
    executionStrategy: 'parallel',
    tasks: [],
  }));
  return {
    schemaVersion: 1,
    workflowId: input.number,
    slug: input.slug,
    title: input.slug,
    profile: input.profile,
    pattern: input.pattern,
    addons: input.addons,
    journey: { currentPhase: 'intake' },
    waves,
    gates: buildGates(input.patternDef, waves),
    artifacts: [],
  };
}

/** Write one human/seed file inside the pack dir and record its relative path. */
function writeArtifact(dir, written, artifactId, slug) {
  const artifact = explainFile(artifactId);
  if (artifact.filename.endsWith('/')) return; // a directory artifact (reports/)
  const render = SEEDS[artifactId];
  const content = render ? render(slug) : renderStub(artifact);
  writeFileAtomicSync(resolve(dir, artifact.filename), content);
  written.push(artifact.filename);
}

/**
 * Create a wave-based workflow pack from a profile (+ optional pattern/add-ons),
 * or from a caller-provided plan. Refuses to clobber an existing folder.
 *
 * When `options.owner` (`OP-####`/`BIZ-####`) is present the pack is placed under
 * that owner's existing context folder — `<owner>/workflows/WF-<number>-<slug>` —
 * honoring the one-canonical-owner rule (BIZ-0001 ownership rule 3); a missing
 * owner folder throws (no silent fallback to central). When owner is ABSENT the
 * pack lands in the central legacy root as `<number>-<slug>` (owner=null).
 *
 * @param {string} root project root (contains `contextkit/memory/workflows/`)
 * @param {string} slug workflow slug (must match SLUG_RE)
 * @param {{ profile: string, pattern?: (string|null), addons?: string[],
 *   plan?: (object|null), now: string, number?: string, owner?: (string|null) }} options
 * @returns {{ dir: string, number: string, slug: string, profile: string,
 *   pattern: (string|null), files: string[] }}
 * @throws {Error} on bad slug, unknown profile/pattern/add-on, a missing owner
 *   context folder, or an existing folder
 */
export function createWaveWorkflow(root, slug, options = {}) {
  if (!SLUG_RE.test(slug || '')) throw new Error(`slug must match ${SLUG_RE} (got "${slug || ''}")`);
  if (typeof options.now !== 'string' || !options.now) throw new Error('createWaveWorkflow: a string `now` is required (inject the clock)');
  const profileName = options.profile;
  const profile = resolveProfile(profileName); // throws on unknown profile
  const addons = Array.isArray(options.addons) ? options.addons : [];
  if (addons.length) addonRequirements(addons); // throws on unknown / incompatible

  const patternId = options.pattern ?? profile.defaultPattern ?? null;
  const patternDef = patternId ? resolvePattern(patternId) : null;
  const skeleton = patternId ? waveSkeleton(patternId) : [];

  // Placement: an owned workflow nests under its parent context with the `WF-`
  // prefix (BIZ-0001 ownership rule 3); an unowned one stays central + legacy.
  // `ownerWorkflowsDir` THROWS if the owner folder is absent — never a silent
  // fallback to central (the protocol violation WF-0057's gate prevents).
  const owner = options.owner || null;
  const dir = owner ? ownerWorkflowsDir(root, owner) : workflowsDir(root);
  mkdirSync(dir, { recursive: true });
  // Workflow numbering is UNIVERSAL across legacy/business/operations (BIZ-0001 /
  // WF-0036 A4, ADR-0119): the next id is the global max+1 over every root — NEVER
  // a per-directory count. `nextWorkflowNumber` is the single source of truth.
  const number = options.number ?? nextWorkflowNumber(root);
  const packDir = resolve(dir, owner ? `WF-${number}-${slug}` : `${number}-${slug}`);
  if (existsSync(packDir)) throw new Error(`workflow "${slug}" already exists at ${packDir}`);
  mkdirSync(packDir, { recursive: true });
  mkdirSync(resolve(packDir, 'reports'), { recursive: true });
  writeFileAtomicSync(resolve(packDir, 'reports', '.gitkeep'), '');

  const branch = typeof options.branch === 'string' ? options.branch : '';
  const written = [];
  writeFileAtomicSync(
    resolve(packDir, 'index.md'),
    renderWaveIndex({ slug, number, profile: profileName, pattern: patternId, branch, started: options.now }),
  );
  written.push('index.md');

  for (const artifactId of requiredFilesFor(profileName, { addons })) {
    if (artifactId === 'index' || artifactId === 'reports') continue; // index written above; reports is a dir
    if (artifactId === 'workflow-plan' || artifactId === 'workflow-state') continue; // plan below; state on execution
    writeArtifact(packDir, written, artifactId, slug);
  }

  const plan = options.plan
    ? { ...options.plan, slug, workflowId: options.plan.workflowId ?? number, profile: options.plan.profile ?? profileName }
    : planFromSkeleton({ number, slug, profile: profileName, pattern: patternId, addons, patternDef, skeleton });
  writePlan(resolve(packDir, 'workflow-plan.json'), plan); // normalizes + validates; throws on a refused plan
  written.push('workflow-plan.json');

  written.sort();
  return { dir: packDir, number, slug, profile: profileName, pattern: patternId, files: written };
}
