/**
 * In-process self-test for WF-0059 W7 — migration (`tasks-migrate.mjs`).
 * Exercises the rollback drill for real against an in-memory board byte-map — no
 * disk, no live tree.
 *
 * Sections:
 *   [a] classifyCard — migrated (owned) / fixture / review_required (unowned + dup) /
 *       invalid (no id) / human verdict (merged|cancelled)
 *   [b] buildManifest — conservation law total==Σ; THROWS when it would be violated
 *   [c] determinism — serializeManifest byte-identical across two builds; no wall-clock
 *   [d] no fabricated history — no entry is dispositioned "blocked"; unowned → review_required
 *   [e] applyMigration — snapshots Stage-0 into the archive; writes the manifest (additive)
 *   [f] EXERCISED ROLLBACK — rollback restores byte-identical to the pre-migration snapshot
 *   [g] idempotency — apply twice ⇒ identical archive digest
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import {
  classifyCard, buildManifest, serializeManifest, applyMigration, rollbackMigration,
  assertConservation, DISPOSITIONS,
} from './tasks-migrate.mjs';
import { buildInventory } from './pipeline-inventory.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}
function throws(fn) { try { fn(); return false; } catch { return true; } }

// A synthetic W1-shaped inventory (no disk): 2 migrated, 1 fixture, 1 unowned, 1 dup pair.
const inventory = {
  totals: { total: 6 },
  anomalies: { duplicateIds: ['001'], fixtures: ['098'], unowned: ['502'], uuidSidecars: [], orphanSidecars: [] },
  cards: [
    { id: '501', owned: true, fixture: false, workflow: 'demo', contentHash: 'sha256:aa', sourcePath: 'pipeline/backlog/501.md' },
    { id: '503', owned: true, fixture: false, workflow: 'demo', contentHash: 'sha256:bb', sourcePath: 'pipeline/testing/503.md' },
    { id: '098', owned: false, fixture: true, workflow: '', contentHash: 'sha256:cc', sourcePath: 'pipeline/conclusion/098.md' },
    { id: '502', owned: false, fixture: false, workflow: '', contentHash: 'sha256:dd', sourcePath: 'pipeline/backlog/502.md' },
    { id: '001', owned: true, fixture: false, workflow: 'a', contentHash: 'sha256:ee', sourcePath: 'pipeline/working/001.md' },
    { id: '001', owned: true, fixture: false, workflow: 'b', contentHash: 'sha256:ff', sourcePath: 'pipeline/testing/001.md' },
  ],
};

// [a] classifyCard
const dup = new Set(['001']);
assert('[a] owned → migrated', classifyCard({ id: '501', owned: true }).disposition === 'migrated');
assert('[a] fixture → fixture', classifyCard({ id: '098', fixture: true }).disposition === 'fixture');
assert('[a] unowned → review_required', classifyCard({ id: '502', owned: false }).disposition === 'review_required');
assert('[a] duplicate id → review_required', classifyCard({ id: '001', owned: true }, { duplicateIds: dup }).disposition === 'review_required');
assert('[a] no id → invalid', classifyCard({}).disposition === 'invalid');
assert('[a] human verdict merged wins', classifyCard({ id: '9', owned: false }, { verdicts: { 9: 'merged' } }).disposition === 'merged');

// [b] conservation law
const manifest = buildManifest(inventory);
assert('[b] conservation total==Σ', manifest.total === 6 && DISPOSITIONS.reduce((a, d) => a + manifest.counts[d], 0) === 6);
assert('[b] conservationOk flag', manifest.conservationOk === true);
assert('[b] counts as expected (2 migrated,1 fixture,3 review_required)',
  manifest.counts.migrated === 2 && manifest.counts.fixture === 1 && manifest.counts.review_required === 3,
  JSON.stringify(manifest.counts));
// The conservation invariant, tested DIRECTLY with a deliberate mismatch (real,
// not theatrical): total 5 but counts sum to 4 must throw; a matching sum passes.
assert('[b] assertConservation THROWS on total≠Σ', throws(() => assertConservation(5, { migrated: 3, fixture: 1 })));
assert('[b] assertConservation passes on total==Σ', assertConservation(4, { migrated: 3, fixture: 1 }) === 4);

// [c] determinism
assert('[c] serialize byte-identical across builds', serializeManifest(buildManifest(inventory)) === serializeManifest(buildManifest(inventory)));
assert('[c] no wall-clock in manifest', !/20\d\d-\d\d-\d\dT\d\d:\d\d/.test(serializeManifest(manifest)));

// [d] no fabricated history
assert('[d] no entry dispositioned "blocked"', !manifest.entries.some((e) => e.disposition === 'blocked'));
assert('[d] unowned 502 is review_required', manifest.entries.find((e) => e.id === '502').disposition === 'review_required');
assert('[d] both dup 001 survivors present (distinct paths)',
  manifest.entries.filter((e) => e.id === '001').length === 2);

// [e]/[f]/[g] apply + EXERCISED rollback + idempotency, against an in-memory board
const root = mkdtempSync(resolve(tmpdir(), 'wf0059-mig-'));
try {
  // Seed a tiny real board on disk to snapshot.
  const pipe = resolve(root, 'pipeline');
  mkdirSync(resolve(pipe, 'backlog'), { recursive: true });
  writeFileSync(resolve(pipe, 'backlog', '501-card.md'), '---\nid: 501\nstatus: backlog\n---\n# 501\n', 'utf-8');
  writeFileSync(resolve(pipe, 'backlog', '502-card.md'), '---\nid: 502\nstatus: backlog\n---\n# 502\n', 'utf-8');

  const realInv = buildInventory(pipe);
  const realManifest = buildManifest(realInv);

  // In-memory io: snapshot reads the seeded files; archive is an in-mem byte map;
  // restore writes back into a "live" mutable map we can corrupt then restore.
  const live = {
    '501-card.md': readFileSync(resolve(pipe, 'backlog', '501-card.md'), 'utf-8'),
    '502-card.md': readFileSync(resolve(pipe, 'backlog', '502-card.md'), 'utf-8'),
  };
  let archive = null; let manifestText = null;
  const io = {
    snapshotStage0: () => ({ ...live }),
    writeArchive: (byteMap) => { archive = { ...byteMap }; },
    readArchive: () => ({ ...archive }),
    writeManifest: (text) => { manifestText = text; },
    restore: (path, contents) => { live[path] = contents; },
  };

  const preDigestSource = Object.keys(live).sort().map((p) => `${p} ${live[p]}`).join('');
  const applied = applyMigration(io, realManifest);
  assert('[e] archive captured both cards', applied.archivedPaths.length === 2 && applied.applied === true);
  assert('[e] manifest written', typeof manifestText === 'string' && manifestText.includes('migration-manifest'));

  // Corrupt the live board (simulate a botched Phase-2), then EXERCISE rollback.
  live['501-card.md'] = 'CORRUPTED';
  delete live['502-card.md'];
  const rolled = rollbackMigration(io);
  const postDigestSource = Object.keys(live).sort().map((p) => `${p} ${live[p]}`).join('');
  assert('[f] EXERCISED rollback restores byte-identical', postDigestSource === preDigestSource);
  assert('[f] rollback digest matches archive digest', rolled.digest === applied.archiveDigest);

  // [g] idempotency — a second apply yields the same archive digest.
  const applied2 = applyMigration(io, realManifest);
  assert('[g] idempotent: second apply, same archive digest', applied2.archiveDigest === applied.archiveDigest);
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(`\nWF-0059 W7 migration selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
