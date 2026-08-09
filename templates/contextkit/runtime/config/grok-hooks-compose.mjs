/** Composes Grok Build hooks from the single-process v4 governance lifecycle. */

/**
 * @param {Record<string, any> | null} existing parsed Grok hook file
 * @param {number} level active ContextDevKit level
 * @returns {Record<string, any>} composed hook file
 */
export function composeGrokHooks(existing, level) {
  const file = existing && typeof existing === 'object' ? { ...existing } : {};
  const hooks = file.hooks && typeof file.hooks === 'object' ? { ...file.hooks } : {};

  for (const eventName of [
    'SessionStart', 'PostToolUse', 'Stop', 'PreToolUse', 'UserPromptSubmit',
    'SubagentStart', 'SubagentStop', 'PreCompact',
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

  const mutationMatcher = 'Edit|Write|MultiEdit|Bash|MCPTool|.*__.*';
  if (level >= 1) add('SessionStart', null, 'governance-session-context.mjs');
  if (level >= 2) {
    add('PostToolUse', mutationMatcher, 'governance-postflight.mjs');
    add('Stop', null, 'governance-completion.mjs');
  }
  if (level >= 3) add('PreToolUse', mutationMatcher, 'governance-write-preflight.mjs');
  if (level >= 5) {
    add('UserPromptSubmit', null, 'governance-prompt-preflight.mjs');
    add('PreCompact', null, 'governance-session-context.mjs');
    add('SubagentStart', null, 'governance-session-context.mjs');
  }

  file.hooks = hooks;
  return file;
}

/**
 * @param {Record<string, any> | null} existing parsed hook file
 * @returns {Record<string, any> | null} user-owned remainder
 */
export function stripGrokHooks(existing) {
  if (!existing || typeof existing !== 'object') return null;
  const next = composeGrokHooks(existing, 0);
  if (!next.hooks || Object.keys(next.hooks).length === 0) delete next.hooks;
  return Object.keys(next).length > 0 ? next : null;
}
