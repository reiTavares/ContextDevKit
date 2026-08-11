#!/usr/bin/env node
/** WF-0117 integration checks for governed CompozyOS active execution. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const envelopeModule = await import(pathToFileURL(join(ROOT, 'templates/contextkit/runtime/execution/governed-execution-envelope.mjs')).href);
const dispatchModule = await import(pathToFileURL(join(ROOT, 'templates/contextkit/runtime/execution/executor-dispatch.mjs')).href);
const compozyModule = await import(pathToFileURL(join(ROOT, 'templates/contextkit/runtime/integrations/compozy-executor.mjs')).href);

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function fixtureWorkflow(workspaceRoot) {
  const task = {
    id: 'T-001', status: 'working', touchHints: ['src'],
    acceptance: ['independent QA remains required'],
  };
  return {
    workflow: {
      format: 'v2', id: 'WF-9001', currentPhase: 'pipeline',
      state: { status: 'working', revision: 7 },
      tasks: { revision: 4, tasks: [task] },
    },
    task,
    workspaceRoot,
  };
}

function authorizedEnvelope(workspaceRoot) {
  const fixture = fixtureWorkflow(workspaceRoot);
  return envelopeModule.createAuthorizedExecutionEnvelope(fixture.workflow, fixture.task, {
    objective: 'Implement the governed executor literally: ` $() & | Unicode ✓',
    workspaceRoot,
    allowedPaths: ['src'],
  }, { now: new Date('2030-01-01T00:00:00.000Z') });
}

function commandReceipt(document, code = 0) {
  return {
    code,
    stdout: typeof document === 'string' ? document : JSON.stringify(document),
    stderr: '',
    timedOut: false,
    overflow: false,
  };
}

async function main() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'cdk-compozy-'));
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'src', 'entry.mjs'), 'export const ready = true;\n');
  try {
    console.log('\nCompozy governed executor integration');
    const envelope = authorizedEnvelope(workspaceRoot);
    check('authorized envelope has a deterministic hash', /^[a-f0-9]{64}$/.test(envelope.envelopeSha256));
    check('automatic permission policy is explicit', envelope.executionPermissions.mode === 'auto-approve');
    const laterFixture = fixtureWorkflow(workspaceRoot);
    const duplicate = envelopeModule.createAuthorizedExecutionEnvelope(laterFixture.workflow, laterFixture.task, {
      objective: 'Implement the governed executor literally: ` $() & | Unicode ✓',
      workspaceRoot,
      allowedPaths: ['src'],
    }, { now: new Date('2030-01-01T00:10:00.000Z') });
    check('retry timestamps preserve the same canonical identity',
      envelopeModule.executionIdentity(envelope).idempotencyKey === envelopeModule.executionIdentity(duplicate).idempotencyKey);

    let detectionCalls = 0;
    let executorCalls = 0;
    const refused = await dispatchModule.executeGovernedEnvelope({ schemaVersion: 1 }, {
      detectProjectTools: () => { detectionCalls += 1; },
      compozyExecutor: () => { executorCalls += 1; },
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    check('invalid governance is refused', refused.executionState === 'governance_refused');
    check('governance refusal invokes no detector or executor', detectionCalls === 0 && executorCalls === 0);

    const localReceipt = await dispatchModule.executeGovernedEnvelope(envelope, {
      now: new Date('2030-01-01T00:00:00.000Z'),
      detectProjectTools: () => ({ compozy: { status: 'not_detected' } }),
      localExecutor: async () => ({ executionState: 'local-test-path' }),
    });
    check('absent Compozy preserves the local executor path', localReceipt.executionState === 'local-test-path');

    let localFallbackCalls = 0;
    const blocked = await dispatchModule.executeGovernedEnvelope(envelope, {
      now: new Date('2030-01-01T00:00:00.000Z'),
      detectProjectTools: () => ({ compozy: { status: 'configured' } }),
      compozyExecutor: async () => { throw Object.assign(new Error('daemon failed'), { code: 'daemon_failed' }); },
      localExecutor: async () => { localFallbackCalls += 1; },
    });
    check('configured Compozy failure blocks', blocked.executionState === 'blocked' && blocked.reason === 'daemon_failed');
    check('configured failure never invokes local fallback', localFallbackCalls === 0);

    const calls = [];
    let statusChecks = 0;
    const commandRunner = async (_executable, args) => {
      calls.push(args);
      const command = args.slice(0, 2).join(' ');
      if (args[0] === 'version') return commandReceipt({ version: '0.3.4' });
      if (args[0] === 'status') {
        statusChecks += 1;
        return commandReceipt({ status: statusChecks === 1 ? 'stopped' : 'ready' });
      }
      if (command === 'daemon start') return commandReceipt({ status: 'started' });
      if (command === 'session new') return commandReceipt({ id: 'session-123' });
      if (command === 'session approve') return commandReceipt({ status: 'approved' });
      throw new Error(`unexpected command: ${args.join(' ')}`);
    };
    const permissionEvent = {
      type: 'permission', session_id: 'session-123', turn_id: 'turn-1',
      content: {
        request_id: 'request-1',
        options: [{ decision: 'allow-once' }],
        tool_call: { kind: 'write', locations: [{ path: join(workspaceRoot, 'src', 'entry.mjs') }] },
      },
    };
    const jsonlRunner = async (_executable, args, options) => {
      calls.push(args);
      await options.onEvent(permissionEvent);
      await options.onEvent(permissionEvent);
      return { code: 0, events: [permissionEvent, { type: 'done', session_id: 'session-123', turn_id: 'turn-1' }], stderr: 'Bearer secret-token', timedOut: false, overflow: false, malformedError: null };
    };
    const receipt = await compozyModule.executeWithCompozy(envelope, {
      resolveExecutable: () => 'C:\\trusted\\compozy.exe',
      commandRunner,
      jsonlRunner,
      readinessDelayMs: 0,
    });
    check('daemon is auto-started and reaches ready', receipt.daemon.autoStartedByContextDevKit && receipt.daemon.state === 'ready');
    check('permission is auto-approved exactly once', receipt.permissions.decisions.length === 1
      && receipt.permissions.decisions[0].decision === 'allow-once');
    check('prompt uses stable idempotency arguments', calls.some((args) => args.includes('--message-id') && args.includes('--idempotency-key')));
    check('hostile objective remains one literal argv value', calls.some((args) => args[0] === 'session' && args[1] === 'prompt'
      && args.some((entry) => entry.includes('` $() & | Unicode ✓'))));
    check('executor receipt cannot mark QA or completion', receipt.taskComplete === false && receipt.qaPassed === false);
    check('diagnostic secrets are redacted', !receipt.evidence.stderrPreview.includes('secret-token'));

    const rejectCalls = [];
    const rejectingRunner = async (_executable, args) => {
      rejectCalls.push(args);
      if (args[0] === 'version') return commandReceipt({ version: '0.3.4' });
      if (args[0] === 'status') return commandReceipt({ status: 'ready' });
      if (args[0] === 'session' && args[1] === 'new') return commandReceipt({ id: 'session-123' });
      if (args[0] === 'session' && args[1] === 'approve') return commandReceipt({ status: 'rejected' });
      throw new Error(`unexpected command: ${args.join(' ')}`);
    };
    let outsideScopeRejected = false;
    try {
      await compozyModule.executeWithCompozy(envelope, {
        resolveExecutable: () => 'C:\\trusted\\compozy.exe',
        commandRunner: rejectingRunner,
        jsonlRunner: async (_executable, _args, options) => {
          await options.onEvent({
            ...permissionEvent,
            content: { ...permissionEvent.content, request_id: 'request-outside', tool_call: {
              kind: 'write', locations: [{ path: join(workspaceRoot, '..', 'outside.txt') }],
            } },
          });
          return { code: 0, events: [], stderr: '', timedOut: false, overflow: false, malformedError: null };
        },
      });
    } catch (error) {
      outsideScopeRejected = error.code === 'permission_outside_envelope';
    }
    check('out-of-envelope permission is rejected and blocks', outsideScopeRejected);
    check('out-of-envelope decision is reject-once', rejectCalls.some((args) => args.includes('--decision') && args.includes('reject-once')));

    let incompatibleRejected = false;
    try {
      await compozyModule.executeWithCompozy(envelope, {
        resolveExecutable: () => 'C:\\trusted\\compozy.exe',
        commandRunner: async () => commandReceipt({ version: '0.2.15' }),
      });
    } catch (error) {
      incompatibleRejected = error.code === 'compozy_version_incompatible';
    }
    check('deprecated Compozy v0.2 is refused', incompatibleRejected);

    let raceStatusChecks = 0;
    const raceReceipt = await compozyModule.executeWithCompozy(envelope, {
      resolveExecutable: () => 'C:\\trusted\\compozy.exe',
      commandRunner: async (_executable, args) => {
        if (args[0] === 'version') return commandReceipt({ version: '0.3.4' });
        if (args[0] === 'status') {
          raceStatusChecks += 1;
          return commandReceipt({ status: raceStatusChecks === 1 ? 'stopped' : 'ready' });
        }
        if (args[0] === 'daemon') return commandReceipt('already running', 1);
        if (args[0] === 'session' && args[1] === 'new') return commandReceipt({ id: 'session-race' });
        throw new Error(`unexpected race command: ${args.join(' ')}`);
      },
      jsonlRunner: async () => ({
        code: 0,
        events: [{ type: 'done', session_id: 'session-race', turn_id: 'turn-race' }],
        stderr: '', timedOut: false, overflow: false, malformedError: null,
      }),
      readinessDelayMs: 0,
    });
    check('concurrent daemon starter is reconciled instead of failing',
      raceReceipt.executionState === 'evidence_returned' && raceStatusChecks >= 2);

    let missingTerminalRejected = false;
    try {
      await compozyModule.executeWithCompozy(envelope, {
        resolveExecutable: () => 'C:\\trusted\\compozy.exe',
        commandRunner: async (_executable, args) => {
          if (args[0] === 'version') return commandReceipt({ version: '0.3.4' });
          if (args[0] === 'status') return commandReceipt({ status: 'ready' });
          if (args[0] === 'session' && args[1] === 'new') return commandReceipt({ id: 'session-no-done' });
          throw new Error(`unexpected terminal command: ${args.join(' ')}`);
        },
        jsonlRunner: async () => ({
          code: 0, events: [{ type: 'agent_message' }], stderr: '',
          timedOut: false, overflow: false, malformedError: null,
        }),
      });
    } catch (error) {
      missingTerminalRejected = error.code === 'compozy_terminal_evidence_missing';
    }
    check('missing terminal evidence never becomes a pass', missingTerminalRejected);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
