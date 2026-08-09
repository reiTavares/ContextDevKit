#!/usr/bin/env node
/**
 * WF-0057 W3 (ADR-0122) — selftest for the governed intentional-debt validators
 * (W0-contracts.md §21/§22, §6.1; acceptance-matrix §34.18/.19/.20).
 * Covers: validateIntentionalDebt throws on missing owner / repayment trigger;
 * a fully-valid record within acceptance conditions → DEBT_ACCEPTED; an EXPIRED
 * valid record → NOT accepted (→ reopen/review); a bare "TODO/fix later" with no
 * governance → rejected. Pure (now injected). Zero-dep, node:/relative only,
 * Windows-safe. Standalone entrypoint (exit 0/1).
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };

const SCRIPTS = 'templates/contextkit/tools/scripts/arch-debt';
const modPath = resolve(KIT, SCRIPTS + '/intentional-debt.mjs');
const enumsPath = resolve(KIT, SCRIPTS + '/finding-enums.mjs');
existsSync(modPath) ? ok('intentional-debt.mjs exists') : bad('intentional-debt.mjs NOT FOUND');

let mod;
try {
  mod = await import(pathToFileURL(modPath).href);
} catch (err) {
  bad('Failed to import intentional-debt.mjs: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const {
  validateIntentionalDebt, isExpired, acceptDebt,
  REQUIRED_FIELDS, IntentionalDebtError,
} = mod;
const enums = await import(pathToFileURL(enumsPath).href);
const { GateOutcome } = enums;

for (const [n, f] of [
  ['validateIntentionalDebt', validateIntentionalDebt],
  ['isExpired', isExpired], ['acceptDebt', acceptDebt],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}
Array.isArray(REQUIRED_FIELDS) && REQUIRED_FIELDS.length === 11
  ? ok('REQUIRED_FIELDS has 11 governance fields') : bad('REQUIRED_FIELDS count: ' + (REQUIRED_FIELDS || []).length);

/** A fully-governed, non-expired record (every required §21 field present). */
const fullRecord = () => ({
  businessJustification: 'Ship the Q3 launch on the current adapter; rewrite blocks revenue.',
  expectedValue: 'Unblocks $40k MRR launch this sprint',
  owner: 'jane.doe',
  acceptanceAuthority: 'architect:rui (ADR-0122)',
  containment: 'Isolated behind LegacyAdapter; no new call sites permitted.',
  knownRisk: 'Adapter cannot batch; +120ms p95 on the import path.',
  repaymentTrigger: 'When a second consumer needs batching, or by WF-0061.',
  expiry: '2026-12-31',
  impact: 'PERFORMANCE: bounded latency on one non-critical path.',
  relatedBusiness: 'BIZ-0002',
  relatedOperation: 'OP-0014',
});

console.log('\n§34.18 — intentional debt WITHOUT owner is rejected');
{
  const r = fullRecord(); delete r.owner;
  threw(() => validateIntentionalDebt(r)) ? ok('missing owner → throws') : bad('missing owner did NOT throw');
  let typed = false;
  try { validateIntentionalDebt(r); } catch (e) { typed = e instanceof IntentionalDebtError && /owner/i.test(e.message); }
  typed ? ok('throws typed IntentionalDebtError naming "owner"') : bad('error not typed / did not name owner');
  threw(() => acceptDebt({ id: 'x' }, r, '2026-06-26')) ? ok('acceptDebt refuses owner-less record') : bad('acceptDebt accepted owner-less record!');
}

console.log('\n§34.19 — intentional debt WITHOUT repayment trigger is rejected');
{
  const r = fullRecord(); delete r.repaymentTrigger;
  threw(() => validateIntentionalDebt(r)) ? ok('missing repaymentTrigger → throws') : bad('missing repaymentTrigger did NOT throw');
  let named = false;
  try { validateIntentionalDebt(r); } catch (e) { named = /repaymentTrigger/i.test(e.message); }
  named ? ok('error names "repaymentTrigger"') : bad('error did not name repaymentTrigger');
}

console.log('\nother required fields are each enforced (§21)');
for (const field of REQUIRED_FIELDS) {
  const r = fullRecord(); delete r[field];
  threw(() => validateIntentionalDebt(r)) ? ok('missing "' + field + '" → throws') : bad('missing "' + field + '" did NOT throw');
}
threw(() => validateIntentionalDebt(null)) ? ok('null record → throws') : bad('null record did not throw');
threw(() => validateIntentionalDebt({})) ? ok('empty record → throws') : bad('empty record did not throw');

console.log('\nconditional fields (§21) — required only when declared');
{
  const r = { ...fullRecord(), requiresWorkflow: true };
  threw(() => validateIntentionalDebt(r)) ? ok('requiresWorkflow w/o relatedWorkflow → throws') : bad('conditional workflow not enforced');
  r.relatedWorkflow = 'WF-0057';
  validateIntentionalDebt(r) === true ? ok('requiresWorkflow + relatedWorkflow → valid') : bad('conditional workflow valid case failed');
}

