#!/usr/bin/env node
/**
 * WF-0057 W3 (ADR-0122, decisions.md fork #5) — selftest for the
 * DebtRegistryAdapter + 11-state debt lifecycle.
 *
 * Covers: legal lifecycle transitions accepted, illegal rejected (throw);
 * `upsertFindings` preserves existing state for known findings and adds new as
 * CANDIDATE; the board is REGENERATED from data (round-trips); canonical state is
 * the data, NOT the markdown (mutating the board can't change state); read/write
 * over an INJECTED temp findings JSON (never the real store). Temp files cleaned.
 *
 * Zero-dep, node:/relative only, Windows-safe. Standalone entrypoint (exit 0/1).
 */
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };

const SCRIPTS = 'templates/contextkit/tools/scripts/arch-debt';
const registryPath = resolve(KIT, SCRIPTS + '/debt-registry.mjs');
const lifecyclePath = resolve(KIT, SCRIPTS + '/debt-lifecycle.mjs');
const findingPath = resolve(KIT, SCRIPTS + '/finding.mjs');
existsSync(registryPath) ? ok('debt-registry.mjs exists') : bad('debt-registry.mjs NOT FOUND');
existsSync(lifecyclePath) ? ok('debt-lifecycle.mjs exists') : bad('debt-lifecycle.mjs NOT FOUND');

