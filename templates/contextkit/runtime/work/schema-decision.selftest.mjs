/**
 * In-process self-test for the decision schema v2 validator + classifier (B1-T1).
 *
 * Zero-dependency, runs under plain `node`. Proves:
 *   1. the REAL ADR-0102 front matter validates (skip-not-pass if absent);
 *   2. the front-matter reader round-trips ADR-0102's nested maps/lists;
 *   3. malformed records are rejected (bad id / bad decisionKind / bad status /
 *      missing required / accepted-but-non-human approval);
 *   4. a legacy-SHAPED front-matter record validates (legacy grandfathering);
 *   5. a plain-markdown legacy ADR (no front matter) classifies as `legacy`;
 *      a v2 file classifies as `new`;
 *   6. the validator never throws on hostile input.
 *
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 *
 * Path resolution: ships under `templates/contextkit/runtime/work/`. The real
 * ADR-0102 lives in the INSTALLED tree, resolved relative to the repo root and
 * SKIPPED gracefully when absent (never a false pass).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrontMatter } from './front-matter.mjs';
import { validateDecision, classifyDecisionFile } from './schema-decision.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const REAL_ADR = resolve(
  REPO_ROOT,
  'contextkit/memory/decisions/business/ADR-0102-business-driven-methodology.md',
);

const failures = [];
/**
 * Records a named assertion.
 * @param {string} label - assertion name.
 * @param {boolean} condition - must hold.
 * @returns {void}
 */
function assert(label, condition) {
  if (condition) process.stdout.write(`  ok   ${label}\n`);
  else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}\n`);
  }
}

// 1 + 2. Real ADR-0102 reads + validates (skip-not-pass if file absent).
let realContents = null;
try {
  realContents = readFileSync(REAL_ADR, 'utf8');
} catch {
  process.stdout.write(`  skip real ADR-0102 not found at ${REAL_ADR}\n`);
}
if (realContents) {
  const front = readFrontMatter(realContents);
  assert('ADR-0102 front matter is read', front.hasFrontMatter === true);
  assert('ADR-0102 reader keeps nested primaryContext', front.data?.primaryContext?.id === 'BIZ-0001');
  assert('ADR-0102 reader keeps governs list', Array.isArray(front.data?.governs?.workflows));
  const verdict = validateDecision(front.data);
  assert('real ADR-0102 front matter is valid', verdict.ok === true);
  if (!verdict.ok) process.stdout.write(`       errors: ${verdict.errors.join('; ')}\n`);
  assert('ADR-0102 classifies as new(v2)', classifyDecisionFile('ADR-0102-x.md', realContents).kind === 'new');
}

// 3. Malformed records are rejected.
assert('bad id rejected', validateDecision(sampleDecision({ id: 'ADR-1' })).ok === false);
assert('bad decisionKind rejected', validateDecision(sampleDecision({ decisionKind: 'NOPE' })).ok === false);
assert('bad status rejected', validateDecision(sampleDecision({ status: 'draft' })).ok === false);
assert('missing required title rejected', validateDecision(sampleDecision({ title: '' })).ok === false);
assert(
  'accepted with non-human approval rejected',
  validateDecision(sampleDecision({ approvalSource: { ...sampleApproval(), actor: 'ai' } })).ok === false,
);
assert(
  'contextType/primaryContext mismatch rejected',
  validateDecision(sampleDecision({ contextType: 'operation' })).ok === false,
);

// 4. Legacy-shaped front-matter record validates (grandfathering).
assert('legacy front-matter shape valid', validateDecision(legacyFrontMatter()).ok === true);

// 5. Classification: plain-markdown legacy vs v2.
const plainLegacy = '# 0099 — Some old decision\n\nNo front matter here.\n';
assert('plain-markdown legacy classifies as legacy', classifyDecisionFile('0099-updater.md', plainLegacy).kind === 'legacy');
assert('non-ADR markdown classifies as unknown', classifyDecisionFile('NOTES.md', plainLegacy).kind === 'unknown');

// 6. Hostile input never throws.
assert('validator is defensive (no throw)', defensiveHolds());

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);

/** @returns {boolean} true when probes return a verdict object without throwing. */
function defensiveHolds() {
  const probes = [null, undefined, 42, 'str', [], { id: 123 }];
  try {
    for (const probe of probes) {
      if (typeof validateDecision(probe).ok !== 'boolean') return false;
    }
    classifyDecisionFile(null, null);
    classifyDecisionFile(42, {});
    return true;
  } catch {
    return false;
  }
}

/** @returns {object} a valid approvalSource baseline. */
function sampleApproval() {
  return { type: 'business', id: 'BIZ-9999', revision: 1, decisionHash: 'abc', approvedAt: '2026-06-19', actor: 'human' };
}

/**
 * Builds a valid v2 decision record, overridable per-field for negatives.
 * @param {object} [overrides] - fields to override.
 * @returns {object} a decision front-matter object.
 */
function sampleDecision(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'ADR-9999',
    title: 'Sample decision',
    status: 'accepted',
    contextType: 'business',
    primaryContext: { type: 'business', id: 'BIZ-9999' },
    relatedContexts: [],
    decisionKind: 'ARCHITECTURE',
    decisionScope: 'platform',
    valueIntents: { primary: 'ENABLE', secondary: ['IMPROVE'] },
    product: { productId: 'contextdevkit', area: 'x', capability: 'y' },
    approvalSource: sampleApproval(),
    governs: { workflows: [], operations: [], business: [] },
    supersedes: [],
    supersededBy: null,
    tags: [],
    createdAt: '2026-06-19',
    acceptedAt: '2026-06-19',
    updatedAt: '2026-06-19',
    ...overrides,
  };
}

/**
 * Builds a legacy-shaped front-matter record (grandfathering form).
 * @returns {object} a legacy decision record.
 */
function legacyFrontMatter() {
  return {
    schemaVersion: 2,
    id: 'ADR-0099',
    title: 'Legacy-shaped record',
    status: 'legacy',
    contextType: 'legacy',
    primaryContext: null,
    relatedContexts: [],
    decisionKind: 'ARCHITECTURE',
    decisionScope: 'platform',
    valueIntents: { primary: 'PROTECT', secondary: [] },
    product: { productId: 'contextdevkit', area: 'x', capability: 'y' },
    approvalSource: { type: 'human', id: 'legacy', revision: 0, decisionHash: 'n/a', approvedAt: '2024-01-01', actor: 'human' },
    governs: { workflows: [], operations: [], business: [] },
    supersedes: [],
    supersededBy: null,
    tags: ['legacy'],
    createdAt: '2024-01-01',
    acceptedAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
}
