/**
 * Host adapter — the ONLY host-aware seam in the hook scripts [ADR-0049].
 *
 * The same governance hooks (track-edits, concurrency-guard, simulate-gate,
 * deliberation-nudge) run on two hosts with different wire contracts:
 *
 *   Claude Code            → stdin `{ tool_name, tool_input: { file_path } }`,
 *                            block via `{ decision: "block", reason }`.
 *   Antigravity CLI (agy)  → stdin `{ toolCall: { args: { TargetFile } } }`,
 *                            block via `{ decision: "deny", reason }`.
 *
 * The composer (`agent-hooks-compose.mjs`) appends `--host agy` to every agy
 * command, so hooks never sniff the payload to guess the host. Everything here
 * is defensive: unknown shapes normalize to "no paths", never to a throw.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEDGER_DIR } from '../config/paths.mjs';
import { resolveSessionId } from './ledger.mjs';

/** agy file-mutating tool names (snake_case, per the agy hook contract). */
export const AGY_WRITE_TOOLS = ['write_to_file', 'replace_file_content', 'multi_replace_file_content'];

/** Marker file `session-manager.mjs start` mints so per-event agy hook processes share one session. */
export const AGY_SESSION_MARKER = '.agy-active.json';

/**
 * Resolves which host invoked this hook from its argv (`--host agy` or
 * `--host=agy`). Default is Claude Code — the original wire format.
 * @param {string[]} [argv]
 * @returns {'agy'|'claude'}
 */
export function hookHost(argv = process.argv) {
  const flagIndex = argv.indexOf('--host');
  if (flagIndex !== -1 && argv[flagIndex + 1] === 'agy') return 'agy';
  return argv.includes('--host=agy') ? 'agy' : 'claude';
}

/** First string value among the path-bearing keys agy variants have shipped. */
function firstPathKey(args) {
  for (const key of ['TargetFile', 'target_file', 'file_path', 'path']) {
    if (typeof args?.[key] === 'string' && args[key].length > 0) return args[key];
  }
  return null;
}

/**
 * Normalizes a tool payload from either host into `{ toolName, filePaths }`.
 * Claude Code: Edit/Write carry `tool_input.file_path`; MultiEdit may carry an
 * `edits[]` array. agy: `toolCall.args` carries a TargetFile-style key (the
 * matcher already restricted the tool, so any path-bearing payload counts).
 *
 * @param {any} payload parsed stdin JSON
 * @returns {{ toolName: string|null, filePaths: string[] }}
 */
export function normalizeToolPayload(payload) {
  const none = { toolName: null, filePaths: [] };
  if (!payload || typeof payload !== 'object') return none;

  if (payload.toolCall && typeof payload.toolCall === 'object') {
    const call = payload.toolCall;
    const toolName = typeof call.name === 'string' ? call.name : typeof call.tool === 'string' ? call.tool : null;
    const path = firstPathKey(call.args ?? {});
    return { toolName, filePaths: path ? [path] : [] };
  }

  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : null;
  const input = payload.tool_input ?? {};
  if (toolName === 'Edit' || toolName === 'Write') {
    return { toolName, filePaths: input.file_path ? [input.file_path] : [] };
  }
  if (toolName === 'MultiEdit') {
    if (input.file_path) return { toolName, filePaths: [input.file_path] };
    if (Array.isArray(input.edits)) {
      return { toolName, filePaths: input.edits.map((edit) => edit?.file_path).filter(Boolean) };
    }
  }
  // agy variants that mimic the Claude shape but keep their own arg key.
  const agyStylePath = firstPathKey(input);
  if (toolName && AGY_WRITE_TOOLS.includes(toolName) && agyStylePath) {
    return { toolName, filePaths: [agyStylePath] };
  }
  return { toolName, filePaths: [] };
}

/**
 * Writes the host-correct blocking decision to stdout.
 * Claude Code expects `decision: "block"`; agy expects `decision: "deny"`.
 * @param {string} reason human-readable explanation shown to the agent
 * @param {'agy'|'claude'} [host]
 */
export function emitBlockDecision(reason, host = hookHost()) {
  process.stdout.write(JSON.stringify({ decision: host === 'agy' ? 'deny' : 'block', reason }));
}

/**
 * Surfaces advisory text without ever blocking. Claude Code shows bare stdout
 * to the agent; agy parses stdout as a decision object, so the text rides an
 * explicit allow (immutable rule 2 — a nudge must never break the tool call).
 * @param {string} text the warning / nudge body
 * @param {'agy'|'claude'} [host]
 */
export function emitAdvisory(text, host = hookHost()) {
  if (host === 'agy') {
    process.stdout.write(JSON.stringify({ decision: 'allow', reason: text }));
  } else {
    process.stdout.write(text);
  }
}

/**
 * Resolves the session id for ledger writes. Claude Code sends `session_id`
 * in every payload; agy hook events carry none, so per-event processes read
 * the stable id `session-manager.mjs start` minted — otherwise every edit
 * would fragment into its own ledger. Falls back to a fixed id (one shared
 * agy ledger) rather than a synthetic per-process one.
 *
 * @param {any} payload parsed stdin JSON
 * @param {'agy'|'claude'} [host]
 * @param {string} [root] project root (default cwd)
 * @returns {string}
 */
export function resolveHookSessionId(payload, host = hookHost(), root = process.cwd()) {
  if (host !== 'agy') return resolveSessionId(payload);
  try {
    const marker = JSON.parse(readFileSync(resolve(root, LEDGER_DIR, AGY_SESSION_MARKER), 'utf-8'));
    if (typeof marker?.sid === 'string' && marker.sid.length > 0) return marker.sid;
  } catch {
    /* no marker yet — session-manager start has not run */
  }
  return 'agy_local';
}
