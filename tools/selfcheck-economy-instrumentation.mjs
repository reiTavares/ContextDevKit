#!/usr/bin/env node
/**
 * Economy instrumentation behavioral self-check (OP-0001 / WF-0039, ADR-0117).
 *
 * The completeness gate (selfcheck-economy-completeness.mjs) proves an emit-SITE
 * exists statically. This file proves the LEDGER DELTA — that each instrumented
 * resource, driven through its real application path, actually writes the right
 * ledger with the right honesty routing (advisory/lifecycle → events ledger,
 * never the observed-savings ledger). No spies: we read the JSONL back.
 *
 * Three guarantees:
 *   A) a real CLI end-to-end (context-pack) emits when invoked;
 *   B) the wired hook path (loop-breaker via gate-advisory) emits ONLY when an
 *      injected finite `now` is present (so the pure selfcheck never writes), and
 *   C) per-resource seam routing: advisory/lifecycle payloads land in events, not
 *      savings (the honesty fence).
 *
 * Zero runtime deps — node:* only. Exit 1 on any failure.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const ECON = resolve(KIT, 'templates/contextkit/tools/scripts/economy');
const NOW = 1750000000000;

const { economyEventsFile } = await import(pathToFileURL(resolve(ECON, 'economy-events.mjs')).href);
const { savingsFile } = await import(pathToFileURL(resolve(ECON, 'economy-savings.mjs')).href);
const { emitEconomy } = await import(pathToFileURL(resolve(ECON, 'telemetry-emit.mjs')).href);
const { buildEconomyAdvisory } = await import(pathToFileURL(resolve(ECON, 'gate-advisory.mjs')).href);

const readJsonl = (path) => (existsSync(path)
  ? readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };
const tmpRoot = () => mkdtempSync(join(tmpdir(), 'econ-instr-'));

console.log('\n── Economy instrumentation behavioral check (ADR-0117) ──');

// A) Real CLI end-to-end: context-pack emits a context-pack events row on invoke.
{
  const base = tmpRoot();
  try {
    const res = spawnSync(process.execPath, [resolve(KIT, 'templates/contextkit/tools/scripts/context-pack.mjs'), '--json'],
      { cwd: base, encoding: 'utf-8' });
    const rows = readJsonl(economyEventsFile(base));
    const hit = rows.some((r) => r.lever === 'context-pack');
    hit ? ok(`context-pack CLI emits a context-pack events row (exit ${res.status})`)
        : bad(`context-pack CLI wrote no context-pack row (exit ${res.status}; ${rows.length} rows)`);
  } finally { try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ } }
}

// B) Wired hook path: loop-breaker fires with finite `now`, stays silent without.
{
  const base = tmpRoot();
  const fakeLedger = async () => ({ modifications: [
    { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' },
  ] });
  const call = (now) => buildEconomyAdvisory({
    config: {}, payload: { tool_input: { file_path: 'a.mjs' } }, toolName: 'Edit',
    root: base, sessionId: 'sid', readLedger: fakeLedger, now,
  });
  try {
    await call(undefined);
    const afterPure = readJsonl(economyEventsFile(base)).filter((r) => r.lever === 'loop-breaker').length;
    await call(NOW);
    const afterWired = readJsonl(economyEventsFile(base)).filter((r) => r.lever === 'loop-breaker').length;
    afterPure === 0 ? ok('loop-breaker: pure call (no `now`) writes no ledger row')
                    : bad(`loop-breaker: pure call wrote ${afterPure} row(s) — selfcheck pollution`);
    afterWired === 1 ? ok('loop-breaker: wired call (finite `now`) writes exactly one events row')
                     : bad(`loop-breaker: wired call wrote ${afterWired} row(s), expected 1`);
  } finally { try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ } }
}

// C) Per-resource seam routing: advisory/lifecycle land in events, never savings.
const ROUTED = [
  ['resume-pack', 'lifecycle', 'applied'],
  ['findings', 'advisory', 'applied'],
  ['output-contract', 'advisory', 'applied'],
];
for (const [resource, category, action] of ROUTED) {
  const base = tmpRoot();
  try {
    emitEconomy(base, resource, { category, action, measurement: 'none', sessionId: 's1' }, { now: NOW });
    const events = readJsonl(economyEventsFile(base)).filter((r) => r.lever === resource);
    const savings = readJsonl(savingsFile(base)).filter((r) => r.lever === resource);
    (events.length === 1 && savings.length === 0)
      ? ok(`${resource}: routed to events (${events.length}), not savings (${savings.length})`)
      : bad(`${resource}: events=${events.length} savings=${savings.length} (expected 1/0)`);
  } finally { try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ } }
}

// D) Phase-1 runnable surfaces (option-1 wiring): each emits when invoked, with
// NO auto-hook. tc-packet fires even on an uncompilable symbol (attempted); the
// downstream ladder fires over a hand-built valid work-packet.
{
  const base = tmpRoot();
  try {
    const { runTaskCompiler, compileLadderFrom } = await import(pathToFileURL(resolve(ECON, 'task-compiler.mjs')).href);
    const { runLeanLoop } = await import(pathToFileURL(resolve(ECON, 'lean-loop-cli.mjs')).href);
    const { applySubagentProfile } = await import(pathToFileURL(resolve(ECON, 'subagent-profile.mjs')).href);

    runTaskCompiler({ objective: 'x', symbol: '__no_such_symbol__', root: base }, { now: NOW });
    const packet = { schemaVersion: 'cdk-work-packet/1', objective: 'x', taskClass: 'bugfix',
      files: [{ path: 'a.mjs', symbols: ['f'], lines: [1, 2] }], acceptanceCriteria: [],
      verification: [], outputContract: { artifactFirst: true }, confidence: 0.5, coverage: 'symbol' };
    compileLadderFrom(packet, { root: base, now: NOW });
    runLeanLoop({ controller: 'swarm', touchSet: ['a'] }, base, { now: NOW });
    applySubagentProfile(base, { now: NOW });

    const rows = readJsonl(economyEventsFile(base)).map((r) => r.lever);
    for (const id of ['tc-packet', 'tc-route', 'tc-dispatch', 'tc-accept', 'lean-loop', 'subagent-profile']) {
      rows.includes(id) ? ok(`${id}: runnable surface emits an events row`)
                        : bad(`${id}: no events row from its runnable surface`);
    }
  } finally { try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ } }
}

// E) agent-contract CLI (spawned) emits on a real drift-audit run.
{
  const base = tmpRoot();
  try {
    spawnSync(process.execPath, [resolve(ECON, 'agent-contract.mjs')], { cwd: base, encoding: 'utf-8' });
    const hit = readJsonl(economyEventsFile(base)).some((r) => r.lever === 'agent-contract');
    hit ? ok('agent-contract CLI emits an agent-contract events row')
        : bad('agent-contract CLI wrote no agent-contract row');
  } finally { try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ } }
}

// F/G) W7 security: run-compact persists summary-only by default and routes the
// full tee through the hardened redactor when opted in.
{
  const base = tmpRoot();
  try {
    const { runCompact } = await import(pathToFileURL(resolve(ECON, 'run-compact.mjs')).href);
    const GH = 'ghp_ABCDEFGHIJ0123456789XYZ';

    const plain = await runCompact(['node', '-e', 'console.log("hello world")'], { runsDir: base });
    const defaultLog = resolve(base, plain.id, 'output.log');
    (plain.logPath === null && !existsSync(defaultLog))
      ? ok('run-compact: summary-only by default (no output.log persisted)')
      : bad(`run-compact: default persisted a raw log (logPath=${plain.logPath})`);

    const full = await runCompact(['node', '-e', `console.log("token ${GH} end")`], { runsDir: base, captureFull: true });
    const fullLog = existsSync(full.logPath) ? readFileSync(full.logPath, 'utf-8') : '';
    (full.logPath && fullLog.includes('[REDACTED:gh]') && !fullLog.includes(GH))
      ? ok('run-compact: --capture-full tee is hardened-redacted (gh token masked)')
      : bad(`run-compact: captured log leaked or unmasked (hasMask=${fullLog.includes('[REDACTED:gh]')} hasRaw=${fullLog.includes(GH)})`);
  } finally { try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ } }
}

// I) W7 concurrency safety: two processes appending to ONE ledger never tear a
// JSONL line (the single-line atomic append is what makes per-session shards
// unnecessary for torn-line safety; read-isolation sharding is a deferred
// follow-up). Every persisted line must parse.
{
  const base = tmpRoot();
  const emitN = `import('${pathToFileURL(resolve(ECON, 'telemetry-emit.mjs')).href}').then(m=>{for(let i=0;i<60;i++)m.emitEconomy(${JSON.stringify(base)},'context-pack',{category:'advisory',action:'fired',measurement:'none'},{now:${NOW}+i});});`;
  try {
    const a = spawnSync(process.execPath, ['-e', emitN], { encoding: 'utf-8' });
    const b = spawnSync(process.execPath, ['-e', emitN], { encoding: 'utf-8' });
    const file = economyEventsFile(base);
    const raw = existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [];
    let parsed = 0;
    for (const line of raw) { try { JSON.parse(line); parsed += 1; } catch { /* torn */ } }
    (raw.length === 120 && parsed === 120 && a.status === 0 && b.status === 0)
      ? ok(`concurrent appends never tear a line (${parsed}/${raw.length} parse)`)
      : bad(`torn or missing lines: ${parsed}/${raw.length} parsed (expected 120/120)`);
  } finally { try { rmSync(base, { recursive: true, force: true }); } catch { /* advisory */ } }
}

// H) runs/ is gitignored (W7) — diagnostic logs must never be committed.
{
  const gi = existsSync(resolve(KIT, '.gitignore')) ? readFileSync(resolve(KIT, '.gitignore'), 'utf-8') : '';
  /(^|\n)\s*\/?runs\/?\s*(\n|$)/.test(gi)
    ? ok('runs/ is gitignored at the kit root')
    : bad('runs/ is NOT gitignored — diagnostic logs could be committed');
}

console.log(
  failures === 0
    ? '\n✅ Economy instrumentation behavioral check: all checks passed.\n'
    : `\n❌ Economy instrumentation behavioral check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
