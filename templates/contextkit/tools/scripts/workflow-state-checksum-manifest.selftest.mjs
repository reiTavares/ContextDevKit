/**
 * Selftest — workflow-state-checksum-manifest (WF-0087 D5, immutable rule 3).
 *
 * Proves the drift net over the concluded corpus: unchanged passes, a byte
 * change is drift, a removal is drift, and a NEWLY-concluded workflow is normal
 * growth (added, NOT drift). Uses a temp memory fixture; no real corpus touched.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChecksumManifest, checkAgainstManifest } from './workflow-state-checksum-manifest.mjs';

const failures = [];
/** @param {string} label @param {boolean} cond */
function assert(label, cond) {
  if (cond) process.stdout.write(`  ok   ${label}\n`);
  else { failures.push(label); process.stdout.write(`  FAIL ${label}\n`); }
}

/** Write a concluded workflow-state under `<root>/contextkit/memory/business/<biz>/done/<wf>/`. */
function seedConcluded(root, biz, wf, body) {
  const dir = join(root, 'contextkit', 'memory', 'business', biz, 'done', wf);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'workflow-state.json'), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return join(dir, 'workflow-state.json');
}

const root = mkdtempSync(join(tmpdir(), 'wf0087-checksum-'));
try {
  const stateA = { schemaVersion: 1, overallStatus: 'done', revision: 3, taskStates: { 'A-T1': { status: 'done' } } };
  const stateB = { schemaVersion: 1, overallStatus: 'done', revision: 5, taskStates: { 'B-T1': { status: 'done' } } };
  seedConcluded(root, 'BIZ-9001-alpha', 'WF-9001-a', stateA);
  const pathB = seedConcluded(root, 'BIZ-9001-alpha', 'WF-9002-b', stateB);

  const manifest = buildChecksumManifest(root);
  assert('[a] manifest counts every concluded state', manifest.count === 2 && manifest.entries.length === 2);
  assert('[a] entries carry a sha256 digest + path', manifest.entries.every((e) => /^sha256:[0-9a-f]{64}$/.test(e.digest) && e.path.endsWith('/workflow-state.json')));

  assert('[b] unchanged corpus passes', checkAgainstManifest(root, manifest).ok === true);

  // [c] a byte change to a pinned file is drift.
  writeFileSync(pathB, `${JSON.stringify({ ...stateB, revision: 6 }, null, 2)}\n`, 'utf8');
  const changed = checkAgainstManifest(root, manifest);
  assert('[c] a byte change is drift (not ok)', changed.ok === false);
  assert('[c] the changed path is named', changed.changed.some((p) => p.includes('WF-9002-b')));

  // [d] a NEWLY concluded workflow is growth, not drift.
  const freshManifest = buildChecksumManifest(root); // re-pin current bytes
  seedConcluded(root, 'BIZ-9001-alpha', 'WF-9003-c', { schemaVersion: 1, overallStatus: 'done', revision: 1, taskStates: {} });
  const grown = checkAgainstManifest(root, freshManifest);
  assert('[d] a new concluded workflow is added, not drift → still ok', grown.ok === true);
  assert('[d] the added workflow is reported', grown.added.some((p) => p.includes('WF-9003-c')));

  // [e] a removed pinned file is drift.
  const pinned = buildChecksumManifest(root);
  rmSync(join(root, 'contextkit', 'memory', 'business', 'BIZ-9001-alpha', 'done', 'WF-9003-c'), { recursive: true, force: true });
  const removed = checkAgainstManifest(root, pinned);
  assert('[e] a removed pinned file is drift (not ok)', removed.ok === false && removed.removed.some((p) => p.includes('WF-9003-c')));
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(`\nworkflow-state-checksum-manifest selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
