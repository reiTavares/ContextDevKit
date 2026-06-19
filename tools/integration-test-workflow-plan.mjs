/**
 * Integration test for the plan model (WF0035, W1-T2). Drives plan.mjs +
 * validate.mjs: normalize/validate on Basic / Standard / Program plans, the
 * documented rejection cases, round-trip stability, and unknown-field
 * preservation. Standalone runnable: `node tools/integration-test-workflow-plan.mjs`.
 *
 * Zero runtime deps — node:* + the kit's own modules only (ADR-0001).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';
import { readJsonSafe, stableStringify } from '../templates/contextkit/tools/scripts/workflow/io.mjs';
import {
  addTask,
  addWave,
  normalizePlan,
  planHash,
  validatePlan,
} from '../templates/contextkit/tools/scripts/workflow/plan.mjs';
import { validatePack } from '../templates/contextkit/tools/scripts/workflow/validate.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();

/** A minimal but valid agent task in a given wave. */
function task(id, waveId, extra = {}) {
  return {
    id, waveId, title: id, priority: 'P0', objective: 'do', acceptance: ['a'],
    dependsOn: [], execution: { mode: 'agent', parallelizable: true, agentSlots: 1 },
    ownership: { allowedPaths: [`src/${id}.mjs`], forbiddenPaths: [], sharedPaths: [], integrationOwner: 'orchestrator' },
    tests: [], artifacts: [], riskTags: [], ...extra,
  };
}

/** A one-wave Basic plan (no profile ownership requirement). */
function basicPlan() {
  return {
    schemaVersion: 1, workflowId: '0001', slug: 'basic', title: 'Basic', profile: 'basic',
    waves: [{ id: 'W1', title: 'Only', type: 'implementation', priority: 'P0', dependsOn: [], gate: null, executionStrategy: 'parallel', tasks: [task('W1-T1', 'W1')] }],
    gates: [], artifacts: [],
  };
}

/** A four-wave Standard plan with a gate and cross-wave deps. */
function standardPlan() {
  const waves = ['W1', 'W2', 'W3', 'W4'].map((id, idx) => ({
    id, title: id, type: 'implementation', priority: 'P0',
    dependsOn: idx === 0 ? [] : [`W${idx}`], gate: id === 'W4' ? 'G-W4' : null,
    executionStrategy: 'parallel', tasks: [task(`${id}-T1`, id)],
  }));
  return {
    schemaVersion: 1, workflowId: '0002', slug: 'standard', title: 'Standard', profile: 'standard',
    waves, gates: [{ id: 'G-W4', waveId: 'W4', type: 'machine', requirements: ['green'] }], artifacts: [],
  };
}

/** A ~10-wave Program plan with cross-wave task dependencies. */
function programPlan() {
  const waves = [];
  for (let index = 0; index < 10; index += 1) {
    const id = `W${index}`;
    const tasks = [task(`${id}-T1`, id), task(`${id}-T2`, id, { dependsOn: [`${id}-T1`] })];
    waves.push({ id, title: id, type: 'implementation', priority: 'P0', dependsOn: index === 0 ? [] : [`W${index - 1}`], gate: `G-${id}`, executionStrategy: 'parallel', tasks });
  }
  const gates = waves.map((wave) => ({ id: `G-${wave.id}`, waveId: wave.id, type: 'machine', requirements: ['green'] }));
  return { schemaVersion: 1, workflowId: '0003', slug: 'program', title: 'Program', profile: 'program', waves, gates, artifacts: [] };
}

/** Assert that a plan normalizes + validates clean. */
function expectValid(label, plan) {
  const normalized = normalizePlan(plan);
  const verdict = validatePlan(normalized);
  verdict.valid ? rep.ok(`${label} validates clean`) : rep.bad(`${label} unexpectedly invalid: ${JSON.stringify(verdict.errors)}`);
  return normalized;
}

/** Assert that validatePlan rejects with the expected error code. */
function expectRejected(label, plan, code) {
  const verdict = validatePlan(normalizePlan(plan));
  const hit = !verdict.valid && verdict.errors.some((error) => error.code === code);
  hit ? rep.ok(`${label} rejected (${code})`) : rep.bad(`${label} should reject with ${code}, got ${JSON.stringify(verdict.errors)}`);
}

// --- Positive: the three pattern tiers normalize + validate ------------------
const basicNorm = expectValid('Basic one-wave plan', basicPlan());
const standardNorm = expectValid('Standard four-wave plan', standardPlan());
const programNorm = expectValid('Program ten-wave DAG plan', programPlan());

// --- Round-trip stability: normalize twice → byte-identical -------------------
for (const [label, plan] of [['Basic', basicNorm], ['Standard', standardNorm], ['Program', programNorm]]) {
  const once = stableStringify(plan);
  const twice = stableStringify(normalizePlan(JSON.parse(JSON.stringify(plan))));
  once === twice ? rep.ok(`${label} round-trips stable`) : rep.bad(`${label} not stable across normalize`);
}

// --- planHash is deterministic for logically-equal plans ---------------------
planHash(basicPlan()) === planHash(basicNorm)
  ? rep.ok('planHash stable for equal plans')
  : rep.bad('planHash differs for logically-equal plans');

