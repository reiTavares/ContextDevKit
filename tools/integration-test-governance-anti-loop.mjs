/**
 * WF-0111 W04 — correctness tests for event deduplication, recursion guards,
 * bounded execution, session circuit breaking, and visible-message suppression.
 * Performance targets live in benchmark-governance-hot-path.mjs so slow CI
 * machines cannot turn timing variance into correctness failures.
 */
import { reporter } from './it-helpers.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EVENT_BUDGET_MS,
  MAX_EVENT_BUDGET_MS,
  MAX_GATE_TIMEOUT_MS,
  createGovernanceEventRuntime,
  dispatchGovernanceEvent,
} from '../templates/contextkit/runtime/governance/event-runtime.mjs';
import { createSessionCircuitBreaker } from '../templates/contextkit/runtime/governance/circuit-breaker.mjs';
import { createGateDedupKey } from '../templates/contextkit/runtime/governance/dedup-cache.mjs';

if (process.argv.includes('--cross-process-worker')) {
  const payload = JSON.parse(process.env.CDK_GOVERNANCE_WORKER_PAYLOAD ?? '{}');
  const response = await dispatchGovernanceEvent({
    moment: process.env.CDK_GOVERNANCE_WORKER_MOMENT,
    root: process.env.CDK_GOVERNANCE_WORKER_ROOT,
    env: process.env,
    payload,
  });
  process.stdout.write(JSON.stringify(response));
  process.exit(0);
}

const rep = reporter();
const eventInput = (payload = {}, overrides = {}) => ({
  moment: 'write-preflight',
  root: process.cwd(),
  env: {},
  payload: {
    sessionId: 'session-1',
    workItemId: 'work-1',
    revision: '1',
    ...payload,
  },
  ...overrides,
});

/** @param {string} name @param {()=>unknown|Promise<unknown>} check */
async function verify(name, check) {
  try {
    const passed = await check();
    passed ? rep.ok(name) : rep.bad(name);
  } catch (error) {
    rep.bad(`${name}: ${error?.stack ?? error}`);
  }
}

await verify('dedup key preserves all five identity dimensions without delimiter collisions', () => {
  const first = createGateDedupKey({ sessionId: 'a|b', workItemId: 'c', revision: 1, gateId: 'd', moment: 'completion' });
  const second = createGateDedupKey({ sessionId: 'a', workItemId: 'b|c', revision: 1, gateId: 'd', moment: 'completion' });
  return first !== second && JSON.parse(first).length === 5;
});

await verify('same gate/revision/moment evaluates once; a new revision evaluates again', async () => {
  let evaluationCount = 0;
  const runtime = createGovernanceEventRuntime();
  const gates = [{ id: 'qa-signoff', evaluate: () => {
    evaluationCount += 1;
    return { decision: 'warn', reasonCode: 'QA_PENDING', message: 'QA is pending.' };
  } }];
  const first = await runtime.dispatch(eventInput({ gates }));
  const duplicate = await runtime.dispatch(eventInput({ gates }));
  const nextRevision = await runtime.dispatch(eventInput({ gates, revision: '2' }));
  return evaluationCount === 2
    && first.evaluations[0]?.status === 'evaluated'
    && duplicate.status === 'deduplicated'
    && nextRevision.evaluations[0]?.status === 'evaluated';
});

await verify('internal execution cannot re-enqueue governance', async () => {
  const runtime = createGovernanceEventRuntime();
  let nestedResponse;
  let evaluationCount = 0;
  const gates = [{ id: 'technical-debt', evaluate: async (context) => {
    evaluationCount += 1;
    nestedResponse = await runtime.dispatch(eventInput({ gates, revision: 'nested' }, { env: context.env }));
    return { decision: 'silent' };
  } }];
  const outerResponse = await runtime.dispatch(eventInput({ gates, sessionId: 'session-internal' }));
  return outerResponse.status === 'completed'
    && evaluationCount === 1
    && nestedResponse?.status === 'internal'
    && nestedResponse?.allowed === true;
});

await verify('gate timeout aborts cooperatively and releases the operation', async () => {
  const runtime = createGovernanceEventRuntime();
  let aborted = false;
  const gates = [{ id: 'slow-gate', evaluate: (_context, { signal }) => new Promise(() => {
    signal.addEventListener('abort', () => { aborted = true; }, { once: true });
  }) }];
  const response = await runtime.dispatch(eventInput({ gates, timeoutMs: 10, sessionId: 'session-timeout' }));
  return aborted
    && response.allowed === true
    && response.evaluations[0]?.status === 'timed-out'
    && response.diagnostics.some((diagnostic) => diagnostic.code === 'GATE_TIMEOUT');
});

