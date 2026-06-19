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
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileAtomicSync } from './io.mjs';
import { writePlan } from './plan.mjs';
import { resolveProfile, requiredFilesFor } from './profiles.mjs';
import { resolvePattern, waveSkeleton } from './patterns.mjs';
import { explainFile } from './files.mjs';
import { addonRequirements } from './addons.mjs';
import { nextNumber } from '../workflow-number.mjs';
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

/** Resolve the absolute workflows directory under a project root. */
function workflowsDir(root) {
  return resolve(root, 'contextkit', 'memory', 'workflows');
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
 * @param {string} root project root (contains `contextkit/memory/workflows/`)
 * @param {string} slug workflow slug (must match SLUG_RE)
 * @param {{ profile: string, pattern?: (string|null), addons?: string[],
 *   plan?: (object|null), now: string, number?: string }} options
 * @returns {{ dir: string, number: string, slug: string, profile: string,
 *   pattern: (string|null), files: string[] }}
 * @throws {Error} on bad slug, unknown profile/pattern/add-on, or an existing folder
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

  const dir = workflowsDir(root);
  mkdirSync(dir, { recursive: true });
  const number = options.number ?? nextNumber(dir);
  const packDir = resolve(dir, `${number}-${slug}`);
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
