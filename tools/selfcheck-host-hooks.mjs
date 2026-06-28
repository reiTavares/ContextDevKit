/**
 * Host hook composition checks for Claude settings, Antigravity, and Codex.
 *
 * Kept outside the main selfcheck runner so the entrypoint remains an
 * orchestrator instead of becoming a host-contract test module.
 */

function checkCompose({ ok, bad }, composeSettings) {
  console.log('Checking settings composition per level...');
  const events = (lvl) => Object.keys(composeSettings(null, lvl).hooks || {}).sort();
  const expect = {
    1: ['SessionStart'],
    2: ['PostToolUse', 'SessionStart', 'Stop'],
    3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    4: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    5: ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit'],
    6: ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit'],
    7: ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit'],
  };
  for (const [lvl, want] of Object.entries(expect)) {
    const got = events(Number(lvl));
    JSON.stringify(got) === JSON.stringify(want.sort())
      ? ok(`L${lvl} -> ${got.join(', ')}`)
      : bad(`L${lvl} expected [${want}] got [${got}]`);
  }
  const once = composeSettings(null, 5);
  const onceCount = (once.hooks.PostToolUse || []).length;
  const twice = composeSettings(structuredClone(once), 5);
  const dup = (twice.hooks.PostToolUse || []).length;
  dup === onceCount
    ? ok('re-running installer is idempotent (no duplicate hooks)')
    : bad(`idempotency broken: PostToolUse has ${dup} groups after re-compose (expected ${onceCount})`);
  const sl = composeSettings(null, 1).statusLine;
  sl && String(sl.command).includes('contextkit/runtime/statusline')
    ? ok('statusLine widget wired (L1+)')
    : bad('statusLine widget not wired');
  composeSettings({ statusLine: { type: 'command', command: 'mine' } }, 5).statusLine?.command === 'mine'
    ? ok('composeSettings preserves a user statusLine')
    : bad('composeSettings clobbered a user statusLine');
}

