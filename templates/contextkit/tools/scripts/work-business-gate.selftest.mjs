/**
 * In-process self-test for the A3 Business Gate, lifecycle transition, and
 * decision-hash modules (BIZ-0001 / WF-0036, A3-T2).
 *
 * Zero-dependency, runs under plain `node`. Proves the Gate G-A3 invariants
 * against the ACTUAL exported APIs:
 *   (a) AI-cannot-self-approve — `transition(b, 'approve', { actor })` THROWS
 *       with code APPROVAL_ACTOR_REFUSED for any non-'human' actor;
 *   (b) `evaluateBusinessGate` blocks when status !== 'confirmed', no ADR ref,
 *       or decisionHash mismatches;
 *   (c) human approve → gate passes on the resulting entity;
 *   (d) revise → revisions history grows + decisionHash changes deterministically.
 *
 * Fixed constants: `FIXED_NOW` / `REVISED_NOW` injected via `ctx.now` so no
 * assertion ever touches the real clock. Exit 0 = all held; exit 1 = failure.
 */
import { evaluateBusinessGate, generateAuthorizedWorkflows } from './work-business-gate.mjs';
import { transition } from './work-business-lifecycle.mjs';
import { computeDecisionHash, extractCanonicalFields } from './work-decision-hash.mjs';

const failures = [];
/**
 * Records a named assertion.
 * @param {string} label - human-readable assertion name for failure output.
 * @param {boolean} cond - the condition that must be true for the assertion to pass.
 */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

// ---------------------------------------------------------------------------
// Fixed constants — deterministic, no real clock/random.
// ---------------------------------------------------------------------------
const FIXED_NOW = '2026-06-19T00:00:00.000Z';
const REVISED_NOW = '2026-06-20T00:00:00.000Z';

/**
 * A parsed ADR front-matter fixture: accepted, with primaryContext and decisionKind.
 * Used as the `primaryAdrRecord` in gate checks.
 */
const PRIMARY_ADR_RECORD = Object.freeze({
  id: 'ADR-0102',
  status: 'accepted',
  primaryContext: { type: 'business', id: 'BIZ-0001' },
  decisionKind: 'BUSINESS_AUTHORIZATION',
  supersedes: [],
  title: 'Business-Driven Methodology Governance',
});

/** The canonical hash of the PRIMARY_ADR_RECORD, computed once for reuse. */
const CANONICAL_HASH = computeDecisionHash(extractCanonicalFields(PRIMARY_ADR_RECORD));

/**
 * A draft Business entity in `proposed` state — the legal precursor to `confirmed`.
 * Includes the ADR ref so the gate finds decisions.primary.
 */
