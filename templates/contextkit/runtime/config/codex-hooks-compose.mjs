/**
 * Composes `.codex/hooks.json` with the ContextDevKit v4 event dispatchers.
 *
 * Every host event starts at most one ContextDevKit process. Gate selection,
 * interaction classification, deduplication, and budgets stay behind that
 * process boundary in the shared governance event runtime.
 *
 * @param {Record<string, any> | null} existing parsed hooks file, if any
 * @param {number} level active ContextDevKit level
 * @returns {Record<string, any>} composed hooks file
 */
export function composeCodexHooks(existing, level) {
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
      hooks: [{ type: 'command', command: `node contextkit/runtime/hooks/${script} --host codex` }],
    };
    if (matcher) entry.matcher = matcher;
    (hooks[eventName] = hooks[eventName] || []).push(entry);
  };

  if (level >= 2) {
    add('PostToolUse', 'Edit|Write|apply_patch|Bash|mcp__.*', 'governance-postflight.mjs');
    add('Stop', null, 'governance-completion.mjs');
  }
  if (level >= 3) {
    add('PreToolUse', 'Edit|Write|apply_patch|Bash|mcp__.*', 'governance-write-preflight.mjs');
  }
  if (level >= 5) add('UserPromptSubmit', null, 'governance-prompt-preflight.mjs');

  file.hooks = hooks;
  return file;
}

/**
 * Removes only ContextDevKit hook commands from `.codex/hooks.json`.
 *
 * @param {Record<string, any> | null} existing parsed hooks file, if any
 * @returns {Record<string, any> | null} remaining user hooks, or null if empty
 */
export function stripCodexHooks(existing) {
  if (!existing || typeof existing !== 'object') return null;
  const next = composeCodexHooks(existing, 0);
  if (!next.hooks || Object.keys(next.hooks).length === 0) delete next.hooks;
  return Object.keys(next).length > 0 ? next : null;
}
