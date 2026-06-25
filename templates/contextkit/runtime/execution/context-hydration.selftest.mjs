/**
 * context-hydration.selftest.mjs — Self-contained test harness for context-hydration.mjs.
 *
 * Verifies:
 *   T01  Each role receives only its declared sections (not others).
 *   T02  Token budget is NEVER exceeded (oversized envelope → truncated=true + tokenCount ≤ budget).
 *   T03  Token estimate matches playbook-compile.mjs convention (4 chars/token, Math.ceil).
 *   T04  propagateState rolls up child→task→wave→business counts correctly.
 *   T05  Pure / no-throw when no I/O target is given (shadow-safe).
 *   T06  Determinism: same inputs → same outputs across two calls.
 *   T07  Inputs are never mutated (envelope + payload are unchanged after calls).
 *   T08  Unknown role falls back to default sections without throwing.
 *   T09  Empty envelope yields empty pack without throwing.
 *   T10  propagateState with malformed payload never throws.
 *
 * Exit non-zero on any failure; print "ok N/N" on full pass.
 * Zero dependencies beyond node:* and the module under test.
 */
import { hydrateRolePack, propagateState } from './context-hydration.mjs';

// ---------------------------------------------------------------------------
// Minimal assert harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

/**
 * @param {string} label
 * @param {boolean} condition
 * @param {string} [detail]
 */
function assert(label, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    process.stderr.write(`FAIL [${label}]${detail ? ': ' + detail : ''}\n`);
  }
}

/**
 * Estimates tokens using the SAME convention as playbook-compile.mjs (4 chars/token).
 * This is the spot-check reference for T03.
 *
 * @param {string} text
 * @returns {number}
 */
