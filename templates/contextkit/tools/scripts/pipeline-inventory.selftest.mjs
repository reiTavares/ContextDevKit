/**
 * In-process self-test for WF-0059 W1 — the Stage-0 pipeline inventory
 * (`pipeline-inventory.mjs`), the migration parity oracle.
 *
 * Tests the ACTUAL exported API against a synthetic on-disk board built in a
 * temp dir (never touches the live pipeline):
 *   buildInventory(pipeDir)        → { schemaVersion, kind, totals, anomalies, cards }
 *   serializeInventory(inventory)  → byte-stable JSON string
 *   detectAnomalies(cards, ids)    → { duplicateIds, fixtures, unowned, uuidSidecars, orphanSidecars }
 *   contentHash(text)              → deterministic sha256:… prefix
 *   listSidecarIds(pipeDir)        → sorted sidecar ids
 *
 * Sections:
 *   [a] totals — per-lane counts + total match the synthetic board
 *   [b] per-card facts — lane, status, workflow, owned, sidecar, sourcePath, contentHash
 *   [c] anomalies — duplicate ids, fixtures, unowned, UUID sidecars, orphan sidecars
 *   [d] determinism — buildInventory + serializeInventory byte-identical across two runs
 *   [e] greenfield — a missing/empty pipeline dir yields a valid empty inventory (no throw)
 *   [f] contentHash — same text ⇒ same hash; different text ⇒ different hash
 *
 * Exit 0 = all held; exit 1 = at least one failed. No wall-clock in the output
 * (the determinism section would catch a Date.now() leak).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildInventory, serializeInventory, detectAnomalies, contentHash, listSidecarIds,
} from './pipeline-inventory.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/** Writes a card file into a lane, with a minimal frontmatter. */
function writeCard(pipeDir, lane, id, extra = {}) {
  const fm = { id, title: `card ${id}`, type: 'chore', status: lane, ...extra };
  const body = ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', `# card ${id}`, ''].join('\n');
  writeFileSync(resolve(pipeDir, lane, `${id}-card.md`), body, 'utf-8');
}

/** Writes a sidecar state.json under state/<id>/. */
function writeSidecar(pipeDir, id) {
  const dir = resolve(pipeDir, 'state', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'state.json'), JSON.stringify({ kind: 'task', id, status: 'working', events: [] }), 'utf-8');
}

/** Builds a synthetic board: 2 backlog (one unowned), 1 testing, 1 conclusion, a dup, a fixture, a UUID sidecar. */
function buildBoard() {
  const root = mkdtempSync(resolve(tmpdir(), 'wf0059-inv-'));
  const pipeDir = resolve(root, 'pipeline');
  for (const lane of ['backlog', 'working', 'testing', 'conclusion', 'state']) mkdirSync(resolve(pipeDir, lane), { recursive: true });
  writeCard(pipeDir, 'backlog', '501', { workflow: 'demo-flow' });
  writeCard(pipeDir, 'backlog', '502');                            // unowned (no workflow)
  writeCard(pipeDir, 'testing', '503', { workflow: 'demo-flow' });
  writeCard(pipeDir, 'conclusion', '504', { workflow: 'demo-flow' });
  writeCard(pipeDir, 'conclusion', '098', { fixture: 'true' });    // fixture
  writeCard(pipeDir, 'working', '001', { workflow: 'a' });         // dup id part 1
  writeCard(pipeDir, 'testing', '001', { workflow: 'b' });         // dup id part 2
  writeSidecar(pipeDir, '501');                                    // real sidecar
  writeSidecar(pipeDir, 'task-3f2504e0-4f89-41d3-9a0c-0305e82c3301-1'); // UUID sidecar
  writeSidecar(pipeDir, '999');                                    // orphan sidecar (no card)
  return { root, pipeDir };
}

// ---------------------------------------------------------------------------
const { root, pipeDir } = buildBoard();
try {
  const inv = buildInventory(pipeDir);

  // [a] totals
  assert('[a] total card count is 7', inv.totals.total === 7, `got ${inv.totals.total}`);
  assert('[a] backlog=2', inv.totals.backlog === 2, `got ${inv.totals.backlog}`);
  assert('[a] testing=2', inv.totals.testing === 2, `got ${inv.totals.testing}`);
  assert('[a] conclusion=2', inv.totals.conclusion === 2, `got ${inv.totals.conclusion}`);
  assert('[a] working=1', inv.totals.working === 1, `got ${inv.totals.working}`);
  assert('[a] kind + schemaVersion stamped', inv.kind === 'pipeline-inventory-stage0' && inv.schemaVersion === 1);

  // [b] per-card facts
  const c501 = inv.cards.find((c) => c.id === '501' && c.lane === 'backlog');
  assert('[b] 501 owned + sidecar + sourcePath', c501 && c501.owned === true && c501.sidecar === true
    && c501.sourcePath === 'pipeline/backlog/501-card.md', JSON.stringify(c501));
  assert('[b] 501 contentHash is sha256-prefixed', /^sha256:[0-9a-f]{64}$/.test(c501.contentHash), c501?.contentHash);
  const c502 = inv.cards.find((c) => c.id === '502');
  assert('[b] 502 unowned + no sidecar', c502 && c502.owned === false && c502.sidecar === false);

  // [c] anomalies
  assert('[c] duplicate id 001 detected', inv.anomalies.duplicateIds.includes('001'), JSON.stringify(inv.anomalies.duplicateIds));
  assert('[c] fixture 098 detected', inv.anomalies.fixtures.includes('098'));
  assert('[c] unowned 502 detected', inv.anomalies.unowned.includes('502'));
  assert('[c] UUID sidecar detected', inv.anomalies.uuidSidecars.some((id) => id.includes('3f2504e0')));
  assert('[c] orphan sidecar 999 detected', inv.anomalies.orphanSidecars.includes('999'));

  // [d] determinism — two independent builds serialize byte-identical
  const once = serializeInventory(buildInventory(pipeDir));
  const twice = serializeInventory(buildInventory(pipeDir));
  assert('[d] byte-stable across re-run', once === twice);
  assert('[d] serialized output has trailing newline', once.endsWith('}\n'));
  assert('[d] no wall-clock leak (no 20xx-..T..Z timestamp)', !/20\d\d-\d\d-\d\dT\d\d:\d\d/.test(once));

  // [e] greenfield — empty/missing pipeline dir
  const empty = buildInventory(resolve(root, 'does-not-exist'));
  assert('[e] greenfield: valid empty inventory, no throw', empty.totals.total === 0 && Array.isArray(empty.cards) && empty.cards.length === 0);
  assert('[e] greenfield: anomalies all empty', empty.anomalies.duplicateIds.length === 0 && empty.anomalies.unowned.length === 0);

  // [f] contentHash determinism
  assert('[f] same text ⇒ same hash', contentHash('abc') === contentHash('abc'));
  assert('[f] different text ⇒ different hash', contentHash('abc') !== contentHash('abd'));

  // sidecar listing sanity
  assert('[b] listSidecarIds sorted + includes real + uuid + orphan', (() => {
    const ids = listSidecarIds(pipeDir);
    const sorted = [...ids].sort();
    return ids.join(',') === sorted.join(',') && ids.includes('501') && ids.includes('999');
  })());

  // detectAnomalies pure-function contract
  const pure = detectAnomalies([{ id: 'x', owned: false, fixture: false }], []);
  assert('[c] detectAnomalies pure: unowned x', pure.unowned.includes('x') && pure.duplicateIds.length === 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(`\nWF-0059 W1 inventory selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
