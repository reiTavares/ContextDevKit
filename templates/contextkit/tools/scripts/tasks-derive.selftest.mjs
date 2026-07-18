/**
 * In-process self-test for WF-0059 W4 — the deterministic global derivation
 * (`tasks-derive.mjs`), the aggregator that projects every owner's
 * `tasks.json` into the derived-only project-wide board (SPEC §D6).
 *
 * Tests the ACTUAL exported API against synthetic owner documents (never
 * touches a live pipeline or reads disk — `deriveBoard` is pure):
 *   deriveBoard(ownerDocs)         → { schemaVersion, kind, totals, byOwner, byBatch, rows }
 *   renderBoardMarkdown(board)     → deterministic markdown string
 *   assertDerivedOnly(board)       → board | throws
 *
 * Sections:
 *   [a] determinism — two independent deriveBoard calls on the same input serialize byte-identical
 *   [b] byOwner rollup — per-owner counts + taskIds match the synthetic docs
 *   [c] byBatch rollup — tasks sharing a batchId under one owner summarize correctly
 *   [d] totals — per-state counts across the whole board
 *   [e] greenfield — deriveBoard([]) is a valid empty board, never throws
 *   [f] renderBoardMarkdown — deterministic across calls, carries the expected facts
 *   [g] defensive — malformed docs/tasks are skipped/normalized, never throw
 *   [h] assertDerivedOnly — accepts a genuine deriveBoard() output, throws on anything else
 *
 * Exit 0 = all held; exit 1 = at least one failed. No wall-clock in the output.
 */
