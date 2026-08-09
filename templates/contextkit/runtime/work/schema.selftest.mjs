/**
 * In-process self-test for the Business/Operation validators (A1-T1).
 *
 * Zero-dependency, runs under plain `node`. Proves: (1) the REAL BIZ-0001
 * `business.json` validates; (2) a doctored business (missing required field /
 * bad enum) is rejected; (3) a valid operation passes; (4) a bad-enum / bad-id
 * operation is rejected; (5) validators never throw on hostile input.
 *
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 *
 * Path resolution: this file ships under `templates/contextkit/runtime/work/`.
 * The real business.json lives in the INSTALLED tree (`contextkit/memory/...`),
 * so the test resolves it relative to the repo root derived from this module's
 * URL and SKIPS that one assertion gracefully if it is absent (e.g. when the
 * template tree is exercised outside the dogfood repo) — never a false pass.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripBom } from './enums.mjs';
import { validateBusiness } from './schema-business.mjs';
import { validateOperation } from './schema-operation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// templates/contextkit/runtime/work -> up 4 = repo root.
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const REAL_BUSINESS = resolve(
  REPO_ROOT,
  'contextkit/memory/business/BIZ-0001-business-driven-development/business.json',
);

const failures = [];
/**
 * Records a named assertion.
 * @param {string} label - human-readable assertion name.
 * @param {boolean} condition - must be true to pass.
 * @returns {void}
 */
function assert(label, condition) {
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}\n`);
  }
}

// 1. Real BIZ-0001 business.json validates (skip-not-pass if file absent).
let realBusiness = null;
try {
  realBusiness = JSON.parse(stripBom(readFileSync(REAL_BUSINESS, 'utf8')));
} catch {
  process.stdout.write(`  skip real BIZ-0001 business.json not found at ${REAL_BUSINESS}\n`);
}
if (realBusiness) {
  const verdict = validateBusiness(realBusiness);
  assert('real BIZ-0001 business.json is valid', verdict.ok === true);
  if (!verdict.ok) process.stdout.write(`       errors: ${verdict.errors.join('; ')}\n`);
}

// 2. Doctored business — missing required `title`.
{
  const doctored = realBusiness
    ? { ...realBusiness, title: '' }
    : sampleBusiness({ title: '' });
  assert('business missing title is rejected', validateBusiness(doctored).ok === false);
}

// 3. Doctored business — bad value-intent enum.
{
  const base = realBusiness ?? sampleBusiness();
  const doctored = { ...base, valueIntents: { primary: 'NOT_A_REAL_INTENT', secondary: [] } };
  assert('business with bad value intent is rejected', validateBusiness(doctored).ok === false);
}

// 4. Doctored business — bad id format.
assert('business with bad id is rejected', validateBusiness(sampleBusiness({ id: 'BIZ-1' })).ok === false);

// 5. Valid operation passes.
assert('valid operation passes', validateOperation(sampleOperation()).ok === true);

// 6. Operation with bad executionMode is rejected.
assert(
  'operation with bad executionMode is rejected',
  validateOperation(sampleOperation({ executionMode: 'instant' })).ok === false,
);

// 7. Operation with bad id is rejected.
assert('operation with bad id is rejected', validateOperation(sampleOperation({ id: 'OP-1' })).ok === false);

// 8. Hostile input never throws.
assert('validators are defensive (no throw)', defensiveHolds());

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);

/**
 * Confirms both validators tolerate hostile input without throwing.
 * @returns {boolean} true when every probed input returns a verdict object.
 */
function defensiveHolds() {
  const probes = [null, undefined, 42, 'str', [], { id: 123 }];
  try {
    for (const probe of probes) {
      if (typeof validateBusiness(probe).ok !== 'boolean') return false;
      if (typeof validateOperation(probe).ok !== 'boolean') return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a minimal valid business object, overridable per-field for negatives.
 * @param {object} [overrides] - fields to override on the valid baseline.
 * @returns {object} a business object.
 */
function sampleBusiness(overrides = {}) {
  return {
    schemaVersion: 1,
    uid: null,
    id: 'BIZ-9999',
    title: 'Sample',
    slug: 'sample',
    status: 'approved',
    kind: 'TRANSFORMATION',
    strategicFacet: 'PLATFORM_CAPABILITY',
    valueIntents: { primary: 'ENABLE', secondary: ['IMPROVE'] },
    growth: {},
    investment: {},
    approval: { actor: 'human', revision: 1, approvedAt: '2026-06-19', decision: 'approved' },
    decisions: { status: 'covered' },
    workflows: {},
    relations: [{ type: 'related-to', ref: 'ADR-0102' }],
    lifecycle: ['draft', 'approved'],
    ...overrides,
  };
}

/**
 * Builds a minimal valid operation object, overridable per-field for negatives.
 * @param {object} [overrides] - fields to override on the valid baseline.
 * @returns {object} an operation object.
 */
function sampleOperation(overrides = {}) {
  return {
    schemaVersion: 1,
    uid: null,
    id: 'OP-0001',
    title: 'Sample Operation',
    slug: 'sample-operation',
    kind: 'MAINTENANCE',
    executionMode: 'direct',
    urgency: 'normal',
    severity: 'low',
    valueIntents: { primary: 'IMPROVE', secondary: [] },
    business: { suggested: null, confirmed: null, score: 0, status: 'unlinked' },
    decisions: { coverage: 'none', primary: null, governing: [], created: [], candidatesEvaluated: 0 },
    relations: [],
    ...overrides,
  };
}