function refEstimate(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A minimal well-formed envelope mirroring the buildEnvelope() output shape. */
const BASE_ENVELOPE = Object.freeze({
  schemaVersion: '1.0.0',
  requestId: 'req-test-001',
  sessionId: 'sess-001',
  receivedAt: '2026-06-24T00:00:00.000Z',
  request: Object.freeze({ textHash: 'sha256:abc', summary: 'test request', explicitOverrides: [] }),
  context: Object.freeze({ primaryType: 'implementation', secondaryTypes: [], businessId: null, operationId: null, workflowId: null, taskId: null }),
  classification: Object.freeze({ intent: 'implementation', complexity: 'feature', risk: 'medium', materialityScore: 0, ambiguityScore: 0, reversibility: 'medium', blastRadius: 'local', needsAdr: false, needsDebate: false }),
  autonomy: Object.freeze({ configuredGrade: null, effectiveGrade: null, source: 'unknown', mode: 'manual' }),
  routing: Object.freeze({ mode: 'shadow', directExecutionAllowed: true, reasonCodes: [] }),
  agents: Object.freeze({ lead: null, council: [], scouts: [], reviewers: [], synthesizer: null }),
  playbooks: Object.freeze([]),
  dispatchPlanId: null,
});

/** Role → expected field names (must match ROLE_NEEDS in the module exactly). */
const ROLE_NEEDS = {
  reviewer:    ['classification', 'routing', 'request'],
  scout:       ['context', 'classification', 'request'],
  synthesizer: ['agents', 'playbooks', 'routing'],
  lead:        ['context', 'classification', 'autonomy', 'routing', 'agents', 'playbooks', 'request'],
  council:     ['classification', 'autonomy', 'routing', 'request'],
};

// ---------------------------------------------------------------------------
// T01 — Each role gets only its declared sections
// ---------------------------------------------------------------------------

for (const [role, expectedNames] of Object.entries(ROLE_NEEDS)) {
  const pack = hydrateRolePack(role, BASE_ENVELOPE, { maxTokens: 4000 });
  const actualNames = pack.sections.map((s) => s.name);
  const sectionSet = new Set(actualNames);

  // All expected fields that exist in the envelope should be present.
  for (const name of expectedNames) {
    if (name in BASE_ENVELOPE) {
      assert(`T01-${role}-has-${name}`, sectionSet.has(name), `role=${role} missing section ${name}`);
    }
  }

  // No section outside the declared needs should appear.
  for (const name of actualNames) {
    assert(`T01-${role}-no-extra-${name}`, expectedNames.includes(name), `role=${role} unexpected section ${name}`);
  }
}

// ---------------------------------------------------------------------------
// T02 — Token budget is NEVER exceeded (oversized content → truncated=true)
// ---------------------------------------------------------------------------

// Build an oversized envelope where the 'classification' field alone is huge.
const PADDED = 'x'.repeat(10000); // 10000 chars → ~2500 tokens
const fatEnvelope = { ...BASE_ENVELOPE, classification: { ...BASE_ENVELOPE.classification, extraPad: PADDED } };

const tightPack = hydrateRolePack('lead', fatEnvelope, { maxTokens: 100 });
assert('T02-truncated-flag', tightPack.truncated === true, 'oversized envelope should set truncated=true');
assert('T02-budget-not-exceeded', tightPack.tokenCount <= 100, `tokenCount=${tightPack.tokenCount} > budget=100`);
assert('T02-reason-code-present', tightPack.reasonCodes.some((r) => r.startsWith('budget-exceeded-at')), 'missing budget reason code');
assert('T02-frozen-result', Object.isFrozen(tightPack), 'result object must be frozen');

// ---------------------------------------------------------------------------
// T03 — Same token estimate as playbook-compile.mjs (4 chars/token, Math.ceil)
// ---------------------------------------------------------------------------

const KNOWN_STRING = 'Hello, World!'; // 13 chars → ceil(13/4) = 4 tokens
const knownPack = hydrateRolePack('reviewer', { ...BASE_ENVELOPE, classification: KNOWN_STRING }, { maxTokens: 4000 });
// The rendered text is "## classification\n<KNOWN_STRING>" — estimate should match refEstimate.
const renderedText = `## classification\n${KNOWN_STRING}`;
const expectedTokens = refEstimate(renderedText);
const classSection = knownPack.sections.find((s) => s.name === 'classification');
assert('T03-section-found', !!classSection, 'classification section absent for spot-check');
if (classSection) {
  const actualSectionTokens = refEstimate(classSection.text);
  assert('T03-token-estimate-matches', actualSectionTokens === expectedTokens,
    `refEstimate=${expectedTokens} vs section text estimate=${actualSectionTokens}`);
}
// Ensure tokenCount === sum of refEstimate over all sections (consistency).
const expectedTotal = knownPack.sections.reduce((sum, s) => sum + refEstimate(s.text), 0);
assert('T03-total-consistent', knownPack.tokenCount === expectedTotal,
  `pack.tokenCount=${knownPack.tokenCount} vs sum=${expectedTotal}`);

// ---------------------------------------------------------------------------
// T04 — propagateState rolls up counts correctly
// ---------------------------------------------------------------------------

const childPayload = {
  taskId: 'task-001',
  children: [
    { id: 'c1', status: 'done' },
    { id: 'c2', status: 'failed' },
    { id: 'c3', status: 'done' },
    { id: 'c4', status: 'blocked' },
    { id: 'c5', status: 'working' },
  ],
};

const taskRollup = propagateState('task', childPayload);
assert('T04-level', taskRollup.level === 'task', `level=${taskRollup.level}`);
assert('T04-total', taskRollup.rollup.total === 5, `total=${taskRollup.rollup.total}`);
assert('T04-done', taskRollup.rollup.done === 2, `done=${taskRollup.rollup.done}`);
assert('T04-failed', taskRollup.rollup.failedCount === 1, `failedCount=${taskRollup.rollup.failedCount}`);
assert('T04-blocked', taskRollup.rollup.blockedCount === 1, `blockedCount=${taskRollup.rollup.blockedCount}`);

// Wave-level: aggregate tasks.
const wavePayload = {
  waveId: 'wave-A',
  children: [
    { id: 'task-001', status: 'done' },
    { id: 'task-002', status: 'done' },
    { id: 'task-003', status: 'working' },
  ],
};
const waveRollup = propagateState('wave', wavePayload);
assert('T04-wave-done', waveRollup.rollup.done === 2, `wave done=${waveRollup.rollup.done}`);
assert('T04-wave-total', waveRollup.rollup.total === 3, `wave total=${waveRollup.rollup.total}`);

// Business-level: all done.
const businessPayload = {
  businessId: 'biz-01',
  children: [
    { id: 'wave-A', status: 'success' },
    { id: 'wave-B', status: 'passed' },
  ],
};
const businessRollup = propagateState('business', businessPayload);
assert('T04-business-all-done', businessRollup.rollup.done === 2, `business done=${businessRollup.rollup.done}`);
assert('T04-business-total', businessRollup.rollup.total === 2, `business total=${businessRollup.rollup.total}`);

// ---------------------------------------------------------------------------
// T05 — Pure / no-throw with no I/O target
// ---------------------------------------------------------------------------

let noThrow = true;
try {
  const pureResult = propagateState('child', { children: [{ id: 'x', status: 'done' }] });
  assert('T05-rollup-produced', pureResult.rollup.total === 1, 'pure rollup total wrong');
} catch (err) {
  noThrow = false;
}
assert('T05-no-throw', noThrow, 'propagateState threw when no I/O target was given');

// ---------------------------------------------------------------------------
// T06 — Determinism: same inputs produce identical outputs
// ---------------------------------------------------------------------------

const pack1 = hydrateRolePack('scout', BASE_ENVELOPE, { maxTokens: 1500 });
const pack2 = hydrateRolePack('scout', BASE_ENVELOPE, { maxTokens: 1500 });
assert('T06-hydrate-deterministic-role', pack1.role === pack2.role);
assert('T06-hydrate-deterministic-tokenCount', pack1.tokenCount === pack2.tokenCount,
  `run1=${pack1.tokenCount} run2=${pack2.tokenCount}`);
assert('T06-hydrate-deterministic-truncated', pack1.truncated === pack2.truncated);
assert('T06-hydrate-deterministic-sections', JSON.stringify(pack1.sections) === JSON.stringify(pack2.sections));

const roll1 = propagateState('task', childPayload);
const roll2 = propagateState('task', childPayload);
assert('T06-propagate-deterministic', JSON.stringify(roll1.rollup) === JSON.stringify(roll2.rollup));

// ---------------------------------------------------------------------------
// T07 — Inputs are never mutated
// ---------------------------------------------------------------------------

const envelopeCopy = JSON.parse(JSON.stringify(BASE_ENVELOPE));
hydrateRolePack('lead', envelopeCopy, { maxTokens: 2000 });
assert('T07-envelope-not-mutated', JSON.stringify(envelopeCopy) === JSON.stringify(BASE_ENVELOPE),
  'envelope was mutated by hydrateRolePack');

const payloadCopy = JSON.parse(JSON.stringify(childPayload));
propagateState('task', payloadCopy);
assert('T07-payload-not-mutated', JSON.stringify(payloadCopy) === JSON.stringify(childPayload),
  'payload was mutated by propagateState');

// ---------------------------------------------------------------------------
// T08 — Unknown role falls back without throwing
// ---------------------------------------------------------------------------

let unknownRoleThrew = false;
let unknownRolePack;
try {
  unknownRolePack = hydrateRolePack('nonexistent', BASE_ENVELOPE, { maxTokens: 1500 });
} catch {
  unknownRoleThrew = true;
}
assert('T08-no-throw', !unknownRoleThrew, 'hydrateRolePack threw on unknown role');
assert('T08-fallback-reason', unknownRolePack?.reasonCodes.some((r) => r.startsWith('unknown-role')),
  'missing unknown-role reason code');
assert('T08-has-sections', Array.isArray(unknownRolePack?.sections), 'no sections array on unknown-role pack');

// ---------------------------------------------------------------------------
// T09 — Empty envelope yields empty pack without throwing
// ---------------------------------------------------------------------------

let emptyThrew = false;
let emptyPack;
try {
  emptyPack = hydrateRolePack('reviewer', {}, { maxTokens: 1500 });
} catch {
  emptyThrew = true;
}
assert('T09-no-throw', !emptyThrew, 'hydrateRolePack threw on empty envelope');
assert('T09-frozen', emptyPack && Object.isFrozen(emptyPack), 'result not frozen on empty envelope');
assert('T09-tokenCount-zero', emptyPack?.tokenCount === 0, `tokenCount=${emptyPack?.tokenCount}`);

// ---------------------------------------------------------------------------
// T10 — propagateState with malformed payload never throws
// ---------------------------------------------------------------------------

const malformedCases = [null, undefined, 42, 'string', [], { children: null }, { children: [null, undefined, 42] }];
for (const input of malformedCases) {
  let threw = false;
  try { propagateState('child', input); } catch { threw = true; }
  assert(`T10-no-throw-${JSON.stringify(input)}`, !threw, `propagateState threw on input=${JSON.stringify(input)}`);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

const total = passed + failed;
process.stdout.write(`ok ${passed}/${total}\n`);
if (failed > 0) {
  process.stdout.write(`FAILED ${failed}/${total} tests\n`);
  process.exit(1);
}
