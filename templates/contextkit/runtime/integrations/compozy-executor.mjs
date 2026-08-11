/**
 * CompozyOS v0.3 CLI execution adapter.
 * Compozy executes; ContextDevKit retains governance and completion authority.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, relative, resolve } from 'node:path';
import { executionIdentity, stableJson } from '../execution/governed-execution-envelope.mjs';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CONTROL_MAX_BYTES = 1024 * 1024;
const DEFAULT_STDERR_MAX_BYTES = 64 * 1024;
const READY_STATES = new Set(['ready', 'running', 'started', 'healthy', 'online']);

/** Typed external-runtime failure used by the dispatcher. */
export class CompozyExecutionError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'CompozyExecutionError';
    this.code = code;
  }
}

function executableExtensions(environment) {
  if (process.platform !== 'win32') return [''];
  // Batch/cmd shims require command-shell semantics on Windows. The adapter
  // deliberately accepts only directly spawnable binaries.
  return ['.exe', '.com'];
}

/** Resolve a regular non-project executable without invoking a shell. */
export function resolveCompozyExecutable(workspaceRoot, options = {}) {
  const environment = options.environment ?? process.env;
  const configured = options.executable ? resolve(options.executable) : null;
  const candidates = configured
    ? [configured]
    : String(environment.PATH ?? '').split(delimiter).filter(Boolean).flatMap((directory) => (
        executableExtensions(environment).map((extension) => resolve(directory, `compozy${extension}`))
      ));
  const canonicalWorkspace = realpathSync.native(workspaceRoot);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const stats = lstatSync(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) continue;
    const canonical = realpathSync.native(candidate);
    const workspaceRelative = relative(canonicalWorkspace, canonical);
    if (workspaceRelative === '' || (!workspaceRelative.startsWith('..') && !isAbsolute(workspaceRelative))) continue;
    return canonical;
  }
  throw new CompozyExecutionError('compozy_binary_unavailable', 'no trusted Compozy executable was found outside the workspace');
}

function appendBounded(chunks, chunk, state, maximumBytes) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = maximumBytes - state.bytes;
  if (remaining <= 0) {
    state.overflow = true;
    return;
  }
  chunks.push(buffer.subarray(0, remaining));
  state.bytes += Math.min(buffer.length, remaining);
  if (buffer.length > remaining) state.overflow = true;
}

/**
 * Spawn one bounded process with argv semantics and no shell.
 * @returns {Promise<{code:number|null,stdout:string,stderr:string,timedOut:boolean,overflow:boolean}>}
 */
export function runBoundedCommand(executable, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutState = { bytes: 0, overflow: false };
    const stderrState = { bytes: 0, overflow: false };
    let timedOut = false;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.environment ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => appendBounded(stdoutChunks, chunk, stdoutState, options.maxStdoutBytes ?? DEFAULT_CONTROL_MAX_BYTES));
    child.stderr.on('data', (chunk) => appendBounded(stderrChunks, chunk, stderrState, options.maxStderrBytes ?? DEFAULT_STDERR_MAX_BYTES));
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        overflow: stdoutState.overflow || stderrState.overflow,
      });
    });
  });
}

/** Stream strict JSONL while allowing asynchronous permission callbacks. */
export function runJsonlCommand(executable, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const stderrChunks = [];
    const stderrState = { bytes: 0, overflow: false };
    const events = [];
    let bufferedText = '';
    let totalBytes = 0;
    let malformedError = null;
    let timedOut = false;
    let callbackChain = Promise.resolve();
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.environment ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    function consumeLine(rawLine) {
      const line = rawLine.trim();
      if (!line) return;
      try {
        const event = JSON.parse(line.charCodeAt(0) === 0xfeff ? line.slice(1) : line);
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event is not an object');
        events.push(event);
        if (options.onEvent) callbackChain = callbackChain.then(() => options.onEvent(event));
      } catch (error) {
        malformedError = error;
        child.kill();
      }
    }

    child.stdout.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > (options.maxStdoutBytes ?? DEFAULT_CONTROL_MAX_BYTES)) {
        malformedError = new Error('JSONL output exceeded the configured byte limit');
        child.kill();
        return;
      }
      bufferedText += chunk.toString('utf8');
      const lines = bufferedText.split(/\r?\n/);
      bufferedText = lines.pop() ?? '';
      lines.forEach(consumeLine);
    });
    child.stderr.on('data', (chunk) => appendBounded(stderrChunks, chunk, stderrState, options.maxStderrBytes ?? DEFAULT_STDERR_MAX_BYTES));
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (bufferedText.trim()) consumeLine(bufferedText);
      try {
        await callbackChain;
      } catch (error) {
        malformedError = error;
      }
      resolvePromise({
        code,
        events,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        overflow: stderrState.overflow,
        malformedError,
      });
    });
  });
}

