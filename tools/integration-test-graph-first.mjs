/**
 * integration-test-graph-first.mjs — end-to-end tests for mandatory graph-first
 * exploration (WF-0108 / ADR-0155).
 *
 * Drives the REAL installed hooks as subprocesses via `installFixture`, so this
 * exercises the shipped wiring (settings.json → hook → committed projection), not
 * the templates in isolation. The projection is written by hand rather than built,
 * which keeps every case hermetic and fast (no tree-sitter, no multi-second build).
 *
 * Coverage:
 *   GF1. A term the graph KNOWS -> decision:block, and the denial names the match.
 *   GF2. A term the graph does NOT know -> no block + a VISIBLE warning (the
 *        developer's explicit requirement: a miss is never silent).
 *   GF3. No projection at all -> no block + a warning (never false-blocks on
 *        missing evidence; skipped, never a fabricated pass).
 *   GF4. A human bypass token in the prompt -> the next search is allowed even
 *        though the graph has the answer.
 *   GF5. `Read` of a named file is never gated.
 *   GF6. A pure glob (`**\/*.mjs`) is never gated — no literal to ask about.
 *   GF7. Malformed stdin -> exit 0, silent (fail-open, immutable rule 2).
 *   GF8. `mode: 'advisory'` -> never blocks (the config kill switch works).
 *   GF9. The session-refresh hook writes a receipt and returns fast (detached).
 *   GF10. Graph tools are reachable over the installed MCP server.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFixture, readJson, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const fx = installFixture(rep);

/**
 * Blocks the test process for `ms` without a timer — this file is a top-level
 * synchronous script, so an async sleep would race the cleanup it is guarding.
 * `node:*` only (immutable rule 1).
 */
function waitMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Writes a committed projection holding exactly the given node ids. */
function writeProjection(ids) {
  const dir = join(fx.proj, 'contextkit', 'memory', 'project-map', 'graph');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'graph.json'),
    JSON.stringify({ schemaVersion: 1, graphSignature: 'test00000000', layers: ['structural'], grammarVersions: {}, nodes: ids.map((id) => ({ id })), edges: [] }, null, 2),
    'utf-8',
  );
}

