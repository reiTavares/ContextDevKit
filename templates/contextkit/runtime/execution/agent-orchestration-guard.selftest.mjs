/** Self-test for ADR-0158 non-binding orchestration recommendations. */
import assert from 'node:assert/strict';
import { applyOverOrchestrationGuard } from './agent-orchestration-guard.mjs';

const selection = {
  lead: 'implementation-engineer',
  scouts: ['explorer-a', 'explorer-b'],
  supporting: ['security', 'privacy-lgpd'],
  reviewers: ['code-reviewer'],
  council: ['architect'],
  synthesizer: null,
  reasonCodes: ['existing'],
};
const snapshot = JSON.stringify(selection);

const recommendation = applyOverOrchestrationGuard(
  selection,
  { complexity: 'feature', needsDebate: true },
  { orchestration: { overOrchestrationGuard: { tierCaps: { feature: 1 } } } },
  { hostTechnicalLimit: 4 },
);

assert.equal(JSON.stringify(selection), snapshot, 'input must not mutate');
assert.deepEqual(recommendation.scouts, selection.scouts, 'scouts must not be trimmed');
assert.deepEqual(recommendation.supporting, selection.supporting, 'supporting agents must not be trimmed');
assert.deepEqual(recommendation.reviewers, selection.reviewers, 'reviewers must not be trimmed');
assert.deepEqual(recommendation.council, selection.council, 'council must not be trimmed');
assert.equal(recommendation.guard.plannedAfter, recommendation.guard.plannedBefore);
assert.equal(recommendation.guard.recommendedCap, 1);
assert.equal(recommendation.guard.hostTechnicalLimit, 4);
assert.equal(recommendation.guard.enforced, false);
assert.equal(recommendation.guard.blocking, false);
assert.equal(recommendation.guard.authority, 'recommendation-only');
assert.ok(recommendation.reasonCodes.some((code) => code.startsWith('orchestration-size-recommendation:')));
assert.ok(recommendation.reasonCodes.includes('council-is-optional-owner-guidance'));
assert.ok(recommendation.reasonCodes.some((code) => code.startsWith('host-technical-limit-observed:')));
assert.equal(Object.values(recommendation.guard.trimmed).every((count) => count === 0), true);
assert.equal(Object.isFrozen(recommendation), true);
assert.equal(Object.isFrozen(recommendation.guard), true);
assert.equal(
  JSON.stringify(recommendation),
  JSON.stringify(applyOverOrchestrationGuard(
    selection,
    { complexity: 'feature', needsDebate: true },
    { orchestration: { overOrchestrationGuard: { tierCaps: { feature: 1 } } } },
    { hostTechnicalLimit: 4 },
  )),
  'recommendation must be deterministic',
);

console.log('agent-orchestration-guard: PASS (advisory only, unchanged selection, host limit observable)');
