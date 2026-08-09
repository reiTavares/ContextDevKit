/**
 * In-process self-test for the B3-T2 decision-coverage gate module
 * (BIZ-0001 / WF-0037, B3-T2).
 *
 * Tests the ACTUAL exported API of `decision-coverage.mjs`:
 *   evaluateDecisionCoverage(entity, registry, opts?) → { covered, mode, reasons }
 *   requiredDecisionGate(entity, registry, opts?)     → { pass, reasons }
 *   validateWorkflowDecisionRefs(workflowPlan, registry) → { ok, missing, superseded }
 *
 * All assertions use in-memory registry fixtures — no disk reads, no live-tree mutation.
 * Exit 0 = all held; exit 1 = at least one failed.
 *
 * Sections:
 *   [a] COVERED_BY_ACCEPTED — governing accepted ADR → covered:true, mode='COVERED_BY_ACCEPTED'
 *   [b] SUPERSEDED_NOT_GOVERNING — only-superseded candidate → covered:false
 *   [c] NEEDS_DECISION — no candidate at all → covered:false, mode='NEEDS_DECISION'
 *   [d] requiredDecisionGate — entity w/o accepted coverage → pass:false
 *   [e] requiredDecisionGate — entity with governing accepted ADR → pass:true
 *   [f] validateWorkflowDecisionRefs — superseded/absent ref → ok:false, listed in arrays
 *   [g] validateWorkflowDecisionRefs — governing accepted refs → ok:true, empty arrays
 *   [h] Determinism — byte-identical JSON twice for all three functions
 *   [i] Defensive — never throws; null/empty → non-pass/non-covered (default-refuse §8)
 */
import { evaluateDecisionCoverage, requiredDecisionGate, validateWorkflowDecisionRefs } from './decision-coverage.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

// ---------------------------------------------------------------------------
// In-memory registry fixture — never touches the live decision tree.
// ADR-2001: accepted business/BIZ-TEST/BUSINESS_AUTHORIZATION — the governing ADR.
// ADR-2002: superseded, same triple, supersededBy ADR-2001.
// ADR-2003: accepted operation/OP-TEST/OPERATION_AUTHORIZATION.
// ---------------------------------------------------------------------------
const mkAdr = (o) => Object.assign(
  { schemaVersion: 2, supersedes: [], supersededBy: null,
    governs: { workflows: [], operations: [], business: [] }, tags: [] }, o,
);
const REGISTRY = Object.freeze({ schemaVersion: 1, decisions: [
  mkAdr({ id: 'ADR-2001', status: 'accepted', format: 'new',
    primaryContext: { type: 'business', id: 'BIZ-TEST' }, contextType: 'business',
    decisionKind: 'BUSINESS_AUTHORIZATION', decisionScope: 'platform',
    title: 'BIZ-TEST governance authorization',
    governs: { workflows: ['WF-TEST'], operations: [], business: ['BIZ-TEST'] } }),
  mkAdr({ id: 'ADR-2002', status: 'superseded', format: 'new',
    primaryContext: { type: 'business', id: 'BIZ-TEST' }, contextType: 'business',
    decisionKind: 'BUSINESS_AUTHORIZATION', decisionScope: 'platform',
    supersededBy: 'ADR-2001', title: 'BIZ-TEST governance (superseded)' }),
  mkAdr({ id: 'ADR-2003', status: 'accepted', format: 'new',
    primaryContext: { type: 'operation', id: 'OP-TEST' }, contextType: 'operation',
    decisionKind: 'OPERATION_AUTHORIZATION', decisionScope: 'operation',
    title: 'OP-TEST authorization',
    governs: { workflows: [], operations: ['OP-TEST'], business: [] } }),
] });

// Registry with only the superseded ADR — no accepted candidate for BIZ-TEST.
const REGISTRY_ONLY_SUPERSEDED = Object.freeze({ schemaVersion: 1,
  decisions: [REGISTRY.decisions[1]] }); // ADR-2002 only

