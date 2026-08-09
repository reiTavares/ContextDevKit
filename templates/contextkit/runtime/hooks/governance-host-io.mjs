/**
 * Pure host I/O boundary for ContextDevKit v4 governance events.
 *
 * This module intentionally imports no ledger, marker, filesystem, process
 * runner, or legacy hook. It normalizes event identity from the host payload
 * and environment, then renders the structured runtime verdict for that host.
 */

const VALID_HOSTS = new Set(['agy', 'claude', 'codex', 'grok']);

/**
 * Resolves the explicit host flag, defaulting to Claude's native wire format.
 * @param {string[]} [argv] process arguments
 * @returns {'agy'|'claude'|'codex'|'grok'} active host
 */
export function resolveGovernanceHost(argv = process.argv) {
  const separateFlagIndex = argv.indexOf('--host');
  const separateValue = separateFlagIndex >= 0 ? argv[separateFlagIndex + 1] : null;
  if (VALID_HOSTS.has(separateValue)) return separateValue;
  const inlineValue = argv.find((argument) => argument.startsWith('--host='))?.slice('--host='.length);
  return VALID_HOSTS.has(inlineValue) ? inlineValue : 'claude';
}

/**
 * Reads and parses one host hook payload without touching persistent state.
 * @param {NodeJS.ReadStream} [input] input stream
 * @returns {Promise<Record<string, any> | null>} parsed payload, or null
 */
export async function readGovernancePayload(input = process.stdin) {
  let rawPayload = '';
  for await (const chunk of input) rawPayload += chunk;
  if (!rawPayload.trim()) return null;
  try {
    const payload = JSON.parse(rawPayload);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Adds stable event identity without allocating a task or reading a ledger.
 * @param {Record<string, any>} rawPayload host payload
 * @param {'agy'|'claude'|'codex'|'grok'} host active host
 * @param {NodeJS.ProcessEnv | Record<string, any>} env process environment
 * @returns {Record<string, any>} normalized payload
 */
export function normalizeGovernancePayload(rawPayload, host, env) {
  const hostSessionId = host === 'codex'
    ? env.CODEX_THREAD_ID ?? env.CODEX_SESSION_ID
    : host === 'agy'
      ? env.AGY_SESSION_ID ?? env.ANTIGRAVITY_SESSION_ID
      : host === 'grok'
        ? env.GROK_SESSION_ID
        : env.CLAUDE_SESSION_ID;
  const sessionId = rawPayload.sessionId
    ?? rawPayload.session_id
    ?? env.CONTEXTKIT_SESSION_ID
    ?? hostSessionId
    ?? `${host}_local`;
  const workItemId = rawPayload.workItemId
    ?? rawPayload.work_item_id
    ?? rawPayload.taskId
    ?? rawPayload.task_id
    ?? rawPayload.tool_input?.taskId
    ?? rawPayload.tool_input?.task_id
    ?? env.CONTEXTKIT_WORK_ITEM_ID
    ?? sessionId;
  const revision = rawPayload.revision
    ?? rawPayload.promptRevision
    ?? rawPayload.prompt_revision
    ?? rawPayload.tool_input?.revision
    ?? env.CONTEXTKIT_REVISION
    ?? 0;
  return { ...rawPayload, sessionId, workItemId, revision };
}

/**
 * Delegates one normalized host event to the canonical event runtime.
 * @param {object} input invocation context
 * @param {'prompt-preflight'|'write-preflight'|'postflight'|'completion'} input.moment lifecycle moment
 * @param {Record<string, any>} input.rawPayload host payload
 * @param {string} [input.root] project root
 * @param {NodeJS.ProcessEnv | Record<string, any>} [input.env] process environment
 * @param {'agy'|'claude'|'codex'|'grok'} [input.host] active host
 * @param {Function} [input.dispatch] test-only dispatcher injection
 * @returns {Promise<Record<string, any>>} structured governance result
 * @throws {Error} when the canonical runtime cannot dispatch the event
 */
export async function dispatchHostGovernanceEvent({
  moment,
  rawPayload,
  root = process.cwd(),
  env = process.env,
  host = resolveGovernanceHost(),
  dispatch,
}) {
  const runtimeDispatch = dispatch
    ?? (await import('../governance/event-runtime.mjs')).dispatchGovernanceEvent;
  return runtimeDispatch({
    moment,
    payload: normalizeGovernancePayload(rawPayload, host, env),
    root,
    env,
  });
}

/**
 * Emits a host-native advisory or blocking decision.
 * @param {Record<string, any>} dispatchResult structured governance result
 * @param {object} options output context
 * @param {'agy'|'claude'|'codex'|'grok'} options.host active host
 * @param {string} options.eventName host event name
 * @param {{write:(text:string)=>unknown}} [options.output] output stream
 * @returns {void}
 */
export function emitGovernanceResult(dispatchResult, { host, eventName, output = process.stdout }) {
  const details = {};
  if (Array.isArray(dispatchResult?.messages) && dispatchResult.messages.length > 0) {
    details.messages = dispatchResult.messages;
  }
  if (Array.isArray(dispatchResult?.diagnostics) && dispatchResult.diagnostics.length > 0) {
    details.diagnostics = dispatchResult.diagnostics;
  }
  const text = Object.keys(details).length > 0
    ? `[contextdevkit-governance] ${JSON.stringify(details)}`
    : '';
  if (dispatchResult?.allowed === false) {
    output.write(JSON.stringify({
      decision: ['agy', 'grok'].includes(host) ? 'deny' : 'block',
      reason: text || 'ContextDevKit governance denied this action.',
    }));
    return;
  }
  if (!text) return;
  if (['agy', 'grok'].includes(host)) {
    output.write(JSON.stringify({ decision: 'allow', reason: text }));
    return;
  }
  if (host === 'codex') {
    const payload = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse'].includes(eventName)
      ? { hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }
      : { systemMessage: text };
    output.write(JSON.stringify(payload));
    return;
  }
  output.write(text);
}

/**
 * Runs a complete hook entrypoint while keeping failures fail-safe.
 * @param {object} input hook identity
 * @param {'prompt-preflight'|'write-preflight'|'postflight'|'completion'} input.moment lifecycle moment
 * @param {string} input.eventName host event name
 * @returns {Promise<void>}
 */
export async function runGovernanceHook({ moment, eventName }) {
  const rawPayload = await readGovernancePayload();
  if (!rawPayload) return;
  const host = resolveGovernanceHost();
  const dispatchResult = await dispatchHostGovernanceEvent({ moment, rawPayload, host });
  emitGovernanceResult(dispatchResult, { host, eventName });
}