function parseJsonObject(commandReceipt, commandName) {
  if (commandReceipt.timedOut) throw new CompozyExecutionError(`${commandName}_timeout`, `${commandName} timed out`);
  if (commandReceipt.overflow) throw new CompozyExecutionError(`${commandName}_oversized`, `${commandName} output exceeded its limit`);
  if (commandReceipt.code !== 0) throw new CompozyExecutionError(`${commandName}_failed`, `${commandName} exited with code ${commandReceipt.code}`);
  try {
    const text = commandReceipt.stdout.trim().replace(/^\uFEFF/, '');
    const document = JSON.parse(text);
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('not an object');
    return document;
  } catch {
    throw new CompozyExecutionError(`${commandName}_invalid_json`, `${commandName} did not return one JSON object`);
  }
}

function versionFrom(document) {
  const candidate = document.version ?? document.cli_version ?? document.compozy?.version;
  const match = String(candidate ?? '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) throw new CompozyExecutionError('compozy_version_unknown', 'Compozy version response is unsupported');
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 0 && minor < 3) throw new CompozyExecutionError('compozy_version_incompatible', `Compozy ${match[0]} is older than the v0.3 adapter contract`);
  return match[0];
}

function daemonState(document) {
  return String(document.status ?? document.daemon?.status ?? document.state ?? '').trim().toLowerCase();
}

function sessionIdFrom(document) {
  const sessionId = String(document.id ?? document.session_id ?? document.session?.id ?? '').trim();
  if (!sessionId) throw new CompozyExecutionError('compozy_session_invalid', 'session new response did not contain a session id');
  return sessionId;
}

function eventPayload(event) {
  if (event.content && typeof event.content === 'object') return event.content;
  if (typeof event.content === 'string') {
    try { return JSON.parse(event.content); } catch { return {}; }
  }
  return event;
}

function pendingPermission(event) {
  if (String(event.type ?? '').toLowerCase() !== 'permission') return null;
  const payload = eventPayload(event);
  if (String(payload.decision ?? event.decision ?? '').trim()) return null;
  const requestId = String(payload.request_id ?? event.request_id ?? '').trim();
  const turnId = String(event.turn_id ?? payload.turn_id ?? '').trim();
  const sessionId = String(event.session_id ?? payload.session_id ?? '').trim();
  if (!requestId || !turnId) throw new CompozyExecutionError('permission_event_invalid', 'pending permission event lacks request_id or turn_id');
  return { requestId, turnId, sessionId, payload };
}

function pathWithinAllowed(workspaceRoot, allowedPaths, candidate) {
  const lexicalAbsolute = resolve(workspaceRoot, String(candidate));
  const absolute = existsSync(lexicalAbsolute) ? realpathSync.native(lexicalAbsolute) : lexicalAbsolute;
  const workspaceRelative = relative(workspaceRoot, absolute).replace(/\\/g, '/');
  if (workspaceRelative === '..' || workspaceRelative.startsWith('../') || isAbsolute(workspaceRelative)) return false;
  return allowedPaths.some((allowedPath) => allowedPath === '.'
    || workspaceRelative === allowedPath
    || workspaceRelative.startsWith(`${allowedPath.replace(/\/$/, '')}/`));
}

/** Determine whether one correlated permission is inside the envelope policy. */
export function permissionWithinEnvelope(permission, envelope, expectedSessionId) {
  if (permission.sessionId && permission.sessionId !== expectedSessionId) return false;
  const toolCall = permission.payload.tool_call ?? {};
  const operation = String(toolCall.kind ?? permission.payload.action ?? '*').trim() || '*';
  const operations = envelope.executionPermissions.allowedOperations;
  if (!operations.includes('*') && !operations.includes(operation)) return false;
  if (/network|http|fetch|web/i.test(operation)
      && envelope.executionPermissions.networkPolicy !== 'allow') return false;
  const toolInput = permission.payload.tool_input ?? {};
  const requestedCommand = String(toolInput.command ?? toolInput.cmd ?? '').trim();
  const allowedCommands = envelope.executionPermissions.allowedCommands;
  if (requestedCommand && !allowedCommands.includes('*')
      && !allowedCommands.some((allowedCommand) => requestedCommand === allowedCommand
        || requestedCommand.startsWith(`${allowedCommand} `))) return false;
  const locations = Array.isArray(toolCall.locations) ? toolCall.locations : [];
  return locations.every((location) => {
    const candidate = typeof location === 'string' ? location : (location.path ?? location.uri ?? '');
    return candidate && pathWithinAllowed(envelope.workspaceRoot, envelope.allowedPaths, candidate);
  });
}

