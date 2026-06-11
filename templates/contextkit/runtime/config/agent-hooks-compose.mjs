/**
 * Composes `.agents/hooks.json` — the Antigravity (agy) twin of
 * `settings-compose.mjs` [ADR-0049].
 *
 * Shared by the installer (`tools/install/antigravity.mjs`) and the in-project
 * `/context-level` helper so the two can never drift. The kit owns exactly ONE
 * named hook group (`contextdevkit`) and rewrites it wholesale on every call;
 * every other group in the file is the user's and is preserved untouched.
 *
 * Level → events (mirrors the Claude Code wiring 1:1):
 *   1  SessionStart  (session-manager start — boot context + agy session id)
 *   2  + PostToolUse (track-edits), Stop (session-manager end — drift check)
 *   3  + PreToolUse  (concurrency-guard)
 *   5  + PreToolUse  (simulate-gate, deliberation-nudge)
 * (Level 4 adds personas — assets, not hooks.)
 *
 * agy matchers are exact snake_case tool names; one entry per tool (not an
 * `a|b|c` alternation) so the wiring works under both exact-match and regex
 * matcher semantics — a wrong guess about the engine degrades to an inert
 * hook, never a broken tool call.
 */
import { AGY_WRITE_TOOLS } from '../hooks/host-adapter.mjs';

/** The single hooks.json group ContextDevKit owns (delete it to disable the kit). */
export const KIT_HOOK_GROUP = 'contextdevkit';

const SESSION_MANAGER = 'contextkit/runtime/antigravity/session-manager.mjs';
const HOOKS_DIR = 'contextkit/runtime/hooks';

/**
 * Builds the `.agents/hooks.json` object for a given activation level,
 * preserving every non-kit top-level group from `existing`.
 *
 * @param {Record<string, any> | null} existing parsed hooks.json (or null)
 * @param {number} level 1–7
 * @returns {Record<string, any>}
 */
export function composeAgentHooks(existing, level) {
  const hooksFile = existing && typeof existing === 'object' ? { ...existing } : {};

  const group = { enabled: true };
  const command = (cmd) => ({ hooks: [{ type: 'command', command: cmd }] });
  const perWriteTool = (script) =>
    AGY_WRITE_TOOLS.map((tool) => ({ matcher: tool, ...command(`node ${HOOKS_DIR}/${script} --host agy`) }));

  if (level >= 1) group.SessionStart = [command(`node ${SESSION_MANAGER} start`)];
  if (level >= 2) {
    group.PostToolUse = perWriteTool('track-edits.mjs');
    group.Stop = [command(`node ${SESSION_MANAGER} end`)];
  }
  if (level >= 3) group.PreToolUse = perWriteTool('concurrency-guard.mjs');
  if (level >= 5) {
    group.PreToolUse.push(...perWriteTool('simulate-gate.mjs'));
    group.PreToolUse.push(...perWriteTool('deliberation-nudge.mjs'));
  }

  hooksFile[KIT_HOOK_GROUP] = group;
  return hooksFile;
}

/**
 * Removes the kit-owned group from a parsed hooks.json (uninstall path).
 * Returns null when nothing user-owned remains, signalling "delete the file".
 *
 * @param {Record<string, any> | null} existing parsed hooks.json (or null)
 * @returns {Record<string, any> | null}
 */
export function stripAgentHooks(existing) {
  if (!existing || typeof existing !== 'object') return null;
  const remaining = { ...existing };
  delete remaining[KIT_HOOK_GROUP];
  return Object.keys(remaining).length > 0 ? remaining : null;
}