await verify('aggregate event budget is bounded and stops remaining evaluations', async () => {
  let monotonicNow = 0;
  let evaluationCount = 0;
  const runtime = createGovernanceEventRuntime({ now: () => monotonicNow });
  const gates = ['one', 'two', 'three'].map((id) => ({ id, evaluate: () => {
    evaluationCount += 1;
    monotonicNow += 30;
    return { decision: 'silent' };
  } }));
  const response = await runtime.dispatch(eventInput({ gates, budgetMs: 50, timeoutMs: 50, sessionId: 'session-budget' }));
  return evaluationCount === 2
    && response.status === 'budget-exhausted'
    && response.budget.exhausted === true
    && response.evaluations.at(-1)?.gateId === 'three';
});

await verify('session circuit opens after bounded failures and never blocks work', async () => {
  const runtime = createGovernanceEventRuntime({ failureThreshold: 2 });
  let attempted = 0;
  const gates = ['broken-a', 'broken-b', 'never-runs'].map((id) => ({ id, evaluate: () => {
    attempted += 1;
    throw new Error(`failure:${id}`);
  } }));
  const first = await runtime.dispatch(eventInput({ gates, sessionId: 'session-circuit' }));
  const next = await runtime.dispatch(eventInput({ gates, sessionId: 'session-circuit', revision: '2' }));
  return attempted === 2
    && first.allowed === true
    && first.status === 'circuit-open'
    && next.allowed === true
    && next.status === 'circuit-open';
});

await verify('equivalent visible problem appears once across revisions', async () => {
  const runtime = createGovernanceEventRuntime();
  const gates = [{ id: 'architecture-debt', evaluate: () => ({
    decision: 'warn', problemKey: 'same-architecture-risk', message: 'Review this architecture risk.',
  }) }];
  const first = await runtime.dispatch(eventInput({ gates, sessionId: 'session-message' }));
  const nextRevision = await runtime.dispatch(eventInput({ gates, sessionId: 'session-message', revision: '2' }));
  return first.messages.length === 1 && nextRevision.messages.length === 0;
});

await verify('canonical policy seam consumes observation by evaluatorId', async () => {
  let observedStatus = null;
  const runtime = createGovernanceEventRuntime({
    resolveGatePlan: () => ({
      policyVersion: 'governance/4', policyHash: 'hash', failurePolicy: 'continue',
      gates: [{ id: 'qa-signoff', evaluatorId: 'qa-evidence', mode: 'guarded' }],
    }),
    evaluateGateObservation: ({ observation }) => {
      observedStatus = observation.status;
      return { decision: 'deny', reasonCode: 'QA_FAILED', message: 'QA failed.' };
    },
  });
  const response = await runtime.dispatch(eventInput({
    sessionId: 'session-observation',
    observations: { 'qa-evidence': { status: 'violated', deterministic: true, applicable: true, evidenced: true } },
  }));
  return observedStatus === 'violated'
    && response.allowed === false
    && response.policy.version === 'governance/4'
    && response.messages.length === 1;
});

await verify('message rendering failure is contained and retry is deduplicated', async () => {
  let evaluationCount = 0;
  const runtime = createGovernanceEventRuntime();
  const gates = [{ id: 'renderer', evaluate: () => {
    evaluationCount += 1;
    const verdict = { decision: 'warn', problemKey: 'renderer-problem' };
    Object.defineProperty(verdict, 'visibleMessage', { get() { throw new Error('renderer failed'); } });
    return verdict;
  } }];
  const first = await runtime.dispatch(eventInput({ gates, sessionId: 'session-renderer' }));
  const retry = await runtime.dispatch(eventInput({ gates, sessionId: 'session-renderer' }));
  return evaluationCount === 1
    && first.allowed === true
    && first.diagnostics.some((diagnostic) => diagnostic.code === 'MESSAGE_RENDER_FAILURE')
    && retry.status === 'deduplicated';
});

await verify('invalid context and explicit internal marker fail open without evaluation', async () => {
  let evaluationCount = 0;
  const runtime = createGovernanceEventRuntime();
  const gates = [{ id: 'must-not-run', evaluate: () => { evaluationCount += 1; return { decision: 'deny' }; } }];
  const invalid = await runtime.dispatch(eventInput({ gates, revision: null }));
  const internal = await runtime.dispatch(eventInput({ gates }, { env: { CONTEXTKIT_INTERNAL: '1' } }));
  return evaluationCount === 0
    && invalid.status === 'invalid-context'
    && invalid.allowed === true
    && internal.status === 'internal'
    && internal.allowed === true;
});

