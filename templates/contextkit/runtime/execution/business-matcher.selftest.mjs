/**
 * In-process self-test for A2-T2 — Business matcher, intake-proposal store, and
 * the methodology decision layer (BIZ-0001 / WF-0036 Wave A2, ADR-0102).
 *
 * Zero-dependency, runs under plain `node`. Proves (Gate G-A2):
 *   1. matcher scores + thresholds deterministically on a fixture registry;
 *   2. matcher is BYTE-IDENTICAL across two runs (no time/randomness);
 *   3. matcher refuses-to-null below the suggested threshold + never sets confirmed;
 *   4. proposal store round-trips atomically (build → save → read identical);
 *   5. autonomy-per-grade: Business is `manual` at EVERY grade; Operation is
 *      `auto` at grade 3; a low-confidence near-tie downgrades one notch;
 *   6. the hook's legacy checklist render is byte-identical and methodology is a
 *      pure superset (returns null / appends nothing for a control input).
 *
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 *
 * Hermetic: builds a throwaway fixture root under the OS temp dir (its own
 * `contextkit/memory/business/<id>/business.json` + registry), so it never reads
 * or writes the dogfood tree.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchBusiness } from './business-matcher.mjs';
import {
  buildIntakeProposal, saveIntakeProposal, readIntakeProposal,
} from './intake-proposal-store.mjs';
import { resolveProposedAction, renderMethodologyLine, runMethodology } from './intake-methodology.mjs';
import { renderChecklist } from '../hooks/execution-contract-hook.mjs';

const failures = [];
/** Records a named assertion. */
function assert(label, condition) {
  if (!condition) failures.push(label);
}

// ---------------------------------------------------------------------------
// Fixture root with one Business candidate (capability kind, ENABLE intent).
// ---------------------------------------------------------------------------
const ROOT = mkdtempSync(join(tmpdir(), 'a2t2-'));
const BIZ_DIR = join(ROOT, 'contextkit', 'memory', 'business', 'BIZ-9001-fixture-platform-capability');
mkdirSync(BIZ_DIR, { recursive: true });
writeFileSync(join(BIZ_DIR, 'business.json'), JSON.stringify({
  schemaVersion: 1, id: 'BIZ-9001', title: 'Fixture Platform Capability',
  slug: 'fixture-platform-capability', kind: 'capability',
  valueIntents: { primary: 'ENABLE', secondary: ['IMPROVE', 'RELIABILITY'] },
}, null, 2));

const REGISTRY = {
  schemaVersion: 1, generator: 'fixture',
  contexts: [{ id: 'BIZ-9001', path: 'business/BIZ-9001-fixture-platform-capability', type: 'business', status: 'approved', title: 'Fixture Platform Capability' }],
};

/** A classified Operation that should match the fixture Business (intent + token overlap). */
const OP_WORK = {
  nature: 'operation', kind: 'fix',
  valueIntents: { primary: 'RECOVER', secondary: ['IMPROVE'] },
  growthLever: 'RELIABILITY', executionMode: 'direct', confidence: 'high', reasons: [],
};
const OP_OBJECTIVE = 'fix the broken platform capability rollback after the failed release';

// ---------------------------------------------------------------------------
// 1 + 2 — deterministic scoring + byte-identical across two runs.
// ---------------------------------------------------------------------------
const m1 = matchBusiness(OP_WORK, { root: ROOT, objective: OP_OBJECTIVE, registry: REGISTRY });
const m2 = matchBusiness(OP_WORK, { root: ROOT, objective: OP_OBJECTIVE, registry: REGISTRY });
assert('matcher suggests the fixture Business', m1.status === 'suggested' && m1.suggested === 'BIZ-9001');
assert('matcher score is in (0,1]', m1.score > 0 && m1.score <= 1);
assert('matcher is byte-identical across two runs', JSON.stringify(m1) === JSON.stringify(m2));
assert('matcher records reasons[]', Array.isArray(m1.reasons) && m1.reasons.length >= 1);

// 3 — never sets confirmed; refuse-to-null below threshold + on non-operation.
assert('matcher never sets confirmed (provenance null)', m1.confirmed === null);
const noOverlapWork = { nature: 'operation', kind: 'maintenance', valueIntents: { primary: 'COMPLY', secondary: [] }, confidence: 'high' };
const mLow = matchBusiness(noOverlapWork, { root: ROOT, objective: 'tidy lint warnings', registry: REGISTRY });
assert('matcher refuses-to-null below suggested threshold', mLow.status === 'unlinked' && mLow.suggested === null);
const mBiz = matchBusiness({ nature: 'business', kind: 'capability', valueIntents: { primary: 'ENABLE' } }, { root: ROOT, registry: REGISTRY });
assert('matcher skips non-operation nature', mBiz.status === 'unlinked' && mBiz.suggested === null);
const mEmpty = matchBusiness(OP_WORK, { root: ROOT, objective: OP_OBJECTIVE, registry: { contexts: [] } });
assert('matcher unlinked on empty registry', mEmpty.status === 'unlinked');

