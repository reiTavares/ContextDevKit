#!/usr/bin/env node
/**
 * Self-test for mandatory graph-first exploration (WF-0108 / ADR-0155).
 *
 * Covers the three pieces that make the graph obligatory instead of optional:
 *   1. `graph-session-refresh.mjs#shouldRefresh` — the per-session rebuild ladder
 *      (the first real consumer of `projectMap.graph.autoIndex`).
 *   2. `graph-first-gate.mjs` — the pure decision core plus its payload/pattern
 *      parsing: a match BLOCKS, a miss WARNS-and-allows, a stale miss REBUILDS,
 *      an absent projection never false-blocks, and only a human can bypass.
 *   3. `tools/install/graph-deps.mjs` — the dependency guarantee that keeps the
 *      AST tier from degrading silently on a fresh install.
 *
 * Plus the wiring assertions that would catch a regression in the host composers.
 *
 * Everything runs on injected inputs — no real spawn, no disk mutation, no rebuild.
 * Standalone entrypoint (exit 0/1).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const REFRESH = resolve(KIT, 'templates/contextkit/runtime/hooks/graph-session-refresh.mjs');
const GATE = resolve(KIT, 'templates/contextkit/runtime/hooks/graph-first-gate.mjs');
const DEPS = resolve(KIT, 'tools/install/graph-deps.mjs');

/** Config shape helper: an enabled graph with the given overrides. */
function graphConfig(overrides = {}) {
  return { projectMap: { graph: { enabled: true, mode: 'guarded', humanFlip: true, autoIndex: true, maxAgeMinutes: 60, ...overrides } } };
}

