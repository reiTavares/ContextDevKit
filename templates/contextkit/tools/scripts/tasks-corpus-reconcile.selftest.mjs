/**
 * Selftest — tasks-corpus-reconcile (WF-0087 TL3, immutable rule 3).
 *
 * Exercises the corpus walker + receipt over a temp memory fixture: the four
 * verdicts, BIZ-0004 / _TEMPLATE exclusion, the recursive walk reaching the
 * legacy `memory/workflows/*` root, and the Blocker-1 fix (a present-but-
 * unparseable state quarantines, never certifies ready+observed).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planHash } from './workflow/plan.mjs';
import { reconcileCorpusReceipt } from './tasks-corpus-reconcile.mjs';

const failures = [];
function assert(label, cond) {
  if (cond) process.stdout.write(`  ok   ${label}\n`);
  else { failures.push(label); process.stdout.write(`  FAIL ${label}\n`); }
}

const plan = {
  schemaVersion: 1, workflowId: 'WF-TEST', slug: 'wf-test', profile: 'program',
  waves: [{ id: 'W1', tasks: [{ id: 'W1-T1', waveId: 'W1', title: 'T' }] }], gates: [],
};
const hash = planHash(plan);

/** Seed a workflow pack (plan + state) at a memory-relative dir. */
function seed(root, relDir, state, { rawState } = {}) {
  const dir = join(root, 'contextkit', 'memory', relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'workflow-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'workflow-state.json'), rawState ?? `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return dir;
}

const root = mkdtempSync(join(tmpdir(), 'wf0087-corpus-'));
try {
  // observed: journal folds to taskStates → ready
  seed(root, 'business/BIZ-9001-x/done/WF-9101-observed',
    { planHash: hash, revision: 2, taskStates: { 'W1-T1': { status: 'working' } },
      events: [{ type: 'task.status', taskId: 'W1-T1', to: 'working', status: 'working' }] });
  // concluded, no journal → reconciled-by-inference
  seed(root, 'business/BIZ-9001-x/done/WF-9102-inferred',
    { planHash: hash, revision: 2, taskStates: { 'W1-T1': { status: 'done' } }, events: [] });
  // BIZ-0004 → excluded (forbidden parallel session)
  seed(root, 'business/BIZ-0004-graph/done/WF-9103-biz4',
    { planHash: hash, revision: 2, taskStates: { 'W1-T1': { status: 'done' } }, events: [] });
  // _TEMPLATE scaffold → excluded from enumeration entirely
  seed(root, 'workflows/_TEMPLATE',
    { planHash: hash, revision: 0, taskStates: {}, events: [] });
  // legacy memory/workflows/* root reached by the recursive walk → inferred
  seed(root, 'workflows/0099-legacy-engine',
    { planHash: hash, revision: 9, taskStates: { 'W1-T1': { status: 'done' } }, events: [] });
  // present-but-unparseable state (Blocker 1) → quarantined, never ready+observed
  seed(root, 'business/BIZ-9001-x/done/WF-9104-corrupt', {}, { rawState: '{ not: valid json' });

  const receipt = reconcileCorpusReceipt(root, '2026-07-24T00:00:00.000Z');

  assert('[a] receipt is deterministic-stamped (no wall-clock in body)',
    receipt.generatedAt === '2026-07-24T00:00:00.000Z' && !/[0-9]{2}:[0-9]{2}:[0-9]{2}/.test(JSON.stringify(receipt.counts)));
  assert('[b] BIZ-0004 workflow is excluded, not scored',
    receipt.excluded.some((e) => e.workflowId === 'WF-TEST' || /BIZ-0004/.test(JSON.stringify(receipt.excludedPaths))));
  assert('[b] _TEMPLATE is not enumerated at all',
    ![...receipt.frozenPaths, ...receipt.excludedPaths].some((p) => /_TEMPLATE/.test(p)));
  assert('[c] legacy memory/workflows root IS reached (0099 present)',
    [...receipt.frozenPaths].some((p) => /workflows\/0099-legacy-engine/.test(p)));
  assert('[d] the corrupt state quarantines → corpus NOT ready',
    receipt.status === 'quarantined' && receipt.counts.quarantined >= 1);

  // Remove the corrupt fixture → corpus should now be ready (observed + inferred only).
  rmSync(join(root, 'contextkit', 'memory', 'business', 'BIZ-9001-x', 'done', 'WF-9104-corrupt'), { recursive: true, force: true });
  const clean = reconcileCorpusReceipt(root, '2026-07-24T00:00:00.000Z');
  assert('[e] clean corpus is ready with 0 quarantined', clean.status === 'ready' && clean.counts.quarantined === 0);
  assert('[e] one observed (ready) + inferred present', clean.counts.ready >= 1 && clean.counts.reconciledByInference >= 2);
  assert('[e] frozenPaths lists the in-scope states', clean.frozenPaths.every((p) => p.endsWith('/workflow-state.json')));
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(`\ntasks-corpus-reconcile selftest: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
