/**
 * child-envelope.selftest.mjs — Self-contained unit tests for child-envelope.mjs.
 *
 * Run directly: node templates/contextkit/runtime/execution/child-envelope.selftest.mjs
 * Exit 0 on full pass; exit 1 with a failure report on any failure.
 * No external deps — pure node:*.
 *
 * Covers (A9-T1 acceptance criteria, ADR-0112):
 *   - Child inherits business root, work nature, ceremony, context, decisions, acceptance.
 *   - Child has canDelegate=false and delegationDepth=parent+1.
 *   - assertChildScope rejects: reclassify-primaryType, reclassify-complexity,
 *     autonomy-change, scope-expansion, createsWorkflow, acceptsADR.
 *   - assertChildScope accepts a faithful child attempt.
 *   - Inputs are never mutated.
 *   - Determinism: same inputs → same output.
 *   - Missing/null parent → MISSING_PARENT violation (not a pass).
 *
 * @module child-envelope.selftest
 */
import { deriveChildEnvelope, assertChildScope } from './child-envelope.mjs';

// ---------------------------------------------------------------------------
// Minimal assert harness (mirrors dispatch-plan.selftest.mjs convention)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

/**
 * Records a single assertion result.
 *
 * @param {string} label human-readable test name
 * @param {boolean} condition must be true to pass
 * @param {string} [detail] extra context printed on failure
 */
function assert(label, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Prints the final summary and exits with an appropriate code.
 */
function finish() {
  const total = passed + failed;
  if (failed === 0) {
    console.log(`ok ${passed}/${total}`);
    process.exit(0);
  } else {
    console.error(`not ok — ${failed} failure(s) / ${total} assertions`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Builds a representative parent intent envelope. */
function makeParentEnvelope(overrides = {}) {
  return {
    requestId: 'req-parent-001',
    delegationDepth: 0,
    classification: {
      primaryType: 'implementation',
      complexity: 'feature',
      ceremony: 'standard',
      risk: 'medium',
    },
    context: {
      businessId: 'biz-42',
      operationId: 'op-99',
      workflowId: 'wf-0038',
      taskId: 'task-7',
      paths: ['/src/foo.mjs', '/src/bar.mjs'],
    },
    autonomy: {
      effectiveGrade: 3,
      configuredGrade: 3,
      source: 'config',
      mode: 'advisory',
    },
    decisions: ['ADR-0112', 'ADR-0107'],
    acceptance: { criteria: 'tests green' },
    ...overrides,
  };
}

/** Builds a minimal valid child spec. */
function makeChildSpec(overrides = {}) {
  return { childId: 'child-001', role: 'lead', ...overrides };
}

// ---------------------------------------------------------------------------
// Test group 1 — Inherited fields
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();
  const child = deriveChildEnvelope(parent, makeChildSpec());

  assert('inherit: businessId carried', child.inherited.businessId === 'biz-42');
  assert('inherit: primaryType carried', child.inherited.primaryType === 'implementation');
  assert('inherit: ceremony carried', child.inherited.ceremony === 'standard');
  assert('inherit: context.workflowId carried', child.inherited.context.workflowId === 'wf-0038');
  assert('inherit: decisions array carried',
    Array.isArray(child.inherited.decisions)
    && child.inherited.decisions.includes('ADR-0112'));
  assert('inherit: acceptance carried',
    child.inherited.acceptance && child.inherited.acceptance.criteria === 'tests green');

  // Top-level classification mirrors parent
  assert('inherit: classification.primaryType', child.classification.primaryType === 'implementation');
  assert('inherit: classification.complexity', child.classification.complexity === 'feature');
  assert('inherit: classification.ceremony', child.classification.ceremony === 'standard');

  // Top-level decisions + acceptance also promoted
  assert('inherit: decisions at root', Array.isArray(child.decisions) && child.decisions.includes('ADR-0112'));
  assert('inherit: acceptance at root', child.acceptance && child.acceptance.criteria === 'tests green');
}

// ---------------------------------------------------------------------------
// Test group 2 — canDelegate and delegationDepth
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope({ delegationDepth: 0 });
  const child = deriveChildEnvelope(parent, makeChildSpec());

  assert('delegation: canDelegate is false', child.canDelegate === false);
  assert('delegation: delegationDepth = parent+1', child.delegationDepth === 1);

  // Depth arithmetic works from any starting depth
  const parent2 = makeParentEnvelope({ delegationDepth: 4 });
  const child2 = deriveChildEnvelope(parent2, makeChildSpec());
  assert('delegation: depth from 4 → 5', child2.delegationDepth === 5);

  // Absent delegationDepth on parent treated as 0
  const parentNoDep = makeParentEnvelope();
  delete parentNoDep.delegationDepth;
  const childNoDep = deriveChildEnvelope(parentNoDep, makeChildSpec());
  assert('delegation: missing parent depth treated as 0, child gets 1', childNoDep.delegationDepth === 1);
}

// ---------------------------------------------------------------------------
// Test group 3 — Child identity fields
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();
  const child = deriveChildEnvelope(parent, { childId: 'c-reviewer-007', role: 'reviewer' });

  assert('identity: childId set', child.childId === 'c-reviewer-007');
  assert('identity: role set', child.role === 'reviewer');
  assert('identity: parentRequestId matches parent.requestId', child.parentRequestId === 'req-parent-001');
}

// ---------------------------------------------------------------------------
// Test group 4 — assertChildScope rejects reclassification
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();

  const r1 = assertChildScope(parent, { primaryType: 'business' });
  assert('scope: rejects reclassify primaryType', !r1.valid);
  assert('scope: violation code RECLASSIFY_PRIMARY_TYPE', r1.violations.includes('RECLASSIFY_PRIMARY_TYPE'));

  const r2 = assertChildScope(parent, { complexity: 'trivial' });
  assert('scope: rejects reclassify complexity', !r2.valid);
  assert('scope: violation code RECLASSIFY_COMPLEXITY', r2.violations.includes('RECLASSIFY_COMPLEXITY'));

  // Matching values do not trigger reclassification violations
  const r3 = assertChildScope(parent, { primaryType: 'implementation', complexity: 'feature' });
  assert('scope: same primaryType/complexity is not a violation',
    !r3.violations.includes('RECLASSIFY_PRIMARY_TYPE')
    && !r3.violations.includes('RECLASSIFY_COMPLEXITY'));
}

