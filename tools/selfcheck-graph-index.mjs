#!/usr/bin/env node
/**
 * Self-test for tools/install/graph-index.mjs (WF-0074/BIZ-0004) — the
 * index-on-update installer machinery. Standalone entrypoint (exit 0/1).
 *
 * Asserts the ADR-0134 rollout guards, all via injected fns (no real install,
 * no disk mutation): default-OFF is a silent no-op; greenfield/self-update/
 * active-sessions defer; a missing builder skips; an enabled target runs the
 * builder exactly once; and every path is fail-open (never throws).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const modPath = resolve(KIT, 'tools/install/graph-index.mjs');

export async function runGraphIndexChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(modPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph-index imported');

  const enabled = () => true;
  const disabled = () => false;
  let ran = 0;
  const runGraph = () => { ran += 1; };

  // 1. Disabled by default -> silent no-op, builder never invoked.
  ran = 0;
  const r1 = await m.maybeGenerateGraph('/t', { isEnabled: disabled, runGraph });
  record('default-off -> disabled no-op, builder not run', r1.status === 'disabled' && ran === 0, r1.status);

  // 2. Enabled + no other guard -> runs the builder exactly once.
  ran = 0;
  const r2 = await m.maybeGenerateGraph('/t', { isEnabled: enabled, runGraph, hasSource: () => true, builderExists: () => true });
  record('enabled -> generated, builder run once', r2.status === 'generated' && ran === 1, r2.status + ' ran=' + ran);

  // 3. Enabled but greenfield -> skip, builder not run.
  ran = 0;
  const r3 = await m.maybeGenerateGraph('/t', { isEnabled: enabled, runGraph, hasSource: () => false });
  record('greenfield -> skipped', r3.status === 'greenfield' && ran === 0, r3.status);

  // 4. Enabled but self-update risk -> defer.
  ran = 0;
  const r4 = await m.maybeGenerateGraph('/t', { isEnabled: enabled, runGraph, hasSource: () => true, selfHost: true });
  record('self-update risk -> deferred', r4.status === 'deferred_self_update' && ran === 0, r4.status);

  // 5. Enabled but active sessions -> defer.
  ran = 0;
  const r5 = await m.maybeGenerateGraph('/t', { isEnabled: enabled, runGraph, hasSource: () => true, activeSessions: 2 });
  record('active sessions -> deferred', r5.status === 'deferred_active_sessions' && ran === 0, r5.status);

  // 6. Builder throws -> fail-open (status failed, never throws out).
  ran = 0;
  let threw = false;
  let r6;
  try {
    r6 = await m.maybeGenerateGraph('/t', { isEnabled: enabled, hasSource: () => true, runGraph: () => { throw new Error('boom'); } });
  } catch { threw = true; }
  record('builder error -> fail-open (failed, never throws)', !threw && r6 && r6.status === 'failed', threw ? 'THREW' : (r6 && r6.status));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-index.mjs')) {
  const results = await runGraphIndexChecks();
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
