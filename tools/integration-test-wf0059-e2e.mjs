#!/usr/bin/env node
/**
 * WF-0059 W9 — end-to-end integration + environment matrix.
 *
 * The capstone suite: it composes ALL eight wave modules through one realistic
 * flow against a temp-dir board (no live tree, no disk pollution), proving the
 * waves interoperate — not just that each passes in isolation. Maps to the
 * deliberation's "environment matrix" acceptance condition (SPEC §"Test plan"
 * row 9): clean-clone, greenfield, projection-parity, and the full lifecycle.
 *
 * Flow:
 *   [1] GREENFIELD — empty board ⇒ valid empty inventory + empty derived board
 *   [2] SEED + INVENTORY — a synthetic board ⇒ deterministic Stage-0 inventory
 *   [3] SCHEMA + LIFECYCLE — build a tasks.json, drive it through the transition
 *       engine (journal-first), validate the fold==status fence end-to-end
 *   [4] DERIVATION + PARITY — derive the global board; assert parity vs the oracle
 *   [5] CAS — a concurrent write races; loser retries, no orphan event
 *   [6] COMPAT — an old workflow: string resolves; an ambiguous legacy id refuses
 *   [7] MIGRATION + EXERCISED ROLLBACK — manifest conservation holds; rollback
 *       restores byte-identical
 *   [8] CUTOVER + FENCE — cutover gated on parity+rollback; old writer fenced after
 *
 * Zero-dep, `node:*` only. Exit 0 = all held; exit 1 = at least one failed.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildInventory } from '../templates/contextkit/tools/scripts/pipeline-inventory.mjs';
import { validateTasksDoc, assertTasksDoc } from '../templates/contextkit/tools/scripts/tasks-validate.mjs';
import { foldStatus } from '../templates/contextkit/tools/scripts/tasks-schema.mjs';
import { applyTransition } from '../templates/contextkit/tools/scripts/tasks-transition.mjs';
import { deriveBoard } from '../templates/contextkit/tools/scripts/tasks-derive.mjs';
import { casUpdate, casTransition, CasConflict } from '../templates/contextkit/tools/scripts/tasks-cas.mjs';
import { resolveWorkflowString, resolveLegacyId } from '../templates/contextkit/tools/scripts/tasks-compat.mjs';
import { buildManifest, applyMigration, rollbackMigration } from '../templates/contextkit/tools/scripts/tasks-migrate.mjs';
import { checkParity, cutover, fenceOldWriter, OldWriterFenced } from '../templates/contextkit/tools/scripts/tasks-cutover.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}
function throwsType(fn, Type) { try { fn(); return false; } catch (e) { return Type ? e instanceof Type : true; } }

/** In-memory journal + status projection io for the transition engine. */
function makeTaskIo() {
  const store = { events: [], status: undefined };
  return {
    store,
    readEvents: () => store.events,
    appendEvent: (_id, e) => store.events.push(e),
    writeStatus: (_id, s) => { store.status = s; },
  };
}

console.log('\n🌀 WF-0059 W9 — end-to-end integration + environment matrix\n');