export async function runGraphFirstChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  // ── 1. per-session refresh ladder ──────────────────────────────────────────
  let refresh;
  try {
    refresh = await import(pathToFileURL(REFRESH).href);
  } catch (err) {
    record('graph-session-refresh import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('graph-session-refresh imports without running (execution guard)', typeof refresh.shouldRefresh === 'function', 'shouldRefresh exported');

  {
    const base = { level: 7, config: graphConfig(), sessionId: 's1', receipt: null, hasSource: true, builderExists: true };
    const ok = refresh.shouldRefresh(base);
    record('new session + enabled -> refresh', ok.refresh === true, ok.reason);

    const low = refresh.shouldRefresh({ ...base, level: 3 });
    record('level < 4 -> no refresh (graph is inert below its minimum level)', low.refresh === false, low.reason);

    const off = refresh.shouldRefresh({ ...base, config: { projectMap: { graph: { enabled: false } } } });
    record('graph disabled -> no refresh', off.refresh === false, off.reason);

    const optOut = refresh.shouldRefresh({ ...base, config: graphConfig({ autoIndex: false }) });
    record('autoIndex:false -> no refresh (the flag is now REALLY consumed)', optOut.refresh === false, optOut.reason);

    const green = refresh.shouldRefresh({ ...base, hasSource: false });
    record('greenfield -> no refresh', green.refresh === false, green.reason);

    const noBuilder = refresh.shouldRefresh({ ...base, builderExists: false });
    record('builder absent -> no refresh (never a fabricated success)', noBuilder.refresh === false, noBuilder.reason);

    const same = refresh.shouldRefresh({ ...base, receipt: { sessionId: 's1' } });
    record('receipt from THIS session -> no double spawn on resume/compaction', same.refresh === false, same.reason);

    const other = refresh.shouldRefresh({ ...base, receipt: { sessionId: 'other' } });
    record("another session's receipt -> still refreshes", other.refresh === true, other.reason);

    const broken = refresh.shouldRefresh({ ...base, receipt: null, config: null });
    record('null config -> no refresh, never throws', broken.refresh === false, broken.reason);
  }

  // ── 2. graph-first gate ────────────────────────────────────────────────────
  let gate;
  try {
    gate = await import(pathToFileURL(GATE).href);
  } catch (err) {
    record('graph-first-gate import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('graph-first-gate imports without running (execution guard)', typeof gate.decideGate === 'function', 'decideGate exported');

  {
    // literalOf: a real symbol is searchable; a bare glob/extension is NOT (an
    // extension token would match nearly every node id and false-block a routine
    // `Glob **\/*.mjs` — the exact over-blocking risk this gate must avoid).
    record('literalOf: a real symbol survives', gate.literalOf('resolveGraphActivation') === 'resolveGraphActivation', String(gate.literalOf('resolveGraphActivation')));
    const globs = ['**/*.mjs', '*.ts', 'src/**/*.js', 'index.js', 'test/**'];
    const globsNull = globs.every((pattern) => gate.literalOf(pattern) === null);
    record('literalOf: bare globs/extensions -> null (no false block on a routine sweep)', globsNull, globs.map((g) => `${g}=${gate.literalOf(g)}`).join(' '));
    record('literalOf: non-string -> null', gate.literalOf(null) === null && gate.literalOf(undefined) === null, 'null/undefined safe');

    // Bypass is HUMAN-only and bilingual (pt-BR carries the same weight, WF-0095).
    const tokensWork = ['use no-graph here', 'pode ir sem-grafo', 'skip-graph please', 'pular-grafo agora'].every((p) => gate.hasBypassToken(p) === true);
    record('hasBypassToken: all 4 tokens, en + pt-BR', tokensWork, gate.BYPASS_TOKENS.join(','));
    record('hasBypassToken: ordinary prompt -> false', gate.hasBypassToken('please refactor the parser') === false, 'no false positive');
    record('hasBypassToken: non-string -> false', gate.hasBypassToken(null) === false && gate.hasBypassToken(42) === false, 'type-safe');

    // Payload extraction across host shapes.
    const claudeGrep = gate.extractSearchTerm({ tool_name: 'Grep', tool_input: { pattern: 'shouldRefresh' } });
    record('extractSearchTerm: Claude Grep payload', claudeGrep?.term === 'shouldRefresh', JSON.stringify(claudeGrep));
    const agy = gate.extractSearchTerm({ toolCall: { name: 'grep_search', args: { query: 'decideGate' } } });
    record('extractSearchTerm: agy toolCall payload', agy?.term === 'decideGate', JSON.stringify(agy));
    record('extractSearchTerm: a non-search tool -> null (gate is inert)', gate.extractSearchTerm({ tool_name: 'Read', tool_input: { file_path: 'a.mjs' } }) === null, 'Read never gated');
    record('extractSearchTerm: glob-only pattern -> null', gate.extractSearchTerm({ tool_name: 'Glob', tool_input: { pattern: '**/*.mjs' } }) === null, 'no literal to ask the graph');

    // queryProjection over node ids.
    const projection = { nodes: [{ id: 'sym:src/a.mjs#doThing' }, { id: 'file:src/b.mjs' }] };
    record('queryProjection: case-insensitive hit', gate.queryProjection(projection, 'dothing').length === 1, 'matched');
    record('queryProjection: miss -> []', gate.queryProjection(projection, 'absent').length === 0, 'empty');
    record('queryProjection: malformed graph -> [] (never throws)', gate.queryProjection(null, 'x').length === 0 && gate.queryProjection({}, 'x').length === 0, 'defensive');

    // decideGate — the enforcement matrix.
    const base = { level: 7, mode: 'guarded', bypassed: false, projectionPresent: true, matches: [], ageMinutes: 5, maxAgeMinutes: 60 };
    record('match -> BLOCK', gate.decideGate({ ...base, matches: ['sym:a#b'] }).action === 'block', 'block');
    record('miss + fresh graph -> allow (warn-and-allow, never a false block)', gate.decideGate(base).action === 'allow', 'allow');
    record('miss + stale graph -> rebuild first', gate.decideGate({ ...base, ageMinutes: 120 }).action === 'rebuild', 'rebuild');
    record('miss + stale + already rebuilt -> allow (no rebuild loop)', gate.decideGate({ ...base, ageMinutes: 120, rebuilt: true }).action === 'allow', 'allow');
    record('absent projection -> allow (skipped, NEVER a fabricated pass)', gate.decideGate({ ...base, projectionPresent: false, matches: ['x'] }).action === 'allow', 'allow');
    record('human bypass -> allow even with matches', gate.decideGate({ ...base, matches: ['x'], bypassed: true }).action === 'allow', 'allow');
    record('advisory mode -> never blocks', gate.decideGate({ ...base, mode: 'advisory', matches: ['x'] }).action === 'allow', 'allow');
    record('shadow/off mode -> never blocks', gate.decideGate({ ...base, mode: 'shadow', matches: ['x'] }).action === 'allow' && gate.decideGate({ ...base, mode: 'off', matches: ['x'] }).action === 'allow', 'allow');
    record('strict mode -> blocks on a match', gate.decideGate({ ...base, mode: 'strict', matches: ['x'] }).action === 'block', 'block');
    record('level < 4 -> inert', gate.decideGate({ ...base, level: 3, matches: ['x'] }).action === 'allow', 'allow');
    let gateThrew = false;
    try {
      gate.decideGate({});
    } catch {
      gateThrew = true;
    }
    record('decideGate({}) -> allow, never throws', gateThrew === false, 'defensive');
  }

  // ── 3. installer dependency guarantee ──────────────────────────────────────
  let deps;
  try {
    deps = await import(pathToFileURL(DEPS).href);
  } catch (err) {
    record('graph-deps import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }

  {
    const pins = deps.graphDependencies(KIT);
    const names = pins.map((p) => p.name);
    record('graph deps are single-sourced from the kit optionalDependencies', names.includes('web-tree-sitter') && names.includes('tree-sitter-wasms'), names.join(', '));
    record('graph dep pins are EXACT (no ranges)', pins.every((p) => /^\d+\.\d+\.\d+$/.test(p.version)), pins.map((p) => `${p.name}@${p.version}`).join(', '));

    const exists = (needle) => (path) => String(path).includes(needle);
    record('detectPackageManager: pnpm lockfile', deps.detectPackageManager('/t', exists('pnpm-lock.yaml')) === 'pnpm', 'pnpm');
    record('detectPackageManager: yarn lockfile', deps.detectPackageManager('/t', exists('yarn.lock')) === 'yarn', 'yarn');
    record('detectPackageManager: no package.json -> null', deps.detectPackageManager('/nonexistent-target-xyz') === null, 'null');
    record('installCommand: npm pins exactly', deps.installCommand('npm', ['x@1.2.3']).args.includes('--save-exact'), 'save-exact');

    const enabled = () => true;
    const disabled = () => false;
    const noModules = (path) => !String(path).includes('node_modules');
    const explode = () => { throw new Error('runner must not be called'); };

    const off = await deps.maybeInstallGraphDeps('/t', { isEnabled: disabled, runInstall: explode });
    record('graph disabled -> deps skipped, installer not run', off.status === 'disabled', off.status);
    const selfHost = await deps.maybeInstallGraphDeps('/t', { isEnabled: enabled, runInstall: explode, selfHost: true });
    record('self-update -> deferred', selfHost.status === 'deferred_self_update', selfHost.status);
    const active = await deps.maybeInstallGraphDeps('/t', { isEnabled: enabled, runInstall: explode, activeSessions: 2 });
    record('active sessions -> deferred', active.status === 'deferred_active_sessions', active.status);
    const notNode = await deps.maybeInstallGraphDeps('/t', { isEnabled: enabled, manager: null, deps: [{ name: 'x', version: '1' }], runInstall: explode });
    record('non-Node target -> honest skip (regex tier, no pretend install)', notNode.status === 'not_a_node_project', notNode.status);
    const noPins = await deps.maybeInstallGraphDeps('/t', { isEnabled: enabled, manager: 'npm', deps: [], runInstall: explode });
    record('unreadable pins -> unknown_pins (never guessed)', noPins.status === 'unknown_pins', noPins.status);
    const satisfied = await deps.maybeInstallGraphDeps('/t', { isEnabled: enabled, manager: 'npm', deps: [{ name: 'x', version: '1' }], existsFn: () => true, runInstall: explode });
    record('deps already present -> satisfied, installer not run', satisfied.status === 'satisfied', satisfied.status);

    let called = null;
    const installed = await deps.maybeInstallGraphDeps('/t', {
      isEnabled: enabled,
      manager: 'npm',
      deps: [{ name: 'x', version: '1.2.3' }],
      existsFn: noModules,
      runInstall: (manager, specs) => { called = { manager, specs }; },
    });
    record('missing dep -> installed with the exact pin', installed.status === 'installed' && called?.specs[0] === 'x@1.2.3', JSON.stringify(called));

    let threw = false;
    let failed;
    try {
      failed = await deps.maybeInstallGraphDeps('/t', {
        isEnabled: enabled,
        manager: 'npm',
        deps: [{ name: 'x', version: '1' }],
        existsFn: noModules,
        runInstall: () => { throw new Error('registry down'); },
      });
    } catch {
      threw = true;
    }
    record('install failure -> fail-open (failed + manual command, never throws)', !threw && failed?.status === 'failed' && failed.note.includes('regex tier'), threw ? 'THREW' : failed?.status);
  }

  // ── 4. wiring: composers, config, agent briefings, MCP ─────────────────────
  {
    const claude = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/config/settings-compose.mjs')).href);
    const codex = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/config/codex-hooks-compose.mjs')).href);
    const agy = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/config/agent-hooks-compose.mjs')).href);
    const hooksOf = (composed) => JSON.stringify(composed).match(/graph-(?:first-gate|session-refresh)\.mjs/g) ?? [];

    for (const [host, composed] of [['claude', claude.composeSettings(null, 4)], ['codex', codex.composeCodexHooks(null, 4)], ['agy', agy.composeAgentHooks(null, 4)]]) {
      const found = new Set(hooksOf(composed));
      record(`${host} L4 registers BOTH graph hooks (refresh + gate)`, found.has('graph-session-refresh.mjs') && found.has('graph-first-gate.mjs'), [...found].join(', '));
    }
    for (const [host, composed] of [['claude', claude.composeSettings(null, 3)], ['codex', codex.composeCodexHooks(null, 3)], ['agy', agy.composeAgentHooks(null, 3)]]) {
      record(`${host} L3 registers NO graph hook (inert below L4)`, hooksOf(composed).length === 0, String(hooksOf(composed).length));
    }
    // The agy L5 branch reassigns UserPromptSubmit; the L4 gate entry must survive it.
    const agy5 = agy.composeAgentHooks(null, 5);
    const prompt5 = JSON.stringify(agy5?.contextdevkit?.UserPromptSubmit ?? []);
    record('agy L5 keeps the L4 graph gate on UserPromptSubmit (additive, not overwritten)', prompt5.includes('graph-first-gate.mjs') && prompt5.includes('execution-contract-hook.mjs'), prompt5.slice(0, 120));

    // Config: the install template ships the mandatory posture.
    const tplConfig = JSON.parse(readFileSync(resolve(KIT, 'templates/contextkit/config.json'), 'utf-8'));
    const shipped = tplConfig?.projectMap?.graph ?? {};
    record('install template ships graph guarded + humanFlip + maxAgeMinutes', shipped.enabled === true && shipped.mode === 'guarded' && shipped.humanFlip === true && Number(shipped.maxAgeMinutes) > 0, JSON.stringify(shipped));
    const defaults = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/config/defaults.mjs')).href);
    const defGraph = defaults.DEFAULT_CONFIG?.projectMap?.graph ?? {};
    record('runtime defaults carry the same graph posture', defGraph.mode === 'guarded' && defGraph.humanFlip === true, JSON.stringify(defGraph));

    // MCP: the graph is reachable, and the catalog matches the tool registry.
    const { TOOL_LIST } = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/mcp-server/tool-catalog.mjs')).href);
    const { MCP_GRAPH_TOOLS } = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/graph-consumers.mjs')).href);
    const advertised = TOOL_LIST.map((tool) => tool.name);
    const missing = MCP_GRAPH_TOOLS.filter((tool) => !advertised.includes(tool));
    record('MCP advertises every graph tool in MCP_GRAPH_TOOLS', missing.length === 0, missing.length ? 'missing: ' + missing.join(', ') : MCP_GRAPH_TOOLS.join(', '));
    record('MCP tool names are unique', new Set(advertised).size === advertised.length, `${advertised.length} tools`);

    // Agent briefings: the obligation reaches every dispatched subagent.
    const { readdirSync } = await import('node:fs');
    const agentsDir = resolve(KIT, 'templates/claude/agents');
    const agentFiles = readdirSync(agentsDir).filter((name) => name.endsWith('.md'));
    const without = agentFiles.filter((name) => !readFileSync(resolve(agentsDir, name), 'utf-8').includes('Graph-first code location'));
    record('every agent briefing carries the graph-first obligation', without.length === 0, without.length ? 'missing in: ' + without.slice(0, 4).join(', ') : `${agentFiles.length} agents`);

    for (const tpl of ['templates/CLAUDE.md.tpl', 'templates/AGENTS.md.tpl']) {
      const text = readFileSync(resolve(KIT, tpl), 'utf-8');
      record(`${tpl} states graph-first as mandatory + enforced`, text.includes('Graph before ANY exploration') && text.includes('graph.mjs query'), 'present');
    }
  }

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-first.mjs')) {
  const results = await runGraphFirstChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log();
  console.log(results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log();
  console.log(failCount > 0 ? 'FAIL' : 'PASS');
  process.exit(failCount > 0 ? 1 : 0);
}
