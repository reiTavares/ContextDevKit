/**
 * In-process self-test for the B2-T1 decision-need classifier modules
 * (BIZ-0001 / WF-0037 Wave B2, ADR-0102).
 *
 * Runs under plain `node`, zero-dependency. Sections:
 *   [a] materialityScore band edges: score 6→required, 5→recommended,
 *       3→recommended, 2→none (§2.2 thresholds).
 *   [b] routineKind (−4) drives score below material threshold.
 *   [c] Routine-coverage RC1..RC4 → coverageMode ROUTINE_COVERED;
 *       RC4 guard: irreversible token refuses routine path.
 *   [d] HR-4: regulated domain floors needVerdict to required; routine refused.
 *   [e] HR-5: irreversible token floors needVerdict to required.
 *   [f] HR-1: explicit ADR ref → forced LINK (eligible ADR);
 *       superseded ref → SUPERSEDED_NOT_GOVERNING.
 *   [g] Determinism: same input → byte-identical JSON output twice.
 *   [h] Defensive: classifyDecisionNeed never throws on null/hostile input.
 *
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 */
import { materialityScore, DEFAULT_DECISION_POLICY } from './materiality-score.mjs';
import { classifyDecisionNeed } from './decision-need-classifier.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

const P = DEFAULT_DECISION_POLICY;

// Shared routine standing-ADR fixture reused in [c] and [d].
const ROUTINE_ADR = Object.freeze({
  id: 'ADR-0050', status: 'accepted', format: 'new',
  primaryContext: { type: 'platform', id: 'platform' },
  decisionKind: 'ROUTINE_OPERATION_GOVERNANCE', decisionScope: 'operation',
  routineCeiling: 3,
  routineClasses: [{ name: 'dependency-bump', signals: [{ s: 'bump', w: 2 }, { s: 'dependency within policy', w: 3 }] }],
  governs: { workflows: [], operations: [], business: [] },
  supersedes: [], supersededBy: null, tags: [],
});
const ROUTINE_TRIPLE = Object.freeze({ primaryContext: { type: 'platform', id: 'platform' }, decisionKind: 'ROUTINE_OPERATION_GOVERNANCE', decisionScope: 'operation' });
const ROUTINE_REG  = { schemaVersion: 1, decisions: [ROUTINE_ADR] };
const EMPTY_REG    = { schemaVersion: 1, decisions: [] };

// ---------------------------------------------------------------------------
// [a] materialityScore band edges
// ---------------------------------------------------------------------------
process.stdout.write('\n[a] materialityScore band edges\n');
{
  // Score=6: tierFeature(+2)+materialKind(OPERATION_AUTH,+3)+scopeOperationWorkflow(+1)
  const r6 = materialityScore({ tier:'feature', domain:'general', work:{ executionMode:'direct' }, decisionKind:'OPERATION_AUTHORIZATION', decisionScope:'operation', objectiveLower:'add a cli flag to one command', policy:P });
  assert('score=6 → band:required', r6.band === 'required', `band=${r6.band}, score=${r6.score}`);
  assert('score=6 exact integer', r6.score === 6, `got ${r6.score}`);

  // Score=5: tierArchitectural(+5) — decisionScope:'' to avoid scopeOperationWorkflow(+1)
  const r5 = materialityScore({ tier:'architectural', domain:'general', work:{ executionMode:'direct' }, decisionKind:'', decisionScope:'', objectiveLower:'refactor internal utilities', policy:P });
  assert('score=5 → band:recommended', r5.band === 'recommended', `band=${r5.band}, score=${r5.score}`);
  assert('score=5 exact integer', r5.score === 5, `got ${r5.score}`);

  // Score=3: materialKind(ARCHITECTURE,+3), tier trivial — decisionScope:'' avoids scopeOperationWorkflow(+1)
  const r3 = materialityScore({ tier:'trivial', domain:'general', work:{ executionMode:'direct' }, decisionKind:'ARCHITECTURE', decisionScope:'', objectiveLower:'small tweak', policy:P });
  assert('score=3 → band:recommended', r3.band === 'recommended', `band=${r3.band}, score=${r3.score}`);
  assert('score=3 exact integer', r3.score === 3, `got ${r3.score}`);

  // Score=2: tierFeature(+2), no materialKind — decisionScope:'' avoids scopeOperationWorkflow(+1)
  const r2 = materialityScore({ tier:'feature', domain:'general', work:{ executionMode:'direct' }, decisionKind:'', decisionScope:'', objectiveLower:'update button label', policy:P });
  assert('score=2 → band:none', r2.band === 'none', `band=${r2.band}, score=${r2.score}`);
  assert('score=2 exact integer', r2.score === 2, `got ${r2.score}`);
}