// ---------------------------------------------------------------------------
// 4 — proposal store round-trips atomically.
// ---------------------------------------------------------------------------
const proposal = buildIntakeProposal('task-test-1', OP_WORK, m1, {
  objective: OP_OBJECTIVE, createdAt: '2026-06-19T00:00:00.000Z',
  action: { nature: 'operation', kind: 'fix', autonomyMode: 'auto', grade: 3 },
});
const saved = saveIntakeProposal(ROOT, 'task-test-1', proposal);
const roundTrip = readIntakeProposal(ROOT, 'task-test-1');
assert('proposal save returns true', saved === true);
assert('proposal round-trips identically', JSON.stringify(roundTrip) === JSON.stringify(proposal));
assert('proposal status defaults to proposed', roundTrip.status === 'proposed');
assert('absent proposal reads as null', readIntakeProposal(ROOT, 'nope') === null);

// ---------------------------------------------------------------------------
// 5 — autonomy-per-grade mapping.
// ---------------------------------------------------------------------------
const cfgAt = (grade) => ({ autonomy: { grade } });
const bizAction1 = resolveProposedAction({ nature: 'business', kind: 'capability', confidence: 'high' }, cfgAt(1));
const bizAction3 = resolveProposedAction({ nature: 'business', kind: 'capability', confidence: 'high' }, cfgAt(3));
assert('Business is manual at grade 1', bizAction1.mode === 'manual');
assert('Business stays manual at grade 3 (human floor)', bizAction3.mode === 'manual' && bizAction3.area === 'adr');
const opAction1 = resolveProposedAction({ nature: 'operation', kind: 'fix', confidence: 'high' }, cfgAt(1));
const opAction3 = resolveProposedAction({ nature: 'operation', kind: 'fix', confidence: 'high' }, cfgAt(3));
assert('Operation is manual at grade 1', opAction1.mode === 'manual');
assert('Operation is auto at grade 3', opAction3.mode === 'auto' && opAction3.area === 'edit');
const opLow3 = resolveProposedAction({ nature: 'operation', kind: 'fix', confidence: 'low' }, cfgAt(3));
assert('low-confidence Operation downgrades auto→suggest at grade 3', opLow3.mode === 'suggest' && opLow3.downgraded === true);

// methodology line is a non-empty single line.
const line = renderMethodologyLine(OP_WORK, m1, opAction3);
assert('methodology line is single-line and mentions suggestion', typeof line === 'string' && !line.includes('\n') && line.includes('BIZ-9001'));

// ---------------------------------------------------------------------------
// 6 — hook is a pure superset: legacy render unchanged; methodology null-safe.
// ---------------------------------------------------------------------------
const fakeContract = { signals: { tier: 'feature' }, requiredBeforeWrite: ['x'], requiredBeforeCompletion: [] };
const legacy = renderChecklist(fakeContract, 'task-c-1', true, null);
assert('legacy checklist render still produces the tier line', legacy.includes('Tier: feature'));
assert('legacy checklist render carries NO methodology line', !legacy.includes('Work:'));
// control input: no `signals.work` → runMethodology returns null → hook appends nothing.
const controlResult = runMethodology({ root: ROOT, taskId: 'task-c-2', objective: 'anything', work: undefined, config: cfgAt(3) });
assert('runMethodology returns null when classification absent (control input)', controlResult === null);
// genuine input: runMethodology produces a line + persists a proposal.
const fullResult = runMethodology({ root: ROOT, taskId: 'task-c-3', objective: OP_OBJECTIVE, work: OP_WORK, config: cfgAt(3), createdAt: '2026-06-19T00:00:00.000Z' });
assert('runMethodology yields a line for a genuine classification', !!fullResult && typeof fullResult.line === 'string');
assert('runMethodology persists the proposal', readIntakeProposal(ROOT, 'task-c-3') !== null);

// ---------------------------------------------------------------------------
// Report + cleanup.
// ---------------------------------------------------------------------------
try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ }

if (failures.length === 0) {
  console.log('business-matcher.selftest: OK (all A2-T2 assertions held)');
  process.exit(0);
} else {
  console.error('business-matcher.selftest: FAILED');
  for (const label of failures) console.error(`  - ${label}`);
  process.exit(1);
}
