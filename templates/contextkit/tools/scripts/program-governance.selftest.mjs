/**
 * program-governance.selftest.mjs — pure-core tests for assessProgramGovernance
 * (BIZ-0001 / WF-0037 Wave B5, B5-T1).
 *
 * Fixture-based and dogfood-INDEPENDENT (clean-clone safe): exercises the pure
 * `assessProgramGovernance` over hand-built inputs — one all-pass fixture plus one
 * fixture per failure mode — so a regression in any of the four governance
 * criteria flips a deterministic assertion. The live dogfood run is covered by
 * `validateProgramGovernance` (invoked by the wave gate), not here.
 *
 * Run: `node program-governance.selftest.mjs` (exit 0 = green).
 */
import { assessProgramGovernance } from './program-governance.mjs';

let failures = 0;
const assertOk = (cond, label) => { if (cond) { console.log(`  ✓ ${label}`); } else { failures += 1; console.error(`  ✗ ${label}`); } };

/** A valid v2 Business-authorization ADR record (passes schema + provenance). */
const VALID_ADR = Object.freeze({
  schemaVersion: 2,
  id: 'ADR-0102',
  title: 'Business-driven, evidence-governed methodology',
  status: 'accepted',
  contextType: 'business',
  primaryContext: { type: 'business', id: 'BIZ-0001' },
  relatedContexts: [],
  decisionKind: 'BUSINESS_AUTHORIZATION',
  decisionScope: 'platform',
  valueIntents: { primary: 'ENABLE', secondary: ['IMPROVE'] },
  product: { productId: 'contextdevkit', area: 'workflow-engine', capability: 'business-driven-methodology' },
  governs: { workflows: ['WF-0036', 'WF-0037'], operations: [], business: ['BIZ-0001'] },
  approvalSource: {
    type: 'business', id: 'BIZ-0001', revision: 1,
    decisionHash: 'sha256:fixture', approvedAt: '2026-06-19T00:00:00.000Z',
    actor: 'human',
  },
  supersededBy: null,
  createdAt: '2026-06-18T00:00:00.000Z',
  acceptedAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
});

/** A registry whose rows resolve the program's decision references. */
const REGISTRY = Object.freeze({
  decisions: [
    { id: 'ADR-0102', status: 'accepted', contextType: 'business', decisionKind: 'BUSINESS_AUTHORIZATION' },
  ],
});

/** Two workflow plans referencing the authorizing ADR. */
const PLANS = [
  { workflowId: 'WF-0036', decisionRefs: ['ADR-0102'] },
  { workflowId: 'WF-0037', decisionRefs: ['ADR-0102'] },
];

const BASE = Object.freeze({
  adrRecord: VALID_ADR,
  registry: REGISTRY,
  workflowPlans: PLANS,
  redundancyReport: { findings: [] },
  registriesIdempotent: true,
});

console.log('program-governance.selftest:');

// 1. All-pass fixture → ok:true, every check ok.
const pass = assessProgramGovernance(BASE);
assertOk(pass.ok === true, 'all-pass fixture → ok:true');
assertOk(pass.checks.adrSchemaV2.ok, 'all-pass → adrSchemaV2 ok');
assertOk(pass.checks.decisionRefs.length === 2 && pass.checks.decisionRefs.every((r) => r.ok), 'all-pass → both decisionRefs resolve');
assertOk(pass.checks.provenance.ok, 'all-pass → provenance ok');
assertOk(pass.checks.noDuplicates.ok, 'all-pass → no duplicates');
assertOk(pass.checks.registriesIdempotent.ok, 'all-pass → registries idempotent');

// 2. Bad schema (v1) → fail.
const badSchema = assessProgramGovernance({ ...BASE, adrRecord: { ...VALID_ADR, schemaVersion: 1 } });
assertOk(badSchema.ok === false && !badSchema.checks.adrSchemaV2.ok, 'schemaVersion 1 → ok:false (schema fails)');

// 3. Unresolved decision reference → fail.
const missingRef = assessProgramGovernance({ ...BASE, registry: { decisions: [] } });
assertOk(missingRef.ok === false && missingRef.checks.decisionRefs.some((r) => r.missing.length > 0), 'unresolved ref → ok:false (missing reported)');

// 4. Missing provenance (no approvalSource) → fail.
const noProv = assessProgramGovernance({ ...BASE, adrRecord: { ...VALID_ADR, approvalSource: undefined } });
assertOk(noProv.ok === false && !noProv.checks.provenance.ok, 'no approvalSource → ok:false (provenance fails)');

// 5. Hard id-duplicate finding → fail.
const dup = assessProgramGovernance({ ...BASE, redundancyReport: { findings: [{ kind: 'duplicate-id', ids: ['ADR-0102', 'ADR-0102'] }] } });
assertOk(dup.ok === false && !dup.checks.noDuplicates.ok, 'id-duplicate finding → ok:false (noDuplicates fails)');

// 6. Non-idempotent registry rebuild → fail.
const notIdem = assessProgramGovernance({ ...BASE, registriesIdempotent: false });
assertOk(notIdem.ok === false && !notIdem.checks.registriesIdempotent.ok, 'non-idempotent rebuild → ok:false');

// 7. Empty workflow list is NOT a pass — refsOk requires ≥1 plan, so a program with
//    no governed workflows cannot pass vacuously (constitution §8, default to refuse).
const noPlans = assessProgramGovernance({ ...BASE, workflowPlans: [] });
assertOk(noPlans.ok === false, 'no workflow plans → ok:false (vacuous pass refused)');

// 8. A workflow declaring ZERO decision references must NOT pass — the underlying
//    ref validator trivially resolves an empty set, so the program gate adds a
//    ≥1-reference requirement (an unwired governed workflow is a governance hole).
const emptyRefs = assessProgramGovernance({ ...BASE, workflowPlans: [{ workflowId: 'WF-0036', decisionRefs: [] }] });
assertOk(emptyRefs.ok === false && emptyRefs.checks.decisionRefs[0].refCount === 0, 'workflow with empty decisionRefs → ok:false (unwired workflow refused)');

if (failures > 0) {
  console.error(`program-governance.selftest: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('program-governance.selftest: PASS (all assertions green)');
