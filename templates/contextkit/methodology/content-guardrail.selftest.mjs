/**
 * In-process self-test for the WF-0090 GA2 guardrail + promotion modules
 * (`token-guardrail.mjs` + `content-promote.mjs`; BIZ-0006, ADR-0148 rails (c)
 * and (b)-promotion).
 *
 * Zero disk I/O and zero model calls: the ledger reader takes an injected
 * `readEvents` seam and every promotion case passes a parsed sidecar plus a
 * synthetic gate receipt. What it proves:
 *   [a] killswitch-on-token-regression   — a rising session total trips the switch
 *   [b] killswitch-on-unavailable-ledger — unavailable ⇒ off, and `skipped` never
 *                                          behaves as a pass
 *   [c] killswitch-on-zero-budget / default-config-is-off
 *   [d] budget-consumed                  — spend at/over budget switches off
 *   [e] pressure band                    — hot/critical switch off; absent or
 *                                          `skipped` neither authorizes nor blocks
 *   [f] ledger reader                     — per-session totals, prior-session
 *                                          baseline, and every fail-open branch
 *   [g] promotion-from-gate-receipt      — an approved receipt naming a field
 *                                          promotes it; stale/anonymous/unapproved
 *                                          promote nothing; one-way
 *   [h] promotion-from-human-edit        — a content-hash mismatch promotes
 *   [i] no-llm-to-decide                 — the guardrail is a deterministic
 *                                          comparison: it never receives, and
 *                                          cannot call, a generator
 *
 * Exit 0 = all held; exit 1 = at least one failed. No wall-clock.
 */
import { readFileSync } from 'node:fs';
import {
  CONTENT_FILL_LEVER,
  evaluateKillSwitch,
  readGovernanceTokenLedger,
} from './token-guardrail.mjs';
import { PROMOTION_REASONS, authorizedFieldKeys, promoteDrafts } from './content-promote.mjs';
import { CONTENT_FILL_DEFAULTS } from './content-fill.mjs';
import { hashFieldContent } from './provenance.mjs';
import { validateProvenanceSidecar } from './schema-provenance-sidecar.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

const ACTIVE = Object.freeze({ enabled: true, tokenBudgetPerContext: 5000, promptVersion: 1 });

/** A ledger read result, built explicitly so each case states exactly what was measured. */
function ledger(sessionTokens, priorSessionTokens, available = true, reason = null) {
  return { available, sessionTokens, priorSessionTokens, sessionId: 'S-now', reason };
}

/** An economy-events row for the content-fill lever. */
function row(sessionId, tokens) {
  return { lever: CONTENT_FILL_LEVER, lifecycle: 'applied', sessionId, observed: { tokens } };
}

// [a] killswitch-on-token-regression — the ADR-0148 §13 guardrail proper.
{
  const verdict = evaluateKillSwitch(ACTIVE, ledger(200, 100));
  assert('[a] a rising governance-tokens/session trips the switch', verdict.enabled === false, JSON.stringify(verdict));
  assert('[a] the trip is reported as a real firing, not "never armed"', verdict.tripped === true);
  assert('[a] the reason names the regression', verdict.reason.includes('rising'), verdict.reason);
  assert('[a] a FALLING session total is allowed', evaluateKillSwitch(ACTIVE, ledger(80, 100)).enabled === true);
  assert('[a] an EQUAL session total is allowed (must not rise, may match)',
    evaluateKillSwitch(ACTIVE, ledger(100, 100)).enabled === true);
}

// [b] killswitch-on-unavailable-ledger — skipped is never a pass (constitution §8).
{
  const verdict = evaluateKillSwitch(ACTIVE, { available: false, reason: 'no content-fill rows' });
  assert('[b] an unavailable ledger switches the engine off', verdict.enabled === false);
  assert('[b] the reason says skipped, never a pass', verdict.reason.includes('skipped, never a pass'), verdict.reason);
  assert('[b] an unavailable measurement is NOT reported as a guardrail trip', verdict.tripped === false);
  for (const [label, value] of [['null', null], ['undefined', undefined], ['empty object', {}]]) {
    assert(`[b] a ${label} ledger switches off without throwing`, evaluateKillSwitch(ACTIVE, value).enabled === false);
  }
}