// ---------------------------------------------------------------------------
// Test group 5 — assertChildScope rejects autonomy change
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();

  const r1 = assertChildScope(parent, { effectiveGrade: 4 });
  assert('autonomy: rejects grade change', !r1.valid);
  assert('autonomy: violation code AUTONOMY_CHANGE', r1.violations.includes('AUTONOMY_CHANGE'));

  // Same grade is not a violation
  const r2 = assertChildScope(parent, { effectiveGrade: 3 });
  assert('autonomy: same grade is not a violation', !r2.violations.includes('AUTONOMY_CHANGE'));
}

// ---------------------------------------------------------------------------
// Test group 6 — assertChildScope rejects scope expansion
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();
  // Child tries to touch a path outside the parent's declared scope
  const r1 = assertChildScope(parent, { scope: ['/src/foo.mjs', '/src/NEW_INTRUDER.mjs'] });
  assert('scope-expansion: rejects new paths', !r1.valid);
  assert('scope-expansion: violation code SCOPE_EXPANSION', r1.violations.includes('SCOPE_EXPANSION'));

  // Subset is allowed
  const r2 = assertChildScope(parent, { scope: ['/src/foo.mjs'] });
  assert('scope-expansion: subset is not a violation', !r2.violations.includes('SCOPE_EXPANSION'));

  // Empty child scope is not an expansion
  const r3 = assertChildScope(parent, { scope: [] });
  assert('scope-expansion: empty child scope is not a violation', !r3.violations.includes('SCOPE_EXPANSION'));

  // Parent with no declared paths — child scope never triggers expansion
  const parentNoPaths = makeParentEnvelope();
  delete parentNoPaths.context.paths;
  const r4 = assertChildScope(parentNoPaths, { scope: ['/src/anything.mjs'] });
  assert('scope-expansion: no parent paths → not a violation', !r4.violations.includes('SCOPE_EXPANSION'));
}

// ---------------------------------------------------------------------------
// Test group 7 — assertChildScope rejects workflow/ADR governance actions
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();

  const r1 = assertChildScope(parent, { createsWorkflow: true });
  assert('govn: rejects createsWorkflow=true', !r1.valid);
  assert('govn: violation code CREATES_WORKFLOW', r1.violations.includes('CREATES_WORKFLOW'));

  const r2 = assertChildScope(parent, { acceptsADR: true });
  assert('govn: rejects acceptsADR=true', !r2.valid);
  assert('govn: violation code ACCEPTS_ADR', r2.violations.includes('ACCEPTS_ADR'));

  // false values are not violations
  const r3 = assertChildScope(parent, { createsWorkflow: false, acceptsADR: false });
  assert('govn: false flags not a violation', r3.violations.length === 0 && r3.valid);
}

// ---------------------------------------------------------------------------
// Test group 8 — assertChildScope accepts a faithful child attempt
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();
  const faithful = {
    primaryType: 'implementation',
    complexity: 'feature',
    effectiveGrade: 3,
    scope: ['/src/foo.mjs'],
    createsWorkflow: false,
    acceptsADR: false,
  };
  const r = assertChildScope(parent, faithful);
  assert('faithful: valid=true', r.valid === true);
  assert('faithful: no violations', r.violations.length === 0);
}

