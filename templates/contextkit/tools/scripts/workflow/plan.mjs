/**
 * Plan model for the universal wave workflow engine (WF0035, ADR-0100 §Contracts).
 * Reads / normalizes / validates / mutates the `workflow-plan.json` machine
 * contract — the static execution topology (waves, tasks, gates, capacity).
 *
 * Status is NEVER stored here: it is a projection from `workflow-state.json`.
 * This module is the single canonical normalizer so two semantically-equal plans
 * serialize byte-identically (stable diffs, stable plan-hash).
 *
 * Pure core + io.mjs only. NO registry membership checks (registries are built in
 * parallel) — this validates STRUCTURE and direct reference existence, not whether
 * a profile/pattern name is registered.
 *
 * cycle detection: WAVE 2 dag.mjs owns it. Here we only validate that each
 * `dependsOn` names an existing wave/task — never that the dependency graph is
 * acyclic. Keep that seam clean.
 *
 * Zero runtime dependencies — node:* / io.mjs only (ADR-0001). Validators return
 * typed `{code,message,path}` errors and mutators throw fast on a refused state.
 */
import { sha256Hex, readJsonSafe, stableStringify, writeJsonStable } from './io.mjs';
import { validatePlan } from './validate.mjs';

export { validatePlan };

/** Execution modes a task may declare. Scheduler never slots a non-agent mode. */
export const EXECUTION_MODES = Object.freeze(['agent', 'deterministic', 'orchestrator', 'human']);

/** Profiles that REQUIRE ownership on an agent-mode task (validated, not resolved). */
export const OWNERSHIP_REQUIRED_PROFILES = Object.freeze(['standard', 'advanced', 'program']);

/** Default capacity ceiling filled when a plan omits `capacity`. */
const DEFAULT_CAPACITY = Object.freeze({
  maxConcurrentWaves: 1,
  maxConcurrentRuns: 1,
  maxAgentsPerRun: 5,
  maxTotalAgents: 5,
  orchestratorCountsAsAgent: false,
});

/** Top-level fields this module owns; everything else is preserved verbatim. */
const KNOWN_TOP_LEVEL = Object.freeze([
  'schemaVersion', 'workflowId', 'slug', 'title', 'profile', 'pattern', 'addons',
  'journey', 'capacity', 'executionPolicy', 'waves', 'gates', 'artifacts',
]);

/** Stable string-array: trim falsy, dedupe-preserving-first, sort for determinism. */
function sortedStrings(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length) seen.add(entry);
  }
  return [...seen].sort();
}

/** Normalize one task: deterministic field order, defaults, stably-ordered arrays. */
function normalizeTask(task) {
  const execution = task.execution && typeof task.execution === 'object' ? task.execution : {};
  const ownership = task.ownership && typeof task.ownership === 'object' ? task.ownership : {};
  return {
    id: task.id,
    waveId: task.waveId,
    title: task.title ?? '',
    priority: task.priority ?? 'P2',
    objective: task.objective ?? '',
    acceptance: Array.isArray(task.acceptance) ? [...task.acceptance] : [],
    dependsOn: sortedStrings(task.dependsOn),
    execution: {
      mode: execution.mode ?? 'agent',
      parallelizable: execution.parallelizable ?? false,
      agentSlots: typeof execution.agentSlots === 'number' ? execution.agentSlots : 0,
    },
    ownership: {
      allowedPaths: sortedStrings(ownership.allowedPaths),
      forbiddenPaths: sortedStrings(ownership.forbiddenPaths),
      readOnlyPaths: sortedStrings(ownership.readOnlyPaths),
      sharedPaths: sortedStrings(ownership.sharedPaths),
      integrationOwner: ownership.integrationOwner ?? 'orchestrator',
    },
    tests: sortedStrings(task.tests),
    artifacts: sortedStrings(task.artifacts),
    riskTags: sortedStrings(task.riskTags),
  };
}

/** Normalize one wave: deterministic field order, tasks sorted by id, defaults. */
function normalizeWave(wave) {
  const tasks = Array.isArray(wave.tasks) ? wave.tasks.map(normalizeTask) : [];
  tasks.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return {
    id: wave.id,
    title: wave.title ?? '',
    description: wave.description ?? '',
    type: wave.type ?? 'implementation',
    priority: wave.priority ?? 'P2',
    dependsOn: sortedStrings(wave.dependsOn),
    gate: wave.gate ?? null,
    executionStrategy: wave.executionStrategy ?? 'parallel',
    capacityOverride: wave.capacityOverride ?? null,
    tasks,
  };
}

/** Normalize one gate: stable field order + stably-ordered requirement list. */
function normalizeGate(gate) {
  return {
    id: gate.id,
    waveId: gate.waveId ?? null,
    type: gate.type ?? 'machine',
    requirements: sortedStrings(gate.requirements),
  };
}

/**
 * Return a canonical normalized plan: deterministic ordering (waves by id, tasks
 * by id within a wave, arrays stably ordered), defaults filled. Unknown TOP-LEVEL
 * fields are PRESERVED verbatim for forward-compat. Output round-trips stable.
 * @param {object} plan a raw or partial plan object
 * @returns {object} a new normalized plan (never mutates the input)
 * @throws {TypeError} when `plan` is not an object
 */