// ---------------------------------------------------------------------------
// [b] routineKind (−4) drives score below material threshold
// ---------------------------------------------------------------------------
process.stdout.write('\n[b] routineKind (−4) drives score below material\n');
{
  const rRoutine = materialityScore({ tier:'trivial', domain:'general', work:{ executionMode:'direct' }, decisionKind:'ROUTINE_OPERATION_GOVERNANCE', decisionScope:'operation', objectiveLower:'bump a dependency within policy', policy:P });
  assert('routineKind score ≤ 2', rRoutine.score <= 2, `score=${rRoutine.score}`);
  assert('routineKind → band:none', rRoutine.band === 'none', `band=${rRoutine.band}`);
  assert('needSignals.routineKind is true', rRoutine.needSignals.routineKind === true);
  assert('needSignals.materialKind false for ROUTINE_OPERATION_GOVERNANCE', rRoutine.needSignals.materialKind === false);
}

// ---------------------------------------------------------------------------
// [c] Routine-coverage RC1..RC4
// ---------------------------------------------------------------------------
process.stdout.write('\n[c] Routine-coverage RC1..RC4 → ROUTINE_COVERED; RC4 guard\n');
{
  const baseSig = { tier:'trivial', domain:'general', work:{ executionMode:'direct', confidence:'medium' }, decisionKind:'ROUTINE_OPERATION_GOVERNANCE', decisionScope:'operation', objectiveLower:'bump a dependency within policy', policy:P };

  const ok = classifyDecisionNeed({ objective:'bump a dependency within policy', signals:baseSig, triple:ROUTINE_TRIPLE, registry:ROUTINE_REG, policy:P });
  assert('RC1..4 met → needVerdict:none', ok.needVerdict === 'none', `got ${ok.needVerdict}`);
  assert('RC1..4 met → coverageMode:ROUTINE_COVERED', ok.coverageMode === 'ROUTINE_COVERED', `got ${ok.coverageMode}`);
  assert('materialityScore is an integer', Number.isInteger(ok.materialityScore));
  assert('reasons[] non-empty', Array.isArray(ok.reasons) && ok.reasons.length > 0);

  // RC4: irreversible token → routine path refused
  const irreversibleSig = { ...baseSig, objectiveLower:'bump a dependency within policy — migration required' };
  const rc4 = classifyDecisionNeed({ objective:'bump a dependency within policy — migration required', signals:irreversibleSig, triple:ROUTINE_TRIPLE, registry:ROUTINE_REG, policy:P });
  assert('RC4: irreversible token refuses routine path', rc4.coverageMode !== 'ROUTINE_COVERED', `got ${rc4.coverageMode}`);

  // No standing ADR for context → never ROUTINE_COVERED
  const noAdr = classifyDecisionNeed({ objective:'bump a dependency within policy', signals:baseSig, triple:ROUTINE_TRIPLE, registry:EMPTY_REG, policy:P });
  assert('no standing ADR → not ROUTINE_COVERED', noAdr.coverageMode !== 'ROUTINE_COVERED', `got ${noAdr.coverageMode}`);
}

// ---------------------------------------------------------------------------
// [d] HR-4: regulated domain floors to required; routine path refused
// ---------------------------------------------------------------------------
process.stdout.write('\n[d] HR-4: regulated domain floors to required\n');
{
  const regSig = { tier:'trivial', domain:'lgpd', work:{ executionMode:'direct', confidence:'medium' }, decisionKind:'ROUTINE_OPERATION_GOVERNANCE', decisionScope:'operation', objectiveLower:'bump a dependency within policy', policy:P };
  const reg = classifyDecisionNeed({ objective:'bump a dependency within policy', signals:regSig, triple:ROUTINE_TRIPLE, registry:ROUTINE_REG, policy:P });
  assert('HR-4: lgpd domain → needVerdict:required', reg.needVerdict === 'required', `got ${reg.needVerdict}`);
  assert('HR-4: lgpd domain → not ROUTINE_COVERED', reg.coverageMode !== 'ROUTINE_COVERED', `got ${reg.coverageMode}`);
  assert('HR-4: reasons mention regulated/lgpd', Array.isArray(reg.reasons) && reg.reasons.some((r) => /lgpd|fintech|healthcare|regulated/i.test(r)));
}

// ---------------------------------------------------------------------------
// [e] HR-5: irreversible token floors to required
// ---------------------------------------------------------------------------
process.stdout.write('\n[e] HR-5: irreversible token floors to required\n');
{
  const irrSig = { tier:'trivial', domain:'general', work:{ executionMode:'direct', confidence:'medium' }, decisionKind:'ROUTINE_OPERATION_GOVERNANCE', decisionScope:'operation', objectiveLower:'migrate the database schema', policy:P };
  const irr = classifyDecisionNeed({ objective:'migrate the database schema', signals:irrSig, triple:ROUTINE_TRIPLE, registry:EMPTY_REG, policy:P });
  assert('HR-5: migrate token → needVerdict:required', irr.needVerdict === 'required', `got ${irr.needVerdict}`);
  assert('HR-5: not ROUTINE_COVERED', irr.coverageMode !== 'ROUTINE_COVERED', `got ${irr.coverageMode}`);
  assert('HR-5: reasons mention irreversible/migrate/schema', Array.isArray(irr.reasons) && irr.reasons.some((r) => /irreversible|one.way|migrate|schema/i.test(r)));
}