/** Sets `projectMap.graph.<key>` in the fixture's committed config. */
function setGraphConfig(patch) {
  const cfg = readJson(fx.cfgPath);
  cfg.projectMap = cfg.projectMap ?? {};
  cfg.projectMap.graph = { ...(cfg.projectMap.graph ?? {}), ...patch };
  writeFileSync(fx.cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

/** Raises the fixture to L7 so a blocking graph mode is reachable (ADR-0134 ladder). */
function setLevel(level) {
  const cfg = readJson(fx.cfgPath);
  cfg.level = level;
  writeFileSync(fx.cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

const SESSION = 'sess-graph-first-01';
const grepPayload = (pattern) => ({
  session_id: SESSION,
  hook_event_name: 'PreToolUse',
  tool_name: 'Grep',
  tool_input: { pattern },
});

setLevel(7);
setGraphConfig({ enabled: true, mode: 'guarded', humanFlip: true, autoIndex: true, maxAgeMinutes: 60 });

// A symbol the graph knows about, and one it does not.
const KNOWN = 'resolveWidgetTotals';
const UNKNOWN = 'nonexistentSymbolXyz';
writeProjection([`sym:src/billing.mjs#${KNOWN}`, 'file:src/billing.mjs']);

// ── GF1: the graph answers -> block, with the match inlined ──────────────────
{
  const out = fx.hook('graph-first-gate.mjs', grepPayload(KNOWN));
  let decision = null;
  try {
    decision = JSON.parse(out);
  } catch {
    /* not JSON -> not a block */
  }
  const blocked = decision?.decision === 'block';
  blocked ? rep.ok('GF1 known term -> decision:block') : rep.bad(`GF1 expected a block, got: ${out.slice(0, 200)}`);
  const namesMatch = typeof decision?.reason === 'string' && decision.reason.includes(KNOWN) && decision.reason.includes('graph.mjs');
  namesMatch ? rep.ok('GF1 denial inlines the graph answer + the graph command') : rep.bad(`GF1 denial did not carry the answer: ${String(decision?.reason).slice(0, 200)}`);
}

// ── GF2: a miss is allowed but NEVER silent ─────────────────────────────────
{
  const out = fx.hook('graph-first-gate.mjs', grepPayload(UNKNOWN));
  const isBlock = out.includes('"decision"') && out.includes('block');
  !isBlock ? rep.ok('GF2 unknown term -> not blocked (fallback search proceeds)') : rep.bad(`GF2 unexpectedly blocked: ${out.slice(0, 200)}`);
  out.includes('graph-first-gate') && out.toLowerCase().includes('could not answer')
    ? rep.ok('GF2 the miss is warned about on screen (never silent)')
    : rep.bad(`GF2 expected a visible miss warning, got: ${out.slice(0, 200)}`);
}

// ── GF3: no projection -> allow + warn (never a false block) ────────────────
{
  const graphPath = join(fx.proj, 'contextkit', 'memory', 'project-map', 'graph', 'graph.json');
  const saved = readFileSync(graphPath, 'utf-8');
  writeFileSync(graphPath, '{ this is not json', 'utf-8');
  const out = fx.hook('graph-first-gate.mjs', grepPayload(KNOWN));
  const isBlock = out.includes('"decision"') && out.includes('block');
  !isBlock ? rep.ok('GF3 unreadable projection -> never blocks (skipped, not a pass)') : rep.bad(`GF3 blocked on missing evidence: ${out.slice(0, 200)}`);
  out.includes('graph-first-gate') ? rep.ok('GF3 the unusable-graph case is surfaced') : rep.bad(`GF3 expected a warning, got: ${out.slice(0, 120)}`);
  writeFileSync(graphPath, saved, 'utf-8');
}

// ── GF4: a HUMAN bypass token disables the gate for the session ─────────────
{
  const before = fx.hook('graph-first-gate.mjs', grepPayload(KNOWN));
  before.includes('block') ? rep.ok('GF4 baseline: the gate blocks before any bypass') : rep.bad('GF4 baseline did not block');

  fx.hook('graph-first-gate.mjs', {
    session_id: SESSION,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'procura isso no projeto sem-grafo por favor',
  });
  const after = fx.hook('graph-first-gate.mjs', grepPayload(KNOWN));
  const stillBlocks = after.includes('"decision"') && after.includes('block');
  !stillBlocks ? rep.ok('GF4 human bypass token (pt-BR) -> the search is allowed') : rep.bad(`GF4 bypass ignored: ${after.slice(0, 200)}`);
}

// ── GF5/GF6/GF7/GF8: the gate stays inert where it must ────────────────────
{
  // A fresh session id, so GF4's bypass marker does not mask these.
  const sid = 'sess-graph-first-02';
  const read = fx.hook('graph-first-gate.mjs', { session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/billing.mjs' } });
  read.trim() === '' ? rep.ok('GF5 Read of a named file is never gated (silent)') : rep.bad(`GF5 expected silence, got: ${read.slice(0, 160)}`);

  const glob = fx.hook('graph-first-gate.mjs', { session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Glob', tool_input: { pattern: '**/*.mjs' } });
  const globBlocked = glob.includes('"decision"') && glob.includes('block');
  !globBlocked ? rep.ok('GF6 a bare glob is never blocked (no literal to ask the graph)') : rep.bad(`GF6 false block on a routine glob: ${glob.slice(0, 200)}`);

  const bad = run([join(fx.proj, 'contextkit', 'runtime', 'hooks', 'graph-first-gate.mjs')], { cwd: fx.proj, input: 'not json at all' });
  bad.status === 0 && (bad.stdout ?? '').trim() === ''
    ? rep.ok('GF7 malformed stdin -> exit 0, silent (fail-open)')
    : rep.bad(`GF7 expected silent exit 0, got status ${bad.status} out=${(bad.stdout ?? '').slice(0, 120)}`);

  setGraphConfig({ mode: 'advisory' });
  const advisory = fx.hook('graph-first-gate.mjs', { session_id: 'sess-graph-first-03', hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: KNOWN } });
  const advisoryBlocked = advisory.includes('"decision"') && advisory.includes('block');
  !advisoryBlocked ? rep.ok('GF8 mode:advisory -> never blocks (config kill switch works)') : rep.bad(`GF8 advisory mode still blocked: ${advisory.slice(0, 200)}`);
  setGraphConfig({ mode: 'guarded' });
}

// ── GF10: the graph is reachable over the installed MCP server ──────────────
{
  const server = join(fx.proj, 'contextkit', 'mcp-server', 'server.mjs');
  const listed = run([server], { cwd: fx.proj, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
  (listed.stdout ?? '').includes('query_graph')
    ? rep.ok('GF10 MCP advertises query_graph (the graph is reachable over MCP)')
    : rep.bad(`GF10 query_graph not advertised: ${(listed.stdout ?? '').slice(0, 160)}`);
  const called = run([server], { cwd: fx.proj, input: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'query_graph', arguments: { q: KNOWN } } }) + '\n' });
  (called.stdout ?? '').includes(KNOWN)
    ? rep.ok('GF10 MCP query_graph returns the known node')
    : rep.bad(`GF10 unexpected MCP result: ${(called.stdout ?? '').slice(0, 200)}`);
}

// ── GF9: the session refresh leaves a receipt and returns fast ──────────────
// LAST on purpose: this one spawns a REAL rebuild, which rewrites the projection
// the cases above depend on.
{
  // The refresh (correctly) refuses on a greenfield tree, so give the fixture a
  // source dir first — otherwise this would assert against the wrong guard.
  mkdirSync(join(fx.proj, 'src'), { recursive: true });
  writeFileSync(join(fx.proj, 'src', 'billing.mjs'), `export function ${KNOWN}() { return 1; }\n`, 'utf-8');

  const receiptPath = join(fx.proj, 'contextkit', 'memory', 'project-map', 'graph', '.session-refresh.json');
  const started = Date.now();
  fx.hook('graph-session-refresh.mjs', { session_id: 'sess-graph-refresh-01', hook_event_name: 'SessionStart' });
  const elapsed = Date.now() - started;

  if (existsSync(receiptPath)) {
    const receipt = readJson(receiptPath);
    receipt.sessionId === 'sess-graph-refresh-01' && receipt.status === 'spawned'
      ? rep.ok('GF9 session refresh writes a receipt (autoIndex finally has a real consumer)')
      : rep.bad(`GF9 unexpected receipt: ${JSON.stringify(receipt)}`);
    // Detached spawn: the hook must never wait for a multi-second rebuild (rule 2).
    elapsed < 5000 ? rep.ok(`GF9 refresh returns immediately (${elapsed}ms — detached, never delays boot)`) : rep.bad(`GF9 refresh blocked boot for ${elapsed}ms`);
    // A second SessionStart in the same session (resume/compaction) must not re-spawn.
    const firstAt = receipt.at;
    fx.hook('graph-session-refresh.mjs', { session_id: 'sess-graph-refresh-01', hook_event_name: 'SessionStart' });
    readJson(receiptPath).at === firstAt ? rep.ok('GF9 same session -> no double spawn (resume/compaction safe)') : rep.bad('GF9 re-spawned within the same session');
    // A different session DOES refresh again.
    fx.hook('graph-session-refresh.mjs', { session_id: 'sess-graph-refresh-02', hook_event_name: 'SessionStart' });
    readJson(receiptPath).sessionId === 'sess-graph-refresh-02' ? rep.ok('GF9 a new session refreshes again') : rep.bad('GF9 a new session did not refresh');
  } else {
    rep.bad('GF9 no refresh receipt was written');
  }

  // Let the detached child finish before cleanup: removing the tree from under a
  // live rebuild is a Windows EBUSY flake, not a real failure.
  waitMs(2500);
}

fx.cleanup();
rep.finish('graph-first exploration (WF-0108 / ADR-0155)');