// [c] default-config-is-off / killswitch-on-zero-budget.
{
  assert('[c] the shipped defaults switch the engine off',
    evaluateKillSwitch(CONTENT_FILL_DEFAULTS, ledger(0, 100)).enabled === false);
  assert('[c] enabled:false is named as the shipped default',
    evaluateKillSwitch(CONTENT_FILL_DEFAULTS, ledger(0, 100)).reason.includes('shipped default is off'));
  assert('[c] a zero budget is an independent second refusal',
    evaluateKillSwitch({ enabled: true, tokenBudgetPerContext: 0 }, ledger(0, 100)).reason.includes('no spend authorized'));
  assert('[c] a negative budget also refuses',
    evaluateKillSwitch({ enabled: true, tokenBudgetPerContext: -1 }, ledger(0, 100)).enabled === false);
  assert('[c] a non-numeric budget refuses',
    evaluateKillSwitch({ enabled: true, tokenBudgetPerContext: 'lots' }, ledger(0, 100)).enabled === false);
}

// [d] budget-consumed — per-CONTEXT granularity (GA0 D3), not per-field.
{
  assert('[d] spend AT the budget switches off',
    evaluateKillSwitch(ACTIVE, ledger(5000, 9000)).enabled === false);
  assert('[d] spend OVER the budget switches off, and counts as a trip',
    evaluateKillSwitch(ACTIVE, ledger(6000, 9000)).tripped === true);
  assert('[d] spend under the budget is allowed', evaluateKillSwitch(ACTIVE, ledger(4999, 9000)).enabled === true);
}

// [e] session pressure — a real hot band blocks; unknown neither authorizes nor blocks.
{
  assert('[e] band=hot switches off', evaluateKillSwitch(ACTIVE, ledger(10, 100), { band: 'hot' }).enabled === false);
  assert('[e] band=critical switches off', evaluateKillSwitch(ACTIVE, ledger(10, 100), { band: 'critical' }).enabled === false);
  assert('[e] band=healthy is allowed', evaluateKillSwitch(ACTIVE, ledger(10, 100), { band: 'healthy' }).enabled === true);
  assert('[e] band=elevated is allowed', evaluateKillSwitch(ACTIVE, ledger(10, 100), { band: 'elevated' }).enabled === true);
  assert('[e] an ABSENT pressure signal does not block (unknown ≠ bad)',
    evaluateKillSwitch(ACTIVE, ledger(10, 100), null).enabled === true);
  assert('[e] a SKIPPED pressure signal does not block and does not authorize on its own',
    evaluateKillSwitch(ACTIVE, ledger(10, 100), { status: 'skipped', band: 'critical' }).enabled === true);
}