// ---------------------------------------------------------------------------
// [f] HR-1: explicit ADR ref wins; superseded ref → SUPERSEDED_NOT_GOVERNING
// ---------------------------------------------------------------------------
process.stdout.write('\n[f] HR-1: explicit ADR ref wins\n');
{
  const ELIGIBLE = { id:'ADR-0102', status:'accepted', format:'new', primaryContext:{ type:'business', id:'BIZ-0001' }, decisionKind:'BUSINESS_AUTHORIZATION', decisionScope:'business', governs:{ workflows:[], operations:[], business:['BIZ-0001'] }, supersedes:[], supersededBy:null, tags:[] };
  const reg = { schemaVersion:1, decisions:[ELIGIBLE] };
  const baseSig = { tier:'trivial', domain:'general', work:{ executionMode:'direct', confidence:'medium' }, decisionKind:'ARCHITECTURE', decisionScope:'workflow', objectiveLower:'update per adr-0102', policy:P };
  const triple = { primaryContext:{ type:'business', id:'BIZ-0001' }, decisionKind:'ARCHITECTURE', decisionScope:'workflow' };

  const hr1 = classifyDecisionNeed({ objective:'update per ADR-0102', signals:baseSig, triple, registry:reg, policy:P });
  assert('HR-1: explicit ref → needVerdict:required', hr1.needVerdict === 'required', `got ${hr1.needVerdict}`);
  assert('HR-1: explicit ref → linkTarget ADR-0102', hr1.linkTarget === 'ADR-0102', `got ${hr1.linkTarget}`);
  assert('HR-1: explicit ref → COVERED_BY_ACCEPTED', hr1.coverageMode === 'COVERED_BY_ACCEPTED', `got ${hr1.coverageMode}`);

  const SUP = { id:'ADR-0099', status:'superseded', format:'new', primaryContext:{ type:'platform', id:'platform' }, decisionKind:'ARCHITECTURE', decisionScope:'workflow', governs:{ workflows:[], operations:[], business:[] }, supersedes:[], supersededBy:'ADR-0100', tags:[] };
  const supReg = { schemaVersion:1, decisions:[SUP] };
  const supSig = { ...baseSig, objectiveLower:'update per adr-0099' };
  const supResult = classifyDecisionNeed({ objective:'update per ADR-0099', signals:supSig, triple:{ primaryContext:{ type:'platform', id:'platform' }, decisionKind:'ARCHITECTURE', decisionScope:'workflow' }, registry:supReg, policy:P });
  assert('HR-1: superseded ref → SUPERSEDED_NOT_GOVERNING', supResult.coverageMode === 'SUPERSEDED_NOT_GOVERNING', `got ${supResult.coverageMode}`);
}

// ---------------------------------------------------------------------------
// [g] Determinism
// ---------------------------------------------------------------------------
process.stdout.write('\n[g] Determinism: same input → byte-identical JSON output twice\n');
{
  const input = { objective:'adopt a new dependency kit-wide', signals:{ tier:'architectural', domain:'general', work:{ executionMode:'workflow', confidence:'medium' }, decisionKind:'ARCHITECTURE', decisionScope:'platform', objectiveLower:'adopt a new dependency kit-wide', policy:P }, triple:{ primaryContext:{ type:'platform', id:'platform' }, decisionKind:'ARCHITECTURE', decisionScope:'platform' }, registry:EMPTY_REG, policy:P };
  assert('classifyDecisionNeed deterministic', JSON.stringify(classifyDecisionNeed(input)) === JSON.stringify(classifyDecisionNeed(input)));
  assert('materialityScore deterministic', JSON.stringify(materialityScore(input.signals)) === JSON.stringify(materialityScore(input.signals)));
  // Pinned-score anchors (§2.2) — guard the frozen weight table against regression.
  const anchorArch = materialityScore(input.signals);
  assert('§2.2 anchor: architectural + platform kit-wide → score=14/required',
    anchorArch.score === 14 && anchorArch.band === 'required', `got ${anchorArch.score}/${anchorArch.band}`);
  const anchorRegulated = materialityScore({ tier:'feature', domain:'lgpd', work:{}, decisionScope:'workflow' });
  assert('§2.2 anchor: feature + regulated(lgpd) → score=7/required (HR-4 floor)',
    anchorRegulated.score === 7 && anchorRegulated.band === 'required', `got ${anchorRegulated.score}/${anchorRegulated.band}`);
}

// ---------------------------------------------------------------------------
// [h] Defensive: never throws on null/hostile input
// ---------------------------------------------------------------------------
process.stdout.write('\n[h] Defensive: never throws on hostile input\n');
{
  let threw = false;
  try {
    classifyDecisionNeed(null); classifyDecisionNeed(undefined); classifyDecisionNeed({});
    classifyDecisionNeed({ objective:null, signals:null, triple:null, registry:null });
    classifyDecisionNeed({ objective:42, signals:[], triple:'bad', registry:{} });
  } catch { threw = true; }
  assert('classifyDecisionNeed never throws', threw === false);
  const safe = classifyDecisionNeed({});
  assert('classifyDecisionNeed({}) → needVerdict string', typeof safe.needVerdict === 'string');
  assert('classifyDecisionNeed({}) → coverageMode string', typeof safe.coverageMode === 'string');
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
