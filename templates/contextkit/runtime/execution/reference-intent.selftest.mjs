/**
 * In-process self-test for WF-0094 (BIZ-0006, ADR-0152) — reference-intent
 * resolution + the citation scan that make intake continuation-aware. Tests the
 * ACTUAL exported API against in-memory fixtures (no disk, no live tree). Each
 * section maps to the WF-0094 acceptance matrix (RI0-RI3).
 *
 * Sections:
 *   [a] scanCitations — explicit id detection + resolution, fuzzy title/slug,
 *       refuse-to-null on no citation, fail-open on malformed input
 *   [b] resolveReferenceIntent — the four intents (new-context / work-within /
 *       new-child-in-context / new-workflow-in-owner) + ask on ambiguity
 *   [c] meta-repro — the user's Codex case: a continuation prompt citing an
 *       existing WF/BIZ never resolves to a silent new-context (new operation)
 *   [d] determinism + fail-open
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import { scanCitations, resolveReferenceIntent, REFERENCE_INTENTS } from './reference-intent.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/** Shared fixture registries (BIZ-0006 program shape). */
const REG = {
  workContexts: [
    { id: 'BIZ-0006', type: 'business', title: 'Methodology plane integrity', slug: 'methodology-plane-integrity' },
    { id: 'OP-0008', type: 'operation', title: 'Language aware classification', slug: 'language-aware' },
  ],
  workflows: [
    { id: 'WF-0094', owner: 'BIZ-0006', slug: 'reference-intent', title: 'Reference intent resolution' },
  ],
};
const op = (kind = 'change', executionMode = 'direct') => ({ nature: 'operation', kind, executionMode });

// [a] scanCitations
process.stdout.write('[a] scanCitations\n');
{
  const c = scanCitations('continue work on BIZ-0006', REG);
  assert('explicit BIZ id detected + resolved', c[0]?.id === 'BIZ-0006' && c[0]?.resolved === true && c[0]?.tier === 'explicit');
}
{
  const c = scanCitations('add to WF-0094', REG);
  assert('explicit WF id carries its owner', c[0]?.id === 'WF-0094' && c[0]?.ownerId === 'BIZ-0006' && c[0]?.type === 'workflow');
}
{
  const c = scanCitations('look at WF-9999', REG);
  assert('unresolved explicit id ⇒ resolved:false', c[0]?.id === 'WF-9999' && c[0]?.resolved === false);
}
{
  const c = scanCitations('add pagination to the users endpoint', REG);
  assert('no citation ⇒ empty (refuse-to-null)', Array.isArray(c) && c.length === 0);
}
{
  const c = scanCitations('improve the methodology plane integrity thing', REG);
  assert('fuzzy title match detected below explicit', c[0]?.id === 'BIZ-0006' && c[0]?.tier === 'fuzzy');
}
assert('malformed input ⇒ [] (fail-open)', scanCitations(null).length === 0 && scanCitations(undefined, null).length === 0);
assert('empty objective ⇒ []', scanCitations('', REG).length === 0);