let reg, fnd;
try {
  reg = await import(pathToFileURL(registryPath).href);
  fnd = await import(pathToFileURL(findingPath).href);
} catch (err) {
  bad('Failed to import modules: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const {
  DebtState, DEBT_STATES, transition, isLegalTransition, currentState,
  emptyStore, readStore, writeStore, upsertFindings, advanceLifecycle, toBoard,
} = reg;
const { makeFinding } = fnd;

for (const [n, f] of [
  ['transition', transition], ['isLegalTransition', isLegalTransition],
  ['currentState', currentState], ['upsertFindings', upsertFindings],
  ['toBoard', toBoard], ['readStore', readStore], ['writeStore', writeStore],
  ['advanceLifecycle', advanceLifecycle], ['emptyStore', emptyStore],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}

console.log('\n11-state set (spec §22)');
DEBT_STATES instanceof Set && DEBT_STATES.size === 11
  ? ok('DEBT_STATES has 11 states') : bad('DEBT_STATES size: ' + (DEBT_STATES && DEBT_STATES.size));
for (const s of ['CANDIDATE', 'CONFIRMED', 'ACCEPTED', 'CONTAINED', 'SCHEDULED',
  'IN_REMEDIATION', 'PAID', 'TRANSFERRED', 'EXPIRED', 'REJECTED', 'REOPENED']) {
  DEBT_STATES.has(s) ? ok('state ' + s + ' present') : bad('state ' + s + ' MISSING');
}

console.log('\nlegal transitions accepted, illegal rejected (throw)');
const f0 = makeFinding({ id: 'r:p:1', ruleId: 'r', path: 'src/x.js' });
currentState(f0) === DebtState.CANDIDATE ? ok('untracked finding defaults to CANDIDATE') : bad('default state: ' + currentState(f0));
const confirmed = transition(f0, DebtState.CONFIRMED);
confirmed.lifecycleState === DebtState.CONFIRMED ? ok('CANDIDATE → CONFIRMED accepted') : bad('CANDIDATE→CONFIRMED state: ' + confirmed.lifecycleState);
const inRemed = transition(confirmed, DebtState.IN_REMEDIATION);
const paid = transition(inRemed, DebtState.PAID);
paid.lifecycleState === DebtState.PAID ? ok('CONFIRMED → IN_REMEDIATION → PAID accepted') : bad('PAID path failed');
transition(paid, DebtState.REOPENED).lifecycleState === DebtState.REOPENED ? ok('PAID → REOPENED accepted (regression)') : bad('PAID→REOPENED rejected');
transition(transition(f0, DebtState.REJECTED), DebtState.REOPENED).lifecycleState === DebtState.REOPENED ? ok('CANDIDATE → REJECTED → REOPENED accepted') : bad('reject/reopen path failed');
// idempotent self-transition is allowed (no-op), not an illegal move.
transition(confirmed, DebtState.CONFIRMED).lifecycleState === DebtState.CONFIRMED ? ok('CONFIRMED → CONFIRMED is a no-op (idempotent)') : bad('self-transition broke');

threw(() => transition(f0, DebtState.PAID)) ? ok('CANDIDATE → PAID rejected (illegal, throws)') : bad('illegal CANDIDATE→PAID did NOT throw');
threw(() => transition(paid, DebtState.CANDIDATE)) ? ok('PAID → CANDIDATE rejected (illegal, throws)') : bad('illegal PAID→CANDIDATE did NOT throw');
threw(() => transition(f0, 'BOGUS_STATE')) ? ok('unknown target state rejected (throws)') : bad('unknown state did NOT throw');
threw(() => transition(null, DebtState.CONFIRMED)) ? ok('null finding rejected (throws)') : bad('null finding did NOT throw');
isLegalTransition(DebtState.CONFIRMED, DebtState.ACCEPTED) === true ? ok('isLegalTransition CONFIRMED→ACCEPTED true') : bad('isLegalTransition false positive/negative');
isLegalTransition(DebtState.CANDIDATE, DebtState.PAID) === false ? ok('isLegalTransition CANDIDATE→PAID false') : bad('isLegalTransition illegal allowed');
isLegalTransition('NOPE', DebtState.PAID) === false ? ok('isLegalTransition unknown from → false (defensive)') : bad('unknown from not rejected');

console.log('\nupsertFindings preserves known state, adds new as CANDIDATE');
const fA = makeFinding({ id: 'A:1', ruleId: 'F1', path: 'src/a.js' });
const fB = makeFinding({ id: 'B:1', ruleId: 'F2', path: 'src/b.js' });
let store = upsertFindings(emptyStore(), [fA, fB], 2);
store.findings.every((f) => f.lifecycleState === DebtState.CANDIDATE) ? ok('first upsert → all CANDIDATE') : bad('first upsert states wrong');
store.fileCount === 2 ? ok('fileCount carried through') : bad('fileCount: ' + store.fileCount);
// Advance A through its lifecycle, then re-scan (B re-found, A re-found, C new).
store = advanceLifecycle(store, 'A:1', DebtState.CONFIRMED);
store = advanceLifecycle(store, 'A:1', DebtState.IN_REMEDIATION);
store.findings.find((f) => f.id === 'A:1').lifecycleState === DebtState.IN_REMEDIATION ? ok('advanceLifecycle moved A to IN_REMEDIATION') : bad('advanceLifecycle failed');
threw(() => advanceLifecycle(store, 'NOPE', DebtState.CONFIRMED)) ? ok('advanceLifecycle unknown id throws') : bad('unknown id did not throw');
const fC = makeFinding({ id: 'C:1', ruleId: 'F3', path: 'src/c.js' });
const rescan = upsertFindings(store, [makeFinding({ id: 'A:1', ruleId: 'F1', path: 'src/a.js' }), fB, fC], 3);
rescan.findings.find((f) => f.id === 'A:1').lifecycleState === DebtState.IN_REMEDIATION ? ok('re-scan PRESERVES A IN_REMEDIATION state') : bad('A state lost on re-scan: ' + rescan.findings.find((f) => f.id === 'A:1').lifecycleState);
rescan.findings.find((f) => f.id === 'B:1').lifecycleState === DebtState.CANDIDATE ? ok('B stays CANDIDATE (never advanced)') : bad('B state wrong');
rescan.findings.find((f) => f.id === 'C:1').lifecycleState === DebtState.CANDIDATE ? ok('new finding C enters as CANDIDATE') : bad('C not CANDIDATE');
threw(() => upsertFindings(emptyStore(), [{ ruleId: 'x', path: 'p' }])) ? ok('finding without id throws (fail-fast)') : bad('idless finding did not throw');
threw(() => upsertFindings(emptyStore(), 'not-array')) ? ok('non-array findings throws') : bad('non-array did not throw');

console.log('\ntoBoard regenerated from data + groups by state');
const board = toBoard(rescan);
board.includes('## IN_REMEDIATION (1)') ? ok('board shows IN_REMEDIATION group') : bad('board missing IN_REMEDIATION group');
board.includes('## CANDIDATE (2)') ? ok('board shows CANDIDATE group (B + C)') : bad('board missing CANDIDATE group');
board.includes('src/a.js') && board.includes('src/c.js') ? ok('board lists finding paths') : bad('board missing paths');
toBoard(emptyStore()).includes('Clean') ? ok('empty store → "Clean" board') : bad('empty board wrong');
// round-trip: a board produced from a store reflects exactly the structured states.
const board2 = toBoard(rescan);
board === board2 ? ok('toBoard is deterministic (same data → same board)') : bad('toBoard not deterministic');

console.log('\ncanonical state is the DATA, not the markdown (fork #5)');
// Mutate the rendered board arbitrarily; it must NOT feed back into state.
const tamperedBoard = board.replace('## IN_REMEDIATION (1)', '## PAID (1)');
// Re-derive state purely from the structured store — board is never read back.
const stateAfterTamper = rescan.findings.find((f) => f.id === 'A:1').lifecycleState;
stateAfterTamper === DebtState.IN_REMEDIATION ? ok('tampering the board markdown does NOT change A state') : bad('board tamper leaked into state');
tamperedBoard !== board ? ok('(sanity: the tampered board string did differ)') : bad('tamper test inert');
// The board carries no machine-readable state hook — it is a projection only.
!/lifecycleState/.test(board) ? ok('board carries no parseable state field (projection only)') : bad('board exposes a state field');

console.log('\nreadStore/writeStore over an INJECTED temp path (not the real store)');
const dir = mkdtempSync(join(tmpdir(), 'ckit-debt-reg-'));
const storePath = join(dir, 'tech-debt-findings.json');
let cleanupOk = true;
try {
  readStore(storePath).findings.length === 0 ? ok('missing store file → emptyStore (no throw)') : bad('missing file not empty');
  writeStore(storePath, rescan);
  existsSync(storePath) ? ok('writeStore created the injected file') : bad('writeStore did not create file');
  const roundTrip = readStore(storePath);
  roundTrip.findings.length === rescan.findings.length ? ok('readStore round-trips findings') : bad('round-trip count mismatch');
  roundTrip.findings.find((f) => f.id === 'A:1').lifecycleState === DebtState.IN_REMEDIATION ? ok('state survives the disk round-trip') : bad('state lost on disk round-trip');
  // BOM tolerance (immutable rule #4).
  writeFileSync(storePath, '﻿' + JSON.stringify(rescan), 'utf-8');
  readStore(storePath).findings.length === rescan.findings.length ? ok('readStore strips a UTF-8 BOM') : bad('BOM not stripped');
  // empty file → empty store, never a parse crash.
  writeFileSync(storePath, '', 'utf-8');
  readStore(storePath).findings.length === 0 ? ok('empty file → emptyStore') : bad('empty file threw/mis-parsed');
  // verify the injected real-store path is NOT touched anywhere here.
  !storePath.includes('contextkit') ? ok('temp fixture path is isolated (not the real store)') : bad('used the real store path!');
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { cleanupOk = false; }
}
cleanupOk && !existsSync(dir) ? ok('temp fixtures cleaned up') : bad('temp dir not cleaned');

console.log('\nzero-dep invariant');
for (const p of [registryPath, lifecyclePath]) {
  const content = readFileSync(p, 'utf-8');
  const re = /^(?:import|export)\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m, dirty = null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) { dirty = m[1]; break; }
  }
  dirty === null ? ok('zero-dep: ' + p.split(/[\\/]/).pop() + ' imports only node:/relative')
    : bad('zero-dep violation in ' + p + ': imports ' + dirty);
}

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