import { deriveBoard, renderBoardMarkdown, assertDerivedOnly } from './tasks-derive.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/** Builds the synthetic two-owner fixture used across [a]-[d], [f]. */
function buildOwnerDocs() {
  return [
    {
      schemaVersion: 1, owner: { kind: 'WF', id: '1', lane: null }, revision: 0, executionMode: 'workflow',
      tasks: [
        { id: '10', title: 'Alpha', status: 'not_started', batchId: 'b1', sidecarRef: 'state/10' },
        { id: '11', title: 'Beta', status: 'working', batchId: 'b1', sidecarRef: 'state/11' },
        { id: '12', title: 'Gamma', status: 'done', sidecarRef: 'state/12' },
      ],
    },
    {
      schemaVersion: 1, owner: { kind: 'OP', id: '2', lane: null }, revision: 0, executionMode: 'direct',
      tasks: [
        { id: '1', title: 'Delta', status: 'blocked', sidecarRef: 'state/1' },
        { id: '2', title: 'Epsilon', status: 'testing', batchId: 'b2', sidecarRef: 'state/2' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
const docs = buildOwnerDocs();
const board = deriveBoard(docs);

// [a] determinism
{
  const once = JSON.stringify(deriveBoard(buildOwnerDocs()));
  const twice = JSON.stringify(deriveBoard(buildOwnerDocs()));
  assert('[a] byte-identical across two independent runs', once === twice);
  assert('[a] no wall-clock leak (no ISO timestamp)', !/20\d\d-\d\d-\d\dT\d\d:\d\d/.test(once));
  assert('[a] schemaVersion + kind stamped', board.schemaVersion === 1 && board.kind === 'derived-pipeline-board');
}

// [b] byOwner rollup
{
  assert('[b] byOwner has 2 entries, OP before WF (kind sort)', board.byOwner.length === 2
    && board.byOwner[0].owner.kind === 'OP' && board.byOwner[1].owner.kind === 'WF', JSON.stringify(board.byOwner.map((o) => o.owner)));
  const wf1 = board.byOwner.find((entry) => entry.owner.kind === 'WF' && entry.owner.id === '1');
  assert('[b] WF:1 counts total=3', wf1 && wf1.counts.total === 3, JSON.stringify(wf1?.counts));
  assert('[b] WF:1 taskIds sorted numeric-aware', wf1 && wf1.taskIds.join(',') === '10,11,12', wf1?.taskIds.join(','));
  const op2 = board.byOwner.find((entry) => entry.owner.kind === 'OP' && entry.owner.id === '2');
  assert('[b] OP:2 counts total=2, blocked=1, testing=1', op2 && op2.counts.total === 2 && op2.counts.blocked === 1 && op2.counts.testing === 1, JSON.stringify(op2?.counts));
}

// [c] byBatch rollup
{
  assert('[c] byBatch has 2 entries (b1 under WF:1, b2 under OP:2)', board.byBatch.length === 2, JSON.stringify(board.byBatch));
  const b1 = board.byBatch.find((entry) => entry.batchId === 'b1');
  assert('[c] b1 members are 10,11', b1 && b1.memberIds.join(',') === '10,11', b1?.memberIds.join(','));
  assert('[c] b1 counts: not_started=1, working=1, total=2', b1 && b1.counts.total === 2 && b1.counts.not_started === 1 && b1.counts.working === 1, JSON.stringify(b1?.counts));
  const b2 = board.byBatch.find((entry) => entry.batchId === 'b2');
  assert('[c] b2 members are 2, owner OP:2', b2 && b2.memberIds.join(',') === '2' && b2.owner.kind === 'OP', JSON.stringify(b2));
  assert('[c] task 12 (no batchId) creates no batch group', !board.byBatch.some((entry) => entry.memberIds.includes('12')));
}

// [d] totals
{
  assert('[d] totals.total===5', board.totals.total === 5, `got ${board.totals.total}`);
  assert('[d] not_started=1, working=1, blocked=1, testing=1, done=1', board.totals.not_started === 1
    && board.totals.working === 1 && board.totals.blocked === 1 && board.totals.testing === 1 && board.totals.done === 1, JSON.stringify(board.totals));
  assert('[d] rows sorted owner.kind → owner.id → id', board.rows.map((row) => `${row.ownerKind}:${row.ownerId}:${row.id}`).join('|')
    === 'OP:2:1|OP:2:2|WF:1:10|WF:1:11|WF:1:12', board.rows.map((row) => `${row.ownerKind}:${row.ownerId}:${row.id}`).join('|'));
}

// [e] greenfield
{
  const empty = deriveBoard([]);
  assert('[e] deriveBoard([]) totals.total===0', empty.totals.total === 0, `got ${empty.totals.total}`);
  assert('[e] deriveBoard([]) byOwner/byBatch/rows all empty arrays', Array.isArray(empty.byOwner) && empty.byOwner.length === 0
    && Array.isArray(empty.byBatch) && empty.byBatch.length === 0 && Array.isArray(empty.rows) && empty.rows.length === 0);
  assert('[e] deriveBoard(undefined) does not throw, empty board', (() => {
    try { return deriveBoard(undefined).totals.total === 0; } catch { return false; }
  })());
}

// [f] renderBoardMarkdown
{
  const rendered = renderBoardMarkdown(board);
  const renderedAgain = renderBoardMarkdown(deriveBoard(buildOwnerDocs()));
  assert('[f] byte-identical across calls', rendered === renderedAgain);
  assert('[f] carries owner labels', rendered.includes('WF:1') && rendered.includes('OP:2'));
  assert('[f] carries batch line for b1', rendered.includes('batch b1'));
  assert('[f] carries a task row for id 10', rendered.includes('| 10 |'));
  assert('[f] trailing newline', rendered.endsWith('\n') && !rendered.endsWith('\n\n'));
  const emptyRendered = renderBoardMarkdown(deriveBoard([]));
  assert('[f] empty board renders "_none_" sections without throwing', emptyRendered.includes('_none_'));
}

// [g] defensive on malformed docs
{
  const malformed = [
    null,
    42,
    {},                                                     // no owner
    { owner: { kind: 'ZZ', id: '1' }, tasks: [] },           // unknown owner kind
    { owner: { kind: 'WF', id: '9' } },                      // missing tasks[] → folds to []
    { owner: { kind: 'WF', id: '9' }, tasks: 'not-an-array' }, // non-array tasks
    { owner: { kind: 'WF', id: '9' }, tasks: [null, 42, {}, { id: '' }, { id: 'ok', status: 'not-a-real-state' }] },
  ];
  let result;
  let threw = false;
  try { result = deriveBoard(malformed); } catch { threw = true; }
  assert('[g] malformed docs never throw', !threw);
  assert('[g] only the resolvable owner (WF:9) with the one valid task survives', result
    && result.rows.length === 1 && result.rows[0].id === 'ok', JSON.stringify(result?.rows));
  assert('[g] a task with an unrecognized status normalizes to the initial state', result
    && result.rows[0].status === 'not_started', result?.rows[0]?.status);
}

// [h] assertDerivedOnly guard
{
  assert('[h] accepts a genuine deriveBoard() output', assertDerivedOnly(board) === board);
  const rejections = [undefined, null, {}, { kind: 'derived-pipeline-board' }, { schemaVersion: 1 }, docs[0]];
  assert('[h] rejects anything not stamped by deriveBoard()', rejections.every((candidate) => {
    try { assertDerivedOnly(candidate); return false; } catch { return true; }
  }));
}

process.stdout.write(`\nWF-0059 W4 derivation selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