export function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('normalizePlan: plan must be an object');
  }
  const preserved = {};
  for (const key of Object.keys(plan)) {
    if (!KNOWN_TOP_LEVEL.includes(key)) preserved[key] = plan[key];
  }
  const waves = Array.isArray(plan.waves) ? plan.waves.map(normalizeWave) : [];
  waves.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const gates = Array.isArray(plan.gates) ? plan.gates.map(normalizeGate) : [];
  gates.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return {
    ...preserved,
    schemaVersion: plan.schemaVersion,
    workflowId: plan.workflowId,
    slug: plan.slug,
    title: plan.title ?? '',
    profile: plan.profile,
    pattern: plan.pattern ?? null,
    addons: sortedStrings(plan.addons),
    journey: plan.journey && typeof plan.journey === 'object' ? plan.journey : {},
    capacity: { ...DEFAULT_CAPACITY, ...(plan.capacity && typeof plan.capacity === 'object' ? plan.capacity : {}) },
    executionPolicy: plan.executionPolicy && typeof plan.executionPolicy === 'object' ? plan.executionPolicy : {},
    waves,
    gates,
    artifacts: sortedStrings(plan.artifacts),
  };
}

/**
 * Read a plan from disk and normalize it. Missing file → throws (a plan must
 * exist to be read); use `readJsonSafe` directly for optional reads.
 * @param {string} path absolute path to a `workflow-plan.json`
 * @returns {object} the normalized plan
 * @throws {Error} when the file is absent or not valid JSON
 */
export function readPlan(path) {
  const raw = readJsonSafe(path, null);
  if (raw === null) throw new Error(`readPlan: no readable plan at ${path}`);
  return normalizePlan(raw);
}

/**
 * Validate then atomically persist a plan (stable JSON, no mtime churn). A refused
 * plan never reaches disk (validator throws first — fail-fast).
 * @param {string} path absolute destination path
 * @param {object} plan the plan to persist (normalized internally)
 * @returns {{ changed: boolean }} whether a write occurred
 * @throws {Error} when the normalized plan fails validation
 */
export function writePlan(path, plan) {
  const normalized = normalizePlan(plan);
  const verdict = validatePlan(normalized);
  if (!verdict.valid) {
    const detail = verdict.errors.map((error) => `${error.code} @ ${error.path}: ${error.message}`).join('; ');
    throw new Error(`writePlan: refused invalid plan — ${detail}`);
  }
  return writeJsonStable(path, normalized);
}

/** Collect every wave id and task id in a normalized plan (for mutation guards). */
function collectIds(plan) {
  const waveIds = new Set(plan.waves.map((wave) => wave.id));
  const taskIds = new Set();
  for (const wave of plan.waves) {
    for (const task of wave.tasks) taskIds.add(task.id);
  }
  return { waveIds, taskIds };
}

/**
 * Add a wave and return a NEW normalized plan. Rejects a duplicate wave id or a
 * `dependsOn` that names a wave not present after insertion (fail-fast).
 * @param {object} plan the source plan
 * @param {object} wave the wave to add (id required)
 * @returns {object} a new normalized plan including `wave`
 * @throws {Error} on duplicate id or unknown dependency
 */
export function addWave(plan, wave) {
  const base = normalizePlan(plan);
  if (!wave || typeof wave.id !== 'string' || !wave.id.length) {
    throw new Error('addWave: wave.id is required');
  }
  const { waveIds } = collectIds(base);
  if (waveIds.has(wave.id)) throw new Error(`addWave: duplicate wave id "${wave.id}"`);
  for (const dep of sortedStrings(wave.dependsOn)) {
    if (!waveIds.has(dep)) throw new Error(`addWave: unknown wave dependency "${dep}"`);
  }
  return normalizePlan({ ...base, waves: [...base.waves, wave] });
}

/**
 * Add a task to an existing wave and return a NEW normalized plan. Rejects an
 * unknown wave, a globally-duplicate task id, or an unknown task dependency.
 * @param {object} plan the source plan
 * @param {string} waveId the target wave id (must exist)
 * @param {object} task the task to add (id required)
 * @returns {object} a new normalized plan including `task`
 * @throws {Error} on unknown wave, duplicate task id, or unknown dependency
 */
export function addTask(plan, waveId, task) {
  const base = normalizePlan(plan);
  if (!task || typeof task.id !== 'string' || !task.id.length) {
    throw new Error('addTask: task.id is required');
  }
  const { waveIds, taskIds } = collectIds(base);
  if (!waveIds.has(waveId)) throw new Error(`addTask: unknown wave "${waveId}"`);
  if (taskIds.has(task.id)) throw new Error(`addTask: duplicate task id "${task.id}"`);
  for (const dep of sortedStrings(task.dependsOn)) {
    if (!taskIds.has(dep)) throw new Error(`addTask: unknown task dependency "${dep}"`);
  }
  const waves = base.waves.map((wave) =>
    wave.id === waveId ? { ...wave, tasks: [...wave.tasks, { ...task, waveId }] } : wave,
  );
  return normalizePlan({ ...base, waves });
}

/**
 * Stable sha-256 hash of the normalized plan — the plan-hash the state guard
 * binds a `workflow-state.json` to (a state write against a changed plan is
 * rejected until reconciled).
 * @param {object} plan any plan (normalized internally)
 * @returns {string} 64-char hex digest
 */
export function planHash(plan) {
  return sha256Hex(stableStringify(normalizePlan(plan), 0));
}
