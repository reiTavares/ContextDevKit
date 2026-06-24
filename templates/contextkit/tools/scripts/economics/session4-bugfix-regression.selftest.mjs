/**
 * session4-bugfix-regression.selftest.mjs — regression locks for the 6 bugs the
 * Session-4 internal bug-hunt swarm confirmed (BIZ-0001 + #243 code).
 * Deterministic, dependency-free. Run: `node session4-bugfix-regression.selftest.mjs`.
 *
 * Each assertion would have FAILED before its fix — they pin the corrected behavior.
 */
import { buildForecast, quotaTimingRecommendation } from './investment-forecast-core.mjs';
import { detectRecurrence } from '../operation-recurrence-core.mjs';
import { stepAudit } from '../adr-migrate-core.mjs';
import { detectValueIntentOverlap } from '../adr-redundancy-core.mjs';

let failures = 0;
const check = (cond, label) => { if (cond) { console.log(`  ✓ ${label}`); } else { failures += 1; console.error(`  ✗ ${label}`); } };

console.log('session4-bugfix-regression.selftest:');

// BUG 1 — buildForecast(null) must not crash (default param only guards undefined).
let crashed = false; let forecast;
try { forecast = buildForecast(null); } catch { crashed = true; }
check(!crashed && forecast && forecast.confidence === 'unknown', 'BUG1 buildForecast(null) → no crash, confidence unknown');

// BUG 2 — detectRecurrence counts ALL occurrences, not just string-id ops.
const recur = detectRecurrence([
  { contextId: 'BIZ-X', kind: 'deploy' },
  { contextId: 'BIZ-X', kind: 'deploy' },
  { contextId: 'BIZ-X', kind: 'deploy' },
]);
check(recur.groups[0].count === 3 && recur.groups[0].recommendation === 'promote-to-business',
  'BUG2 detectRecurrence with 3 anonymous ops → count 3, promote-to-business');

// BUG 3 — value-intent-overlap must NOT fire for sparse rows (no kind/intent).
const sparse = detectValueIntentOverlap([{ id: 'A' }, { id: 'B' }]);
check(sparse.length === 0, 'BUG3 sparse rows (no kind/intent) → 0 false-positive overlap findings');
// ...but a REAL shared triple still flags.
const real = detectValueIntentOverlap([
  { id: 'A', primaryContext: { type: 'business', id: 'B1' }, decisionKind: 'BUSINESS_AUTHORIZATION', valueIntents: { primary: 'ENABLE' } },
  { id: 'B', primaryContext: { type: 'business', id: 'B1' }, decisionKind: 'BUSINESS_AUTHORIZATION', valueIntents: { primary: 'ENABLE' } },
]);
check(real.length === 1, 'BUG3 genuine shared triple → still detected (no false negative)');

// BUG 4 — stepAudit(null, null) must not crash.
let auditCrashed = false; let audit;
try { audit = stepAudit(null, null); } catch { auditCrashed = true; }
check(!auditCrashed && Array.isArray(audit), 'BUG4 stepAudit(null,null) → no crash, returns array');

// BUG 5 — known-negative routing net-benefit must NOT be reported as "unknown".
const negForecast = { quota: { hosts: [{ host: 'h', remainingPct: 90 }] }, routing: { netBenefitUnits: -3 }, budget: { mode: 'ok' } };
const timing = quotaTimingRecommendation(negForecast, negForecast.quota.hosts, { now: 1 });
check(timing.recommendation === 'observe' && timing.reasons.some((r) => /negative/.test(r)) && !timing.reasons.some((r) => /benefit unknown/.test(r)),
  'BUG5 negative net-benefit → observe with honest "negative" reason (not "unknown")');

// BUG 6 — low-quota reason string must not print "undefined" for a host missing `host`.
const noHostForecast = { quota: { hosts: [{ remainingPct: 10 }] }, routing: {}, budget: {} };
const lowTiming = quotaTimingRecommendation(noHostForecast, noHostForecast.quota.hosts, { now: 1 });
check(lowTiming.recommendation === 'defer-quota-low' && !lowTiming.reasons.some((r) => /undefined=/.test(r)),
  'BUG6 host missing `host` field → reason reads "(unknown-host)", not "undefined="');

if (failures > 0) { console.error(`session4-bugfix-regression.selftest: ${failures} FAILED`); process.exit(1); }
console.log('session4-bugfix-regression.selftest: PASS (all assertions green)');
