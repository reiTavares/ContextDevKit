/**
 * child-envelope.selftest.mjs — Unit tests for child-envelope.mjs.
 * Run: node templates/contextkit/runtime/execution/child-envelope.selftest.mjs
 * Exit 0 on full pass; exit 1 on any failure.
 *
 * Covers (A9-T1, ADR-0112): inheritance, canDelegate=false, depth+1,
 * assertChildScope rejects reclassify/autonomy/scope/createsWorkflow/acceptsADR,
 * accepts faithful child, missing-parent→MISSING_PARENT, no-mutation, determinism,
 * frozen results, optional-fields fallback.
 *
 * @module child-envelope.selftest
 */
import { deriveChildEnvelope, assertChildScope } from './child-envelope.mjs';

let passed = 0;
let failed = 0;

/** @param {string} label @param {boolean} condition @param {string} [detail] */
function assert(label, condition, detail = '') {
  if (condition) { passed += 1; }
  else { failed += 1; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}

function finish() {
  const total = passed + failed;
  if (failed === 0) { console.log(`ok ${passed}/${total}`); process.exit(0); }
  else { console.error(`not ok — ${failed} failure(s) / ${total} assertions`); process.exit(1); }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeParent(overrides = {}) {
  return {
    requestId: 'req-parent-001', delegationDepth: 0,
    classification: { primaryType: 'implementation', complexity: 'feature', ceremony: 'standard', risk: 'medium' },
    context: { businessId: 'biz-42', operationId: 'op-99', workflowId: 'wf-0038', taskId: 'task-7',
      paths: ['/src/foo.mjs', '/src/bar.mjs'] },
    autonomy: { effectiveGrade: 3, configuredGrade: 3, source: 'config', mode: 'advisory' },
    decisions: ['ADR-0112', 'ADR-0107'],
    acceptance: { criteria: 'tests green' },
    ...overrides,
  };
}
const baseSpec = { childId: 'child-001', role: 'lead' };

// ---------------------------------------------------------------------------
// Group 1 — Inherited fields + optional fields
// ---------------------------------------------------------------------------
{
  const parent = makeParent();
  const child = deriveChildEnvelope(parent, baseSpec);

  // Core inherited fields
  assert('inherit: businessId', child.inherited.businessId === 'biz-42');
  assert('inherit: primaryType', child.inherited.primaryType === 'implementation');
  assert('inherit: ceremony', child.inherited.ceremony === 'standard');
  assert('inherit: context.workflowId', child.inherited.context.workflowId === 'wf-0038');
  assert('inherit: decisions includes ADR-0112',
    Array.isArray(child.inherited.decisions) && child.inherited.decisions.includes('ADR-0112'));
  assert('inherit: acceptance.criteria', child.inherited.acceptance?.criteria === 'tests green');

  // Top-level mirrors
  assert('inherit: classification.primaryType at root', child.classification.primaryType === 'implementation');
  assert('inherit: classification.complexity at root', child.classification.complexity === 'feature');
  assert('inherit: decisions at root', Array.isArray(child.decisions) && child.decisions.includes('ADR-0112'));
  assert('inherit: acceptance at root', child.acceptance?.criteria === 'tests green');

  // Optional fields absent on parent → absent on child
  const parentNoOpts = makeParent();
  delete parentNoOpts.decisions; delete parentNoOpts.acceptance;
  const childNoOpts = deriveChildEnvelope(parentNoOpts, baseSpec);
  assert('optional: absent decisions not propagated', childNoOpts.decisions === undefined);
  assert('optional: absent acceptance not propagated', childNoOpts.acceptance === undefined);
  assert('optional: inherited.decisions undefined', childNoOpts.inherited.decisions === undefined);
  assert('optional: inherited.acceptance undefined', childNoOpts.inherited.acceptance === undefined);
}

// ---------------------------------------------------------------------------
// Group 2 — canDelegate, delegationDepth, identity
// ---------------------------------------------------------------------------
{
  const parent = makeParent();
  const child = deriveChildEnvelope(parent, { childId: 'c-reviewer-007', role: 'reviewer' });

  assert('delegation: canDelegate is false', child.canDelegate === false);
  assert('delegation: depth parent(0)+1=1', child.delegationDepth === 1);
  assert('identity: childId set', child.childId === 'c-reviewer-007');
  assert('identity: role set', child.role === 'reviewer');
  assert('identity: parentRequestId', child.parentRequestId === 'req-parent-001');

  // Depth arithmetic from non-zero start
  assert('delegation: depth from 4→5', deriveChildEnvelope(makeParent({ delegationDepth: 4 }), baseSpec).delegationDepth === 5);

  // Missing delegationDepth on parent treated as 0
  const parentNoDep = makeParent(); delete parentNoDep.delegationDepth;
  assert('delegation: missing parent depth → child gets 1',
    deriveChildEnvelope(parentNoDep, baseSpec).delegationDepth === 1);
}

// ---------------------------------------------------------------------------
// Group 3 — assertChildScope rejects reclassification
// ---------------------------------------------------------------------------
{
  const parent = makeParent();

  const r1 = assertChildScope(parent, { primaryType: 'business' });
  assert('scope: rejects reclassify primaryType', !r1.valid);
  assert('scope: RECLASSIFY_PRIMARY_TYPE code', r1.violations.includes('RECLASSIFY_PRIMARY_TYPE'));

  const r2 = assertChildScope(parent, { complexity: 'trivial' });
  assert('scope: rejects reclassify complexity', !r2.valid);
  assert('scope: RECLASSIFY_COMPLEXITY code', r2.violations.includes('RECLASSIFY_COMPLEXITY'));

  // Same values → no violation
  const r3 = assertChildScope(parent, { primaryType: 'implementation', complexity: 'feature' });
  assert('scope: same values not a violation',
    !r3.violations.includes('RECLASSIFY_PRIMARY_TYPE') && !r3.violations.includes('RECLASSIFY_COMPLEXITY'));
}

// ---------------------------------------------------------------------------
// Group 4 — assertChildScope rejects autonomy change + scope expansion + governance
// ---------------------------------------------------------------------------
{
  const parent = makeParent();

  // Autonomy
  const ra = assertChildScope(parent, { effectiveGrade: 4 });
  assert('autonomy: rejects grade change', !ra.valid);
  assert('autonomy: AUTONOMY_CHANGE code', ra.violations.includes('AUTONOMY_CHANGE'));
  assert('autonomy: same grade not a violation',
    !assertChildScope(parent, { effectiveGrade: 3 }).violations.includes('AUTONOMY_CHANGE'));

  // Scope expansion
  const rs1 = assertChildScope(parent, { scope: ['/src/foo.mjs', '/src/NEW_INTRUDER.mjs'] });
  assert('scope-exp: rejects new paths', !rs1.valid);
  assert('scope-exp: SCOPE_EXPANSION code', rs1.violations.includes('SCOPE_EXPANSION'));
  assert('scope-exp: subset allowed',
    !assertChildScope(parent, { scope: ['/src/foo.mjs'] }).violations.includes('SCOPE_EXPANSION'));
  assert('scope-exp: empty scope allowed',
    !assertChildScope(parent, { scope: [] }).violations.includes('SCOPE_EXPANSION'));

  // No parent paths → never an expansion
  const parentNoPaths = makeParent(); delete parentNoPaths.context.paths;
  assert('scope-exp: no parent paths → not a violation',
    !assertChildScope(parentNoPaths, { scope: ['/src/anything.mjs'] }).violations.includes('SCOPE_EXPANSION'));

  // Governance flags
  const rw = assertChildScope(parent, { createsWorkflow: true });
  assert('govn: rejects createsWorkflow=true', !rw.valid);
  assert('govn: CREATES_WORKFLOW code', rw.violations.includes('CREATES_WORKFLOW'));

  const ra2 = assertChildScope(parent, { acceptsADR: true });
  assert('govn: rejects acceptsADR=true', !ra2.valid);
  assert('govn: ACCEPTS_ADR code', ra2.violations.includes('ACCEPTS_ADR'));

  assert('govn: false flags not violations',
    assertChildScope(parent, { createsWorkflow: false, acceptsADR: false }).valid === true);
}

// ---------------------------------------------------------------------------
// Group 5 — Faithful child accepted
// ---------------------------------------------------------------------------
{
  const r = assertChildScope(makeParent(), {
    primaryType: 'implementation', complexity: 'feature',
    effectiveGrade: 3, scope: ['/src/foo.mjs'], createsWorkflow: false, acceptsADR: false,
  });
  assert('faithful: valid=true', r.valid === true);
  assert('faithful: no violations', r.violations.length === 0);
}

// ---------------------------------------------------------------------------
// Group 6 — Missing/invalid parent → MISSING_PARENT
// ---------------------------------------------------------------------------
{
  for (const [label, badParent] of [['null', null], ['undefined', undefined], ['string', 'not-obj']]) {
    const r = assertChildScope(badParent, {});
    assert(`missing-parent: ${label} → valid=false`, !r.valid);
    assert(`missing-parent: ${label} → MISSING_PARENT`, r.violations.includes('MISSING_PARENT'));
  }
}

// ---------------------------------------------------------------------------
// Group 7 — No mutation + Determinism + Frozen results
// ---------------------------------------------------------------------------
{
  const parent = makeParent();
  const spec = { ...baseSpec };
  const pSnap = JSON.stringify(parent); const sSnap = JSON.stringify(spec);

  const c1 = deriveChildEnvelope(parent, spec);
  const c2 = deriveChildEnvelope(parent, spec);
  assert('no-mutation: parent unchanged', JSON.stringify(parent) === pSnap);
  assert('no-mutation: spec unchanged', JSON.stringify(spec) === sSnap);
  assert('determinism: childId stable', c1.childId === c2.childId);
  assert('determinism: delegationDepth stable', c1.delegationDepth === c2.delegationDepth);
  assert('determinism: canDelegate stable', c1.canDelegate === c2.canDelegate);
  assert('determinism: inherited.businessId stable', c1.inherited.businessId === c2.inherited.businessId);
  assert('frozen: child envelope frozen', Object.isFrozen(c1));
  assert('frozen: child.inherited frozen', Object.isFrozen(c1.inherited));
  assert('frozen: child.classification frozen', Object.isFrozen(c1.classification));
  assert('frozen: child.autonomy frozen', Object.isFrozen(c1.autonomy));

  // assertChildScope mutation + determinism + frozen
  const attempt = { primaryType: 'business', scope: ['/extra.mjs'] };
  const pA = makeParent(); const pASnap = JSON.stringify(pA); const aSnap = JSON.stringify(attempt);
  const r1 = assertChildScope(pA, attempt); const r2 = assertChildScope(pA, attempt);
  assert('no-mutation: parent unchanged after assertChildScope', JSON.stringify(pA) === pASnap);
  assert('no-mutation: attempt unchanged after assertChildScope', JSON.stringify(attempt) === aSnap);
  assert('determinism: assertChildScope valid stable', r1.valid === r2.valid);
  assert('determinism: assertChildScope violations stable',
    JSON.stringify(r1.violations) === JSON.stringify(r2.violations));
  assert('frozen: scope result frozen', Object.isFrozen(r1));
  assert('frozen: scope violations frozen', Object.isFrozen(r1.violations));
}

finish();
