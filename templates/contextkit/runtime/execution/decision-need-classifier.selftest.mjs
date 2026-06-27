/**
 * In-process self-test for the B2-T1 decision-need classifier modules
 * (BIZ-0001 / WF-0037 Wave B2, ADR-0125).
 *
 * Runs under plain `node`, zero-dependency. Sections:
 *   [a] materialityScore band edges: score 8→required, 7→recommended,
 *       4→recommended, 3→none (§28 TABLE 4 thresholds: required=8, recommended=4).
 *   [b] Plain routine objective → score=0/none; new needSignals shape (no routineKind).
 *   [c] Routine-coverage RC1..RC4 → coverageMode ROUTINE_COVERED;
 *       RC4 guard: reversal/migration token refuses routine path.
 *   [d] HR-4: regulated domain floors needVerdict to required; routine refused.
 *   [e] HR-5: dataMigration token floors needVerdict to required.
 *   [f] HR-1: explicit ADR ref → forced LINK (eligible ADR);
 *       superseded ref → SUPERSEDED_NOT_GOVERNING.
 *   [g] Determinism: same input → byte-identical JSON output twice;
 *       pinned-score anchors guard the frozen weight table.
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
// [a] materialityScore band edges (§28 TABLE 4: required=8, recommended=4, none<4)
// ---------------------------------------------------------------------------
process.stdout.write('\n[a] materialityScore band edges\n');
{
  // Score=8: crossCuttingArch(+5) + importantPerf(+3)
  const r8 = materialityScore({ objectiveLower: 'cross-cutting performance optimization', policy: P });
  assert('score=8 → band:required', r8.band === 'required', `band=${r8.band}, score=${r8.score}`);
  assert('score=8 exact integer', r8.score === 8, `got ${r8.score}`);

  // Score=7: newBoundary(+4) + multiTeam(+3) — inside [4,8) → recommended
  const r7 = materialityScore({ objectiveLower: 'create new module for the platform team', policy: P });
  assert('score=7 → band:recommended', r7.band === 'recommended', `band=${r7.band}, score=${r7.score}`);
  assert('score=7 exact integer', r7.score === 7, `got ${r7.score}`);

  // Score=4: newBoundary(+4) — lower recommended edge
  const r4 = materialityScore({ objectiveLower: 'introduce new service layer', policy: P });
  assert('score=4 → band:recommended', r4.band === 'recommended', `band=${r4.band}, score=${r4.score}`);
  assert('score=4 exact integer', r4.score === 4, `got ${r4.score}`);

  // Score=3: importantPerf(+3) — below recommended threshold → none
  const r3 = materialityScore({ objectiveLower: 'improve throughput of the render loop', policy: P });
  assert('score=3 → band:none', r3.band === 'none', `band=${r3.band}, score=${r3.score}`);
  assert('score=3 exact integer', r3.score === 3, `got ${r3.score}`);
}

// ---------------------------------------------------------------------------
// [b] Plain routine objective → score=0/none; new needSignals shape
// ---------------------------------------------------------------------------
process.stdout.write('\n[b] Plain routine objective → score=0/none; new needSignals shape\n');
{
  const rRoutine = materialityScore({ objectiveLower: 'bump a dependency within policy', policy: P });
  assert('routine score = 0', rRoutine.score === 0, `score=${rRoutine.score}`);
  assert('routine → band:none', rRoutine.band === 'none', `band=${rRoutine.band}`);
  // New signal shape: token-based booleans — no routineKind/materialKind keys
  assert('needSignals is an object', typeof rRoutine.needSignals === 'object' && rRoutine.needSignals !== null);
  assert('needSignals.coveredByAcceptedAdr is false', rRoutine.needSignals.coveredByAcceptedAdr === false);
  assert('needSignals.localReversible is false', rRoutine.needSignals.localReversible === false);
}

// ---------------------------------------------------------------------------
// [c] Routine-coverage RC1..RC4
// ---------------------------------------------------------------------------
process.stdout.write('\n[c] Routine-coverage RC1..RC4 → ROUTINE_COVERED; RC4 guard\n');
{
  const baseSig = { tier: 'trivial', domain: 'general', work: { executionMode: 'direct', confidence: 'medium' }, decisionKind: 'ROUTINE_OPERATION_GOVERNANCE', decisionScope: 'operation', objectiveLower: 'bump a dependency within policy', policy: P };

  const ok = classifyDecisionNeed({ objective: 'bump a dependency within policy', signals: baseSig, triple: ROUTINE_TRIPLE, registry: ROUTINE_REG, policy: P });
  assert('RC1..4 met → needVerdict:none', ok.needVerdict === 'none', `got ${ok.needVerdict}`);
  assert('RC1..4 met → coverageMode:ROUTINE_COVERED', ok.coverageMode === 'ROUTINE_COVERED', `got ${ok.coverageMode}`);
  assert('materialityScore is an integer', Number.isInteger(ok.materialityScore));
  assert('reasons[] non-empty', Array.isArray(ok.reasons) && ok.reasons.length > 0);

  // RC4: reversal token → isIrreversible → routine path refused
  // "rewrite" matches reversalTokens → expensiveReversal=true → forceMaterial
  const rc4Sig = { ...baseSig, objectiveLower: 'bump a dependency within policy — rewrite required' };
  const rc4 = classifyDecisionNeed({ objective: 'bump a dependency within policy — rewrite required', signals: rc4Sig, triple: ROUTINE_TRIPLE, registry: ROUTINE_REG, policy: P });
  assert('RC4: reversal token refuses routine path', rc4.coverageMode !== 'ROUTINE_COVERED', `got ${rc4.coverageMode}`);

  // No standing ADR for context → never ROUTINE_COVERED
  const noAdr = classifyDecisionNeed({ objective: 'bump a dependency within policy', signals: baseSig, triple: ROUTINE_TRIPLE, registry: EMPTY_REG, policy: P });
  assert('no standing ADR → not ROUTINE_COVERED', noAdr.coverageMode !== 'ROUTINE_COVERED', `got ${noAdr.coverageMode}`);
}

// ---------------------------------------------------------------------------
// [d] HR-4: regulated domain floors to required; routine path refused
// ---------------------------------------------------------------------------
process.stdout.write('\n[d] HR-4: regulated domain floors to required\n');
{
  const regSig = { tier: 'trivial', domain: 'lgpd', work: { executionMode: 'direct', confidence: 'medium' }, decisionKind: 'ROUTINE_OPERATION_GOVERNANCE', decisionScope: 'operation', objectiveLower: 'bump a dependency within policy', policy: P };
  const reg = classifyDecisionNeed({ objective: 'bump a dependency within policy', signals: regSig, triple: ROUTINE_TRIPLE, registry: ROUTINE_REG, policy: P });
  assert('HR-4: lgpd domain → needVerdict:required', reg.needVerdict === 'required', `got ${reg.needVerdict}`);
  assert('HR-4: lgpd domain → not ROUTINE_COVERED', reg.coverageMode !== 'ROUTINE_COVERED', `got ${reg.coverageMode}`);
  assert('HR-4: reasons mention regulated/lgpd', Array.isArray(reg.reasons) && reg.reasons.some((r) => /lgpd|fintech|healthcare|regulated/i.test(r)));
}

// ---------------------------------------------------------------------------
// [e] HR-5: dataMigration/irreversible token floors to required
// ---------------------------------------------------------------------------
process.stdout.write('\n[e] HR-5: dataMigration token floors to required\n');
{
  // "migrate the database" is in dataMigrationTokens; "schema" alone not a token
  // but "migrate the database schema" contains "migrate the database" as substring ✓
  const irrSig = { tier: 'trivial', domain: 'general', work: { executionMode: 'direct', confidence: 'medium' }, decisionKind: 'ROUTINE_OPERATION_GOVERNANCE', decisionScope: 'operation', objectiveLower: 'migrate the database schema', policy: P };
  const irr = classifyDecisionNeed({ objective: 'migrate the database schema', signals: irrSig, triple: ROUTINE_TRIPLE, registry: EMPTY_REG, policy: P });
  assert('HR-5: dataMigration token → needVerdict:required', irr.needVerdict === 'required', `got ${irr.needVerdict}`);
  assert('HR-5: not ROUTINE_COVERED', irr.coverageMode !== 'ROUTINE_COVERED', `got ${irr.coverageMode}`);
  assert('HR-5: reasons mention irreversible/migrate', Array.isArray(irr.reasons) && irr.reasons.some((r) => /irreversible|migrate|reversal|migration/i.test(r)));
}

// ---------------------------------------------------------------------------
// [f] HR-1: explicit ADR ref wins; superseded ref → SUPERSEDED_NOT_GOVERNING
// ---------------------------------------------------------------------------
process.stdout.write('\n[f] HR-1: explicit ADR ref wins\n');
{
  const ELIGIBLE = { id: 'ADR-0102', status: 'accepted', format: 'new', primaryContext: { type: 'business', id: 'BIZ-0001' }, decisionKind: 'BUSINESS_AUTHORIZATION', decisionScope: 'business', governs: { workflows: [], operations: [], business: ['BIZ-0001'] }, supersedes: [], supersededBy: null, tags: [] };
  const reg = { schemaVersion: 1, decisions: [ELIGIBLE] };
  const baseSig = { tier: 'trivial', domain: 'general', work: { executionMode: 'direct', confidence: 'medium' }, decisionKind: 'ARCHITECTURE', decisionScope: 'workflow', objectiveLower: 'update per adr-0102', policy: P };
  const triple = { primaryContext: { type: 'business', id: 'BIZ-0001' }, decisionKind: 'ARCHITECTURE', decisionScope: 'workflow' };

  const hr1 = classifyDecisionNeed({ objective: 'update per ADR-0102', signals: baseSig, triple, registry: reg, policy: P });
  assert('HR-1: explicit ref → needVerdict:required', hr1.needVerdict === 'required', `got ${hr1.needVerdict}`);
  assert('HR-1: explicit ref → linkTarget ADR-0102', hr1.linkTarget === 'ADR-0102', `got ${hr1.linkTarget}`);
  assert('HR-1: explicit ref → COVERED_BY_ACCEPTED', hr1.coverageMode === 'COVERED_BY_ACCEPTED', `got ${hr1.coverageMode}`);

  const SUP = { id: 'ADR-0099', status: 'superseded', format: 'new', primaryContext: { type: 'platform', id: 'platform' }, decisionKind: 'ARCHITECTURE', decisionScope: 'workflow', governs: { workflows: [], operations: [], business: [] }, supersedes: [], supersededBy: 'ADR-0100', tags: [] };
  const supReg = { schemaVersion: 1, decisions: [SUP] };
  const supSig = { ...baseSig, objectiveLower: 'update per adr-0099' };
  const supResult = classifyDecisionNeed({ objective: 'update per ADR-0099', signals: supSig, triple: { primaryContext: { type: 'platform', id: 'platform' }, decisionKind: 'ARCHITECTURE', decisionScope: 'workflow' }, registry: supReg, policy: P });
  assert('HR-1: superseded ref → SUPERSEDED_NOT_GOVERNING', supResult.coverageMode === 'SUPERSEDED_NOT_GOVERNING', `got ${supResult.coverageMode}`);
}

// ---------------------------------------------------------------------------
// [g] Determinism + pinned-score anchors (guard the frozen TABLE 4 weights)
// ---------------------------------------------------------------------------
process.stdout.write('\n[g] Determinism: same input → byte-identical JSON output twice\n');
{
  const input = {
    objective: 'adopt a new dependency kit-wide',
    signals: { tier: 'architectural', domain: 'general', work: { executionMode: 'workflow', confidence: 'medium' }, decisionKind: 'ARCHITECTURE', decisionScope: 'platform', objectiveLower: 'adopt a new dependency kit-wide', policy: P },
    triple: { primaryContext: { type: 'platform', id: 'platform' }, decisionKind: 'ARCHITECTURE', decisionScope: 'platform' },
    registry: EMPTY_REG, policy: P,
  };
  assert('classifyDecisionNeed deterministic', JSON.stringify(classifyDecisionNeed(input)) === JSON.stringify(classifyDecisionNeed(input)));
  assert('materialityScore deterministic', JSON.stringify(materialityScore(input.signals)) === JSON.stringify(materialityScore(input.signals)));

  // §28 anchor: "adopt a new dependency kit-wide"
  //   vendorTokens: "new dependency" → structuralVendor +4
  //   crossCuttingArchTokens: "kit-wide" → crossCuttingArch +5
  //   total = 9 → required
  const anchorArch = materialityScore(input.signals);
  assert('§28 anchor: new-dependency kit-wide → score=9/required',
    anchorArch.score === 9 && anchorArch.band === 'required', `got ${anchorArch.score}/${anchorArch.band}`);

  // §28 anchor: lgpd domain alone (no objective text) → score=0/none
  //   HR-4 regulated-domain floor is applied at the classifier level, not materialityScore
  const anchorRegulated = materialityScore({ tier: 'feature', domain: 'lgpd', work: {}, decisionScope: 'workflow', policy: P });
  assert('§28 anchor: lgpd domain alone → score=0/none (HR-4 is classifier-level)',
    anchorRegulated.score === 0 && anchorRegulated.band === 'none', `got ${anchorRegulated.score}/${anchorRegulated.band}`);
}

// ---------------------------------------------------------------------------
// [h] Defensive: never throws on null/hostile input
// ---------------------------------------------------------------------------
process.stdout.write('\n[h] Defensive: never throws on hostile input\n');
{
  let threw = false;
  try {
    classifyDecisionNeed(null); classifyDecisionNeed(undefined); classifyDecisionNeed({});
    classifyDecisionNeed({ objective: null, signals: null, triple: null, registry: null });
    classifyDecisionNeed({ objective: 42, signals: [], triple: 'bad', registry: {} });
  } catch { threw = true; }
  assert('classifyDecisionNeed never throws', threw === false);
  const safe = classifyDecisionNeed({});
  assert('classifyDecisionNeed({}) → needVerdict string', typeof safe.needVerdict === 'string');
  assert('classifyDecisionNeed({}) → coverageMode string', typeof safe.coverageMode === 'string');
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