await verify('configured budgets are clamped to immutable runtime maxima', async () => {
  const runtime = createGovernanceEventRuntime({ resolveGatePlan: () => ({ gates: [] }) });
  const response = await runtime.dispatch(eventInput({ budgetMs: 60_000, timeoutMs: 60_000, sessionId: 'session-caps' }));
  return response.budget.limitMs === MAX_EVENT_BUDGET_MS
    && DEFAULT_EVENT_BUDGET_MS === MAX_EVENT_BUDGET_MS
    && MAX_GATE_TIMEOUT_MS < MAX_EVENT_BUDGET_MS;
});

await verify('circuit breaker validates its threshold and is scoped by session', () => {
  let refusedInvalidThreshold = false;
  try { createSessionCircuitBreaker({ failureThreshold: 0 }); } catch (error) {
    refusedInvalidThreshold = error instanceof RangeError;
  }
  const breaker = createSessionCircuitBreaker({ failureThreshold: 1 });
  breaker.recordFailure('failed-session');
  return refusedInvalidThreshold
    && breaker.canEvaluate('failed-session') === false
    && breaker.canEvaluate('healthy-session') === true;
});

await verify('deduplication, completion idempotence, and circuit state survive hook processes', () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'ck-gov-cross-process-'));
  const stateDirectory = join(scratchRoot, 'state');
  const workerPath = fileURLToPath(import.meta.url);
  const runWorker = (moment, payload) => {
    const worker = spawnSync(process.execPath, [workerPath, '--cross-process-worker'], {
      cwd: scratchRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CONTEXTKIT_GOVERNANCE_STATE_DIR: stateDirectory,
        CDK_GOVERNANCE_WORKER_ROOT: scratchRoot,
        CDK_GOVERNANCE_WORKER_MOMENT: moment,
        CDK_GOVERNANCE_WORKER_PAYLOAD: JSON.stringify(payload),
      },
    });
    if (worker.status !== 0) throw new Error(worker.stderr || `worker exit ${worker.status}`);
    return JSON.parse(worker.stdout);
  };

  try {
    const basePayload = {
      sessionId: 'cross-session',
      workItemId: 'WF-0111',
      revision: '21',
      mutationAttempt: true,
    };
    const firstWrite = runWorker('write-preflight', basePayload);
    const duplicateWrite = runWorker('write-preflight', basePayload);
    const firstCompletion = runWorker('completion', { ...basePayload, revision: '22' });
    const duplicateCompletion = runWorker('completion', { ...basePayload, revision: '22' });

    const failingPayload = {
      sessionId: 'cross-circuit',
      workItemId: 'WF-0111',
      revision: '1',
      mutationAttempt: true,
      observations: {
        'ddd-invariants': { status: 'error' },
        'architecture-debt': { status: 'error' },
        'privacy-lgpd': { status: 'error' },
      },
    };
    const opensCircuit = runWorker('write-preflight', failingPayload);
    const seesOpenCircuit = runWorker('write-preflight', { ...failingPayload, revision: '2' });

    return firstWrite.status === 'completed'
      && duplicateWrite.status === 'deduplicated'
      && firstCompletion.status === 'completed'
      && duplicateCompletion.status === 'deduplicated'
      && opensCircuit.status === 'circuit-open'
      && seesOpenCircuit.status === 'circuit-open';
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

await verify('a completion-only conversation creates no cross-process state artifact', () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'ck-gov-noop-process-'));
  const stateDirectory = join(scratchRoot, 'state');
  const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--cross-process-worker'], {
    cwd: scratchRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CONTEXTKIT_GOVERNANCE_STATE_DIR: stateDirectory,
      CDK_GOVERNANCE_WORKER_ROOT: scratchRoot,
      CDK_GOVERNANCE_WORKER_MOMENT: 'completion',
      CDK_GOVERNANCE_WORKER_PAYLOAD: JSON.stringify({
        sessionId: 'conversation-session', workItemId: 'conversation-session', revision: '1',
      }),
    },
  });
  try {
    const response = worker.status === 0 ? JSON.parse(worker.stdout) : null;
    return response?.status === 'not-applicable' && !existsSync(stateDirectory);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

rep.finish('governance anti-loop (WF-0111 W04)');
