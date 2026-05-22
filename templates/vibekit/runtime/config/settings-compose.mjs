/**
 * Composes `.claude/settings.json` hook wiring for a given activation level.
 *
 * Shared by the installer (`install.mjs`) and the in-project `/vibe-level`
 * helper so they can never drift. It preserves the user's own hooks and
 * top-level keys, stripping only previously-installed VibeDevKit entries
 * (so re-running at a lower level cleanly removes now-disabled hooks).
 *
 * Level → hooks:
 *   1  SessionStart
 *   2  + PostToolUse (Edit|Write|MultiEdit), Stop
 *   3  + PreToolUse  (concurrency-guard) — and git hooks (installed separately)
 *   5  + PreToolUse  (simulate-gate)
 * (Level 4 adds agents — not Claude hooks.)
 *
 * @param {Record<string, any> | null} existing parsed settings.json (or null)
 * @param {number} level 1–5
 * @returns {Record<string, any>}
 */
export function composeSettings(existing, level) {
  const settings = existing && typeof existing === 'object' ? existing : {};
  if (!settings['$schema']) settings['$schema'] = 'https://json.schemastore.org/claude-code-settings.json';
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  for (const evt of ['SessionStart', 'PostToolUse', 'Stop', 'PreToolUse']) {
    if (!Array.isArray(hooks[evt])) continue;
    hooks[evt] = hooks[evt]
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('vibekit/runtime/hooks')) }))
      .filter((g) => (g.hooks || []).length > 0);
    if (hooks[evt].length === 0) delete hooks[evt];
  }

  const add = (evt, matcher, script) => {
    const entry = { hooks: [{ type: 'command', command: `node vibekit/runtime/hooks/${script}` }] };
    if (matcher) entry.matcher = matcher;
    (hooks[evt] = hooks[evt] || []).push(entry);
  };

  if (level >= 1) add('SessionStart', null, 'session-start.mjs');
  if (level >= 2) {
    add('PostToolUse', 'Edit|Write|MultiEdit', 'track-edits.mjs');
    add('Stop', null, 'check-registration.mjs');
  }
  if (level >= 3) add('PreToolUse', 'Edit|Write|MultiEdit', 'concurrency-guard.mjs');
  if (level >= 5) add('PreToolUse', 'Edit|Write|MultiEdit', 'simulate-gate.mjs');

  settings.hooks = hooks;
  return settings;
}
