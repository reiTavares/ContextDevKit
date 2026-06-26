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

console.log(
  failures === 0
    ? '\n✅ Economy instrumentation behavioral check: all checks passed.\n'
    : `\n❌ Economy instrumentation behavioral check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
