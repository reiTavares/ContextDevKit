/**
 * Composes `.grok/hooks/contextdevkit.json` for the Grok Build host.
 *
 * Grok accepts the Claude-style top-level `hooks` map and maps Claude tool
 * names to its own tool catalog. The composer therefore mirrors the canonical
 * level matrix while adding an explicit `--host grok` to every ContextDevKit
 * command. Only commands containing the ContextDevKit hook directory are
 * removed during recomposition; unrelated user hooks remain intact.
 *
 * @param {Record<string, any> | null} existing parsed Grok hook file
 * @param {number} level active ContextDevKit level
 * @returns {Record<string, any>} composed Grok hook file
 */
export function composeGrokHooks(existing, level) {
  const file = existing && typeof existing === 'object' ? { ...existing } : {};
  const hooks = file.hooks && typeof file.hooks === 'object' ? { ...file.hooks } : {};

  for (const eventName of [
    'SessionStart',
    'PostToolUse',
    'Stop',
    'PreToolUse',
    'UserPromptSubmit',
    'SubagentStart',
    'SubagentStop',
    'PreCompact',
  ]) {
    if (!Array.isArray(hooks[eventName])) continue;
    hooks[eventName] = hooks[eventName]
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((hook) => !String(hook.command || '').includes('contextkit/runtime/hooks')),
      }))
      .filter((group) => (group.hooks || []).length > 0);
    if (hooks[eventName].length === 0) delete hooks[eventName];
  }

  const add = (eventName, matcher, script) => {
    const entry = {
      hooks: [{
        type: 'command',
        command: `node contextkit/runtime/hooks/${script} --host grok`,
      }],
    };
    if (matcher) entry.matcher = matcher;
    (hooks[eventName] = hooks[eventName] || []).push(entry);
  };

  if (level >= 1) add('SessionStart', null, 'session-start.mjs');
  if (level >= 2) {
    add('PostToolUse', 'Edit|Write|MultiEdit', 'track-edits.mjs');
    add('Stop', null, 'check-registration.mjs');
  }
  if (level >= 3) add('PreToolUse', 'Edit|Write|MultiEdit', 'concurrency-guard.mjs');
  if (level >= 4) {
    add('PostToolUse', 'Edit|Write|MultiEdit', 'auto-format.mjs');
    add('SessionStart', null, 'graph-session-refresh.mjs');
    add('UserPromptSubmit', null, 'graph-first-gate.mjs');
    add('PreToolUse', 'Grep|Glob|ListDir', 'graph-first-gate.mjs');
    add('PreToolUse', 'Edit|Write|MultiEdit', 'domain-code-gate.mjs');
    add('PostToolUse', 'Edit|Write|MultiEdit', 'domain-conformance.mjs');
    add('PreToolUse', 'Edit|Write|MultiEdit', 'arch-debt-law-gate.mjs');
  }
  if (level >= 5) {
    add('PreToolUse', 'Edit|Write|MultiEdit', 'simulate-gate.mjs');
    add('PreToolUse', 'Edit|Write|MultiEdit', 'journey-gate.mjs');
    add('PreToolUse', 'Edit|Write|MultiEdit', 'deliberation-nudge.mjs');
    add('UserPromptSubmit', null, 'execution-contract-hook.mjs');
    // Grok exposes MCP calls to hooks as qualified `server__tool` names. Keep
    // the host-native aliases alongside the qualified matcher so MCP writes
    // receive the same L5 controls as Codex's `mcp__.*` calls.
    add('PreToolUse', 'Read|Edit|Write|MultiEdit|Grep|Glob|ListDir|Bash|MCPTool|.*__.*', 'execution-gate.mjs');
    add('PostToolUse', 'Edit|Write|MultiEdit|Bash|MCPTool|.*__.*', 'indirect-write-reconcile.mjs');
    add('Stop', null, 'completion-gate.mjs');
    add('Stop', null, 'done-sweep.mjs');
    add('SubagentStart', null, 'subagent-gate.mjs');
    add('SubagentStop', null, 'subagent-gate.mjs');
    add('PreCompact', null, 'compaction-continuity.mjs');
    add('SessionStart', null, 'compaction-continuity.mjs');
  }

  file.hooks = hooks;
  return file;
}

/**
 * Removes only ContextDevKit command hooks from a Grok hook file.
 *
 * @param {Record<string, any> | null} existing parsed Grok hook file
 * @returns {Record<string, any> | null} remaining user hooks, or null when empty
 */
export function stripGrokHooks(existing) {
  if (!existing || typeof existing !== 'object') return null;
  const next = composeGrokHooks(existing, 0);
  if (!next.hooks || Object.keys(next.hooks).length === 0) delete next.hooks;
  return Object.keys(next).length > 0 ? next : null;
}
