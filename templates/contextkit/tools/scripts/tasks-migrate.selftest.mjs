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
  assertConservation, DISPOSITIONS, migrateWorkflow, reconcileWorkflowTaskStates,
  reconcileWorkflowCorpus,
} from './tasks-migrate.mjs';
import { planHash } from './workflow/plan.mjs';
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

// [b2] workflow derive step — read-only, journal-first, planHash-bound.
const workflowPlan = {
  schemaVersion: 1, workflowId: '0087', slug: 'wf-0087', profile: 'program',
  waves: [{ id: 'TL0', tasks: [{ id: 'TL0-T1', waveId: 'TL0', title: 'Inventory' }] }],
  gates: [],
};
const workflowHash = planHash(workflowPlan);
const cleanWorkflow = migrateWorkflow({
  plan: workflowPlan,
  workflowState: { revision: 4, planHash: workflowHash, taskStates: {} },
  journals: {},
});
assert('[b2] clean initial workflow migration is ready', cleanWorkflow.status === 'ready');
assert('[b2] migration projection starts not_started', cleanWorkflow.projection.tasks[0].status === 'not_started');
assert('[b2] planHash is preserved as a migration binding', cleanWorkflow.planHash === workflowHash);
const journalWorkflow = migrateWorkflow({
  plan: workflowPlan,
  workflowState: { revision: 5, planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
  journals: { 'TL0-T1': [{ from: 'not_started', to: 'working', actor: 'auto' }] },
});
assert('[b2] journal fold drives the read-only projection', journalWorkflow.status === 'ready' && journalWorkflow.projection.tasks[0].status === 'working');
// [b2] provenance-aware verdicts (D1, ADR-0148). A missing journal on a
// concluded NON-initial status is INFERRED evidence — reconciled-by-inference,
// never a silent block and never fabricated into an observed pass (§8).
const inferred = reconcileWorkflowTaskStates(
  workflowPlan,
  { planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
  {},
);
assert('[b2] missing journal on non-initial status is reconciled-by-inference',
  inferred.verdict === 'reconciled-by-inference' && inferred.divergences[0].kind === 'missing-journal');
assert('[b2] inferred reconciliation is not observed', inferred.provenance.observed === false);
// A real fold-mismatch (journal present, folds to a different status) is a
// GENUINE divergence — quarantined, never reconciled.
const foldMismatch = reconcileWorkflowTaskStates(
  workflowPlan,
  { planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
  { 'TL0-T1': [] },
);
assert('[b2] fold-mismatch quarantines', foldMismatch.verdict === 'quarantined');
// plan-hash-mismatch quarantines (a post-conclusion plan drift must not be reconciled away).
const planDrift = reconcileWorkflowTaskStates(
  workflowPlan,
  { planHash: 'sha256:stale', taskStates: {} },
  {},
);
assert('[b2] plan-hash-mismatch quarantines',
  planDrift.verdict === 'quarantined' && planDrift.divergences.some((divergence) => divergence.kind === 'plan-hash-mismatch'));
// state-task-not-in-plan quarantines (an orphan task is a genuine inconsistency).
const orphanTask = reconcileWorkflowTaskStates(
  workflowPlan,
  { planHash: workflowHash, taskStates: { 'GHOST-T9': { status: 'done' } } },
  {},
);
assert('[b2] state-task-not-in-plan quarantines',
  orphanTask.verdict === 'quarantined' && orphanTask.divergences.some((divergence) => divergence.kind === 'state-task-not-in-plan'));
// An observed journal that folds to the recorded status is ready + observed.
const observed = reconcileWorkflowTaskStates(
  workflowPlan,
  { planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
  { 'TL0-T1': [{ from: 'not_started', to: 'working', actor: 'auto' }] },
);
assert('[b2] observed journal fold is ready + observed',
  observed.verdict === 'ready' && observed.provenance.observed === true);

const mismatchedJournal = migrateWorkflow({
  plan: workflowPlan,
  workflowState: { planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
  journals: { 'TL0-T1': [] },
});
assert('[b2] fold mismatch refuses migration', mismatchedJournal.status === 'quarantined');

// Corpus: an all-observed corpus is ready.
const corpusReceipt = reconcileWorkflowCorpus([
  {
    plan: workflowPlan,
    workflowState: { planHash: workflowHash, taskStates: {} },
    journals: {},
  },
  {
    plan: workflowPlan,
    workflowState: { planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
    journals: { 'TL0-T1': [{ from: 'not_started', to: 'working', actor: 'auto' }] },
  },
]);
assert('[b2] fully observed corpus is ready', corpusReceipt.status === 'ready' && corpusReceipt.workflowCount === 2);

// Corpus: an inferred-only corpus is READY (corpus-safe) but each result is
// reconciled-by-inference — corpus-green does NOT mean cutover-authorized.
const inferredCorpus = reconcileWorkflowCorpus([
  {
    plan: workflowPlan,
    workflowState: { planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
    journals: {},
  },
]);
assert('[b2] inferred-only corpus is ready but non-authorizing',
  inferredCorpus.status === 'ready' && inferredCorpus.results[0].status === 'reconciled-by-inference');
assert('[b2] inferred projection is marked not observed',
  inferredCorpus.results[0].projection.provenance.observed === false);

// Corpus: a genuine divergence quarantines the whole corpus.
const blockedCorpus = reconcileWorkflowCorpus([
  {
    plan: workflowPlan,
    workflowState: { planHash: workflowHash, taskStates: { 'TL0-T1': { status: 'working' } } },
    journals: { 'TL0-T1': [] },
  },
]);
assert('[b2] divergent corpus is quarantined', blockedCorpus.status === 'quarantined');

// Excluded refs are partitioned out and recorded explicitly, never dropped (§8).
const excludedCorpus = reconcileWorkflowCorpus([
  { plan: { workflowId: 'WF-0080' }, excluded: true, exclusionReason: 'BIZ-0004 parallel session (WF-0086)' },
]);
assert('[b2] excluded-only corpus is skipped (no in-scope refs)', excludedCorpus.status === 'skipped');
assert('[b2] excluded ref is recorded explicitly, not dropped',
  excludedCorpus.excluded.length === 1 && excludedCorpus.excluded[0].workflowId === 'WF-0080');
const mixedCorpus = reconcileWorkflowCorpus([
  { plan: workflowPlan, workflowState: { planHash: workflowHash, taskStates: {} }, journals: {} },
  { plan: { workflowId: 'WF-0080' }, excluded: true, exclusionReason: 'BIZ-0004 parallel session' },
]);
assert('[b2] excluded does not block an otherwise-ready corpus',
  mixedCorpus.status === 'ready' && mixedCorpus.workflowCount === 1 && mixedCorpus.excluded.length === 1);
assert('[b2] empty corpus is skipped, never pass', reconcileWorkflowCorpus([]).status === 'skipped');

// 0-planHash-breakage: reconcile/migrate never mutate the input plan's waves[].tasks.
const planBefore = JSON.stringify(workflowPlan);
migrateWorkflow({ plan: workflowPlan, workflowState: { planHash: workflowHash, taskStates: {} }, journals: {} });
reconcileWorkflowCorpus([{ plan: workflowPlan, workflowState: { planHash: workflowHash, taskStates: {} }, journals: {} }]);
assert('[b2] 0 planHash breakage: input plan is structurally untouched', JSON.stringify(workflowPlan) === planBefore);

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