// [b] resolveReferenceIntent — the four intents + ask
process.stdout.write('[b] resolveReferenceIntent (four intents + ask)\n');
{
  const cites = scanCitations('continue the work on WF-0094', REG);
  const r = resolveReferenceIntent(op('maintenance'), cites, { objective: 'continue the work on WF-0094' });
  assert('cite a WF ⇒ work-within', r.intent === 'work-within');
}
{
  const obj = 'add a new workflow inside BIZ-0006';
  const r = resolveReferenceIntent(op('change', 'workflow'), scanCitations(obj, REG), { objective: obj });
  assert('new-workflow signal ⇒ new-workflow-in-owner', r.intent === 'new-workflow-in-owner');
  assert('  target resolves to the owner BIZ-0006', r.target?.id === 'BIZ-0006');
}
{
  const obj = 'add a task to OP-0008';
  const r = resolveReferenceIntent(op('change'), scanCitations(obj, REG), { objective: obj });
  assert('new-child signal ⇒ new-child-in-context', r.intent === 'new-child-in-context');
}
{
  const obj = 'build a new product like BIZ-0006 but for a new area';
  const r = resolveReferenceIntent(op('change'), scanCitations(obj, REG), { objective: obj });
  assert('contextual citation (new-scope signal) ⇒ new-context', r.intent === 'new-context');
}
{
  const obj = 'launch a new platform, related to BIZ-0006';
  const r = resolveReferenceIntent({ nature: 'business', kind: 'capability', executionMode: 'workflow' }, scanCitations(obj, REG), { objective: obj });
  assert('business nature ⇒ always new-context', r.intent === 'new-context');
}
{
  const obj = 'do something with BIZ-0006';
  const r = resolveReferenceIntent(op('change'), scanCitations(obj, REG), { objective: obj });
  assert('cite a BIZ with change + no scope signal ⇒ ask', r.intent === 'ask' && r.needsClarification === true && !!r.clarifyQuestion);
}
{
  const obj = 'improve the methodology plane integrity thing';
  const r = resolveReferenceIntent(op('change'), scanCitations(obj, REG), { objective: obj });
  assert('fuzzy-only citation, no signal ⇒ ask', r.intent === 'ask');
}
{
  // Regression (reviewer 🟡#1): an UNRESOLVED explicit id + a scope signal must NOT
  // produce a confident verdict against a non-existent target — route to ask.
  const obj = 'add a task to WF-9999';
  const r = resolveReferenceIntent(op('change'), scanCitations(obj, REG), { objective: obj });
  assert('unresolved explicit id + scope signal ⇒ ask (not confident phantom target)', r.intent === 'ask' && r.confidence === 'ask');
}
{
  // executionMode==='workflow' against a workflow citation ⇒ new-workflow-in-owner.
  const obj = 'the next wave on WF-0094';
  const r = resolveReferenceIntent(op('change', 'workflow'), scanCitations(obj, REG), { objective: obj });
  assert('executionMode=workflow + WF cite ⇒ new-workflow-in-owner (owner target)', r.intent === 'new-workflow-in-owner' && r.target?.id === 'BIZ-0006');
}
assert('every returned intent is in the closed enum', REFERENCE_INTENTS.length === 5);

// [c] meta-repro — the user's reported Codex failure
process.stdout.write('[c] meta-repro (continuation prompt citing an existing context)\n');
{
  const obj = 'continue implementing WF-0094 reference-intent resolution';
  const r = resolveReferenceIntent(op('change'), scanCitations(obj, REG), { objective: obj });
  assert('continuation citing a WF ⇒ work-within, NOT a new operation', r.intent === 'work-within');
  assert('  the bug is fixed: NOT silently new-context', r.intent !== 'new-context');
}
{
  // The exact hook framing: operation/change citing an existing Business.
  const obj = 'we need to add a new workflow to BIZ-0006 for the classifier';
  const r = resolveReferenceIntent(op('change'), scanCitations(obj, REG), { objective: obj });
  assert('operation/change + explicit BIZ cite + new-workflow phrasing ⇒ new-workflow-in-owner', r.intent === 'new-workflow-in-owner');
}

// [d] determinism + fail-open
process.stdout.write('[d] determinism + fail-open\n');
{
  const obj = 'continue the work on WF-0094';
  const a = resolveReferenceIntent(op('maintenance'), scanCitations(obj, REG), { objective: obj });
  const b = resolveReferenceIntent(op('maintenance'), scanCitations(obj, REG), { objective: obj });
  assert('resolver is deterministic (same input ⇒ same output)', JSON.stringify(a) === JSON.stringify(b));
}
{
  let threw = false; let r;
  try { r = resolveReferenceIntent(null, null); } catch { threw = true; }
  assert('malformed resolver input ⇒ no throw, new-context (fail-open)', !threw && r?.intent === 'new-context');
}

if (failures.length) {
  process.stdout.write(`\n✗ reference-intent selftest: ${failures.length} failure(s): ${failures.join('; ')}\n`);
  process.exit(1);
}
process.stdout.write('\n✓ reference-intent selftest: all assertions held\n');