// Entity shapes using `decisionRefs.governing[]` + `decisionRefs.primary`.
const ENTITY_COVERED = Object.freeze({
  id: 'OP-TEST', primaryContext: { type: 'operation', id: 'OP-TEST' },
  decisionRefs: { primary: 'ADR-2003', governing: ['ADR-2003'] },
});
const ENTITY_SUPERSEDED = Object.freeze({
  id: 'BIZ-TEST', primaryContext: { type: 'business', id: 'BIZ-TEST' },
  decisionRefs: { primary: 'ADR-2002', governing: ['ADR-2002'] },
});
const ENTITY_NO_REFS = Object.freeze({
  id: 'BIZ-UNREF', primaryContext: { type: 'business', id: 'BIZ-UNREF' },
  decisionRefs: { primary: null, governing: [] },
});

// [a] COVERED_BY_ACCEPTED
process.stdout.write('\n[a] evaluateDecisionCoverage — governing accepted ADR → COVERED_BY_ACCEPTED\n');
{
  const r = evaluateDecisionCoverage(ENTITY_COVERED, REGISTRY);
  assert('[a] returns object', r !== null && typeof r === 'object');
  assert('[a] covered is true', r.covered === true);
  assert('[a] mode is COVERED_BY_ACCEPTED', r.mode === 'COVERED_BY_ACCEPTED');
  assert('[a] reasons is an array', Array.isArray(r.reasons));
}

// [b] SUPERSEDED_NOT_GOVERNING — only-superseded candidate
process.stdout.write('\n[b] evaluateDecisionCoverage — superseded-only ref → SUPERSEDED_NOT_GOVERNING\n');
{
  const r = evaluateDecisionCoverage(ENTITY_SUPERSEDED, REGISTRY_ONLY_SUPERSEDED);
  assert('[b] covered is false', r.covered === false);
  assert('[b] mode is SUPERSEDED_NOT_GOVERNING', r.mode === 'SUPERSEDED_NOT_GOVERNING');
  assert('[b] reasons non-empty and mention superseded',
    Array.isArray(r.reasons) && r.reasons.length > 0 &&
    r.reasons.some((x) => /supersed/i.test(String(x))));
}

// [c] NEEDS_DECISION — no decisionRefs at all
process.stdout.write('\n[c] evaluateDecisionCoverage — no decisionRefs → NEEDS_DECISION\n');
{
  const r = evaluateDecisionCoverage(ENTITY_NO_REFS, REGISTRY);
  assert('[c] covered is false', r.covered === false);
  assert('[c] mode is NEEDS_DECISION', r.mode === 'NEEDS_DECISION');
  assert('[c] reasons non-empty', Array.isArray(r.reasons) && r.reasons.length > 0);
}

// [d] requiredDecisionGate — entity without accepted coverage → pass:false
process.stdout.write('\n[d] requiredDecisionGate — entity without accepted coverage → pass:false\n');
{
  const r = requiredDecisionGate(ENTITY_NO_REFS, REGISTRY);
  assert('[d] returns object', r !== null && typeof r === 'object');
  assert('[d] pass is false', r.pass === false);
  assert('[d] reasons non-empty', Array.isArray(r.reasons) && r.reasons.length > 0);
}

// [e] requiredDecisionGate — entity with governing accepted ADR → pass:true
process.stdout.write('\n[e] requiredDecisionGate — entity with governing accepted ADR → pass:true\n');
{
  const r = requiredDecisionGate(ENTITY_COVERED, REGISTRY);
  assert('[e] pass is true', r.pass === true);
  assert('[e] reasons is an array', Array.isArray(r.reasons));
}

