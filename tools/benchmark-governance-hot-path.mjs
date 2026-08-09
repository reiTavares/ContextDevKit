/**
 * WF-0111 W04 — non-gating hot-path benchmark.
 *
 * This script reports ADR-0158 targets but intentionally never fails on timing:
 * correctness is covered by integration-test-governance-anti-loop.mjs, while
 * host scheduling and CI contention must not create flaky acceptance failures.
 */
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_EVENT_BUDGET_MS,
  createGovernanceEventRuntime,
} from '../templates/contextkit/runtime/governance/event-runtime.mjs';

const requestedIterations = Number(process.argv.find((argument) => argument.startsWith('--iterations='))?.split('=')[1]);
const iterations = Number.isInteger(requestedIterations) && requestedIterations >= 20
  ? requestedIterations
  : 500;

/** @param {number[]} samples @param {number} percentile @returns {number} */
function percentileMilliseconds(samples, percentile) {
  const orderedSamples = [...samples].sort((left, right) => left - right);
  const index = Math.min(orderedSamples.length - 1, Math.ceil(percentile * orderedSamples.length) - 1);
  return orderedSamples[index] ?? 0;
}

/**
 * Measures asynchronous work without adding filesystem or process noise.
 * @param {number} count
 * @param {(index:number)=>Promise<unknown>} operation
 * @returns {Promise<number[]>}
 */
async function measure(count, operation) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now();
    await operation(index);
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

/** @param {string} sessionId @param {string|number} revision @param {object[]} gates @returns {object} */
function eventInput(sessionId, revision, gates) {
  return {
    moment: 'write-preflight',
    root: process.cwd(),
    env: {},
    payload: { sessionId, workItemId: 'benchmark-work', revision, gates },
  };
}

const warmRuntime = createGovernanceEventRuntime({ resolveGatePlan: () => ({ gates: [] }) });
const noOpSamples = await measure(iterations, (index) => warmRuntime.dispatch({
  ...eventInput('benchmark-no-op', index, undefined),
  moment: 'prompt-preflight',
}));
const hotMutationSamples = await measure(iterations, (index) => warmRuntime.dispatch(eventInput(
  'benchmark-hot',
  index,
  [{ id: 'benchmark-gate', evaluate: () => ({ decision: 'silent' }) }],
)));
const coldSampleCount = Math.max(20, Math.floor(iterations / 10));
const coldMutationSamples = await measure(coldSampleCount, (index) => {
  const coldRuntime = createGovernanceEventRuntime();
  return coldRuntime.dispatch(eventInput(
    `benchmark-cold-${index}`,
    1,
    [{ id: 'benchmark-gate', evaluate: () => ({ decision: 'silent' }) }],
  ));
});

const report = {
  schemaVersion: 'governance-hot-path-benchmark/1',
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  iterations: { noOp: iterations, hotMutation: iterations, coldMutation: coldSampleCount },
  targetsMs: {
    conversationExplorationP95: 75,
    hotMutationP95: 300,
    coldMutationMaximum: 1_000,
    aggregateEventBudget: DEFAULT_EVENT_BUDGET_MS,
  },
  measurementsMs: {
    conversationExplorationP95: percentileMilliseconds(noOpSamples, 0.95),
    hotMutationP95: percentileMilliseconds(hotMutationSamples, 0.95),
    coldMutationMaximum: Math.max(...coldMutationSamples),
  },
};
report.observedTargets = {
  conversationExploration: report.measurementsMs.conversationExplorationP95 < report.targetsMs.conversationExplorationP95,
  hotMutation: report.measurementsMs.hotMutationP95 < report.targetsMs.hotMutationP95,
  coldMutation: report.measurementsMs.coldMutationMaximum < report.targetsMs.coldMutationMaximum,
};
report.enforced = false;
report.note = 'Timing is observational and non-gating; correctness failures belong to the integration suite.';

console.log(JSON.stringify(report, null, 2));