function checkAgentHooksCompose({ ok, bad }, composer, adapter) {
  console.log('Checking agy hooks composition + host adapter (ADR-0049)...');
  const { composeAgentHooks, stripAgentHooks, KIT_HOOK_GROUP } = composer;
  const group = (lvl) => composeAgentHooks(null, lvl)[KIT_HOOK_GROUP];
  const events = (lvl) => Object.keys(group(lvl)).filter((k) => k !== 'enabled').sort();
  const expect = {
    1: ['SessionStart'],
    2: ['PostToolUse', 'SessionStart', 'Stop'],
    3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    5: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
  };
  for (const [lvl, want] of Object.entries(expect)) {
    const got = events(Number(lvl));
    JSON.stringify(got) === JSON.stringify(want.sort())
      ? ok(`agy L${lvl} -> ${got.join(', ')}`)
      : bad(`agy L${lvl} expected [${want}] got [${got}]`);
  }
  const l5 = group(5);
  l5.PreToolUse.length === adapter.AGY_WRITE_TOOLS.length * 4 && l5.PreToolUse.every((e) => adapter.AGY_WRITE_TOOLS.includes(e.matcher))
    ? ok('agy PreToolUse wires guard+simulate+journey+nudge once per write tool')
    : bad(`agy PreToolUse wiring wrong: ${JSON.stringify(l5.PreToolUse?.map((e) => e.matcher))}`);
  l5.PreToolUse.every((e) => e.hooks[0].command.endsWith('--host agy'))
    ? ok('every agy tool hook carries the --host agy flag')
    : bad('an agy tool hook is missing the --host agy flag');
  l5.SessionStart[0].hooks[0].command.includes('session-manager.mjs start') && l5.Stop[0].hooks[0].command.includes('session-manager.mjs end')
    ? ok('agy SessionStart/Stop reuse session-manager start/end')
    : bad('agy session boundary commands do not target session-manager');
  const userFile = { 'my-gate': { enabled: true, PreToolUse: [] } };
  const composed = composeAgentHooks(composeAgentHooks(userFile, 5), 5);
  composed['my-gate'] && composed[KIT_HOOK_GROUP].PreToolUse.length === l5.PreToolUse.length
    ? ok('agy re-compose is idempotent and preserves user groups')
    : bad('agy re-compose duplicated entries or dropped a user group');
  const stripped = stripAgentHooks(composed);
  stripped && stripped['my-gate'] && !stripped[KIT_HOOK_GROUP] && stripAgentHooks(composeAgentHooks(null, 5)) === null
    ? ok('stripAgentHooks removes only the kit group (null when nothing remains)')
    : bad('stripAgentHooks misbehaved');

  const norm = adapter.normalizeToolPayload;
  const cases = [
    ['claude Edit', { tool_name: 'Edit', tool_input: { file_path: 'a.js' } }, ['a.js']],
    ['claude MultiEdit edits[]', { tool_name: 'MultiEdit', tool_input: { edits: [{ file_path: 'b.js' }, { file_path: 'c.js' }] } }, ['b.js', 'c.js']],
    ['agy toolCall TargetFile', { toolCall: { name: 'write_to_file', args: { TargetFile: 'd.js' } } }, ['d.js']],
    ['agy claude-shaped variant', { tool_name: 'replace_file_content', tool_input: { TargetFile: 'e.js' } }, ['e.js']],
    ['codex apply_patch', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: src/a.js\n*** Add File: src/b.js\n*** End Patch\n' } }, ['src/a.js', 'src/b.js']],
    ['junk payload', { nonsense: true }, []],
  ];
  for (const [label, payload, want] of cases) {
    const got = norm(payload).filePaths;
    JSON.stringify(got) === JSON.stringify(want)
      ? ok(`normalizeToolPayload: ${label}`)
      : bad(`normalizeToolPayload ${label} -> ${JSON.stringify(got)}`);
  }
  adapter.hookHost(['node', 'x.mjs', '--host', 'agy']) === 'agy' &&
  adapter.hookHost(['node', 'x.mjs', '--host=codex']) === 'codex' &&
  adapter.hookHost(['node', 'x.mjs']) === 'claude'
    ? ok('hookHost resolves explicit agy/codex hosts and defaults to claude')
    : bad('hookHost flag parsing wrong');
  checkCodexAdvisoryPayload({ ok, bad }, adapter);
}

function checkCodexAdvisoryPayload({ ok, bad }, adapter) {
  try {
    const pre = JSON.parse(adapter.advisoryPayload('note', 'codex', 'PreToolUse'));
    const stop = JSON.parse(adapter.advisoryPayload('note', 'codex', 'Stop'));
    pre.hookSpecificOutput?.hookEventName === 'PreToolUse' &&
    pre.hookSpecificOutput?.additionalContext === 'note' &&
    stop.systemMessage === 'note'
      ? ok('Codex advisories use event-valid JSON payloads')
      : bad('Codex advisory payload shape is invalid');
  } catch {
    bad('Codex advisory payload shape is invalid');
  }
}

function checkCodexHooksCompose({ ok, bad }, composer) {
  console.log('Checking Codex hooks composition...');
  const events = (lvl) => Object.keys(composer.composeCodexHooks(null, lvl).hooks || {}).sort();
  const expect = {
    1: ['SessionStart'],
    2: ['PostToolUse', 'SessionStart', 'Stop'],
    3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    5: ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit'],
  };
  for (const [lvl, want] of Object.entries(expect)) {
    const got = events(Number(lvl));
    JSON.stringify(got) === JSON.stringify(want.sort())
      ? ok(`Codex L${lvl} -> ${got.join(', ')}`)
      : bad(`Codex L${lvl} expected [${want}] got [${got}]`);
  }
  const once = composer.composeCodexHooks(null, 5);
  const commands = Object.values(once.hooks).flat().flatMap((entry) => (entry.hooks || []).map((hook) => hook.command || ''));
  commands.every((command) => command.includes('--host codex'))
    ? ok('Codex hook commands carry the explicit host flag')
    : bad('Codex hook command missing --host codex');
  const twice = composer.composeCodexHooks(structuredClone(once), 5);
  (twice.hooks.PreToolUse || []).length === (once.hooks.PreToolUse || []).length
    ? ok('Codex hook re-compose is idempotent')
    : bad('Codex hook re-compose duplicated entries');
  composer.stripCodexHooks(once) === null
    ? ok('stripCodexHooks removes only the kit hooks')
    : bad('stripCodexHooks left kit-only residue');
}

export function runHostHookChecks(report, { mods }) {
  if (mods['config/settings-compose.mjs']?.composeSettings) checkCompose(report, mods['config/settings-compose.mjs'].composeSettings);
  if (mods['config/agent-hooks-compose.mjs']?.composeAgentHooks && mods['hooks/host-adapter.mjs']) {
    checkAgentHooksCompose(report, mods['config/agent-hooks-compose.mjs'], mods['hooks/host-adapter.mjs']);
  }
  if (mods['config/codex-hooks-compose.mjs']?.composeCodexHooks) checkCodexHooksCompose(report, mods['config/codex-hooks-compose.mjs']);
}