console.log('\n§34.20 — a fully-valid record within acceptance conditions → DEBT_ACCEPTED');
{
  const r = fullRecord();
  validateIntentionalDebt(r) === true ? ok('full record validates (returns true)') : bad('full record did not validate');
  const finding = { id: 'F:perf:1', ruleId: 'D8.perf', status: 'VIOLATION', path: 'src/import.js' };
  const accepted = acceptDebt(finding, r, '2026-06-26');
  accepted.outcome === GateOutcome.DEBT_ACCEPTED ? ok('outcome === DEBT_ACCEPTED') : bad('outcome: ' + accepted.outcome);
  accepted.acceptedDebt && accepted.acceptedDebt.owner === 'jane.doe' ? ok('governance metadata attached (owner)') : bad('owner metadata missing');
  accepted.acceptedDebt && accepted.acceptedDebt.acceptanceAuthority === r.acceptanceAuthority ? ok('acceptanceAuthority attached') : bad('acceptanceAuthority missing');
  accepted.acceptedDebt && accepted.acceptedDebt.repaymentTrigger === r.repaymentTrigger ? ok('repaymentTrigger attached') : bad('repaymentTrigger missing');
  accepted.id === finding.id ? ok('original finding identity preserved') : bad('finding identity lost');
  finding.outcome === undefined ? ok('acceptDebt is pure (does not mutate input finding)') : bad('acceptDebt mutated the input finding!');
}

console.log('\n§34 — an EXPIRED valid record is NOT accepted (→ reopen/review)');
{
  const r = fullRecord(); r.expiry = '2025-01-01'; // past relative to injected now
  const exp = isExpired(r, '2026-06-26');
  exp.expired === true ? ok('isExpired → expired:true for a past date') : bad('past date not flagged expired');
  exp.signal === 'REOPENED' ? ok('expired signal === REOPENED (not auto-accept)') : bad('expired signal: ' + exp.signal);
  const finding = { id: 'F:perf:2', ruleId: 'D8.perf', status: 'VIOLATION', path: 'src/x.js' };
  const reviewed = acceptDebt(finding, r, '2026-06-26');
  reviewed.outcome === GateOutcome.REVIEW_REQUIRED ? ok('expired record → REVIEW_REQUIRED (NOT DEBT_ACCEPTED)') : bad('expired outcome: ' + reviewed.outcome);
  reviewed.outcome !== GateOutcome.DEBT_ACCEPTED ? ok('expired debt is never silently accepted (§16)') : bad('expired debt was ACCEPTED!');
  reviewed.acceptedDebt === null ? ok('no governance metadata stamped on a reopened record') : bad('metadata leaked onto reopened record');
}
{
  const r = fullRecord();
  const live = isExpired(r, '2026-06-26');
  live.expired === false ? ok('a future-dated expiry is LIVE') : bad('future expiry flagged expired');
  // injected "now" is the authority — same record, later "now" flips the verdict.
  isExpired(r, '2027-06-26').expired === true ? ok('same record expires once injected now passes the date') : bad('clock injection not honored');
}
{
  // condition-based expiry (no parseable date) honored via expiryConditionMet.
  const r = { ...fullRecord(), expiry: 'when WF-0061 ships', expiryConditionMet: true };
  isExpired(r, '2026-06-26').expired === true ? ok('met expiry condition → expired') : bad('met condition not expired');
  const r2 = { ...fullRecord(), expiry: 'when WF-0061 ships', expiryConditionMet: false };
  isExpired(r2, '2026-06-26').expired === false ? ok('unmet expiry condition → LIVE') : bad('unmet condition wrongly expired');
}
{
  // fail-closed: an invalid injected "now" never silently treats debt as live.
  isExpired(fullRecord(), 'not-a-date').expired === true ? ok('invalid injected now → fail-closed expired (§16)') : bad('invalid now treated as live!');
}

console.log('\n§34 — "TODO / fix later" with no governance is rejected');
{
  const todo = {
    businessJustification: 'TODO: fix later, temporary hack for now',
    expectedValue: 'n/a', owner: '', acceptanceAuthority: '', containment: '',
    knownRisk: '', repaymentTrigger: '', expiry: '', impact: '',
    relatedBusiness: '', relatedOperation: '',
  };
  threw(() => validateIntentionalDebt(todo)) ? ok('bare TODO record → throws (ungoverned)') : bad('bare TODO did not throw');
  threw(() => acceptDebt({ id: 'x' }, todo, '2026-06-26')) ? ok('acceptDebt refuses a bare TODO') : bad('acceptDebt accepted a bare TODO!');
}
{
  // a deferral PHRASE but WITH full governance anchors is legitimately accepted.
  const governedDeferral = { ...fullRecord(), businessJustification: 'Temporary adapter; fix later once batching lands. Owned, contained, scheduled.' };
  validateIntentionalDebt(governedDeferral) === true ? ok('deferral phrase + full governance anchors → valid (not a false-positive reject)') : bad('over-applied: governed deferral wrongly rejected');
}
{
  // a deferral phrase that DROPS one anchor (owner) → rejected as ungoverned.
  const halfGoverned = { ...fullRecord(), businessJustification: 'temporary; revisit later', owner: '' };
  threw(() => validateIntentionalDebt(halfGoverned)) ? ok('deferral phrase missing an anchor → rejected') : bad('deferral missing anchor slipped through');
}

console.log('\nzero-dep invariant');
{
  const content = readFileSync(modPath, 'utf-8');
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m, dirty = null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) { dirty = m[1]; break; }
  }
  dirty === null ? ok('zero-dep: intentional-debt.mjs imports only node:/relative')
    : bad('zero-dep violation: imports ' + dirty);
}

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
