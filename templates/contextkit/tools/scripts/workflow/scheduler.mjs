/**
 * Deterministic scheduler — pure dispatch calculation for the wave engine.
 *
 * `computeSchedule(plan, state)` reads a normalized plan plus machine-owned state
 * and answers ONE question: which waves are ready, which are blocked, and exactly
 * which agent tasks dispatch into which runs/slots — under the capacity ceiling
 * and ownership rules. It allocates nothing, spawns nothing, writes nothing.
 *
 * Cohesion note: wave readiness, execution-mode filtering, ownership pruning and
 * capacity-bounded run packing form one cohesive dispatch calculation over the
 * same plan/state shapes; splitting them would scatter the capacity ceiling
 * across a seam with no second consumer. Kept together (constitution §1).
 *
 * Graph math is delegated to ./dag.mjs and collision detection to ./ownership.mjs
 * — never reimplemented here. Fully pure and deterministic: same inputs ⇒
 * byte-identical output. No Date.now / Math.random; the run counter derives from
 * `state.runs.length`.
 *
 * @module workflow/scheduler
 */
import { readyNodes, blockedNodes } from './dag.mjs';
import { detectCollisions } from './ownership.mjs';

/** Priority rank for deterministic ordering (P0 highest → smallest rank). */
const PRIORITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });

/** Statuses that count a wave or task as completed for dependency satisfaction. */
const DONE_STATUSES = new Set(['completed', 'done', 'passed', 'approved']);

/** Gate verdicts that count a gate as satisfied (anything else ⇒ unsatisfied). */
const GATE_PASS_STATUSES = new Set(['passed', 'approved', 'satisfied', 'green']);

/**
 * Rank a `Pn` priority string; unknown/missing priorities sort after P3.
 * @param {string} priority a `P0..P3` tag
 * @returns {number} numeric rank (lower wins)
 */
function priorityRank(priority) {
  const rank = PRIORITY_RANK[priority];
  return typeof rank === 'number' ? rank : PRIORITY_RANK.P3 + 1;
}

/**
 * Stable comparator on `(priority, id)` for waves or tasks.
 * @param {{id:string, priority?:string}} left first item
 * @param {{id:string, priority?:string}} right second item
 * @returns {number} negative when `left` sorts first
 */
function byPriorityThenId(left, right) {
  const delta = priorityRank(left.priority) - priorityRank(right.priority);
  return delta !== 0 ? delta : String(left.id).localeCompare(String(right.id));
}

/**
 * Whether a state status entry counts as completed.
 * @param {object} states a `waveStates` or `taskStates` map
 * @param {string} id the wave/task id
 * @returns {boolean} true when the recorded status is a done status
 */
function isDone(states, id) {
  const entry = states && typeof states === 'object' ? states[id] : null;
  return Boolean(entry && DONE_STATUSES.has(entry.status));
}

/**
 * Whether a wave's gate (if any) is satisfied in state. A wave with no gate is
 * trivially satisfied; a gate without a recorded pass verdict is NOT satisfied
 * (default-refuse — a dependent wave stays blocked until its predecessor's gate
 * passes).
 * @param {object} wave the wave whose gate to check
 * @param {object} state the workflow state
 * @returns {boolean} true when the wave imposes no unmet gate
 */
function gateSatisfied(wave, state) {
  const gateId = wave && wave.gate ? wave.gate : null;
  if (!gateId) return true;
  const results = state && typeof state.gateResults === 'object' ? state.gateResults : {};
  const verdict = results[gateId];
  if (typeof verdict === 'string') {
    return GATE_PASS_STATUSES.has(verdict);
  }
  return Boolean(verdict && GATE_PASS_STATUSES.has(verdict.status));
}

/**
 * Build the two completion sets used by readiness math: `selfDone` (completed in
 * state — removed from ready candidates, a finished wave never re-dispatches) and
 * `depSatisfied` (completed AND gate satisfied — the only waves that UNLOCK
 * dependents; a downstream wave cannot start while an upstream gate is pending).
 * @param {object[]} waves the plan waves
 * @param {object} state the workflow state
 * @returns {{selfDone:Set<string>, depSatisfied:Set<string>}}
 */
function completionSets(waves, state) {
  const states = state && typeof state.waveStates === 'object' ? state.waveStates : {};
  const selfDone = new Set();
  const depSatisfied = new Set();
  for (const wave of waves) {
    if (!isDone(states, wave.id)) continue;
    selfDone.add(wave.id);
    if (gateSatisfied(wave, state)) depSatisfied.add(wave.id);
  }
  return { selfDone, depSatisfied };
}