// ---------------------------------------------------------------------------
// Test group 9 — Missing parent → MISSING_PARENT violation (never a pass)
// ---------------------------------------------------------------------------

{
  const r1 = assertChildScope(null, { primaryType: 'implementation' });
  assert('missing-parent: null → valid=false', !r1.valid);
  assert('missing-parent: null → MISSING_PARENT', r1.violations.includes('MISSING_PARENT'));

  const r2 = assertChildScope(undefined, {});
  assert('missing-parent: undefined → valid=false', !r2.valid);
  assert('missing-parent: undefined → MISSING_PARENT', r2.violations.includes('MISSING_PARENT'));

  const r3 = assertChildScope('not-an-object', {});
  assert('missing-parent: string → valid=false', !r3.valid);
  assert('missing-parent: string → MISSING_PARENT', r3.violations.includes('MISSING_PARENT'));
}

// ---------------------------------------------------------------------------
// Test group 10 — Inputs are never mutated
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();
  const spec = makeChildSpec();
  const parentClone = JSON.parse(JSON.stringify(parent));
  const specClone = JSON.parse(JSON.stringify(spec));

  deriveChildEnvelope(parent, spec);

  assert('no-mutation: parent unchanged after derive', JSON.stringify(parent) === JSON.stringify(parentClone));
  assert('no-mutation: spec unchanged after derive', JSON.stringify(spec) === JSON.stringify(specClone));

  const attempt = { primaryType: 'business', scope: ['/extra.mjs'] };
  const attemptClone = JSON.parse(JSON.stringify(attempt));
  const parentForAssert = makeParentEnvelope();
  const parentForAssertClone = JSON.parse(JSON.stringify(parentForAssert));

  assertChildScope(parentForAssert, attempt);

  assert('no-mutation: parent unchanged after assertChildScope',
    JSON.stringify(parentForAssert) === JSON.stringify(parentForAssertClone));
  assert('no-mutation: attempt unchanged after assertChildScope',
    JSON.stringify(attempt) === JSON.stringify(attemptClone));
}

// ---------------------------------------------------------------------------
// Test group 11 — Determinism: same inputs → same output
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();
  const spec = makeChildSpec();

  const c1 = deriveChildEnvelope(parent, spec);
  const c2 = deriveChildEnvelope(parent, spec);

  assert('determinism: childId stable', c1.childId === c2.childId);
  assert('determinism: delegationDepth stable', c1.delegationDepth === c2.delegationDepth);
  assert('determinism: canDelegate stable', c1.canDelegate === c2.canDelegate);
  assert('determinism: inherited businessId stable',
    c1.inherited.businessId === c2.inherited.businessId);

  const attempt = { primaryType: 'implementation' };
  const parentScope = makeParentEnvelope();
  const r1 = assertChildScope(parentScope, attempt);
  const r2 = assertChildScope(parentScope, attempt);
  assert('determinism: assertChildScope valid stable', r1.valid === r2.valid);
  assert('determinism: assertChildScope violations stable',
    JSON.stringify(r1.violations) === JSON.stringify(r2.violations));
}

// ---------------------------------------------------------------------------
// Test group 12 — Results are frozen
// ---------------------------------------------------------------------------

{
  const parent = makeParentEnvelope();
  const child = deriveChildEnvelope(parent, makeChildSpec());
  assert('frozen: child envelope is frozen', Object.isFrozen(child));
  assert('frozen: child.inherited is frozen', Object.isFrozen(child.inherited));
  assert('frozen: child.classification is frozen', Object.isFrozen(child.classification));
  assert('frozen: child.autonomy is frozen', Object.isFrozen(child.autonomy));

  const r = assertChildScope(parent, {});
  assert('frozen: scope result is frozen', Object.isFrozen(r));
  assert('frozen: scope violations array is frozen', Object.isFrozen(r.violations));
}

// ---------------------------------------------------------------------------
// Test group 13 — Optional parent fields: decisions/acceptance absent
// ---------------------------------------------------------------------------

{
  const parentNoOptionals = makeParentEnvelope();
  delete parentNoOptionals.decisions;
  delete parentNoOptionals.acceptance;

  const child = deriveChildEnvelope(parentNoOptionals, makeChildSpec());
  assert('optional: decisions absent on parent → absent on child', child.decisions === undefined);
  assert('optional: acceptance absent on parent → absent on child', child.acceptance === undefined);
  assert('optional: inherited.decisions undefined', child.inherited.decisions === undefined);
  assert('optional: inherited.acceptance undefined', child.inherited.acceptance === undefined);
}

finish();