// [1] GREENFIELD
{
  const root = mkdtempSync(resolve(tmpdir(), 'wf0059-e2e-gf-'));
  try {
    const inv = buildInventory(resolve(root, 'pipeline')); // dir absent
    assert('[1] greenfield inventory empty + valid', inv.totals.total === 0 && inv.cards.length === 0);
    const board = deriveBoard([]);
    assert('[1] greenfield derived board empty + valid', board.totals.total === 0 && board.rows.length === 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// [2] SEED + INVENTORY (deterministic)
const root = mkdtempSync(resolve(tmpdir(), 'wf0059-e2e-'));
try {
  const pipe = resolve(root, 'pipeline');
  for (const lane of ['backlog', 'working', 'testing', 'conclusion', 'state']) mkdirSync(resolve(pipe, lane), { recursive: true });
  const card = (lane, id, wf) => writeFileSync(resolve(pipe, lane, `${id}-c.md`),
    `---\nid: ${id}\ntitle: card ${id}\nstatus: ${lane}\n${wf ? `workflow: ${wf}\n` : ''}---\n# ${id}\n`, 'utf-8');
  card('backlog', '701', 'demo'); card('testing', '702', 'demo'); card('conclusion', '703', 'demo');
  const inv1 = buildInventory(pipe);
  const inv2 = buildInventory(pipe);
  assert('[2] inventory deterministic (byte-stable)', JSON.stringify(inv1) === JSON.stringify(inv2));
  assert('[2] inventory sees 3 cards', inv1.totals.total === 3);

  // [3] SCHEMA + LIFECYCLE via the transition engine
  const io = makeTaskIo();
  applyTransition(io, { id: '701', to: 'working', actor: 'auto' });
  applyTransition(io, { id: '701', to: 'testing', actor: 'auto' });
  applyTransition(io, { id: '701', to: 'done', actor: 'qa', acceptanceMet: true, evidenceRef: 'reports/701.md' });
  assert('[3] lifecycle folds to done', foldStatus(io.store.events) === 'done' && io.store.status === 'done');
  const doc = {
    schemaVersion: 1, owner: { kind: 'WF', id: 'WF-0059', lane: null }, revision: 3, executionMode: 'workflow',
    tasks: [{
      id: '701', title: 'seeded', type: 'feature', status: 'done', owner: { kind: 'WF', id: 'WF-0059', lane: null },
      sidecarRef: 'state/701', acceptanceMet: true, evidenceRef: 'reports/701.md', blocker: null,
    }],
  };
  const v = validateTasksDoc(doc, { resolveOwner: () => true, foldEvents: () => io.store.events });
  assert('[3] doc validates with fold==status fence', v.ok, JSON.stringify(v.errors));
  assert('[3] assertTasksDoc chains on valid', assertTasksDoc(doc, { resolveOwner: () => true }).revision === 3);

  // [4] DERIVATION + PARITY vs oracle
  const oracle = { cards: [{ id: '701', status: 'working' }, { id: '702', status: 'testing' }] };
  const board = deriveBoard([{
    schemaVersion: 1, owner: { kind: 'WF', id: 'WF-0059' }, revision: 1, executionMode: 'workflow',
    tasks: [
      { id: '701', title: 'a', status: 'working', owner: { kind: 'WF', id: 'WF-0059' }, sidecarRef: 's/701' },
      { id: '702', title: 'b', status: 'testing', owner: { kind: 'WF', id: 'WF-0059' }, sidecarRef: 's/702' },
    ],
  }]);
  assert('[4] derived board byte-stable', JSON.stringify(board) === JSON.stringify(deriveBoard([{
    schemaVersion: 1, owner: { kind: 'WF', id: 'WF-0059' }, revision: 1, executionMode: 'workflow',
    tasks: [
      { id: '701', title: 'a', status: 'working', owner: { kind: 'WF', id: 'WF-0059' }, sidecarRef: 's/701' },
      { id: '702', title: 'b', status: 'testing', owner: { kind: 'WF', id: 'WF-0059' }, sidecarRef: 's/702' },
    ],
  }])));
  assert('[4] parity derived↔oracle holds', checkParity(board, oracle).ok, JSON.stringify(checkParity(board, oracle).mismatches));

  // [5] CAS concurrency — loser retries, no lost update
  {
    const box = { doc: { revision: 0, tasks: [] } };
    let reads = 0;
    const casIo = {
      read() { reads += 1; const snap = { doc: box.doc, revision: box.doc.revision }; if (reads === 1) box.doc = { revision: 1, tasks: ['racer'] }; return snap; },
      commit(next, expected) { if (box.doc.revision !== expected) throw new CasConflict(expected, box.doc.revision); box.doc = next; return next.revision; },
    };
    const res = casUpdate(casIo, (d) => ({ ...d, tasks: [...d.tasks, 'mine'] }));
    assert('[5] CAS retried + no lost update', res.attempts >= 2 && box.doc.tasks.includes('racer') && box.doc.tasks.includes('mine'));
  }

  // [6] COMPAT — resolve + refuse-ambiguous
  assert('[6] workflow string → FK', resolveWorkflowString('demo', () => 'WF-0059').id === 'WF-0059');
  assert('[6] ambiguous legacy id REFUSES', throwsType(() => resolveLegacyId('001', { '001': [{ owner: 'a' }, { owner: 'b' }] })));

  // [7] MIGRATION + EXERCISED ROLLBACK
  const manifest = buildManifest(inv1);
  assert('[7] manifest conservation holds', manifest.conservationOk && manifest.total === 3);
  const live = { '701-c.md': readFileSync(resolve(pipe, 'backlog', '701-c.md'), 'utf-8') };
  let archive = null;
  const migIo = {
    snapshotStage0: () => ({ ...live }), writeArchive: (b) => { archive = { ...b }; },
    readArchive: () => ({ ...archive }), writeManifest: () => {}, restore: (p, c) => { live[p] = c; },
  };
  const pre = JSON.stringify(live);
  applyMigration(migIo, manifest);
  live['701-c.md'] = 'CORRUPTED';
  rollbackMigration(migIo);
  assert('[7] exercised rollback restores byte-identical', JSON.stringify(live) === pre);

  // [8] CUTOVER + FENCE
  {
    const box = { marker: null };
    const cio = { readMarker: () => box.marker, writeMarker: (m) => { box.marker = m; } };
    assert('[8] cutover refused pre-gates', throwsType(() => cutover(cio, { parityOk: false, rollbackExercised: false }, 'T0')));
    cutover(cio, { parityOk: true, rollbackExercised: true }, 'T1');
    assert('[8] cutover to Phase 2', box.marker.phase === 'phase2');
    assert('[8] old writer fenced post-cutover', throwsType(() => fenceOldWriter(cio, 'move', '701'), OldWriterFenced));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\nWF-0059 W9 end-to-end: ${failures.length === 0 ? '✅ PASS' : `❌ FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
