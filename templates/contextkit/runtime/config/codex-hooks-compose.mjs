/**
 * Composes `.codex/hooks.json` for the Codex host.
 *
 * Codex uses the same project hook scripts as Claude Code in the dogfood host:
 * boot context at SessionStart, edit tracking after writes, pre-edit guards at
 * L3/L5, and drift checking at Stop. Each hook carries `--host codex` so the
 * shared hook adapter can keep a stable Codex ledger. The file is separate from
 * `.claude/settings.json` because Codex owns `.codex/` and should never require
 * Claude Code to be installed.
 *
 * @param {Record<string, any> | null} existing parsed hooks file, if any
 * @param {number} level active ContextDevKit level
 * @returns {Record<string, any>} composed hooks file
 */
export function composeCodexHooks(existing, level) {
  const file = existing && typeof existing === 'object' ? { ...existing } : {};
  const hooks = file.hooks && typeof file.hooks === 'object' ? { ...file.hooks } : {};

  for (const evt of ['SessionStart', 'PostToolUse', 'Stop', 'PreToolUse']) {
    if (!Array.isArray(hooks[evt])) continue;
    hooks[evt] = hooks[evt]
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((hook) => !String(hook.command || '').includes('contextkit/runtime/hooks')),
      }))
      .filter((group) => (group.hooks || []).length > 0);
    if (hooks[evt].length === 0) delete hooks[evt];
  }

  const add = (evt, matcher, script) => {
    const entry = { hooks: [{ type: 'command', command: `node contextkit/runtime/hooks/${script} --host codex` }] };
    if (matcher) entry.matcher = matcher;
    (hooks[evt] = hooks[evt] || []).push(entry);
  };

  if (level >= 1) add('SessionStart', null, 'session-start.mjs');
  if (level >= 2) {
    add('PostToolUse', 'Edit|Write|MultiEdit', 'track-edits.mjs');
    add('Stop', null, 'check-registration.mjs');
  }
  if (level >= 3) add('PreToolUse', 'Edit|Write|MultiEdit', 'concurrency-guard.mjs');
  if (level >= 5) {
    add('PreToolUse', 'Edit|Write|MultiEdit', 'simulate-gate.mjs');
    add('PreToolUse', 'Edit|Write|MultiEdit', 'deliberation-nudge.mjs');
  }

  file.hooks = hooks;
  return file;
}

/**
 * Removes only ContextDevKit hook commands from `.codex/hooks.json`.
 * @param {Record<string, any> | null} existing parsed hooks file, if any
 * @returns {Record<string, any> | null} remaining user hooks, or null if empty
 */
export function stripCodexHooks(existing) {
  if (!existing || typeof existing !== 'object') return null;
  const next = composeCodexHooks(existing, 0);
  if (!next.hooks || Object.keys(next.hooks).length === 0) delete next.hooks;
  return Object.keys(next).length > 0 ? next : null;
}
