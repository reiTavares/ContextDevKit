/**
 * In-process self-test for the B3-T1 approval-mirroring, supersession, and
 * ownership-transfer modules (BIZ-0001 / WF-0037, B3-T1).
 *
 * Runs under plain `node`, zero-dependency, deterministic (fixed timestamps,
 * in-memory fixtures only). Exit 0 = all held; exit 1 = at least one failed.
 *
 * Sections:
 *   [a] mirrorBusinessApproval — human actor → exactly ONE accepted ADR
 *   [b] mirrorBusinessApproval — non-human actor → refused (adr: null, no throw)
 *   [c] supersede — human actor → newAdr + oldPatch + supersededBy link
 *   [d] supersede — non-human actor / same-id → refused (newAdr: null, no throw)
 *   [e] isGoverning — accepted → true; all others → false
 *   [f] transferOwnership — missing humanApproved or non-human actor → refused
 *   [g] transferOwnership — happy path → updated entity + receipt
 *   [h] Determinism — identical frozen inputs → byte-identical JSON twice
 */
import { mirrorBusinessApproval } from './work-decision-mirror.mjs';
import { supersede, isGoverning, transferOwnership } from './work-decision-supersede.mjs';

const failures = [];
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

const FIXED_NOW = '2026-06-19T00:00:00.000Z';
const HASH = 'aabbccdd1122334455667788aabbccdd1122334455667788aabbccdd11223344';

function confirmedBusiness(overrides = {}) {
  return {
    id: 'BIZ-0001', title: 'Business-Driven Development Methodology', status: 'confirmed',
    approval: { actor: 'human', revision: 1, approvedAt: FIXED_NOW, decision: 'ADR-0102', decisionHash: HASH },
    decisions: { status: 'active', primary: 'ADR-0102', refs: [] },
    ...overrides,
  };
}

const ACCEPTED_ADR = Object.freeze({
  id: 'ADR-0102', status: 'accepted',
  primaryContext: { type: 'business', id: 'BIZ-0001' },
  decisionKind: 'BUSINESS_AUTHORIZATION', supersedes: [], supersededBy: null,
  title: 'Business-Driven Methodology Governance',
});

// [a] mirrorBusinessApproval — human + confirmed → exactly ONE accepted ADR
process.stdout.write('\n[a] mirrorBusinessApproval — human actor, confirmed business → one accepted ADR\n');
{
  const { adr, receipt } = mirrorBusinessApproval(confirmedBusiness(), { actor: 'human', now: FIXED_NOW });
  assert('[a] adr is a non-null object', adr !== null && typeof adr === 'object');
  assert('[a] adr.status is "accepted"', adr && adr.status === 'accepted');
  assert('[a] adr.id matches approval.decision', adr && adr.id === 'ADR-0102');
  assert('[a] adr.primaryContext.type is "business"', adr && adr.primaryContext && adr.primaryContext.type === 'business');
  assert('[a] adr.approvalSource.actor is "human"', adr && adr.approvalSource && adr.approvalSource.actor === 'human');
  assert('[a] decisionHash reused from business (A3 is hash authority)',
    adr && adr.approvalSource && adr.approvalSource.decisionHash === HASH);
  assert('[a] receipt.status is "mirrored"', receipt && receipt.status === 'mirrored');
  assert('[a] exactly one adr returned (not an array)', !Array.isArray(adr));
}

// [b] mirrorBusinessApproval — non-human actor → refused (adr: null, no throw)
process.stdout.write('\n[b] mirrorBusinessApproval — non-human actor → refused, adr: null\n');
{
  for (const actor of ['agent', 'ai', 'claude', 'automation']) {
    let threw = false; let result;
    try { result = mirrorBusinessApproval(confirmedBusiness(), { actor, now: FIXED_NOW }); } catch { threw = true; }
    assert(`[b] actor="${actor}" — no throw`, !threw);
    assert(`[b] actor="${actor}" — adr:null`, result && result.adr === null);
    assert(`[b] actor="${actor}" — receipt.status "refused"`, result && result.receipt && result.receipt.status === 'refused');
  }
  // Proposed business (not confirmed) with human actor also refused.
  const { adr: adrOnProposed } = mirrorBusinessApproval(
    confirmedBusiness({ status: 'proposed' }), { actor: 'human', now: FIXED_NOW });
  assert('[b] proposed status → adr: null', adrOnProposed === null);
}

// [c] supersede — human actor → newAdr + oldPatch + supersededBy link
process.stdout.write('\n[c] supersede — human actor → newAdr + oldPatch + supersededBy link\n');
{
  const newFields = { id: 'ADR-0103', title: 'Phase 2', decisionKind: 'BUSINESS_AUTHORIZATION' };
  const { newAdr, oldPatch, oldStatus, receipt } =
    supersede(ACCEPTED_ADR, newFields, { actor: 'human', now: FIXED_NOW, note: 'Scope expanded.' });
  assert('[c] newAdr is non-null', newAdr !== null && typeof newAdr === 'object');
  assert('[c] newAdr.status is "proposed"', newAdr && newAdr.status === 'proposed');
  assert('[c] newAdr.supersedes contains old id', newAdr && Array.isArray(newAdr.supersedes) && newAdr.supersedes.includes('ADR-0102'));
  assert('[c] oldPatch.status is "superseded"', oldPatch && oldPatch.status === 'superseded');
  assert('[c] oldPatch.supersededBy is new id', oldPatch && oldPatch.supersededBy === 'ADR-0103');
  assert('[c] oldStatus is "superseded"', oldStatus === 'superseded');
  assert('[c] receipt.note captured', receipt && receipt.note === 'Scope expanded.');
  assert('[c] original ACCEPTED_ADR not mutated', ACCEPTED_ADR.status === 'accepted');
}