/**
 * Resolve the effective capacity ceiling, tolerating a missing `capacity` block.
 * @param {object} plan a normalized plan
 * @returns {{maxConcurrentWaves:number, maxConcurrentRuns:number, maxAgentsPerRun:number, maxTotalAgents:number}}
 */
function capacityOf(plan) {
  const cap = plan && typeof plan.capacity === 'object' ? plan.capacity : {};
  const positive = (value, fallback) =>
    typeof value === 'number' && value > 0 ? Math.floor(value) : fallback;
  return {
    maxConcurrentWaves: positive(cap.maxConcurrentWaves, 1),
    maxConcurrentRuns: positive(cap.maxConcurrentRuns, 1),
    maxAgentsPerRun: positive(cap.maxAgentsPerRun, 5),
    maxTotalAgents: positive(cap.maxTotalAgents, 5),
  };
}

/**
 * Whether a task is dispatchable to an agent slot: agent-mode AND every task-level
 * dependency completed in state.
 * @param {object} task a normalized task
 * @param {object} taskStates the state `taskStates` map
 * @returns {boolean}
 */
function taskReady(task, taskStates) {
  if (!task || !task.execution || task.execution.mode !== 'agent') return false;
  if (isDone(taskStates, task.id)) return false;
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  return deps.every((dep) => isDone(taskStates, dep));
}

/**
 * Partition a ready wave's tasks into agent-dispatch candidates, human/other
 * actions, and dependency-deferred tasks. Pure; does not consult capacity.
 * @param {object} wave a ready wave
 * @param {object} taskStates the state `taskStates` map
 * @returns {{candidates:object[], humanActions:object[], deferred:object[]}}
 */
function classifyWaveTasks(wave, taskStates) {
  const tasks = Array.isArray(wave.tasks) ? [...wave.tasks].sort(byPriorityThenId) : [];
  const candidates = [];
  const humanActions = [];
  const deferred = [];
  for (const task of tasks) {
    if (isDone(taskStates, task.id)) continue;
    const mode = task.execution ? task.execution.mode : 'agent';
    if (mode !== 'agent') {
      humanActions.push({ taskId: task.id, waveId: wave.id, mode });
      continue;
    }
    if (taskReady(task, taskStates)) candidates.push(task);
    else deferred.push({ taskId: task.id, reason: 'unmet task dependencies' });
  }
  return { candidates, humanActions, deferred };
}

/**
 * Drop candidate tasks that collide on ownership, recording a deferral reason.
 * Uses ownership.detectCollisions; the lexicographically-later task in a colliding
 * pair is deferred so the survivor is deterministic.
 * @param {object[]} candidates agent-dispatch candidate tasks
 * @returns {{kept:object[], conflicts:object[], deferred:object[]}}
 */
function pruneOwnershipCollisions(candidates) {
  const collisions = detectCollisions(candidates);
  const losers = new Set();
  const conflicts = [];
  for (const collision of collisions) {
    losers.add(collision.taskA === collision.taskB ? collision.taskA : collision.taskB);
    conflicts.push(collision);
  }
  const kept = candidates.filter((task) => !losers.has(task.id));
  const deferred = [...losers].sort().map((taskId) => ({ taskId, reason: 'ownership collision' }));
  return { kept, conflicts, deferred };
}

/**
 * Format a run id `RUN-<nnn>-<A|B|...>`. The numeric batch is derived from the
 * existing run count (`state.runs.length`); the letter distinguishes parallel
 * runs within THIS schedule call. Deterministic — no clock/random.
 * @param {number} baseCounter existing run count (state.runs.length)
 * @param {number} ordinal zero-based index of this run within the batch
 * @returns {string} the run id
 */
function runIdFor(baseCounter, ordinal) {
  const numeric = String(baseCounter + 1).padStart(3, '0');
  const suffix = String.fromCharCode(65 + (ordinal % 26));
  return `RUN-${numeric}-${suffix}`;
}

/**
 * Pack ready agent tasks into capacity-bounded dispatch runs. Respects
 * maxAgentsPerRun (slots/run), maxConcurrentRuns (runs/batch) and maxTotalAgents
 * (global ceiling). Tasks beyond the ceiling are returned as deferred. No
 * over-allocation: never opens a run with zero assignments.
 * @param {{tasks:object[], waveId:string}[]} readyWaveTasks per-wave ready tasks
 * @param {object} capacity the effective ceiling
 * @param {number} baseCounter existing run count for stable run ids
 * @returns {{dispatches:object[], deferred:object[]}}
 */
