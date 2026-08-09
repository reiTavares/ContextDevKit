/**
 * Static host-composer checks for the ContextDevKit 4 single-process runtime.
 *
 * Host-specific matching is allowed, but every matching event group must start
 * exactly one canonical dispatcher or the read-only context loader.
 */

const EVENTS_BY_LEVEL = Object.freeze({
  1: ['SessionStart'],
  2: ['PostToolUse', 'SessionStart', 'Stop'],
  3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
  4: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
  5: ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'UserPromptSubmit'],
});

const CANONICAL_SCRIPTS = Object.freeze({
  SessionStart: 'governance-session-context.mjs',
  PostToolUse: 'governance-postflight.mjs',
  Stop: 'governance-completion.mjs',
  PreToolUse: 'governance-write-preflight.mjs',
  UserPromptSubmit: 'governance-prompt-preflight.mjs',
  PreCompact: 'governance-session-context.mjs',
  SubagentStart: 'governance-session-context.mjs',
});

/** Extract the plain event map from one host-specific composition. */
function eventMap(host, composer, level) {
  if (host === 'claude') return composer.composeSettings(null, level).hooks ?? {};
  if (host === 'codex') return composer.composeCodexHooks(null, level).hooks ?? {};
  if (host === 'grok') return composer.composeGrokHooks(null, level).hooks ?? {};
  return composer.composeAgentHooks(null, level)[composer.KIT_HOOK_GROUP] ?? {};
}

/** Return every command registered for an event. */
function commandsFor(events, eventName) {
  return (events[eventName] ?? []).flatMap((group) => (
    (group.hooks ?? []).map((hook) => String(hook.command ?? ''))
  ));
}

/** Verify event shape, canonical dispatchers, and one-process groups. */
function checkHost(report, host, composer) {
  const { ok, bad } = report;
  for (const [levelText, expectedEvents] of Object.entries(EVENTS_BY_LEVEL)) {
    const level = Number(levelText);
    const events = eventMap(host, composer, level);
    const names = Object.keys(events).filter((name) => name !== 'enabled').sort();
    const expected = [...expectedEvents].sort();
    if (JSON.stringify(names) === JSON.stringify(expected)) ok(`${host} L${level} uses the v4 event surface`);
    else bad(`${host} L${level} events differ: expected ${expected.join(', ')}, got ${names.join(', ')}`);

    for (const eventName of names) {
      const groups = events[eventName] ?? [];
      const malformed = groups.some((group) => (group.hooks ?? []).length !== 1);
      if (!malformed) ok(`${host} L${level} ${eventName} starts one process per matching group`);
      else bad(`${host} L${level} ${eventName} contains a multi-process hook group`);

      const commands = commandsFor(events, eventName);
      const expectedScript = CANONICAL_SCRIPTS[eventName];
      if (commands.length > 0 && commands.every((command) => command.includes(expectedScript))) {
        ok(`${host} L${level} ${eventName} delegates to ${expectedScript}`);
      } else {
        bad(`${host} L${level} ${eventName} does not exclusively delegate to ${expectedScript}`);
      }
    }
  }

  const levelFive = eventMap(host, composer, 5);
  const allCommands = Object.keys(levelFive)
    .filter((name) => name !== 'enabled')
    .flatMap((eventName) => commandsFor(levelFive, eventName));
  const forbidden = [
    'ledger.mjs', 'session-start.mjs', 'track-edits.mjs', 'check-registration.mjs',
    'graph-first-gate.mjs', 'execution-gate.mjs', 'completion-gate.mjs',
    'domain-code-gate.mjs', 'domain-conformance.mjs', 'subagent-gate.mjs',
  ];
  const legacy = allCommands.filter((command) => forbidden.some((name) => command.includes(name)));
  if (legacy.length === 0) ok(`${host} composer exposes no executable 3.x hook`);
  else bad(`${host} composer retains executable 3.x hooks: ${legacy.join(', ')}`);

  if (host !== 'claude' && allCommands.every((command) => command.includes(`--host ${host}`))) {
    ok(`${host} commands carry an explicit host flag`);
  } else if (host !== 'claude') {
    bad(`${host} command is missing its explicit host flag`);
  }
}

/** Verify recomposition strips only prior kit hooks and retains user hooks. */
function checkRecomposition(report, host, composer) {
  const { ok, bad } = report;
  if (host === 'agy') {
    const user = { custom: { enabled: true, SessionStart: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } };
    const once = composer.composeAgentHooks(user, 5);
    const twice = composer.composeAgentHooks(once, 5);
    if (twice.custom && JSON.stringify(once[composer.KIT_HOOK_GROUP]) === JSON.stringify(twice[composer.KIT_HOOK_GROUP])) {
      ok('agy recomposition is idempotent and preserves user groups');
    } else bad('agy recomposition duplicated kit hooks or lost a user group');
    return;
  }

  const method = host === 'claude' ? 'composeSettings' : host === 'codex' ? 'composeCodexHooks' : 'composeGrokHooks';
  const user = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } };
  const once = composer[method](structuredClone(user), 5);
  const twice = composer[method](structuredClone(once), 5);
  const userCount = commandsFor(twice.hooks, 'SessionStart').filter((command) => command === 'echo user').length;
  const kitCountOnce = commandsFor(once.hooks, 'PreToolUse').length;
  const kitCountTwice = commandsFor(twice.hooks, 'PreToolUse').length;
  if (userCount === 1 && kitCountOnce === kitCountTwice) ok(`${host} recomposition is idempotent and preserves user hooks`);
  else bad(`${host} recomposition duplicated kit hooks or lost a user hook`);
}

/** Run the host-composition portion of the aggregate selfcheck. */
export function runHostHookChecks(report, { mods }) {
  const hosts = [
    ['claude', mods['config/settings-compose.mjs']],
    ['codex', mods['config/codex-hooks-compose.mjs']],
    ['agy', mods['config/agent-hooks-compose.mjs']],
    ['grok', mods['config/grok-hooks-compose.mjs']],
  ];
  for (const [host, composer] of hosts) {
    if (!composer) {
      report.bad(`${host} composer failed to import`);
      continue;
    }
    checkHost(report, host, composer);
    checkRecomposition(report, host, composer);
  }

  const settings = mods['config/settings-compose.mjs']?.composeSettings(null, 1);
  if (String(settings?.statusLine?.command ?? '').includes('runtime/statusline.mjs')) {
    report.ok('Claude composition keeps the read-only v4 statusline');
  } else report.bad('Claude composition is missing the read-only v4 statusline');
}
