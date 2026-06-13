/**
 * Composes `.claude/settings.json` hook wiring for a given activation level.
 *
 * Shared by the installer (`install.mjs`) and the in-project `/context-level`
 * helper so they can never drift. It preserves the user's own hooks and
 * top-level keys, stripping only previously-installed ContextDevKit entries
 * (so re-running at a lower level cleanly removes now-disabled hooks).
 *
 * Level → hooks:
 *   1  SessionStart
 *   2  + PostToolUse (Edit|Write|MultiEdit), Stop
 *   3  + PreToolUse  (concurrency-guard) — and git hooks (installed separately)
 *   5  + PreToolUse  (simulate-gate, deliberation-nudge)
 * (Level 4 adds agents — not Claude hooks.)
 *
 * @param {Record<string, any> | null} existing parsed settings.json (or null)
 * @param {number} level 1–7
 * @returns {Record<string, any>}
 */
export function composeSettings(existing, level) {
  const settings = existing && typeof existing === 'object' ? existing : {};
  if (!settings['$schema']) settings['$schema'] = 'https://json.schemastore.org/claude-code-settings.json';
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  for (const evt of ['SessionStart', 'PostToolUse', 'Stop', 'PreToolUse']) {
    if (!Array.isArray(hooks[evt])) continue;
    hooks[evt] = hooks[evt]
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('contextkit/runtime/hooks')) }))
      .filter((g) => (g.hooks || []).length > 0);
    if (hooks[evt].length === 0) delete hooks[evt];
  }

  const add = (evt, matcher, script) => {
    const entry = { hooks: [{ type: 'command', command: `node contextkit/runtime/hooks/${script}` }] };
    if (matcher) entry.matcher = matcher;
    (hooks[evt] = hooks[evt] || []).push(entry);
  };

  // Status-line widget (level >= 1). Preserve a user's own statusLine — only set
  // or replace a previously-installed ContextDevKit one.
  if (level >= 1 && (!settings.statusLine || String(settings.statusLine.command || '').includes('contextkit/runtime/statusline'))) {
    settings.statusLine = { type: 'command', command: 'node contextkit/runtime/statusline.mjs', padding: 0 };
  }

  if (level >= 1) add('SessionStart', null, 'session-start.mjs');
  if (level >= 2) {
    add('PostToolUse', 'Edit|Write|MultiEdit', 'track-edits.mjs');
    add('Stop', null, 'check-registration.mjs');
  }
  if (level >= 3) add('PreToolUse', 'Edit|Write|MultiEdit', 'concurrency-guard.mjs');
  if (level >= 4) add('PostToolUse', 'Edit|Write|MultiEdit', 'auto-format.mjs'); // ADR-0061 — advisory format/lint
  if (level >= 5) {
    add('PreToolUse', 'Edit|Write|MultiEdit', 'simulate-gate.mjs');
    add('PreToolUse', 'Edit|Write|MultiEdit', 'deliberation-nudge.mjs'); // ADR-0035 — soft nudge, never blocks
  }

  settings.hooks = hooks;
  return settings;
}
