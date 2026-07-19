#!/usr/bin/env node
/**
 * Self-test for graph-activation.mjs (RO2, WF-0074/BIZ-0004) — standalone
 * entrypoint (exit 0/1), sibling-dispatched like the other BIZ-0004 selfchecks.
 *
 * Asserts the ADR-0134 rollout ladder: default-off; L4+ for any non-off mode;
 * guarded/strict require L7 AND an explicit human flip (else clamp to advisory —
 * never silently block); modeCanBlock is false without evidence (no block on
 * nothing). Deterministic.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/graph-activation.mjs');

const cfg = (graph) => ({ projectMap: { graph } });

export async function runGraphActivationChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(modPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph-activation imported');

  record('default (no config) -> off', m.resolveGraphActivation(7, {}).mode === 'off', '');
  record('enabled:false -> off', m.resolveGraphActivation(7, cfg({ enabled: false, mode: 'strict' })).mode === 'off', '');
  record('enabled but level < 4 -> off', m.resolveGraphActivation(3, cfg({ enabled: true, mode: 'advisory' })).mode === 'off', '');
  record('L4 shadow -> shadow', m.resolveGraphActivation(4, cfg({ enabled: true, mode: 'shadow' })).mode === 'shadow', '');
  record('L4 advisory -> advisory', m.resolveGraphActivation(4, cfg({ enabled: true, mode: 'advisory' })).mode === 'advisory', '');

  const guardedNoFlip = m.resolveGraphActivation(7, cfg({ enabled: true, mode: 'guarded', humanFlip: false }));
  record('L7 guarded WITHOUT human flip -> clamped to advisory (never silently blocks)', guardedNoFlip.mode === 'advisory',
    guardedNoFlip.mode + ' :: ' + guardedNoFlip.reason);

  const guardedFlip = m.resolveGraphActivation(7, cfg({ enabled: true, mode: 'guarded', humanFlip: true }));
  record('L7 guarded WITH human flip -> guarded', guardedFlip.mode === 'guarded', guardedFlip.mode);

  const strictFlip = m.resolveGraphActivation(7, cfg({ enabled: true, mode: 'strict', humanFlip: true }));
  record('L7 strict WITH human flip -> strict', strictFlip.mode === 'strict', strictFlip.mode);

  const strictLowLevel = m.resolveGraphActivation(4, cfg({ enabled: true, mode: 'strict', humanFlip: true }));
  record('strict below L7 -> clamped to advisory', strictLowLevel.mode === 'advisory', strictLowLevel.mode);

  const unknownMode = m.resolveGraphActivation(4, cfg({ enabled: true, mode: 'wibble' }));
  record('unknown mode -> safe default (shadow)', unknownMode.mode === 'shadow', unknownMode.mode);

  record('modeCanBlock(guarded, noEvidence) -> false (no block on nothing)', m.modeCanBlock('guarded', false) === false, '');
  record('modeCanBlock(guarded, evidence) -> true', m.modeCanBlock('guarded', true) === true, '');
  record('modeCanBlock(advisory, evidence) -> false', m.modeCanBlock('advisory', true) === false, '');

  const a = JSON.stringify(m.resolveGraphActivation(7, cfg({ enabled: true, mode: 'guarded', humanFlip: true })));
  const b = JSON.stringify(m.resolveGraphActivation(7, cfg({ enabled: true, mode: 'guarded', humanFlip: true })));
  record('deterministic (same input -> same output)', a === b, a === b ? 'identical' : 'DIVERGED');

  const source = readFileSync(modPath, 'utf-8');
  const bad = source.split(String.fromCharCode(10))
    .filter((l) => l.trim().indexOf('import ') === 0 && l.indexOf(' from ') !== -1)
    .map((l) => { const at = l.lastIndexOf('from '); const r = l.slice(at + 5).trim(); return r.slice(1, r.indexOf(r[0], 1)); })
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero-dep invariant (hot-path safe: node:* + relative only)', bad.length === 0, bad.length === 0 ? 'clean' : bad.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-activation.mjs')) {
  const results = await runGraphActivationChecks();
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