// [f] the one read boundary — per-session totals + every fail-open branch.
{
  const events = [
    row('S-old', 100), row('S-old', 40),
    { lever: 'run-compact', lifecycle: 'applied', sessionId: 'S-now', observed: { tokens: 999999 } },
    row('S-now', 30),
  ];
  const read = readGovernanceTokenLedger('/fake/root', { sessionId: 'S-now', readEvents: () => events });
  assert('[f] the ledger read is available with a prior session present', read.available === true, JSON.stringify(read));
  assert('[f] this session\'s rows are summed', read.sessionTokens === 30, String(read.sessionTokens));
  assert('[f] the prior session\'s rows are summed as the baseline', read.priorSessionTokens === 140, String(read.priorSessionTokens));

  const foreignOnly = readGovernanceTokenLedger('/fake/root', {
    sessionId: 'S-now',
    readEvents: () => [{ lever: 'routing', lifecycle: 'applied', sessionId: 'S-old', observed: { tokens: 5 } }],
  });
  assert('[f] a ledger with no content-fill rows is unavailable (never a fabricated zero)',
    foreignOnly.available === false && foreignOnly.reason.includes('no content-fill rows'), JSON.stringify(foreignOnly));

  const noBaseline = readGovernanceTokenLedger('/fake/root', { sessionId: 'S-now', readEvents: () => [row('S-now', 10)] });
  assert('[f] a single-session ledger is unavailable — a non-regression check needs a baseline',
    noBaseline.available === false && noBaseline.reason.includes('baseline'), JSON.stringify(noBaseline));
  assert('[f] the first session still reports its own measured spend', noBaseline.sessionTokens === 10);

  assert('[f] no session id ⇒ unavailable, not a guess',
    readGovernanceTokenLedger('/fake/root', { sessionId: null, readEvents: () => [] }).available === false);
  assert('[f] no root ⇒ unavailable',
    readGovernanceTokenLedger('', { sessionId: 'S-now', readEvents: () => [] }).available === false);
  assert('[f] a throwing reader degrades instead of propagating',
    readGovernanceTokenLedger('/fake/root', { sessionId: 'S-now', readEvents: () => { throw new Error('disk gone'); } }).available === false);
  assert('[f] a row with no observed tokens counts as zero, not NaN',
    readGovernanceTokenLedger('/fake/root', {
      sessionId: 'S-now',
      readEvents: () => [row('S-old', 5), { lever: CONTENT_FILL_LEVER, lifecycle: 'skipped', sessionId: 'S-now' }],
    }).sessionTokens === 0);
}

/** A sidecar holding one draft plus one already-authored and one derived field. */
function draftSidecar(contentHash = 'c0ffee') {
  return {
    schemaVersion: 1,
    contextRef: 'BIZ-0006',
    fields: {
      'prd.problem': { state: 'draft', source: 'llm:grounded-content', inputHash: 'i1', contentHash, citations: ['adr:0148'] },
      'spec.summary': { state: 'authored' },
      'spec.scope': { state: 'derived', source: 'biz0004:fwd-reach', inputHash: 'i2', contentHash: 'h2' },
    },
  };
}

/** A gate receipt in the exact shape `approveGate` writes / `readGateResult` returns. */
function receipt({ status = 'approved', approver = 'human:reviewer', evidence = ['prd.problem'], revision = 3 } = {}) {
  return { gateId: 'G-GA4', status, requirements: [], evidence, humanApproval: { required: true, approver, timestamp: '2026-07-27T00:00:00.000Z' }, revision };
}

