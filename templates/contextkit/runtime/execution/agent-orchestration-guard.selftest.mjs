/**
 * agent-orchestration-guard.selftest.mjs — Self-test for the over-orchestration guard.
 *
 * Validates A8-T1 acceptance criteria (WF0038, ADR-0112):
 *   1. trivial tier ⇒ 0 sub-agents (all non-lead roles cleared).
 *   2. feature tier ⇒ ≤ 3 sub-agents total.
 *   3. architectural tier ⇒ ≤ 5 sub-agents total.
 *   4. Under-cap selection passes through unchanged.
 *   5. Debate-minimum floor wins over a lower tier cap (reason code emitted).
 *   6. Input selection is never mutated.
 *   7. Determinism — same inputs ⇒ byte-identical JSON output.
 *   8. Reason codes present for every trim performed.
 *
 * Zero dependencies — plain `node` only. Exit 0 = all assertions passed.
 */
import { applyOverOrchestrationGuard } from './agent-orchestration-guard.mjs';

const failures = [];
let assertCount = 0;

/**
 * Records a named assertion.
 * @param {string} label assertion description
 * @param {boolean} condition result
 * @param {string} [detail] extra context on failure
 */
function assert(label, condition, detail = '') {
  assertCount += 1;
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

/** Builds a full selection with the given role lists (lead is always 'architect'). */
function sel(scouts = [], supporting = [], reviewers = [], council = [], reasonCodes = []) {
  return { lead: 'architect', scouts, supporting, reviewers, council, synthesizer: null, reasonCodes };
}

// ---------------------------------------------------------------------------
// 1. Trivial ⇒ 0 sub-agents (all non-lead roles cleared).
// ---------------------------------------------------------------------------
{
  const input = sel(['scout-a', 'scout-b'], ['specialist-a'], ['reviewer-a'], [], ['pre-existing']);
  const cls = { complexity: 'trivial', needsDebate: false };
  const result = applyOverOrchestrationGuard(input, cls, {});
  const subCount = result.scouts.length + result.supporting.length + result.reviewers.length + result.council.length;

  assert('trivial: sub-agent count is 0', subCount === 0, `got ${subCount}`);
  assert('trivial: lead preserved', result.lead === 'architect');
  assert('trivial: synthesizer preserved', result.synthesizer === null);
  assert('trivial: guard.tier is trivial', result.guard.tier === 'trivial');
  assert('trivial: guard.cap is 0', result.guard.cap === 0);
  assert('trivial: guard.plannedBefore is 4', result.guard.plannedBefore === 4, `got ${result.guard.plannedBefore}`);
  assert('trivial: guard.plannedAfter is 0', result.guard.plannedAfter === 0, `got ${result.guard.plannedAfter}`);
  assert('trivial: has trim reason codes', result.reasonCodes.some((c) => c.startsWith('guard-trimmed-')));
}

// ---------------------------------------------------------------------------
// 2. Feature ⇒ ≤ 3 sub-agents.
// ---------------------------------------------------------------------------
{
  // 6 sub-agents planned; cap is 3.
  const input = sel(['s1', 's2'], ['sp1', 'sp2'], ['r1', 'r2'], []);
  const cls = { complexity: 'feature', needsDebate: false };
  const result = applyOverOrchestrationGuard(input, cls, {});
  const subCount = result.scouts.length + result.supporting.length + result.reviewers.length + result.council.length;

  assert('feature: sub-agent count ≤ 3', subCount <= 3, `got ${subCount}`);
  assert('feature: guard.cap is 3', result.guard.cap === 3);
  assert('feature: guard.plannedBefore is 6', result.guard.plannedBefore === 6, `got ${result.guard.plannedBefore}`);
  assert('feature: guard.plannedAfter ≤ 3', result.guard.plannedAfter <= 3, `got ${result.guard.plannedAfter}`);
  assert('feature: trim totals match planned delta',
    result.guard.trimmed.scouts + result.guard.trimmed.supporting +
    result.guard.trimmed.reviewers + result.guard.trimmed.council ===
    result.guard.plannedBefore - result.guard.plannedAfter);
}

// ---------------------------------------------------------------------------
// 3. Architectural ⇒ ≤ 5 sub-agents.
// ---------------------------------------------------------------------------
{
  // 8 sub-agents planned; cap is 5.
  const input = sel(['s1', 's2', 's3'], ['sp1', 'sp2'], ['r1'], ['c1', 'c2']);
  const cls = { complexity: 'architectural', needsDebate: false };
  const result = applyOverOrchestrationGuard(input, cls, {});
  const subCount = result.scouts.length + result.supporting.length + result.reviewers.length + result.council.length;

  assert('architectural: sub-agent count ≤ 5', subCount <= 5, `got ${subCount}`);
  assert('architectural: guard.cap is 5', result.guard.cap === 5);
  assert('architectural: guard.plannedBefore is 8', result.guard.plannedBefore === 8, `got ${result.guard.plannedBefore}`);
  assert('architectural: guard.plannedAfter ≤ 5', result.guard.plannedAfter <= 5, `got ${result.guard.plannedAfter}`);
}

// ---------------------------------------------------------------------------
// 4. Under-cap selection passes through unchanged.
// ---------------------------------------------------------------------------
{
  // 2 sub-agents under the feature cap of 3.
  const input = sel([], ['sp1'], ['r1'], []);
  const cls = { complexity: 'feature', needsDebate: false };
  const result = applyOverOrchestrationGuard(input, cls, {});
  const subCount = result.scouts.length + result.supporting.length + result.reviewers.length + result.council.length;

  assert('under-cap: sub-agent count unchanged (2)', subCount === 2, `got ${subCount}`);
  assert('under-cap: guard.plannedBefore == plannedAfter',
    result.guard.plannedBefore === result.guard.plannedAfter);
  assert('under-cap: all trim counts are 0',
    Object.values(result.guard.trimmed).every((n) => n === 0));
  assert('under-cap: no guard-trimmed reason codes',
    !result.reasonCodes.some((c) => c.startsWith('guard-trimmed-')));
}

// ---------------------------------------------------------------------------
// 5. Debate-minimum floor wins over lower tier cap (+reason code).
//    trivial cap = 0, but needsDebate=true with min=3 → floor wins.
// ---------------------------------------------------------------------------
{
  const config = { deliberations: { council: { min: 3 } } };
  const input = sel([], [], [], ['c1', 'c2', 'c3', 'c4']);
  const cls = { complexity: 'trivial', needsDebate: true };
  const result = applyOverOrchestrationGuard(input, cls, config);

  assert('debate-floor: council not trimmed below min=3',
    result.council.length >= 3, `got ${result.council.length}`);
  assert('debate-floor: guard-yields-to-debate-minimum reason code present',
    result.reasonCodes.some((c) => c.startsWith('guard-yields-to-debate-minimum')));
  assert('debate-floor: guard.cap reflects trivial cap (0)', result.guard.cap === 0);
}

// ---------------------------------------------------------------------------
// 6. Input is never mutated.
// ---------------------------------------------------------------------------
{
  const originalScouts = ['s1', 's2', 's3'];
  const originalSupporting = ['sp1', 'sp2'];
  const input = sel(originalScouts, originalSupporting, ['r1'], []);
  const inputScoutsSnapshot = JSON.stringify(input.scouts);
  const inputSupportingSnapshot = JSON.stringify(input.supporting);

  applyOverOrchestrationGuard(input, { complexity: 'trivial', needsDebate: false }, {});

  assert('no-mutation: input.scouts unchanged', JSON.stringify(input.scouts) === inputScoutsSnapshot);
  assert('no-mutation: input.supporting unchanged', JSON.stringify(input.supporting) === inputSupportingSnapshot);
}

// ---------------------------------------------------------------------------
// 7. Determinism — same inputs ⇒ byte-identical JSON.
// ---------------------------------------------------------------------------
{
  const input = sel(['s1', 's2'], ['sp1'], ['r1', 'r2'], ['c1', 'c2', 'c3']);
  const cls = { complexity: 'feature', needsDebate: true };
  const config = { deliberations: { council: { min: 2 } } };
  const first = applyOverOrchestrationGuard(input, cls, config);
  const second = applyOverOrchestrationGuard(input, cls, config);

  assert('determinism: two calls with same input yield byte-identical JSON',
    JSON.stringify(first) === JSON.stringify(second));
}

// ---------------------------------------------------------------------------
// 8. Reason codes present for every trim performed.
// ---------------------------------------------------------------------------
{
  // Scouts, supporting, and reviewers will all be trimmed (trivial, no debate).
  const input = sel(['s1'], ['sp1'], ['r1'], []);
  const cls = { complexity: 'trivial', needsDebate: false };
  const result = applyOverOrchestrationGuard(input, cls, {});

  const trimmedKeys = Object.entries(result.guard.trimmed)
    .filter(([, count]) => count > 0)
    .map(([key]) => key);

  const missingReasonCodes = trimmedKeys.filter(
    (key) => !result.reasonCodes.some((c) => c.startsWith(`guard-trimmed-${key}:`)),
  );

  assert('reason-codes: every trimmed role has a matching guard-trimmed-* code',
    missingReasonCodes.length === 0,
    `missing codes for: ${missingReasonCodes.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 9. Config-overridable tier caps are respected.
// ---------------------------------------------------------------------------
{
  const config = {
    orchestration: { overOrchestrationGuard: { tierCaps: { trivial: 0, feature: 1, architectural: 2 } } },
  };
  const input = sel([], ['sp1', 'sp2', 'sp3'], ['r1'], []);
  const cls = { complexity: 'feature', needsDebate: false };
  const result = applyOverOrchestrationGuard(input, cls, config);
  const subCount = result.scouts.length + result.supporting.length + result.reviewers.length + result.council.length;

  assert('config-cap: overridden feature cap=1 respected', subCount <= 1, `got ${subCount}`);
  assert('config-cap: guard.cap reflects override (1)', result.guard.cap === 1);
}

// ---------------------------------------------------------------------------
// 10. Result is frozen (immutable).
// ---------------------------------------------------------------------------
{
  const result = applyOverOrchestrationGuard(
    sel(['s1'], [], [], []),
    { complexity: 'trivial', needsDebate: false },
    {},
  );
  let threw = false;
  try {
    result.lead = 'mutated';
  } catch {
    threw = true;
  }
  // In strict mode Object.freeze throws on assignment; in sloppy mode it silently ignores.
  // Either way the value must not have changed.
  assert('frozen: result.lead not mutated', result.lead !== 'mutated');
  assert('frozen: result is frozen', Object.isFrozen(result));
  assert('frozen: result.guard is frozen', Object.isFrozen(result.guard));
  assert('frozen: result.guard.trimmed is frozen', Object.isFrozen(result.guard.trimmed));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = assertCount;
const passed = total - failures.length;
process.stdout.write(`\nok ${passed}/${total}\n`);
if (failures.length) {
  process.stdout.write(`FAILED ${failures.length} assertion(s):\n`);
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
}
process.exit(failures.length ? 1 : 0);