// [d] supersede — non-human actor / same-id → refused (newAdr: null, no throw)
process.stdout.write('\n[d] supersede — non-human actor / same-id → refused, newAdr: null\n');
{
  const newFields = { id: 'ADR-0104', title: 'Attempt', decisionKind: 'BUSINESS_AUTHORIZATION' };
  for (const actor of ['agent', 'ai', 'automation']) {
    let threw = false; let result;
    try { result = supersede(ACCEPTED_ADR, newFields, { actor, now: FIXED_NOW }); } catch { threw = true; }
    assert(`[d] actor="${actor}" — no throw`, !threw);
    assert(`[d] actor="${actor}" — newAdr:null`, result && result.newAdr === null);
  }
  // Same ADR id guard.
  const same = supersede(ACCEPTED_ADR, { id: 'ADR-0102', title: 'Same' }, { actor: 'human', now: FIXED_NOW });
  assert('[d] same id → newAdr:null', same.newAdr === null);
  assert('[d] same id → reason SAME_ADR_ID', same.receipt && same.receipt.reason === 'SAME_ADR_ID');
}

// [e] isGoverning — accepted → true; all non-accepted statuses → false
process.stdout.write('\n[e] isGoverning — accepted → true; all others → false\n');
{
  assert('[e] accepted → true', isGoverning({ status: 'accepted' }) === true);
  for (const status of ['superseded', 'rejected', 'legacy', 'proposed', null]) {
    assert(`[e] ${status} → false`, isGoverning({ status }) === false);
  }
  assert('[e] null input → false', isGoverning(null) === false);
  assert('[e] empty object → false', isGoverning({}) === false);
  assert('[e] array → false', isGoverning([]) === false);
}

// [f] transferOwnership — missing humanApproved or non-human actor → refused
process.stdout.write('\n[f] transferOwnership — humanApproved missing / non-human → refused\n');
{
  const entity = { id: 'ADR-0102', primaryContext: { type: 'business', id: 'BIZ-0001' }, contextType: 'business' };
  const newOwner = { type: 'business', id: 'BIZ-0002' };
  // humanApproved absent.
  const r1 = transferOwnership(entity, newOwner, { actor: 'human', now: FIXED_NOW });
  assert('[f] absent humanApproved → entity:null', r1 && r1.entity === null);
  assert('[f] absent humanApproved → HUMAN_APPROVAL_REQUIRED', r1 && r1.receipt && r1.receipt.reason === 'HUMAN_APPROVAL_REQUIRED');
  // humanApproved:true but non-human actor.
  const r2 = transferOwnership(entity, newOwner, { actor: 'agent', humanApproved: true, now: FIXED_NOW });
  assert('[f] non-human actor + humanApproved → entity:null', r2 && r2.entity === null);
  assert('[f] non-human actor → NON_HUMAN_ACTOR', r2 && r2.receipt && r2.receipt.reason === 'NON_HUMAN_ACTOR');
}

// [g] transferOwnership — happy path → updated entity + receipt stamped
process.stdout.write('\n[g] transferOwnership — happy path\n');
{
  const entity = { id: 'ADR-0102', primaryContext: { type: 'business', id: 'BIZ-0001' }, contextType: 'business' };
  const { entity: updated, receipt } =
    transferOwnership(entity, { type: 'business', id: 'BIZ-0002' },
      { actor: 'human', humanApproved: true, now: FIXED_NOW, note: 'Re-parented.' });
  assert('[g] updated entity non-null', updated !== null);
  assert('[g] updated.primaryContext.id is new owner', updated && updated.primaryContext && updated.primaryContext.id === 'BIZ-0002');
  assert('[g] original entity not mutated', entity.primaryContext.id === 'BIZ-0001');
  assert('[g] receipt.status "transferred"', receipt && receipt.status === 'transferred');
  assert('[g] receipt.previousOwner.id is original', receipt && receipt.previousOwner && receipt.previousOwner.id === 'BIZ-0001');
  assert('[g] receipt.humanApproved true', receipt && receipt.humanApproved === true);
  assert('[g] receipt.note captured', receipt && receipt.note === 'Re-parented.');
}

// [h] Determinism — identical frozen inputs → byte-identical JSON twice
process.stdout.write('\n[h] Determinism — identical inputs → byte-identical JSON twice\n');
{
  const biz = confirmedBusiness();
  const ctx = { actor: 'human', now: FIXED_NOW };
  assert('[h] mirrorBusinessApproval deterministic',
    JSON.stringify(mirrorBusinessApproval(biz, ctx)) === JSON.stringify(mirrorBusinessApproval(biz, ctx)));
  const nf = { id: 'ADR-0103', title: 'Redo', decisionKind: 'BUSINESS_AUTHORIZATION' };
  assert('[h] supersede deterministic',
    JSON.stringify(supersede(ACCEPTED_ADR, nf, ctx)) === JSON.stringify(supersede(ACCEPTED_ADR, nf, ctx)));
  const ent = { id: 'ADR-0102', primaryContext: { type: 'business', id: 'BIZ-0001' }, contextType: 'business' };
  const tCtx = { actor: 'human', humanApproved: true, now: FIXED_NOW };
  assert('[h] transferOwnership deterministic',
    JSON.stringify(transferOwnership(ent, { type: 'business', id: 'BIZ-X' }, tCtx)) ===
    JSON.stringify(transferOwnership(ent, { type: 'business', id: 'BIZ-X' }, tCtx)));
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
