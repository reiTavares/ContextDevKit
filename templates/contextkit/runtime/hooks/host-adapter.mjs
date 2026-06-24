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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEDGER_DIR } from '../config/paths.mjs';
import { resolveSessionId } from './ledger.mjs';

/** agy file-mutating tool names (snake_case, per the agy hook contract). */
export const AGY_WRITE_TOOLS = ['write_to_file', 'replace_file_content', 'multi_replace_file_content'];

/**
 * Bridge hosts (F8 / ADR-0068) — third-party AI coding tools that receive the
 * CONTEXT layer ONLY. ContextDevKit governance (hooks, gates, ledger) runs on the
 * three NATIVE hosts (Claude Code / Antigravity / Codex); these six get a
 * generated, idempotent context bridge and **no enforcement** (`enforced:false`
 * is explicit so nobody mistakes a bridge for a governed host). Installation is
 * opt-in per tool via config `bridges.enabled` and non-destructive via
 * `marker-inject.mjs` (ADR-0067). `targetFile` is the user-project path each
 * tool reads for its project rules.
 */
export const BRIDGE_HOSTS = [
  { key: 'cursor', label: 'Cursor', targetFile: '.cursor/rules/contextdevkit.mdc', enforced: false },
  { key: 'copilot', label: 'GitHub Copilot', targetFile: '.github/copilot-instructions.md', enforced: false },
  { key: 'gemini', label: 'Gemini CLI', targetFile: 'GEMINI.md', enforced: false },
  { key: 'windsurf', label: 'Windsurf', targetFile: '.windsurfrules', enforced: false },
  { key: 'aider', label: 'Aider', targetFile: 'CONVENTIONS.md', enforced: false },
  { key: 'continue', label: 'Continue', targetFile: '.continue/rules/contextdevkit.md', enforced: false },
];

/** Marker file `session-manager.mjs start` mints so per-event agy hook processes share one session. */
export const AGY_SESSION_MARKER = '.agy-active.json';

/** Marker file Codex SessionStart mints so hook processes share one session. */
export const CODEX_SESSION_MARKER = '.codex-active.json';

/**
 * Resolves which host invoked this hook from its argv (`--host agy` or
 * `--host=agy`). Default is Claude Code — the original wire format.
 * @param {string[]} [argv]
 * @returns {'agy'|'claude'}
 */
export function hookHost(argv = process.argv) {
  const flagIndex = argv.indexOf('--host');
  if (flagIndex !== -1 && argv[flagIndex + 1] === 'agy') return 'agy';
  if (flagIndex !== -1 && argv[flagIndex + 1] === 'codex') return 'codex';
  if (argv.includes('--host=agy')) return 'agy';
  return argv.includes('--host=codex') ? 'codex' : 'claude';
}

/** First string value among the path-bearing keys agy variants have shipped. */
function firstPathKey(args) {
  for (const key of ['TargetFile', 'target_file', 'file_path', 'path']) {
    if (typeof args?.[key] === 'string' && args[key].length > 0) return args[key];
  }
  return null;
}

/**
 * Extracts repo paths from the apply_patch command grammar used by Codex.
 * The hook payload reports tool_name="apply_patch" and puts the complete patch
 * in tool_input.command; without this parser every Codex write hook sees no path.
 *
 * @param {unknown} command raw apply_patch command
 * @returns {string[]}
 */
export function extractApplyPatchPaths(command) {
  if (typeof command !== 'string') return [];
  const paths = [];
  const seen = new Set();
  const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  for (const match of command.matchAll(pattern)) {
    const path = match[1]?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
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
  if (toolName === 'apply_patch') {
    return { toolName: 'Write', filePaths: extractApplyPatchPaths(input.command) };
  }
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
 * Builds a host-correct advisory payload without writing it. Codex ignores plain
 * stdout for tool/compaction hooks and requires JSON for Stop/SubagentStop.
 *
 * @param {string} text advisory body
 * @param {'agy'|'claude'|'codex'} host
 * @param {string} eventName hook event name
 * @returns {string}
 */
export function advisoryPayload(text, host = hookHost(), eventName = '') {
  if (host === 'agy') return JSON.stringify({ decision: 'allow', reason: text });
  if (host !== 'codex') return text;
  if (['SessionStart', 'SubagentStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit'].includes(eventName)) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: text,
      },
    });
  }
  return JSON.stringify({ systemMessage: text });
}

/**
 * Surfaces advisory text without ever blocking. Claude Code shows bare stdout
 * to the agent; agy parses stdout as a decision object, so the text rides an
 * explicit allow (immutable rule 2 — a nudge must never break the tool call).
 * @param {string} text the warning / nudge body
 * @param {'agy'|'claude'} [host]
 */
export function emitAdvisory(text, host = hookHost(), eventName = '') {
  process.stdout.write(advisoryPayload(text, host, eventName));
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
  if (host === 'claude') return resolveSessionId(payload);
  if (host === 'codex') {
    if (payload?.session_id && typeof payload.session_id === 'string') return payload.session_id;
    if (process.env.CODEX_SESSION_ID) return process.env.CODEX_SESSION_ID;
    try {
      const marker = JSON.parse(readFileSync(resolve(root, LEDGER_DIR, CODEX_SESSION_MARKER), 'utf-8'));
      if (typeof marker?.sid === 'string' && marker.sid.length > 0) return marker.sid;
    } catch {
      /* no marker yet: SessionStart has not run */
    }
    return 'codex_local';
  }
  try {
    const marker = JSON.parse(readFileSync(resolve(root, LEDGER_DIR, AGY_SESSION_MARKER), 'utf-8'));
    if (typeof marker?.sid === 'string' && marker.sid.length > 0) return marker.sid;
  } catch {
    /* no marker yet — session-manager start has not run */
  }
  return 'agy_local';
}

/**
 * Persists the Codex session id so future hook events reuse the same ledger.
 * @param {string} sessionId resolved session id
 * @param {'agy'|'claude'|'codex'} [host]
 * @param {string} [root] project root
 */
export function rememberHookSessionId(sessionId, host = hookHost(), root = process.cwd()) {
  if (host !== 'codex') return;
  try {
    const dir = resolve(root, LEDGER_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, CODEX_SESSION_MARKER), JSON.stringify({ sid: sessionId, at: Date.now() }, null, 2), 'utf-8');
  } catch {
    /* best effort */
  }
}
