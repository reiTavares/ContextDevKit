#!/usr/bin/env node
/**
 * Integration test — project-map safe deferral (P0-09, ADR-0098, WF0033).
 *
 * Tests the structured result + deferral guards added in v3.1.2 to
 * `maybeGenerateBaseline` (project-map-baseline.mjs). Uses injectable
 * opts.runGenerator so no real generator or disk install is required.
 *
 * Cases: A already_exists · B greenfield · C/D defer active-sessions (array /
 * preflight) · E/F defer self-update (bool / preflight) · G generate · H failed
 * (generator throws, fail-open) · I idempotency (manifest after generate).
 *
 * Run:  node tools/integration-test-projmap-defer.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const { ok, bad } = rep;

async function loadBaseline() {
  const url = 'file:///' + resolve(KIT, 'tools/install/project-map-baseline.mjs').replaceAll('\\', '/');
  return import(url);
}

/** Throwaway temp dir + cleanup. */
function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pmd-it-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
/** Root-level .js → hasSourceFiles() true. */
const plantSource = (d) => writeFileSync(join(d, 'index.js'), '// stub\n');
/** Stub generator script so the generator-missing guard passes. */
function plantGenerator(d) {
  const s = join(d, 'contextkit', 'tools', 'scripts');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'project-map.mjs'), '// stub\n');
}
/** Stub manifest → already_exists guard. */
function plantManifest(d) {
  const m = join(d, 'contextkit', 'memory', 'project-map');
  mkdirSync(m, { recursive: true });
  writeFileSync(join(m, 'manifest.json'), JSON.stringify({ version: 1 }));
}
const spy = () => { const s = { calls: 0, fn: () => { s.calls += 1; } }; return s; };

/**
 * Table-driven guard cases (A–G): each plants a fixture, calls with opts, and
 * asserts the resulting status + whether the generator ran.
 * @param {Function} maybeGenerateBaseline
 */
async function guardCases(maybeGenerateBaseline) {
  const cases = [
    { id: 'A already_exists', plant: ['source', 'gen', 'manifest'], opts: {}, status: 'already_exists', calls: 0 },
    { id: 'B greenfield', plant: ['gen'], opts: {}, status: 'greenfield', calls: 0 },
    { id: 'C defer sessions (array)', plant: ['source', 'gen'], opts: { activeSessions: [{ id: 'a' }] }, status: 'deferred_active_sessions', calls: 0 },
    { id: 'D defer sessions (preflight)', plant: ['source', 'gen'], opts: { preflight: { status: 'DEFERRED_ACTIVE_SESSIONS' } }, status: 'deferred_active_sessions', calls: 0 },
    { id: 'E defer self-update (bool)', plant: ['source', 'gen'], opts: { selfHost: true }, status: 'deferred_self_update', calls: 0 },
    { id: 'F defer self-update (preflight)', plant: ['source', 'gen'], opts: { preflight: { status: 'DEFERRED_SELF_UPDATE' } }, status: 'deferred_self_update', calls: 0 },
    { id: 'G generate', plant: ['source', 'gen'], opts: {}, status: 'generated', calls: 1, noteIncludes: 'generated' },
  ];
  for (const c of cases) {
    const { dir, cleanup } = makeTempDir();
    try {
      if (c.plant.includes('source')) plantSource(dir);
      if (c.plant.includes('gen')) plantGenerator(dir);
      if (c.plant.includes('manifest')) plantManifest(dir);
      const sp = spy();
      const result = await maybeGenerateBaseline(dir, { runGenerator: sp.fn, ...c.opts });
      result?.status === c.status
        ? ok(`${c.id}: status "${c.status}"`)
        : bad(`${c.id}: expected "${c.status}"; got ${JSON.stringify(result?.status)}`);
      sp.calls === c.calls
        ? ok(`${c.id}: generator called ${c.calls}×`)
        : bad(`${c.id}: expected ${c.calls} call(s); got ${sp.calls}`);
      if (c.noteIncludes) {
        typeof result?.note === 'string' && result.note.includes(c.noteIncludes)
          ? ok(`${c.id}: note includes "${c.noteIncludes}"`)
          : bad(`${c.id}: note missing "${c.noteIncludes}"; got ${JSON.stringify(result?.note)}`);
      }
    } finally { cleanup(); }
  }
}

/** Case H — generator throws → fail-open ('failed', no escape). */
async function caseFailed(maybeGenerateBaseline) {
  const { dir, cleanup } = makeTempDir();
  try {
    plantSource(dir); plantGenerator(dir);
    let calls = 0;
    const throwing = () => { calls += 1; throw new Error('simulated generator failure'); };
    let threw = false, result;
    try { result = await maybeGenerateBaseline(dir, { runGenerator: throwing }); } catch { threw = true; }
    !threw ? ok('H: exception does NOT escape (fail-open)') : bad('H: exception escaped maybeGenerateBaseline');
    result?.status === 'failed' ? ok('H: status "failed" when generator throws') : bad(`H: expected "failed"; got ${JSON.stringify(result?.status)}`);
    calls === 1 ? ok('H: generator was called (then threw)') : bad(`H: expected 1 call; got ${calls}`);
  } finally { cleanup(); }
}

/** Case I — second call after a real generation sees the manifest. */
async function caseIdempotency(maybeGenerateBaseline) {
  const { dir, cleanup } = makeTempDir();
  try {
    plantSource(dir); plantGenerator(dir);
    const sp = spy();
    const generating = (genPath, cwd) => {
      sp.fn();
      const m = join(cwd, 'contextkit', 'memory', 'project-map');
      mkdirSync(m, { recursive: true });
      writeFileSync(join(m, 'manifest.json'), JSON.stringify({ version: 1 }));
    };
    const first = await maybeGenerateBaseline(dir, { runGenerator: generating });
    first?.status === 'generated' ? ok('I: first call "generated"') : bad(`I: expected "generated"; got ${JSON.stringify(first?.status)}`);
    const sp2 = spy();
    const second = await maybeGenerateBaseline(dir, { runGenerator: sp2.fn });
    second?.status === 'already_exists' ? ok('I: second call "already_exists" (idempotent)') : bad(`I: expected "already_exists"; got ${JSON.stringify(second?.status)}`);
    sp2.calls === 0 ? ok('I: generator NOT called on second invocation') : bad(`I: generator called ${sp2.calls}× on second invocation`);
  } finally { cleanup(); }
}

(async () => {
  console.log('\n🌀 Integration test — project-map safe deferral (P0-09, ADR-0098, WF0033)\n');
  let maybeGenerateBaseline;
  try {
    ({ maybeGenerateBaseline } = await loadBaseline());
    ok('tools/install/project-map-baseline.mjs imports cleanly');
  } catch (err) {
    bad(`import failed: ${err?.message ?? err}`);
    rep.finish('project-map safe deferral (P0-09)');
    return;
  }
  await guardCases(maybeGenerateBaseline);
  await caseFailed(maybeGenerateBaseline);
  await caseIdempotency(maybeGenerateBaseline);
  rep.finish('project-map safe deferral (P0-09, ADR-0098, WF0033)');
})();