// [g] promotion-from-gate-receipt — the verified verdict, and everything that isn't one.
{
  const outcome = promoteDrafts({ sidecar: draftSidecar(), gateResult: receipt() });
  assert('[g] an approved receipt naming the field promotes it',
    outcome.sidecar.fields['prd.problem'].state === 'authored', JSON.stringify(outcome.sidecar.fields['prd.problem']));
  assert('[g] the promoted entry drops source/hashes (one-way lock)',
    Object.keys(outcome.sidecar.fields['prd.problem']).join(',') === 'state');
  assert('[g] the promotion is reported with its channel',
    outcome.promoted.length === 1 && outcome.promoted[0].reason === PROMOTION_REASONS.GATE, JSON.stringify(outcome.promoted));
  assert('[g] the resulting sidecar still validates', validateProvenanceSidecar(outcome.sidecar).ok === true);
  assert('[g] an authored field is untouched', outcome.sidecar.fields['spec.summary'].state === 'authored');
  assert('[g] a DERIVED field is untouched — promotion never steals WF-0089\'s authority',
    outcome.sidecar.fields['spec.scope'].state === 'derived');

  // Promotion is one-way: a second pass finds no draft and changes nothing.
  const again = promoteDrafts({ sidecar: outcome.sidecar, gateResult: receipt() });
  assert('[g] a second pass is a no-op (idempotent, one-way)',
    again.promoted.length === 0 && again.sidecar.fields['prd.problem'].state === 'authored');

  for (const [label, gateResult] of [
    ['a STALE receipt', receipt({ status: 'stale' })],
    ['an unapproved (pending) receipt', receipt({ status: 'pending' })],
    ['an anonymous receipt', receipt({ approver: '   ' })],
    ['a receipt naming no reasoned field', receipt({ evidence: ['reports/ga4-report.md'] })],
    ['a null receipt', null],
  ]) {
    const refused = promoteDrafts({ sidecar: draftSidecar(), gateResult });
    assert(`[g] ${label} promotes nothing`,
      refused.promoted.length === 0 && refused.sidecar.fields['prd.problem'].state === 'draft', JSON.stringify(refused.promoted));
  }
  assert('[g] authorizedFieldKeys ignores non-field evidence entries',
    authorizedFieldKeys(receipt({ evidence: ['prd.problem', 'npm run ci', 'spec.scope'] })).join(',') === 'prd.problem',
    authorizedFieldKeys(receipt({ evidence: ['prd.problem', 'npm run ci', 'spec.scope'] })).join(','));
  assert('[g] an unreviewed draft is reported as such, not silently dropped',
    promoteDrafts({ sidecar: draftSidecar(), gateResult: null }).unchanged[0].reason === PROMOTION_REASONS.UNREVIEWED);
}

// [h] promotion-from-human-edit — content-hash-first, the same rule WF-0089 uses.
{
  const original = 'The model wrote this.';
  const sidecar = draftSidecar(hashFieldContent(original, 'markdown'));

  const untouched = promoteDrafts({ sidecar, readContent: () => original });
  assert('[h] an UNEDITED draft stays a draft',
    untouched.promoted.length === 0 && untouched.sidecar.fields['prd.problem'].state === 'draft');

  const edited = promoteDrafts({ sidecar, readContent: () => 'A human rewrote this by hand.' });
  assert('[h] an edited draft is promoted to authored',
    edited.sidecar.fields['prd.problem'].state === 'authored', JSON.stringify(edited.sidecar.fields['prd.problem']));
  assert('[h] the promotion names the edit channel',
    edited.promoted[0].reason === PROMOTION_REASONS.EDIT, edited.promoted[0].reason);

  assert('[h] no reader ⇒ the edit channel is skipped, not assumed clean',
    promoteDrafts({ sidecar }).sidecar.fields['prd.problem'].state === 'draft');
  assert('[h] a throwing reader leaves the draft alone (cannot tell ≠ edited)',
    promoteDrafts({ sidecar, readContent: () => { throw new Error('unreadable'); } }).sidecar.fields['prd.problem'].state === 'draft');
  assert('[h] an undefined read leaves the draft alone',
    promoteDrafts({ sidecar, readContent: () => undefined }).sidecar.fields['prd.problem'].state === 'draft');
  assert('[h] a hostile sidecar degrades without throwing',
    promoteDrafts({ sidecar: {} }).promoted.length === 0 && promoteDrafts({ sidecar: null }).promoted.length === 0);
}

// [i] no-llm-to-decide — the guardrail decides by comparison, never by dispatch.
// A static source assertion, in the style tools/selfcheck.mjs already uses for
// wiring: the guarantee has to hold by CONSTRUCTION, not by the author's care.
{
  const guardrailSource = readFileSync(new URL('./token-guardrail.mjs', import.meta.url), 'utf-8');
  assert('[i] the guardrail never imports the content engine (no gate dispatches a model)',
    !guardrailSource.includes('content-fill.mjs'));
  assert('[i] the guardrail takes no generator parameter',
    !/\bgenerate\b/.test(guardrailSource));
  const promoteSource = readFileSync(new URL('./content-promote.mjs', import.meta.url), 'utf-8');
  assert('[i] promotion never imports the content engine either',
    !promoteSource.includes('content-fill.mjs') && !/\bgenerate\b/.test(promoteSource));
  assert('[i] evaluateKillSwitch is deterministic — same input, same verdict',
    JSON.stringify(evaluateKillSwitch(ACTIVE, ledger(10, 100))) === JSON.stringify(evaluateKillSwitch(ACTIVE, ledger(10, 100))));
}