function redact(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function evidenceDigest(events) {
  return createHash('sha256').update(stableJson(events), 'utf8').digest('hex');
}

function hashExecutable(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const digest = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', () => resolvePromise(digest.digest('hex')));
  });
}

function buildPrompt(envelope) {
  return [
    'Execute the following ContextDevKit-authorized task.',
    'ContextDevKit remains the sole authority for workflow, tests, QA, and completion.',
    'Stay within allowedPaths and constraints. Return execution evidence; do not mark the canonical task done.',
    stableJson(envelope),
  ].join('\n');
}

/**
 * Execute one governed envelope through current CompozyOS v0.3 session commands.
 * @param {object} envelope validated governed envelope
 * @param {object} [options] injectable process/runtime options
 * @returns {Promise<object>}
 */
export async function executeWithCompozy(envelope, options = {}) {
  const executable = (options.resolveExecutable ?? resolveCompozyExecutable)(envelope.workspaceRoot, options);
  const executableSha256 = options.executableSha256
    ?? (existsSync(executable) ? await hashExecutable(executable) : 'injected-test-executable');
  const commandRunner = options.commandRunner ?? runBoundedCommand;
  const jsonlRunner = options.jsonlRunner ?? runJsonlCommand;
  const identity = executionIdentity(envelope);
  const common = {
    cwd: envelope.workspaceRoot,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxStdoutBytes: envelope.evidencePolicy.maxBytes,
    maxStderrBytes: DEFAULT_STDERR_MAX_BYTES,
    environment: options.environment,
  };

  const versionDocument = parseJsonObject(await commandRunner(executable, ['version', '-o', 'json'], common), 'compozy_version');
  const version = versionFrom(versionDocument);
  let statusReceipt = await commandRunner(executable, ['status', '-o', 'json'], common);
  let daemonStartedByContextDevKit = false;
  let ready = false;
  if (statusReceipt.code === 0 && !statusReceipt.overflow && !statusReceipt.timedOut) {
    try { ready = READY_STATES.has(daemonState(parseJsonObject(statusReceipt, 'compozy_status'))); } catch { ready = false; }
  }
  if (!ready) {
    const startReceipt = await commandRunner(executable, ['daemon', 'start', '-o', 'json'], common);
    if (startReceipt.code === 0) {
      parseJsonObject(startReceipt, 'compozy_daemon_start');
      daemonStartedByContextDevKit = true;
    } else {
      // Compozy owns a home-scoped start lock. A concurrent starter may win;
      // double-check readiness before classifying its nonzero result as failure.
      const concurrentStatus = await commandRunner(executable, ['status', '-o', 'json'], common);
      if (concurrentStatus.code !== 0
          || !READY_STATES.has(daemonState(parseJsonObject(concurrentStatus, 'compozy_status')))) {
        parseJsonObject(startReceipt, 'compozy_daemon_start');
      }
      ready = true;
    }
    const attempts = options.readinessAttempts ?? 8;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      statusReceipt = await commandRunner(executable, ['status', '-o', 'json'], common);
      if (statusReceipt.code === 0 && !statusReceipt.overflow && !statusReceipt.timedOut) {
        try {
          if (READY_STATES.has(daemonState(parseJsonObject(statusReceipt, 'compozy_status')))) {
            ready = true;
            break;
          }
        } catch {}
      }
      if (options.readinessDelayMs !== 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, options.readinessDelayMs ?? 250));
      }
    }
  }
  if (!ready) throw new CompozyExecutionError('compozy_daemon_not_ready', 'Compozy daemon did not become ready');

  const sessionArgs = ['session', 'new', '--cwd', envelope.workspaceRoot, '--name', identity.executionId];
  if (options.agentName) sessionArgs.push('--agent', options.agentName);
  sessionArgs.push('-o', 'json');
  const sessionDocument = parseJsonObject(await commandRunner(executable, sessionArgs, common), 'compozy_session_new');
  const sessionId = sessionIdFrom(sessionDocument);
  const permissionDecisions = [];
  const handledRequests = new Map();

  const promptReceipt = await jsonlRunner(executable, [
    'session', 'prompt', sessionId, buildPrompt(envelope),
    '--message-id', identity.messageId,
    '--idempotency-key', identity.idempotencyKey,
    '-o', 'jsonl',
  ], {
    ...common,
    onEvent: async (event) => {
      const permission = pendingPermission(event);
      if (!permission) return;
      const requestDigest = evidenceDigest(permission.payload);
      const priorDigest = handledRequests.get(permission.requestId);
      if (priorDigest) {
        if (priorDigest !== requestDigest) throw new CompozyExecutionError('permission_replay_conflict', 'permission request id was replayed with different content');
        return;
      }
      handledRequests.set(permission.requestId, requestDigest);
      const offeredDecisions = Array.isArray(permission.payload.options)
        ? permission.payload.options.map((option) => String(option.decision ?? option.kind ?? '').toLowerCase())
        : [];
      const supportsAllowOnce = offeredDecisions.includes('allow-once') || offeredDecisions.includes('allow_once');
      const allowed = supportsAllowOnce && permissionWithinEnvelope(permission, envelope, sessionId);
      const decision = allowed ? 'allow-once' : 'reject-once';
      const approvalDocument = parseJsonObject(await commandRunner(executable, [
        'session', 'approve', sessionId,
        '--request-id', permission.requestId,
        '--turn-id', permission.turnId,
        '--decision', decision,
        '-o', 'json',
      ], common), 'compozy_permission_decision');
      permissionDecisions.push({
        requestId: permission.requestId,
        turnId: permission.turnId,
        decision,
        responseSha256: evidenceDigest(approvalDocument),
      });
      if (!allowed) throw new CompozyExecutionError('permission_outside_envelope', 'Compozy requested a permission outside the governed envelope');
    },
  });
  if (promptReceipt.timedOut) throw new CompozyExecutionError('compozy_execution_unknown', 'Compozy prompt timed out; reconcile the same session before retrying');
  if (promptReceipt.overflow) throw new CompozyExecutionError('compozy_output_oversized', 'Compozy prompt output exceeded its limit');
  if (promptReceipt.malformedError) throw promptReceipt.malformedError;
  if (promptReceipt.code !== 0) throw new CompozyExecutionError('compozy_prompt_failed', `Compozy prompt exited with code ${promptReceipt.code}`);
  const errorEvent = promptReceipt.events.find((event) => String(event.type ?? '').toLowerCase() === 'error');
  if (errorEvent) throw new CompozyExecutionError('compozy_prompt_error_event', 'Compozy emitted an error event');
  if (envelope.evidencePolicy.requireTerminalEvent
      && !promptReceipt.events.some((event) => String(event.type ?? '').toLowerCase() === 'done')) {
    throw new CompozyExecutionError('compozy_terminal_evidence_missing', 'Compozy prompt ended without a done event');
  }

  if (existsSync(executable)) {
    const finalExecutableSha256 = await hashExecutable(executable);
    if (finalExecutableSha256 !== executableSha256) {
      throw new CompozyExecutionError('compozy_executable_drift', 'Compozy executable changed during execution');
    }
  }

  const finishedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    executionState: 'evidence_returned',
    selectedExecutor: 'compozy',
    governanceAuthority: 'contextdevkit',
    completionAuthority: 'contextdevkit',
    fallback: 'forbidden',
    executionId: identity.executionId,
    sessionId,
    messageId: identity.messageId,
    idempotencyKey: identity.idempotencyKey,
    envelopeSha256: envelope.envelopeSha256,
    executable: { path: executable, version, sha256: executableSha256 },
    daemon: { autoStart: true, autoStartedByContextDevKit: daemonStartedByContextDevKit, state: 'ready' },
    permissions: { mode: 'auto_approve', decisions: permissionDecisions },
    evidence: {
      eventCount: promptReceipt.events.length,
      sha256: evidenceDigest(promptReceipt.events),
      stderrPreview: redact(promptReceipt.stderr).slice(0, 8192),
    },
    finishedAt,
    taskComplete: false,
    qaPassed: false,
  };
}
