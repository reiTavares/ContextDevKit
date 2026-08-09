/**
 * Composes `.claude/settings.json` with the ContextDevKit v4 event dispatchers.
 *
 * Recomposition preserves user-owned hooks and top-level settings while
 * replacing every previously installed ContextDevKit hook chain. One command
 * owns each governance event; the command dispatches internal gates in-process.
 *
 * @param {Record<string, any> | null} existing parsed settings file, if any
 * @param {number} level active ContextDevKit level
 * @returns {Record<string, any>} composed settings file
 */
export function composeSettings(existing, level) {
  const settings = existing && typeof existing === 'object' ? existing : {};
  if (!settings['$schema']) settings['$schema'] = 'https://json.schemastore.org/claude-code-settings.json';
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

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
    const entry = { hooks: [{ type: 'command', command: `node contextkit/runtime/hooks/${script}` }] };
    if (matcher) entry.matcher = matcher;
    (hooks[eventName] = hooks[eventName] || []).push(entry);
  };

  if (level >= 1 && (!settings.statusLine || String(settings.statusLine.command || '').includes('contextkit/runtime/statusline'))) {
    settings.statusLine = { type: 'command', command: 'node contextkit/runtime/statusline.mjs', padding: 0 };
  }
  if (level >= 1) add('SessionStart', null, 'governance-session-context.mjs');

  if (level >= 2) {
    add('PostToolUse', 'Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__.*', 'governance-postflight.mjs');
    add('Stop', null, 'governance-completion.mjs');
  }
  if (level >= 3) {
    add('PreToolUse', 'Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__.*', 'governance-write-preflight.mjs');
  }
  if (level >= 5) {
    add('UserPromptSubmit', null, 'governance-prompt-preflight.mjs');
    add('PreCompact', null, 'governance-session-context.mjs');
    add('SubagentStart', null, 'governance-session-context.mjs');
  }

  settings.hooks = hooks;
  return settings;
}