function packRuns(readyWaveTasks, capacity, baseCounter) {
  const dispatches = [];
  const deferred = [];
  let totalAssigned = 0;
  let runOrdinal = 0;

  for (const { tasks, waveId } of readyWaveTasks) {
    let cursor = 0;
    while (cursor < tasks.length) {
      const remainingGlobal = capacity.maxTotalAgents - totalAssigned;
      const runsLeft = capacity.maxConcurrentRuns - runOrdinal;
      if (remainingGlobal <= 0 || runsLeft <= 0) break;
      const slots = Math.min(capacity.maxAgentsPerRun, remainingGlobal, tasks.length - cursor);
      const runId = runIdFor(baseCounter, runOrdinal);
      const assignments = [];
      for (let slot = 0; slot < slots; slot += 1) {
        const task = tasks[cursor + slot];
        const agentSlot = `${runId}${String(slot + 1).padStart(2, '0')}`;
        assignments.push({ taskId: task.id, agentSlot });
      }
      dispatches.push({ runId, waveId, assignments });
      totalAssigned += slots;
      runOrdinal += 1;
      cursor += slots;
    }
    for (let leftover = cursor; leftover < tasks.length; leftover += 1) {
      deferred.push({ taskId: tasks[leftover].id, reason: 'capacity ceiling reached' });
    }
  }
  return { dispatches, deferred };
}

/**
 * Compute the deterministic schedule for a plan + state. Pure: reads only its
 * arguments, returns the scheduler output shape (spec §11), writes nothing.
 *
 * @param {object} plan a normalized `workflow-plan.json` object
 * @param {object} [state] the `workflow-state.json` object (defaults to empty)
 * @returns {{status:string, readyWaves:string[], blockedWaves:{id:string,blockedBy:string[]}[], dispatches:object[], deferredTasks:object[], ownershipConflicts:object[], humanActions:object[]}}
 * @throws {TypeError} when `plan` is not an object with a `waves` array
 */
export function computeSchedule(plan, state = {}) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.waves)) {
    throw new TypeError('computeSchedule: plan must be an object with a waves array');
  }
  const waves = plan.waves;
  const taskStates = state && typeof state.taskStates === 'object' ? state.taskStates : {};
  const capacity = capacityOf(plan);
  const baseCounter = Array.isArray(state.runs) ? state.runs.length : 0;

  const { selfDone, depSatisfied } = completionSets(waves, state);
  const waveNodes = waves.map((wave) => ({ id: wave.id, dependsOn: wave.dependsOn || [] }));
  // Gate-aware completion (depSatisfied), then drop finished waves so a completed
  // wave behind a pending gate is neither ready nor reported blocked.
  const readyWaveIds = readyNodes(waveNodes, depSatisfied).filter((id) => !selfDone.has(id));
  const blockedWaves = blockedNodes(waveNodes, depSatisfied).filter((blocked) => !selfDone.has(blocked.id));

  const wavesById = new Map(waves.map((wave) => [wave.id, wave]));
  const orderedReady = readyWaveIds
    .map((id) => wavesById.get(id))
    .filter(Boolean)
    .sort(byPriorityThenId);
  const dispatchedWaves = orderedReady.slice(0, capacity.maxConcurrentWaves);

  const deferredTasks = [];
  const ownershipConflicts = [];
  const humanActions = [];
  const readyWaveTasks = [];

  for (const wave of dispatchedWaves) {
    const classified = classifyWaveTasks(wave, taskStates);
    humanActions.push(...classified.humanActions);
    deferredTasks.push(...classified.deferred);
    const pruned = pruneOwnershipCollisions(classified.candidates);
    ownershipConflicts.push(...pruned.conflicts);
    deferredTasks.push(...pruned.deferred);
    if (pruned.kept.length > 0) {
      readyWaveTasks.push({ waveId: wave.id, tasks: pruned.kept });
    }
  }

  const packed = packRuns(readyWaveTasks, capacity, baseCounter);
  deferredTasks.push(...packed.deferred);

  deferredTasks.sort((left, right) => String(left.taskId).localeCompare(String(right.taskId)));
  humanActions.sort((left, right) => String(left.taskId).localeCompare(String(right.taskId)));

  const status = packed.dispatches.length > 0 ? 'ready' : 'idle';
  return {
    status,
    readyWaves: dispatchedWaves.map((wave) => wave.id),
    blockedWaves,
    dispatches: packed.dispatches,
    deferredTasks,
    ownershipConflicts,
    humanActions,
  };
}