// [qa] GA3-T2 adversarial regressions — real holes an independent QA pass found
// that this suite did not catch. Kept as named cases so they cannot reopen.
{
  const original = 'The model wrote this.';
  const sidecar = draftSidecar(hashFieldContent(original, 'markdown'));

  // F3 (the top finding) — a draft promoted ITSELF to `authored` with no human
  // anywhere in the loop. `edited()` treated only `undefined`/throw as "cannot
  // tell", so a reader returning '' read as a content-hash mismatch. Reachable,
  // not theoretical: REASONED_FIELD_SECTIONS is null for acceptance.criterion and
  // acceptance.evidence (table cells, not sections), so the natural
  // markdownSectionBody reader returns '' for 2 of the 8 reasoned fields — those
  // drafts got permanent human authority on the first promotion pass.
  for (const [label, readContent] of [
    ["an empty string (the acceptance.* section reader)", () => ''],
    ['whitespace only', () => '   '],
    ['CRLF whitespace', () => '\r\n  \r\n'],
    ['null', () => null],
    ['false', () => false],
    ['zero', () => 0],
    ['an object', () => ({})],
    ['undefined', () => undefined],
  ]) {
    const outcome = promoteDrafts({ sidecar, readContent });
    assert(`[qa] F3 a failed read (${label}) does NOT promote — "cannot tell" is not "edited"`,
      outcome.promoted.length === 0 && outcome.sidecar.fields['prd.problem'].state === 'draft',
      JSON.stringify(outcome.promoted));
  }
  // The channel must still WORK — a fix that simply disabled edit-promotion
  // would pass every case above and be useless.
  assert('[qa] F3 a genuine human edit still promotes (the fix did not disable the channel)',
    promoteDrafts({ sidecar, readContent: () => 'A human rewrote this by hand.' }).sidecar.fields['prd.problem'].state === 'authored');

  // F4 — `available:true` is not trustworthy. Type-checked, never coerced:
  // `Number(null)` is 0, so coercion read a MISSING measurement as "zero spend".
  for (const unusable of [null, undefined, NaN, -5, '100', {}, Infinity]) {
    assert(`[qa] F4 an unusable sessionTokens (${JSON.stringify(unusable)}) never authorizes spend`,
      evaluateKillSwitch(ACTIVE, { available: true, sessionTokens: unusable, priorSessionTokens: 1 }).enabled === false);
  }
  assert('[qa] F4 a corrupt prior-session baseline refuses',
    evaluateKillSwitch(ACTIVE, { available: true, sessionTokens: 10, priorSessionTokens: 'lots' }).enabled === false);
  assert('[qa] F4 an ABSENT baseline (null) is still allowed — no baseline yet is not corruption',
    evaluateKillSwitch(ACTIVE, ledger(10, null)).enabled === true);
  assert('[qa] F4 a legitimate measurement still passes', evaluateKillSwitch(ACTIVE, ledger(10, 100)).enabled === true);

  // F12 — an absurd budget must not authorize unbounded spend.
  assert('[qa] F12 a non-finite tokenBudgetPerContext refuses',
    evaluateKillSwitch({ enabled: true, tokenBudgetPerContext: Infinity }, ledger(10, 100)).enabled === false);
}

process.stdout.write(failures.length === 0 ? '\nPASSED\n' : `\nFAILED (${failures.length})\n`);
process.exit(failures.length === 0 ? 0 : 1);