// [f] validateWorkflowDecisionRefs — superseded/absent refs → ok:false, listed in arrays
process.stdout.write('\n[f] validateWorkflowDecisionRefs — superseded/absent refs → ok:false\n');
{
  const wfBad = { id: 'WF-BAD', decisionRefs: { primary: 'ADR-2002', governing: ['ADR-2002', 'ADR-9999'] } };
  const r = validateWorkflowDecisionRefs(wfBad, REGISTRY);
  assert('[f] ok is false', r.ok === false);
  assert('[f] superseded array lists ADR-2002',
    Array.isArray(r.superseded) && r.superseded.includes('ADR-2002'));
  assert('[f] missing array lists ADR-9999',
    Array.isArray(r.missing) && r.missing.includes('ADR-9999'));
}

// [g] validateWorkflowDecisionRefs — governing accepted refs → ok:true, empty arrays
process.stdout.write('\n[g] validateWorkflowDecisionRefs — governing accepted refs → ok:true\n');
{
  const wfGood = { id: 'WF-TEST', decisionRefs: { primary: 'ADR-2001', governing: ['ADR-2001'] } };
  const r = validateWorkflowDecisionRefs(wfGood, REGISTRY);
  assert('[g] ok is true', r.ok === true);
  assert('[g] superseded is empty', Array.isArray(r.superseded) && r.superseded.length === 0);
  assert('[g] missing is empty', Array.isArray(r.missing) && r.missing.length === 0);
}

// [h] Determinism — byte-identical JSON twice for all three functions
process.stdout.write('\n[h] Determinism — identical inputs → byte-identical JSON twice\n');
{
  assert('[h] evaluateDecisionCoverage deterministic',
    JSON.stringify(evaluateDecisionCoverage(ENTITY_COVERED, REGISTRY)) ===
    JSON.stringify(evaluateDecisionCoverage(ENTITY_COVERED, REGISTRY)));
  assert('[h] requiredDecisionGate deterministic',
    JSON.stringify(requiredDecisionGate(ENTITY_COVERED, REGISTRY)) ===
    JSON.stringify(requiredDecisionGate(ENTITY_COVERED, REGISTRY)));
  const wf = { id: 'WF-TEST', decisionRefs: { primary: 'ADR-2001', governing: ['ADR-2001'] } };
  assert('[h] validateWorkflowDecisionRefs deterministic',
    JSON.stringify(validateWorkflowDecisionRefs(wf, REGISTRY)) ===
    JSON.stringify(validateWorkflowDecisionRefs(wf, REGISTRY)));
}

// [i] Defensive — never throws; null/empty → non-pass/non-covered (constitution §8 default-refuse)
process.stdout.write('\n[i] Defensive — never throws on null/empty; null → refused\n');
{
  let threw = false;
  try {
    evaluateDecisionCoverage(null, REGISTRY);
    evaluateDecisionCoverage({}, REGISTRY);
    evaluateDecisionCoverage(ENTITY_COVERED, null);
    evaluateDecisionCoverage(ENTITY_COVERED, {});
    requiredDecisionGate(null, REGISTRY);
    requiredDecisionGate({}, REGISTRY);
    requiredDecisionGate(ENTITY_NO_REFS, null);
    validateWorkflowDecisionRefs(null, REGISTRY);
    validateWorkflowDecisionRefs({}, REGISTRY);
    validateWorkflowDecisionRefs({ id: 'WF-X', decisionRefs: null }, REGISTRY);
    validateWorkflowDecisionRefs({ id: 'WF-X', decisionRefs: { primary: 'ADR-2001', governing: [] } }, null);
  } catch { threw = true; }
  assert('[i] none of the above calls throw', !threw);

  const nc = evaluateDecisionCoverage(null, REGISTRY);
  assert('[i] null entity → covered:false (default-refuse)', nc && nc.covered === false);
  const ng = requiredDecisionGate(null, REGISTRY);
  assert('[i] null entity → pass:false (default-refuse)', ng && ng.pass === false);
  const nv = validateWorkflowDecisionRefs(null, REGISTRY);
  assert('[i] null workflowPlan → ok:false (default-refuse)', nv && nv.ok === false);
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