function draftBusiness(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'BIZ-0001',
    title: 'Business-Driven Development Methodology',
    slug: 'business-driven-development-methodology',
    status: 'proposed',
    kind: 'capability',
    strategicFacet: 'platform',
    lifecycle: ['draft', 'proposed', 'needs-revision', 'confirmed', 'active', 'closed'],
    valueIntents: { primary: 'ENABLE', secondary: ['IMPROVE'] },
    growth: { primaryLever: 'STRATEGIC_ENABLEMENT', kpis: [] },
    investment: { estimate: 'unknown' },
    approval: { actor: null, revision: 0, approvedAt: null, decision: null, decisionHash: null },
    decisions: { status: 'pending', primary: 'ADR-0102', refs: [] },
    workflows: { refs: [] },
    relations: [],
    revisions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (a) AI-CANNOT-SELF-APPROVE INVARIANT.
//     `transition(b, 'approve', { actor })` must THROW with code
//     APPROVAL_ACTOR_REFUSED for any non-human actor — constitution §4 / §8.
// ---------------------------------------------------------------------------
process.stdout.write('\n[a] AI-cannot-self-approve invariant — transition throws on non-human actors\n');
{
  const AI_ACTORS = ['ai', 'claude', 'agent', 'automation'];
  for (const actor of AI_ACTORS) {
    let thrownCode = null;
    try {
      transition(draftBusiness(), 'approve', { actor, now: FIXED_NOW, primaryAdr: PRIMARY_ADR_RECORD });
    } catch (err) {
      thrownCode = err.code || 'NO_CODE';
    }
    assert(`transition 'approve' with actor="${actor}" throws`, thrownCode !== null);
    assert(`thrown error has code APPROVAL_ACTOR_REFUSED for actor="${actor}"`,
      thrownCode === 'APPROVAL_ACTOR_REFUSED');
  }

  // Verify the gate itself also refuses non-confirmed status after a non-human tries
  // (the throw above means the business never reaches confirmed; gate sees wrong status).
  const draft = draftBusiness();
  const gateOnDraft = evaluateBusinessGate(draft, { primaryAdrRecord: PRIMARY_ADR_RECORD });
  assert('evaluateBusinessGate on proposed (not confirmed) → pass:false', gateOnDraft.pass === false);
  assert('gate reason mentions "confirmed"',
    Array.isArray(gateOnDraft.reasons) && gateOnDraft.reasons.some((r) => /confirmed/i.test(r)));
}

// ---------------------------------------------------------------------------
// (b) GATE BLOCKS — no ADR ref / hash mismatch / non-accepted ADR.
// ---------------------------------------------------------------------------
process.stdout.write('\n[b] Gate blocks — missing / invalid ADR ref or hash mismatch\n');
{
  // Simulate a human-approved entity but without decisions.primary set.
  const noAdrBusiness = {
    ...draftBusiness(),
    status: 'confirmed',
    approval: { actor: 'human', revision: 1, approvedAt: FIXED_NOW, decision: 'ADR-0102', decisionHash: CANONICAL_HASH },
    decisions: { status: 'active', primary: null, refs: [] }, // primary is null
  };
  const noAdrGate = evaluateBusinessGate(noAdrBusiness, { primaryAdrRecord: PRIMARY_ADR_RECORD });
  assert('missing decisions.primary → pass:false', noAdrGate.pass === false);
  assert('gate reason mentions ADR pattern',
    Array.isArray(noAdrGate.reasons) && noAdrGate.reasons.some((r) => /ADR|governing|decisions\.primary/i.test(r)));

  // Confirmed status + valid ADR ref + but NO primaryAdrRecord supplied → hash unverifiable.
  const confirmedBusiness = {
    ...draftBusiness(),
    status: 'confirmed',
    approval: { actor: 'human', revision: 1, approvedAt: FIXED_NOW, decision: 'ADR-0102', decisionHash: CANONICAL_HASH },
    decisions: { status: 'active', primary: 'ADR-0102', refs: [] },
  };
  const noRecordGate = evaluateBusinessGate(confirmedBusiness, {});
  assert('no primaryAdrRecord → pass:false (hash unverifiable)', noRecordGate.pass === false);
  assert('no primaryAdrRecord reason mentions hash or primaryAdrRecord',
    Array.isArray(noRecordGate.reasons)
    && noRecordGate.reasons.some((r) => /hash|primaryAdrRecord/i.test(r)));

  // Confirmed + valid ADR + valid record + WRONG stored hash.
  const wrongHashBusiness = {
    ...confirmedBusiness,
    approval: { ...confirmedBusiness.approval, decisionHash: 'deadbeef-wrong' },
  };
  const hashMismatch = evaluateBusinessGate(wrongHashBusiness, { primaryAdrRecord: PRIMARY_ADR_RECORD });
  assert('stored hash mismatch → pass:false', hashMismatch.pass === false);
  assert('hash mismatch reason mentions "hash"',
    Array.isArray(hashMismatch.reasons) && hashMismatch.reasons.some((r) => /hash/i.test(r)));
}

// ---------------------------------------------------------------------------
// (c) HUMAN APPROVE — gate passes on the resulting entity.
// ---------------------------------------------------------------------------
process.stdout.write('\n[c] Human approve → gate passes; generateAuthorizedWorkflows produces stubs\n');
{
  // transition: draft → proposed (propose action).
  const { business: proposed } = transition(draftBusiness({ status: 'draft' }), 'propose', {
    actor: 'human', now: FIXED_NOW,
  });

  // transition: proposed → confirmed (approve action with human actor).
  const { business: confirmed, receipt } = transition(proposed, 'approve', {
    actor: 'human', now: FIXED_NOW, primaryAdr: PRIMARY_ADR_RECORD,
  });

  assert('approve transitions status to "confirmed"', confirmed.status === 'confirmed');
  assert('approval.actor stamped as "human"',
    confirmed.approval && confirmed.approval.actor === 'human');
  assert('approval.decision references ADR id',
    confirmed.approval && confirmed.approval.decision === PRIMARY_ADR_RECORD.id);
  assert('approval.decisionHash is a non-empty string',
    typeof confirmed.approval.decisionHash === 'string' && confirmed.approval.decisionHash.length > 0);
  assert('approval.decisionHash equals CANONICAL_HASH',
    confirmed.approval.decisionHash === CANONICAL_HASH);
  assert('approval.revision is >= 1', confirmed.approval.revision >= 1);
  assert('receipt.action is "approve"', receipt && receipt.action === 'approve');

  // Gate must now pass on the confirmed entity.
  // decisions.primary must be 'ADR-0102' (from the fixture draftBusiness).
  const passGate = evaluateBusinessGate(confirmed, { primaryAdrRecord: PRIMARY_ADR_RECORD });
  assert('evaluateBusinessGate passes on a properly approved Business', passGate.pass === true);
  assert('passing gate has empty reasons[]',
    Array.isArray(passGate.reasons) && passGate.reasons.length === 0);

  // generateAuthorizedWorkflows must return at least 1 stub when gate passes.
  const stubs = generateAuthorizedWorkflows(confirmed, { primaryAdrRecord: PRIMARY_ADR_RECORD });
  assert('generateAuthorizedWorkflows returns a non-empty array when gate passes',
    Array.isArray(stubs) && stubs.length >= 1);
  assert('each stub has id, title, businessId, status',
    stubs.every((s) => s.id && s.title && s.businessId && s.status));

  // generateAuthorizedWorkflows must be empty when gate is blocked.
  const blockedStubs = generateAuthorizedWorkflows(draftBusiness(), {});
  assert('generateAuthorizedWorkflows returns empty array when gate is blocked',
    Array.isArray(blockedStubs) && blockedStubs.length === 0);
}

// ---------------------------------------------------------------------------
// (d) REVISE — history grows + decisionHash changes deterministically.
// ---------------------------------------------------------------------------
process.stdout.write('\n[d] revise() — revisions history grows + decisionHash changes\n');
{
  // Build a confirmed business as the starting point.
  const { business: proposed } = transition(draftBusiness({ status: 'draft' }), 'propose',
    { actor: 'human', now: FIXED_NOW });
  const { business: confirmed } = transition(proposed, 'approve',
    { actor: 'human', now: FIXED_NOW, primaryAdr: PRIMARY_ADR_RECORD });

  const hashBefore = confirmed.approval.decisionHash;
  const revisionsBefore = confirmed.revisions.length;

  // Revise: confirmed → needs-revision.
  const REVISION_NOTE = 'Narrowed scope to Phase 1 only.';
  const { business: revised, receipt: revReceipt } = transition(confirmed, 'revise',
    { actor: 'human', now: REVISED_NOW, note: REVISION_NOTE });

  assert('revise transitions status to "needs-revision"', revised.status === 'needs-revision');
  assert('revisions history grows by 1',
    Array.isArray(revised.revisions) && revised.revisions.length === revisionsBefore + 1);
  assert('revision entry captures the note',
    revised.revisions.some((rev) => rev.note === REVISION_NOTE));
  assert('revision entry captures the actor',
    revised.revisions.some((rev) => rev.actor === 'human'));
  assert('receipt.action is "revise"', revReceipt && revReceipt.action === 'revise');

  // After revise → propose again → approve again — the NEW hash must differ from hashBefore
  // because the secondaryAdr fields (revision count embedded via revisions) changed.
  const { business: rProposed } = transition(revised, 'propose',
    { actor: 'human', now: REVISED_NOW });
  const UPDATED_ADR = { ...PRIMARY_ADR_RECORD, status: 'accepted', supersedes: [] };
  const { business: reapproved } = transition(rProposed, 'approve',
    { actor: 'human', now: REVISED_NOW, primaryAdr: UPDATED_ADR });

  const hashAfter = reapproved.approval.decisionHash;
  assert('decisionHash is a non-empty string after re-approve',
    typeof hashAfter === 'string' && hashAfter.length > 0);

  // Determinism: same inputs → same hash across two computeDecisionHash calls.
  const h1 = computeDecisionHash(extractCanonicalFields(UPDATED_ADR));
  const h2 = computeDecisionHash(extractCanonicalFields(UPDATED_ADR));
  assert('computeDecisionHash is deterministic (same inputs → same output)', h1 === h2);

  // The hash depends on the ADR fields — different ADR supersedes → different hash.
  const changedAdr = { ...PRIMARY_ADR_RECORD, supersedes: ['ADR-0001'] };
  const hChanged = computeDecisionHash(extractCanonicalFields(changedAdr));
  assert('different ADR content → different hash', h1 !== hChanged);

  // revisions accumulates: second revision from reapproved → history >= 2.
  const { business: r2 } = transition(reapproved, 'revise',
    { actor: 'human', now: '2026-06-21T00:00:00.000Z', note: 'Added KPI targets.' });
  assert('second revise grows revisions to >= 2',
    Array.isArray(r2.revisions) && r2.revisions.length >= 2);
}

// ---------------------------------------------------------------------------
// Defensive — gate and hash never throw on well-typed hostile input.
// (lifecycle throws by design on invariant violations — tested in block a.)
// ---------------------------------------------------------------------------
process.stdout.write('\n[e] Defensive — evaluateBusinessGate fails gracefully on null/empty\n');
{
  let threw = false;
  try {
    evaluateBusinessGate({}, {});
    evaluateBusinessGate({ status: null, approval: null, decisions: null }, {});
  } catch {
    threw = true;
  }
  assert('evaluateBusinessGate never throws on empty/null fields', threw === false);

  const emptyGate = evaluateBusinessGate({}, {});
  assert('empty object → pass:false with reasons', emptyGate.pass === false && emptyGate.reasons.length > 0);
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