// --- Unknown top-level field preserved through normalize ----------------------
const withUnknown = normalizePlan({ ...basicPlan(), experimentalFlag: { keep: true } });
withUnknown.experimentalFlag && withUnknown.experimentalFlag.keep === true
  ? rep.ok('unknown top-level field preserved')
  : rep.bad('unknown top-level field was dropped');

// --- Defaults filled ----------------------------------------------------------
withUnknown.capacity && withUnknown.capacity.maxAgentsPerRun === 5 && Array.isArray(withUnknown.addons)
  ? rep.ok('capacity + array defaults filled')
  : rep.bad('defaults not filled on normalize');

// --- Rejection cases ----------------------------------------------------------
expectRejected('missing schemaVersion', { ...basicPlan(), schemaVersion: 2 }, 'invalid-schema-version');
expectRejected('missing slug', { ...basicPlan(), slug: '' }, 'missing-field');

const dupWave = basicPlan();
dupWave.waves.push({ id: 'W1', title: 'dup', dependsOn: [], gate: null, tasks: [] });
expectRejected('duplicate wave id', dupWave, 'duplicate-wave-id');

const dupTask = standardPlan();
dupTask.waves[1].tasks.push(task('W1-T1', 'W2'));
expectRejected('duplicate task id (global)', dupTask, 'duplicate-task-id');

const badWaveDep = basicPlan();
badWaveDep.waves[0].dependsOn = ['W9'];
expectRejected('unknown wave dependency', badWaveDep, 'unknown-dependency');

const badTaskDep = basicPlan();
badTaskDep.waves[0].tasks[0].dependsOn = ['W9-T9'];
expectRejected('unknown task dependency', badTaskDep, 'unknown-dependency');

const badMode = basicPlan();
badMode.waves[0].tasks[0].execution.mode = 'wizard';
expectRejected('unknown execution mode', badMode, 'invalid-mode');

const badGate = basicPlan();
badGate.waves[0].gate = 'G-NOPE';
expectRejected('unknown gate reference', badGate, 'unknown-gate');

const taskWaveMismatch = basicPlan();
taskWaveMismatch.waves[0].tasks[0].waveId = 'W9';
expectRejected('task waveId mismatch', taskWaveMismatch, 'task-wave-mismatch');

const noOwnership = standardPlan();
noOwnership.waves[0].tasks[0].ownership = { allowedPaths: [] };
expectRejected('agent task missing ownership (standard)', noOwnership, 'missing-ownership');

// --- Mutations: addWave / addTask -------------------------------------------
const grown = addWave(basicPlan(), { id: 'W2', title: 'Second', dependsOn: ['W1'], gate: null, executionStrategy: 'parallel', tasks: [] });
grown.waves.length === 2 ? rep.ok('addWave appends + normalizes') : rep.bad('addWave failed to append');

let threw = false;
try { addWave(grown, { id: 'W1' }); } catch { threw = true; }
threw ? rep.ok('addWave rejects duplicate id') : rep.bad('addWave allowed a duplicate wave id');

const withTask = addTask(grown, 'W2', task('W2-T1', 'W2'));
withTask.waves.find((wave) => wave.id === 'W2').tasks.length === 1
  ? rep.ok('addTask appends to target wave')
  : rep.bad('addTask failed to append');

threw = false;
try { addTask(grown, 'W9', task('X-T1', 'W9')); } catch { threw = true; }
threw ? rep.ok('addTask rejects unknown wave') : rep.bad('addTask allowed an unknown wave');

threw = false;
try { addTask(withTask, 'W2', { id: 'W2-T1', waveId: 'W2', dependsOn: [] }); } catch { threw = true; }
threw ? rep.ok('addTask rejects duplicate task id') : rep.bad('addTask allowed a duplicate task id');

threw = false;
try { addTask(withTask, 'W2', { id: 'W2-T9', waveId: 'W2', dependsOn: ['NOPE-T1'] }); } catch { threw = true; }
threw ? rep.ok('addTask rejects unknown task dependency') : rep.bad('addTask allowed an unknown task dependency');

// --- validatePack composes plan validation -----------------------------------
validatePack({ plan: basicNorm }).valid && !validatePack({ plan: normalizePlan(dupWave) }).valid
  ? rep.ok('validatePack composes plan validation')
  : rep.bad('validatePack did not reflect plan validity');

// --- Dogfood fixture as a positive case --------------------------------------
const dogfoodPath = join(ROOT, 'contextkit', 'memory', 'workflows', '0035-universal-wave-workflow-engine', 'workflow-plan.json');
const dogfood = readJsonSafe(dogfoodPath, null);
if (dogfood === null) {
  rep.bad(`dogfood fixture not readable at ${dogfoodPath}`);
} else {
  const verdict = validatePlan(normalizePlan(dogfood));
  verdict.valid ? rep.ok('dogfood workflow-plan.json validates clean') : rep.bad(`dogfood plan invalid: ${JSON.stringify(verdict.errors)}`);
  const once = stableStringify(normalizePlan(dogfood));
  const twice = stableStringify(normalizePlan(JSON.parse(once)));
  once === twice ? rep.ok('dogfood plan round-trips stable') : rep.bad('dogfood plan not stable across normalize');
}

rep.finish('workflow-plan');
